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
import { Store }          from '../../core/Store.js';
import { EventBus }       from '../../core/EventBus.js';
import { SeedFactory }    from '../../data/seed.js';
import { APP_SUPABASE_URL, APP_SUPABASE_KEY } from '../../data/constants.js';
import { RecurringService }  from './RecurringService.js';
import { CurrencyService }   from './CurrencyService.js';
import { AccountService }    from './AccountService.js';

export class SyncService {
  /** @type {Store} */           #store;
  /** @type {EventBus} */        #bus;
  /** @type {CurrencyService} */ #fx;

  // Supabase SDK client (null until sbInit() succeeds)
  #sb = null;
  #user = null;
  #cloudVersion = 0;
  #saveTimer = null;
  #channel = null;
  #subscribed = false;

  // Optimistic-UI tracking for family sharing
  #pendingRemovals  = new Set();
  #pendingAdditions = new Map();
  #sharedData       = [];

  constructor() {
    this.#store = Store.getInstance();
    this.#bus   = EventBus.getInstance();
    this.#fx    = new CurrencyService();
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

    // Fire-and-forget: Supabase v2 calls onAuthStateChange(SIGNED_OUT) synchronously
    // inside auth.signOut() before the network revocation request.  The SIGNED_OUT
    // handler below resets state when #user is still set.  We guard with `if (this.#user)`
    // after this call as a fallback for Supabase versions that fire SIGNED_OUT
    // asynchronously — whichever path runs first wins, the other is a no-op.
    this.#sb.auth.signOut().catch(() => {});

    // If SIGNED_OUT hasn't fired yet (async path), reset state now and emit showSignIn.
    // If it already fired (sync path, #user already null), these are no-ops.
    if (this.#user) {
      this.#user = null;
      this.#channel = null;
      this.#subscribed = false;
      this.#cloudVersion = 0;
      this.#sharedData = [];
      this.#pendingRemovals.clear();
      this.#pendingAdditions.clear();
      this.#store.reset(() => SeedFactory.create(), (s) => this.#migrateDefaults(s));
      this.#emitStatus('local');
      this.#emitUser(null);
      this.#bus.emit('auth:changed', { user: null, showSignIn: true });
    }
  }

