/**
 * SyncService — Supabase cloud sync, auth, and family sharing.
 *
 * Encapsulates all cloud operations so the rest of the app never
 * directly touches the Supabase SDK.  Emits EventBus events so the
 * UI can react without coupling to this service.
 *
 * Events emitted:
 *   'sync:status'    { status: 'local'|'syncing'|'synced'|'error' }
 *   'sync:user'      { user: object|null }
 */
import { Store }      from '../../core/Store.js';
import { EventBus }   from '../../core/EventBus.js';
import { SeedFactory } from '../../data/seed.js';
import { APP_SUPABASE_URL, APP_SUPABASE_KEY } from '../../data/constants.js';
import { RecurringService } from './RecurringService.js';

export class SyncService {
  /** @type {Store} */    #store;
  /** @type {EventBus} */ #bus;

  // Supabase SDK client (null until sbInit() succeeds)
  #sb = null;
  #user = null;
  #cloudVersion = 0;
  #saveTimer = null;
  #channel = null;

  // Optimistic-UI tracking for family sharing
  #pendingRemovals  = new Set();
  #pendingAdditions = new Map();
  #sharedData       = [];

  constructor() {
    this.#store = Store.getInstance();
    this.#bus   = EventBus.getInstance();
  }

  // ── Init ─────────────────────────────────────────────────────────────

  /** @returns {boolean} true if Supabase is configured */
  isManagedMode() {
    return !!(APP_SUPABASE_URL && APP_SUPABASE_KEY);
  }

  /**
   * Initialise Supabase client.
   * @returns {boolean}
   */
  init() {
    const state = this.#store.getState();
    const url   = (APP_SUPABASE_URL || state.user.supabaseUrl || '').trim();
    const key   = (APP_SUPABASE_KEY || state.user.supabaseKey || '').trim();
    if (!url || !key) return false;

    try {
      // eslint-disable-next-line no-undef
      this.#sb = supabase.createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
      return true;
    } catch (e) {
      console.error('[SyncService] Supabase init error:', e);
      return false;
    }
  }

  // ── Auth ──────────────────────────────────────────────────────────────

