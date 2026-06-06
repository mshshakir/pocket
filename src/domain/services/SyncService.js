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
import { StateMigrator }  from '../../data/StateMigrator.js';
import { APP_SUPABASE_URL, APP_SUPABASE_KEY } from '../../data/constants.js';
import { RecurringService }  from './RecurringService.js';
import { CurrencyService }   from './CurrencyService.js';
import { LedgerMath }        from './LedgerMath.js';

export class SyncService {
  /** @type {Store} */           #store;
  /** @type {EventBus} */        #bus;
  /** @type {CurrencyService} */ #fx;

  // Supabase SDK client (null until sbInit() succeeds)
  #sb = null;
  #user = null;
  #cloudVersion = 0;
  // The version THIS device last wrote. Realtime UPDATE events carrying this
  // version are our own echo and are ignored, so a local push no longer triggers
  // a redundant self-pull (replaceState + re-render + recurring re-scan).
  #lastSelfVersion = 0;
  #saveTimer = null;
  #channel = null;
  #sharesChannel  = null;
  #contribChannel = null;
  #subscribed = false;

  // Serialises push/pull so overlapping cloud operations can't interleave and
  // clobber each other (last-pull-wins races).
  #syncing = Promise.resolve();

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
    // inside auth.signOut() before the network revocation request. Whichever path
    // (this guard or the SIGNED_OUT handler) runs first does the reset; the other
    // becomes a no-op because #user is already null. Both delegate to the single
    // #resetToGuest() so the reset logic — including channel teardown — lives in
    // exactly one place.
    this.#sb.auth.signOut().catch(() => {});
    if (this.#user) this.#resetToGuest(true);
  }