  async restoreSession() {
    if (!this.#sb) return {};

    // Listener for auth changes AFTER initial load: OAuth sign-in completion and
    // explicit/remote sign-out (or failed token refresh). The INITIAL restore is
    // handled by getSession() below — which reliably returns the persisted
    // session on a plain page refresh (the onAuthStateChange-only approach was
    // racy and could drop the session on reload). Mirrors the reference impl.
    this.#sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        if (!this.#user) this.#adoptSession(session.user);
      } else if (event === 'SIGNED_OUT' && this.#user) {
        this.#resetToGuest(true);
      }
    });

    // Primary restore — getSession() returns the persisted session on refresh and
    // after the OAuth redirect hash has been parsed by the client.
    try {
      const { data } = await this.#sb.auth.getSession();
      const user = data?.session?.user ?? null;
      if (user) {
        const isFirst = await this.#adoptSession(user);
        return { isFirstSignIn: isFirst };
      }
    } catch (e) {
      console.warn('[SyncService] getSession failed:', e);
    }

    // No persisted session → run as local/guest and prompt sign-in.
    this.#resetToGuest(false);
    return { isFirstSignIn: false, needsSignIn: true };
  }

  /**
   * Adopt a restored / freshly signed-in session: pull cloud data + subscribe.
   * @param {object} user
   * @returns {Promise<boolean>} isFirstSignIn
   */
  async #adoptSession(user) {
    if (this.#user) return false;
    this.#user = user;
    this.#emitUser(user);
    this.#emitStatus('syncing');
    this.#bus.emit('auth:changed', { user });
    if (window.location.hash.includes('access_token')) {
      history.replaceState(null, '', window.location.pathname);
    }
    const isFirst = await this.pull();
    this.#subscribe();
    return isFirst;
  }

  /**
   * Drop back to local/guest state, wiping cloud-derived data so the next user
   * never sees the previous one's records.
   * @param {boolean} showSignIn  prompt the sign-in modal (true after sign-out)
   */
  #resetToGuest(showSignIn) {
    this.#user = null;
    this.#channel = null;
    this.#subscribed = false;
    this.#cloudVersion = 0;
    this.#sharedData = [];
    this.#pendingRemovals.clear();
    this.#pendingAdditions.clear();
    this.#store.reset(() => SeedFactory.create(), (s) => this.#migrateDefaults(s));
    this.#emitStatus('local');
    this.#emitUser(null);
    this.#bus.emit('auth:changed', { user: null, showSignIn });
  }

  get currentUser() {
    return this.#user;
  }

  get sharedData() {
    return this.#sharedData;
  }

  /**
   * Public entry point to re-pull family shares from the cloud and notify the
   * UI.  The heavy lifting stays in the private #pullFamilyShares(); this
   * wrapper exists because private fields are inaccessible from app.js (#3/#16).
   */
  async pullFamilyShares() {
    await this.#pullFamilyShares();
    this.#bus.emit('state:changed', this.#store.getState());
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
        // Re-emit state:changed so views update with freshly-loaded shared data
        // (replaceState() emits state:changed before #pullFamilyShares() runs)
        this.#bus.emit('state:changed', this.#store.getState());
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
    if (!this.#sb || !this.#user || this.#subscribed) return;
    this.#subscribed = true;
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

  /**
   * Submit a transaction on behalf of a shared-account member.
   *
   * Uses upsert with ignoreDuplicates so a retry never causes a constraint error.
   * Applies an optimistic balance update to #sharedData immediately so the
   * member sees the correct balance without waiting for the owner snapshot.
   * Tracks the tx in #pendingAdditions so it survives the next pullFamilyShares.
   *
   * @param {string} ownerId  Supabase user ID of the account owner
   * @param {object} txData   Transaction object to contribute
   */
  async submitContribution(ownerId, txData) {
    if (!this.#sb || !this.#user) throw new Error('Not signed in');
    const { error } = await this.#sb.from('family_contributions').upsert({
      owner_id:     ownerId,
      member_email: this.#user.email.toLowerCase(),
      account_id:   txData.accountId ?? null,
      tx_data:      txData,
      synced:       false,
    }, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;

    // Optimistic: add tx to #sharedData and update balance
    const shareIndex = this.#sharedData.findIndex((s) => s._ownerId === ownerId);
    if (shareIndex >= 0) {
      this.#sharedData[shareIndex].transactions = [
        txData,
        ...(this.#sharedData[shareIndex].transactions || []),
      ];
      this.#sharedApplyBalance(shareIndex, txData.accountId, txData, false);
      this.#pendingAdditions.set(txData.id, { tx: txData, shareIndex });
      this.#bus.emit('state:changed', this.#store.getState());
    }
  }

  /**
   * Ask the owner to delete a specific transaction the member previously added.
   *
   * Uses upsert with a stable `del_${txId}` id so the marker is idempotent:
   * a double-tap never causes a unique-constraint error.
   * Applies an optimistic balance revert and hides the tx from #sharedData
   * immediately via #pendingRemovals.
   *
   * @param {string} ownerId  Owner's Supabase user ID
   * @param {string} txId     Transaction ID to delete
   */
  async deleteContribution(ownerId, txId) {
    if (!this.#sb || !this.#user) throw new Error('Not signed in');

    // Guard: if already pending removal, just clean up UI — no duplicate DB write
    if (this.#pendingRemovals.has(txId)) {
      this.#sharedData.forEach((share) => {
        share.transactions = (share.transactions || []).filter((t) => t.id !== txId);
      });
      this.#bus.emit('state:changed', this.#store.getState());
      return;
    }

    // Optimistic: revert balance and hide the tx
    this.#pendingRemovals.add(txId);
    const shareIndex = this.#sharedData.findIndex((s) =>
      (s.transactions || []).some((t) => t.id === txId),
    );
    if (shareIndex >= 0) {
      const tx = (this.#sharedData[shareIndex].transactions || []).find((t) => t.id === txId);
      if (tx) this.#sharedApplyBalance(shareIndex, tx.accountId, tx, true);
      this.#sharedData[shareIndex].transactions =
        (this.#sharedData[shareIndex].transactions || []).filter((t) => t.id !== txId);
      this.#bus.emit('state:changed', this.#store.getState());
    }

    // Stable delete-marker id = 'del_' + txId → upsert is idempotent on double-tap
    const { error } = await this.#sb.from('family_contributions').upsert({
      owner_id:     ownerId,
      member_email: this.#user.email.toLowerCase(),
      account_id:   null,
      tx_data:      { _delete: true, id: `del_${txId}`, targetId: txId },
      synced:       false,
    }, { onConflict: 'id', ignoreDuplicates: true });

    if (error) {
      // Roll back optimistic removal
      this.#pendingRemovals.delete(txId);
      throw error;
    }
  }

  /**
   * Schedule a pullFamilyShares + state:changed after a delay.
   * Called after shared tx submit/delete to get the owner's confirmed snapshot.
   * @param {number} delayMs
   */
  scheduleSharesRefresh(delayMs) {
    setTimeout(async () => {
      if (!this.#sb || !this.#user) return;
      try {
        await this.#pullFamilyShares();
        this.#bus.emit('state:changed', this.#store.getState());
      } catch (_) {}
    }, delayMs);
  }

  /**
   * Optimistically update a shared account's balance when a member tx is added/removed.
   * Mirrors the reference's _sharedApplyBalance.
   *
   * @param {number}  shareIndex  Index into #sharedData
   * @param {string}  accountId   Account the tx affects
   * @param {object}  tx          Transaction object
   * @param {boolean} reverse     true = revert (delete), false = apply (add)
   */
  #sharedApplyBalance(shareIndex, accountId, tx, reverse = false) {
    const share = this.#sharedData[shareIndex];
    if (!share) return;

    const applyToAccount = (accId, amount, currency) => {
      const acc = (share.accounts || []).find((a) => a.id === accId);
      if (!acc) return;
      const m     = this.#fx.convert(amount, currency, acc.currency);
      const delta = tx.type === 'expense' ? -m : tx.type === 'income' ? m : 0;
      acc.balance += reverse ? -delta : delta;
    };

    if (Array.isArray(tx.splits) && tx.splits.length) {
      for (const s of tx.splits) {
        applyToAccount(s.accountId || accountId, s.amount, tx.currency);
      }
    } else {
      applyToAccount(accountId, tx.amount, tx.currency);
    }
  }

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
        // Owner's home currency so members can embed correct exchangeRate /
        // refAmount on contributed transactions (#21).
        homeCurrency: state.user.homeCurrency,
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

      // Re-apply pending removals — clean up once the server confirms removal
      for (const txId of [...this.#pendingRemovals]) {
        if (!rawIds.has(txId)) this.#pendingRemovals.delete(txId);
      }
      if (this.#pendingRemovals.size) {
        this.#sharedData.forEach((share) => {
          share.transactions = (share.transactions || []).filter((t) => !this.#pendingRemovals.has(t.id));
        });
      }

      // Re-apply pending additions — keep optimistically-added txs visible until
      // the owner's snapshot arrives (which will include them).
      for (const [txId, { tx, shareIndex }] of [...this.#pendingAdditions]) {
        const share = this.#sharedData[shareIndex];
        if (!share) { this.#pendingAdditions.delete(txId); continue; }
        // Once the server includes the tx in the snapshot, drop it from pending
        const alreadyIn = (share.transactions || []).some((t) => t.id === txId);
        if (alreadyIn) { this.#pendingAdditions.delete(txId); continue; }
        // Still pending — prepend to the share's transaction list
        share.transactions = [tx, ...(share.transactions || [])];
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
        // Revert each deleted contribution's balance impact before removing it —
        // otherwise the owner's account balances stay permanently wrong (#23).
        const accountSvc = new AccountService();
        state.transactions
          .filter((t) => deleteIds.has(t.id))
          .forEach((t) => { try { accountSvc.revertBalances(t); } catch (_) {} });
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