  async signInWithGoogle() {
    if (!this.#sb) { this.#toast('Configure Supabase first'); return; }
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await this.#sb.auth.signInWithOAuth({
      provider: 'google',
      options:  { redirectTo, queryParams: { prompt: 'select_account' } },
    });
    if (error) this.#toast('Google sign-in error: ' + error.message);
  }

  async signOut() {
    if (!this.#sb) return;
    await this.#sb.auth.signOut();
    this.#user = null;
    this.#channel = null;
    this.#store.reset(() => SeedFactory.create(), (s) => this.#migrateDefaults(s));
    this.#sharedData = [];
    this.#pendingRemovals.clear();
    this.#pendingAdditions.clear();
    this.#cloudVersion = 0;
    this.#emitStatus('local');
    this.#emitUser(null);
  }

  async restoreSession() {
    if (!this.#sb) return;

    // onAuthStateChange handles OAuth redirects (fires SIGNED_IN after token exchange)
    this.#sb.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user && !this.#user) {
        this.#user = session.user;
        await this.pull();
        this.#subscribe();
        this.#emitUser(this.#user);
        if (window.location.hash.includes('access_token')) {
          history.replaceState(null, '', window.location.pathname);
        }
        // Re-render the full app after OAuth sign-in
        this.#bus.emit('auth:changed', { user: this.#user });
      } else if (event === 'SIGNED_OUT') {
        this.#user = null;
        this.#emitUser(null);
        this.#bus.emit('auth:changed', { user: null });
      }
    });

    const { data: sessionData } = await this.#sb.auth.getSession();
    if (sessionData?.session?.user) {
      this.#user = sessionData.session.user;
      const isFirst = await this.pull();
      this.#subscribe();
      this.#emitUser(this.#user);
      if (window.location.hash.includes('access_token')) {
        history.replaceState(null, '', window.location.pathname);
      }
      return { isFirstSignIn: isFirst };
    } else {
      // Always emit null so Navigation renders the sign-in button
      this.#emitUser(null);
      return { isFirstSignIn: false, needsSignIn: true };
    }
  }

  get currentUser() {
    return this.#user;
  }

  get sharedData() {
    return this.#sharedData;
  }

  // ── Save / Push ───────────────────────────────────────────────────────

  /** Debounced cloud push — called after every local save. */
  schedulePush() {
    if (!this.#sb || !this.#user) return;
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.push(), 1000);
  }

  async push() {
    if (!this.#sb || !this.#user) return;
    this.#emitStatus('syncing');
    try {
      if (this.#cloudVersion > 0) {
        const { data: peek } = await this.#sb
          .from('user_data').select('version').eq('id', this.#user.id).single();
        if ((peek?.version ?? 0) > this.#cloudVersion) {
          this.#toast('Another device saved first — merging…');
          await this.pull();
          return;
        }
      }
      const nextVersion = this.#cloudVersion + 1;
      const { error } = await this.#sb.from('user_data').upsert({
        id:         this.#user.id,
        data:       this.#store.getState(),
        version:    nextVersion,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
      if (error) throw error;
      this.#cloudVersion = nextVersion;
      this.#emitStatus('synced');
      await this.#pushFamilyShares();
      await this.#pullMemberContributions();
    } catch (e) {
      console.error('[SyncService] Cloud save error:', e);
      this.#emitStatus('error');
      this.#toast('Sync error: ' + (e.message || e));
    }
  }

  // ── Pull ──────────────────────────────────────────────────────────────

  /** @returns {boolean} isFirstSignIn */
  async pull() {
    if (!this.#sb || !this.#user) return false;
    this.#emitStatus('syncing');
    try {
      const { data, error } = await this.#sb
        .from('user_data').select('data, version, updated_at')
        .eq('id', this.#user.id).single();

      if (error && error.code !== 'PGRST116') throw error;

      if (data?.data) {
        this.#store.replaceState(data.data);
        this.#cloudVersion = data.version ?? 0;
        new RecurringService().process();
        await this.#pullFamilyShares();
        await this.#pullMemberContributions();
        this.#emitStatus('synced');
        return false;
      } else {
        // First sign-in
        this.#cloudVersion = 0;
        await this.push();
        this.#emitStatus('synced');
        return true;
      }
    } catch (e) {
      console.error('[SyncService] Cloud load error:', e);
      this.#emitStatus('error');
      this.#toast('Sync error: ' + (e.message || e));
      return false;
    }
  }

  // ── Real-time subscription ────────────────────────────────────────────

  #subscribe() {
    if (!this.#sb || !this.#user) return;
    // Main user-data channel
    this.#channel = this.#sb
      .channel('pocket_realtime_' + this.#user.id)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'user_data',
        filter: `id=eq.${this.#user.id}`,
      }, () => this.pull())
      .subscribe();

    // Family shares channel (member side)
    const email   = this.#user.email?.toLowerCase().replace(/[^a-z0-9]/g, '_') || '';
    const sharesChannel = this.#sb.channel('pocket_family_' + email)
      .on('broadcast', { event: 'share_updated' }, async () => {
        await this.#pullFamilyShares();
        this.#bus.emit('state:changed', this.#store.getState());
      })
      .subscribe();

    // Contributions channel (owner side)
    const contribChannel = this.#sb.channel('pocket_contrib_' + this.#user.id)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'family_contributions',
        filter: `owner_id=eq.${this.#user.id}`,
      }, () => this.#pullMemberContributions())
      .subscribe();

    this._sharesChannel  = sharesChannel;
    this._contribChannel = contribChannel;
  }

  // ── Family sharing (private) ─────────────────────────────────────────

  async #pushFamilyShares() {
    const state = this.#store.getState();
    if (!this.#sb || !this.#user || !state.family?.length) return;
    for (const member of state.family) {
      if (!member.email) continue;
      const permMap  = {};
      (member.permissions || []).forEach((p) => { permMap[p.accountId] = p.access; });
      const sharedIds = Object.keys(permMap);
      if (!sharedIds.length) continue;
      const snapshot = {
        sharedBy:     state.user.name || this.#user.email,
        permission:   permMap,
        accounts:     state.accounts.filter((a) => sharedIds.includes(a.id)),
        transactions: state.transactions.filter((t) =>
          permMap[t.accountId] || (t.splits || []).some((s) => permMap[s.accountId]),
        ),
        categories:   state.categories,
        updatedAt:    new Date().toISOString(),
      };
      try {
        await this.#sb.from('family_shares').upsert({
          owner_id:     this.#user.id,
          member_email: member.email.toLowerCase().trim(),
          snapshot,
        }, { onConflict: 'owner_id,member_email' });
        this.#broadcastToMember(member.email.toLowerCase().trim());
      } catch (e) { console.warn('[SyncService] pushFamilyShares error:', e); }
    }
  }

  #broadcastToMember(email) {
    if (!this.#sb) return;
    const chanName = 'pocket_family_' + email.replace(/[^a-z0-9]/g, '_');
    const ch = this.#sb.channel(chanName);
    ch.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      ch.send({ type: 'broadcast', event: 'share_updated', payload: {} });
      setTimeout(() => { try { this.#sb.removeChannel(ch); } catch (_) {} }, 3000);
    });
  }

  async #pullFamilyShares() {
    if (!this.#sb || !this.#user?.email) return;
    try {
      const { data, error } = await this.#sb
        .from('family_shares')
        .select('owner_id, snapshot')
        .eq('member_email', this.#user.email.toLowerCase());
      if (error) { console.warn('[SyncService] pullFamilyShares error:', error); return; }

      const rawIds = new Set((data || []).flatMap((r) => (r.snapshot?.transactions || []).map((t) => t.id)));

      this.#sharedData = (data || [])
        .filter((r) => r.snapshot && r.owner_id !== this.#user.id)
        .map((r) => ({ ...r.snapshot, _ownerId: r.owner_id }));

      // Re-apply pending optimistic mutations
      if (this.#pendingRemovals.size) {
        for (const txId of [...this.#pendingRemovals]) {
          if (!rawIds.has(txId)) this.#pendingRemovals.delete(txId);
        }
        if (this.#pendingRemovals.size) {
          this.#sharedData.forEach((share) => {
            share.transactions = (share.transactions || []).filter((t) => !this.#pendingRemovals.has(t.id));
          });
        }
      }
    } catch (e) { console.warn('[SyncService] pullFamilyShares error:', e); }
  }

  async #pullMemberContributions() {
    if (!this.#sb || !this.#user) return;
    try {
      const { data, error } = await this.#sb
        .from('family_contributions')
        .select('id, tx_data')
        .eq('owner_id', this.#user.id)
        .eq('synced', false);
      if (error || !data?.length) return;

      const state      = this.#store.getState();
      const deleteRows = data.filter((r) => r.tx_data?._delete === true);
      const addRows    = data.filter((r) => !r.tx_data?._delete && r.tx_data?.id);

      if (deleteRows.length) {
        const deleteIds = new Set(deleteRows.map((r) => r.tx_data.targetId || r.tx_data.id));
        state.transactions
          .filter((t) => deleteIds.has(t.id))
          .forEach((t) => { try { /* revert handled externally */ } catch (_) {} });
        state.transactions = state.transactions.filter((t) => !deleteIds.has(t.id));
      }

      const existingIds = new Set(state.transactions.map((t) => t.id));
      const newRows     = addRows.filter((r) => r.tx_data?.id && !existingIds.has(r.tx_data.id));

      newRows.forEach((row) => {
        const tx = { ...row.tx_data, _fromFamily: true };
        state.transactions.push(tx);
      });

      if (newRows.length || deleteRows.length) {
        this.#store.persist();
        const { error: saveErr } = await this.#sb.from('user_data').upsert({
          id:         this.#user.id,
          data:       state,
          version:    this.#cloudVersion + 1,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });
        if (!saveErr) {
          this.#cloudVersion += 1;
          const ids = data.map((r) => r.id);
          await this.#sb.from('family_contributions').update({ synced: true }).in('id', ids);
          await this.#pushFamilyShares();
          this.#bus.emit('state:changed', state);
          const n = newRows.length + deleteRows.length;
          if (n > 0) this.#toast(`${n} family change${n > 1 ? 's' : ''} synced`);
        }
      }
    } catch (e) { console.warn('[SyncService] pullMemberContributions error:', e); }
  }

  // ── Private helpers ──────────────────────────────────────────────────

  #emitStatus(status) {
    this.#bus.emit('sync:status', { status });
  }

  #emitUser(user) {
    this.#bus.emit('sync:user', { user });
  }

  #toast(msg) {
    this.#bus.emit('toast', { message: msg });
  }

  #migrateDefaults(state) {
    state.user = Object.assign({
      homeCurrency:'USD', defaultCurrency:'USD', theme:'system',
      showHijri:true, calendarMode:'both', dateFormat:'auto',
      geminiApiKey:'', supabaseUrl:'', supabaseKey:'',
      customPaymentTypes:[], collapsedAccountGroups:[], collapsedCategories:[],
    }, state.user);
    if (!Array.isArray(state.debts))        state.debts = [];
    if (!Array.isArray(state.regularItems)) state.regularItems = [];
    if (!Array.isArray(state.accountGroups)) state.accountGroups = [];
    if (!Array.isArray(state.family))       state.family = [];
  }
}