  /** Remove all realtime channels so they don't leak across sessions/users. */
  #teardownChannels() {
    for (const ch of [this.#channel, this.#sharesChannel, this.#contribChannel]) {
      if (ch) { try { this.#sb?.removeChannel(ch); } catch (_) {} }
    }
    this.#channel = this.#sharesChannel = this.#contribChannel = null;
    this.#subscribed = false;
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
    this.#teardownChannels();
    this.#user = null;
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
    // push() already serialises through #syncing, so a push never overlaps an
    // in-flight push/pull.
    this.#saveTimer = setTimeout(() => this.push(), 1000);
  }

  /** Public push — serialised through the sync queue. */
  push() {
    this.#syncing = this.#syncing.then(() => this.#doPush()).catch(() => {});
    return this.#syncing;
  }

  /**
   * The SINGLE choke point for writing local state to the cloud. Performs an
   * ATOMIC compare-and-swap: the write only succeeds when the row's version
   * still equals the one we last saw. If another device advanced it, zero rows
   * come back and this returns false so the caller can pull+merge instead of
   * blindly clobbering newer data. Every cloud write — the normal push AND the
   * family-contribution writeback — must go through here; a blind upsert
   * anywhere else reintroduces the lost-update race.
   * @param {object} state  the state snapshot to persist
   * @returns {Promise<boolean>} true on success, false if a newer version won
   */
  async #commitState(state) {
    const expected = this.#cloudVersion;
    if (expected > 0) {
      const { data: rows, error } = await this.#sb
        .from('user_data')
        .update({ data: state, version: expected + 1, updated_at: new Date().toISOString() })
        .eq('id', this.#user.id)
        .eq('version', expected)
        .select('version');
      if (error) throw error;
      if (!rows || !rows.length) return false; // another device advanced it
      this.#cloudVersion = expected + 1;
      this.#lastSelfVersion = this.#cloudVersion; // mark our own write to ignore its echo
      return true;
    }
    // First write for this user (no row yet) — insert via upsert.
    const { error } = await this.#sb.from('user_data').upsert({
      id:         this.#user.id,
      data:       state,
      version:    1,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (error) throw error;
    this.#cloudVersion = 1;
    this.#lastSelfVersion = this.#cloudVersion;
    return true;
  }

  async #doPush() {
    if (!this.#sb || !this.#user) return;
    this.#emitStatus('syncing');
    try {
      const ok = await this.#commitState(this.#store.getState());
      if (!ok) {
        this.#toast('Another device saved first — merging…');
        await this.#doPull();
        return;
      }
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

  /**
   * Public pull — serialised through the sync queue so concurrent realtime
   * events can't interleave replaceState() calls.
   * @returns {Promise<boolean>} isFirstSignIn
   */
  pull() {
    this.#syncing = this.#syncing.then(() => this.#doPull()).catch(() => false);
    return this.#syncing;
  }

  /** @returns {boolean} isFirstSignIn */
  async #doPull() {
    if (!this.#sb || !this.#user) return false;
    this.#emitStatus('syncing');
    try {
      const { data, error } = await this.#sb
        .from('user_data').select('data, version, updated_at')
        .eq('id', this.#user.id).single();

      if (error && error.code !== 'PGRST116') throw error;

      if (data?.data) {
        // Migrate the cloud snapshot to the current schema BEFORE it becomes
        // active state (older snapshots may miss newer arrays / openingBalance).
        this.#store.replaceState(data.data, (s) => this.#migrateDefaults(s));
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
        // First sign-in. Call #doPush() directly (NOT push()) — we're already
        // running inside the #syncing chain, so re-entering it would deadlock.
        this.#cloudVersion = 0;
        await this.#doPush();
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
      }, (payload) => {
        // Ignore the echo of our own write; only pull when ANOTHER device advanced
        // the row. (If the payload omits the version, fall back to always pulling.)
        const v = payload?.new?.version;
        if (v != null && v === this.#lastSelfVersion) return;
        this.pull();
      })
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

    // Track on private fields so #teardownChannels() can remove them on sign-out.
    this.#sharesChannel  = sharesChannel;
    this.#contribChannel = contribChannel;
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

    // Optimistic: add tx to the matching share and re-derive its balances.
    const share = this.#sharedData.find((s) => s._ownerId === ownerId);
    if (share) {
      share.transactions = [txData, ...(share.transactions || [])];
      this.#deriveShareBalances(share);
      // Key by stable ownerId (NOT array index — #sharedData is rebuilt on each
      // pull and indices shift, which previously attached txs to the wrong owner).
      this.#pendingAdditions.set(txData.id, { tx: txData, ownerId });
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

    // Optimistic: hide the tx and re-derive the affected share's balances.
    this.#pendingRemovals.add(txId);
    const share = this.#sharedData.find((s) =>
      (s.transactions || []).some((t) => t.id === txId),
    );
    if (share) {
      share.transactions = (share.transactions || []).filter((t) => t.id !== txId);
      this.#deriveShareBalances(share);
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
   * Re-derive a shared snapshot's account balances from its own transaction
   * list using the SAME LedgerMath authority the rest of the app uses. Replaces
   * the old bespoke optimistic-balance arithmetic, so there is one balance model
   * everywhere. The owner's snapshot carries openingBalance per account, so
   * `openingBalance + ledger(share.transactions)` reproduces the owner's
   * derived balance for each shared account.
   * @param {object} share
   */
  #deriveShareBalances(share) {
    if (!share || !Array.isArray(share.accounts)) return;
    const balances = LedgerMath.balances(share.accounts, share.transactions || [], this.#fx);
    for (const a of share.accounts) a.balance = balances.get(a.id) ?? a.balance ?? 0;
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
      // the owner's snapshot arrives (which will include them). Resolve the share
      // by stable ownerId, not a positional index.
      for (const [txId, { tx, ownerId }] of [...this.#pendingAdditions]) {
        const share = this.#sharedData.find((s) => s._ownerId === ownerId);
        if (!share) { this.#pendingAdditions.delete(txId); continue; }
        // Once the server includes the tx in the snapshot, drop it from pending
        const alreadyIn = (share.transactions || []).some((t) => t.id === txId);
        if (alreadyIn) { this.#pendingAdditions.delete(txId); continue; }
        // Still pending — prepend to the share's transaction list
        share.transactions = [tx, ...(share.transactions || [])];
      }

      // Re-derive balances for every share so optimistic add/remove edits are
      // reflected using the single LedgerMath authority.
      for (const share of this.#sharedData) this.#deriveShareBalances(share);
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
        // Just drop the transactions — owner balances are derived and recomputed
        // by the Store's persist hook below, so there is no manual revert to do.
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
        // Version-guarded write (NOT a blind upsert) so a concurrent device's
        // newer snapshot is never clobbered. On a lost race we pull the winner;
        // the contributions stay synced=false and are re-applied next pull.
        const committed = await this.#commitState(state);
        if (committed) {
          const ids = data.map((r) => r.id);
          await this.#sb.from('family_contributions').update({ synced: true }).in('id', ids);
          await this.#pushFamilyShares();
          this.#bus.emit('state:changed', state);
          const n = newRows.length + deleteRows.length;
          if (n > 0) this.#toast(`${n} family change${n > 1 ? 's' : ''} synced`);
        } else {
          this.#toast('Another device saved first — merging…');
          await this.#doPull();
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
    // Single migration authority (also back-fills openingBalance for derived
    // balances) so local load and cloud pull stay in lockstep.
    StateMigrator.migrate(state, this.#fx);
  }
}
