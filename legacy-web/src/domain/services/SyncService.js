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
import { Repository }     from '../../core/Repository.js';
import { SyncJournal }    from '../../core/SyncJournal.js';
import { EventBus }       from '../../core/EventBus.js';
import { SeedFactory }    from '../../data/seed.js';
import { StateMigrator }  from '../../data/StateMigrator.js';
import { APP_SUPABASE_URL, APP_SUPABASE_KEY } from '../../data/constants.js';
import { RecurringService }  from './RecurringService.js';
import { CurrencyService }   from './CurrencyService.js';
import { LedgerMath }        from './LedgerMath.js';
import { BudgetService }     from './BudgetService.js';

/** Trailing-edge debounce applied after each local save. */
const PUSH_DEBOUNCE_MS = 1000;
/**
 * Hard ceiling on how long an uncommitted edit may sit in the debounce window.
 * A pure trailing-edge debounce is re-armed by every subsequent save, so
 * entering transactions back-to-back could postpone the durable write
 * indefinitely — exactly the window three entries were lost in.
 */
const MAX_PUSH_WAIT_MS = 3000;
/** Backoff for retrying a push that failed on the network. */
const RETRY_BASE_MS  = 4000;
const MAX_PUSH_RETRIES = 4;

export class SyncService {
  /** @type {Store} */           #store;
  /** @type {EventBus} */        #bus;
  /** @type {CurrencyService} */ #fx;

  // Supabase SDK client (null until sbInit() succeeds)
  #sb = null;
  #user = null;
  /**
   * Version of the cloud row this device last saw.
   *   null → UNKNOWN: no pull has succeeded this session.
   *   0    → confirmed no row exists yet (genuine first sign-in).
   *   >0   → the row's version.
   * The null/0 distinction is load-bearing: #commitState treats 0 as "insert
   * the first row" and upserts without a CAS guard, so conflating "we never
   * managed to read the cloud" with "the cloud is empty" let a device that
   * failed its pull overwrite the entire remote history — with seed data, if
   * localStorage happened to be empty too.
   */
  #cloudVersion = null;
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

  /** True when local edits have not yet been committed to the cloud. */
  #dirty = false;
  /** Timestamp of the edit that started the current uncommitted run. */
  #dirtySince = 0;
  /** Consecutive failed pushes, for the backoff in #retryPushLater(). */
  #pushRetries = 0;
  /** Re-entrancy guard for the flush-before-pull path. */
  #flushing = false;
  /** True once the page-hide flush listeners are attached. */
  #lifecycleBound = false;
  /** Durable "there are uncommitted local edits" marker — survives a reload. */
  /** @type {SyncJournal} */ #journal;
  /** True only for a user-initiated sign-out (not a failed token refresh). */
  #explicitSignOut = false;

  constructor() {
    this.#store   = Store.getInstance();
    this.#bus     = EventBus.getInstance();
    this.#fx      = new CurrencyService();
    this.#journal = new SyncJournal();
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
      this.#bindLifecycleFlush();
      return true;
    } catch (e) {
      console.error('[SyncService] Supabase init error:', e);
      return false;
    }
  }

  /**
   * Flush any pending push the moment the page stops being visible.
   *
   * `visibilitychange → hidden` is the last event a mobile browser reliably
   * delivers: switching apps, locking the screen or changing tab all fire it,
   * and the OS may then discard the tab without ever running `unload` or
   * `beforeunload`. `pagehide` covers the navigation/refresh case. Between them
   * the 1s debounce can no longer swallow a save just because the user put the
   * phone down.
   */
  #bindLifecycleFlush() {
    if (this.#lifecycleBound) return;
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    this.#lifecycleBound = true;

    const flush = () => {
      if (!this.#dirty || !this.#sb || !this.#user) return;
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
      // Fire-and-forget: the page may not live long enough to await this, but
      // the durable SyncJournal marker means the next boot recovers whatever
      // did not make it out.
      this.push();
    };

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
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
    // Mark this as deliberate so the SIGNED_OUT handler knows it may wipe local
    // data. A SIGNED_OUT arriving WITHOUT this flag is a failed token refresh,
    // where wiping would destroy work the user never chose to discard.
    this.#explicitSignOut = true;
    this.#sb.auth.signOut().catch(() => {});
    if (this.#user) this.#resetToGuest(true, { wipeLocal: true });
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
        // Supabase fires SIGNED_OUT for an expired/failed token refresh too, not
        // only for a deliberate sign-out. Only the deliberate case may clear
        // local data.
        this.#resetToGuest(true, { wipeLocal: this.#explicitSignOut });
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
   * Drop back to local/guest state.
   *
   * @param {boolean} showSignIn  prompt the sign-in modal
   * @param {object}  [opts]
   * @param {boolean} [opts.wipeLocal=false]
   *   true  — deliberate sign-out: reset to seed so the next user at this
   *           browser never sees the previous one's records.
   *   false — the session merely lapsed (failed token refresh, offline). Keep
   *           every local record: the user didn't ask to discard anything, and
   *           any un-pushed edit still lives only here.
   */
  #resetToGuest(showSignIn, { wipeLocal = false } = {}) {
    this.#teardownChannels();
    this.#user = null;
    this.#cloudVersion = null; // unknown again until the next successful pull
    this.#sharedData = [];
    this.#pendingRemovals.clear();
    this.#pendingAdditions.clear();

    if (wipeLocal) {
      // Deliberate sign-out discards local data, so any pending marker would be
      // a lie to the next user of this browser.
      this.#markClean();
      this.#store.reset(() => SeedFactory.create(), (s) => this.#migrateDefaults(s));
    } else {
      // Keep local data; only drop the cloud-derived slice that belonged to the
      // session that just ended. #dirty stays set so the edit is pushed once
      // the user signs back in.
      const state = this.#store.getState();
      state._sharedData       = [];
      state._currentUserEmail = null;
      // Nothing to push: the session just ended.
      this.#store.withoutLocalChange(() => this.#store.persist());
      this.#bus.emit('state:changed', state);
    }

    this.#explicitSignOut = false;
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
   * Resolve a share by its stable owner id.
   *
   * Prefer this over indexing into sharedData: the array is rebuilt on every
   * pull, so a positional index captured when a sheet opened can point at a
   * different owner by the time the user submits.
   * @param {string} ownerId
   * @returns {object|null}
   */
  shareByOwner(ownerId) {
    return this.#sharedData.find((s) => s._ownerId === ownerId) || null;
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
    // Mark dirty BEFORE the debounce so a pull landing inside the window knows
    // there is an uncommitted local edit to flush first.
    this.#dirty = true;
    // Durable twin of #dirty: a field dies with the page, this does not. It is
    // what lets a cold start tell "the cloud row is current" apart from "the
    // cloud row is behind because my last push never went out".
    this.#journal.mark(this.#user.id, this.#cloudVersion);
    const now = Date.now();
    if (!this.#dirtySince) this.#dirtySince = now;
    // A plain trailing-edge debounce is re-armed by every save, so entering
    // transactions back-to-back kept postponing the only durable write. Cap the
    // total wait: once work has been at risk for MAX_PUSH_WAIT_MS the next save
    // commits immediately instead of resetting the clock again.
    const wait = Math.max(0, Math.min(
      PUSH_DEBOUNCE_MS,
      this.#dirtySince + MAX_PUSH_WAIT_MS - now,
    ));
    clearTimeout(this.#saveTimer);
    // push() already serialises through #syncing, so a push never overlaps an
    // in-flight push/pull.
    this.#saveTimer = setTimeout(() => this.push(), wait);
  }

  /** Mark local state as fully committed. */
  #markClean() {
    this.#dirty       = false;
    this.#dirtySince  = 0;
    this.#pushRetries = 0;
    this.#journal.clear();
  }

  /**
   * Re-arm a failed push with exponential backoff.
   *
   * Previously a failed push was simply dropped: one flaky request and the edit
   * stayed local forever with no further attempt, which is how a transient
   * mobile-network blip turned into permanent divergence.
   */
  #retryPushLater() {
    if (this.#pushRetries >= MAX_PUSH_RETRIES) return;
    const delay = RETRY_BASE_MS * (2 ** this.#pushRetries);
    this.#pushRetries++;
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.push(), delay);
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
  async #commitState(rawState) {
    // Never upload the transient render-time keys (notably `_sharedData`, a full
    // copy of other users' snapshots) — see Repository.stripTransient().
    const state    = Repository.stripTransient(rawState);
    const expected = this.#cloudVersion;

    // Never write on an unknown baseline — see the #cloudVersion doc comment.
    if (expected === null) {
      throw new Error('Cloud state not loaded yet — skipping upload to avoid overwriting it');
    }

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
    // First write for this user (no row yet). Use INSERT … ON CONFLICT DO
    // NOTHING (ignoreDuplicates) so a simultaneous first sign-in on another
    // device can't be clobbered: if the row already exists we lost the race and
    // return false, letting #doPush stash + pull the winner instead of
    // overwriting it.
    const { data: rows, error } = await this.#sb.from('user_data').upsert({
      id:         this.#user.id,
      data:       state,
      version:    1,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id', ignoreDuplicates: true }).select('version');
    if (error) throw error;
    if (!rows || !rows.length) return false; // another device created it first
    this.#cloudVersion = 1;
    this.#lastSelfVersion = this.#cloudVersion;
    return true;
  }

  async #doPush() {
    if (!this.#sb || !this.#user) return;

    // No successful pull yet this session (offline sign-in, transient 5xx).
    // Uploading now would overwrite the cloud from an unknown baseline, so hold
    // the change instead — #dirty stays set and the next pull unblocks it.
    if (this.#cloudVersion === null) {
      console.warn('[SyncService] Skipping push: cloud state not loaded yet');
      this.#emitStatus('error');
      // Hold, but do NOT give up: the pull that unblocks this may land a second
      // from now, and without a retry the edit would sit local-only forever.
      this.#retryPushLater();
      return;
    }

    this.#emitStatus('syncing');
    try {
      const ok = await this.#commitState(this.#store.getState());
      if (!ok) {
        // Genuine conflict: another device advanced the version, so our
        // baseline is stale and this state cannot be committed as-is. There is
        // no field-level merge, so keep a recovery copy before the pull
        // overwrites local state — silently discarding the user's work is not
        // an acceptable outcome, and the old "merging…" toast was a lie.
        this.#stashConflict();
        this.#toast('Another device saved first — your local copy was kept as a backup');
        await this.#doPull();
        // The pull replaced local state with the cloud's, so there is nothing
        // left to flush; the losing copy lives under pocket.v1.conflict.
        this.#markClean();
        return;
      }
      this.#markClean();
      this.#emitStatus('synced');
      await this.#pushFamilyShares();
      await this.#pullMemberContributions();
    } catch (e) {
      console.error('[SyncService] Cloud save error:', e);
      this.#emitStatus('error');
      this.#toast('Sync error: ' + (e.message || e));
      // Keep #dirty and the journal set so both the backoff retry below and,
      // failing that, the next cold start still know this edit is outstanding.
      this.#retryPushLater();
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

  /**
   * Persist the current state under a recovery key so a pull can never destroy
   * work outright. Best-effort: a full quota must not break sync.
   */
  #stashConflict() {
    try {
      const savedAt = new Date().toISOString();
      const key = `pocket.v1.conflict.${Date.now()}`;
      localStorage.setItem(key, JSON.stringify({ savedAt, state: this.#store.getState() }));
      // Maintain a capped index (newest first, keep 5) so successive conflicts
      // don't overwrite each other and stay recoverable from Settings.
      const idx = this.conflictBackups();
      idx.unshift({ key, savedAt });
      for (const stale of idx.slice(5)) { try { localStorage.removeItem(stale.key); } catch (_) {} }
      localStorage.setItem('pocket.v1.conflicts', JSON.stringify(idx.slice(0, 5)));
    } catch (_) { /* quota / private mode — nothing we can do */ }
  }

  /** @returns {{key:string, savedAt:string}[]} recoverable conflict copies, newest first */
  conflictBackups() {
    try { return JSON.parse(localStorage.getItem('pocket.v1.conflicts') || '[]'); }
    catch (_) { return []; }
  }

  /** @param {string} key @returns {object|null} the stashed state, or null */
  readConflictBackup(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw).state ?? null) : null;
    } catch (_) { return null; }
  }

  /** Forget one backup (after restore, or on user discard). @param {string} key */
  discardConflictBackup(key) {
    try { localStorage.removeItem(key); } catch (_) {}
    try {
      localStorage.setItem('pocket.v1.conflicts',
        JSON.stringify(this.conflictBackups().filter((b) => b.key !== key)));
    } catch (_) {}
  }

  /**
   * Cold-start recovery for edits that never reached the cloud.
   *
   * The failure this exists to prevent: three transactions entered back-to-back
   * collapse into ONE debounced push; the tab is refreshed before it fires; the
   * next boot reads the cloud row — which predates all three — and
   * replaceState()s it over both memory AND localStorage. All three vanish, the
   * first one included, with no recovery copy anywhere.
   *
   * The durable SyncJournal marker makes that situation detectable. Once it is,
   * the row's own version is a valid CAS baseline, so the correct move is to
   * commit local state OVER the stale row. If another device legitimately wrote
   * while this one was away the compare-and-swap fails, and we fall back to
   * adopting the cloud — but only after stashing a restorable backup.
   *
   * @param {{data: object, version: number}} row  the cloud row just read
   * @returns {Promise<boolean>} true when the caller must NOT adopt the snapshot
   */
  async #recoverPendingLocalEdits(row) {
    if (this.#flushing) return false;             // already inside a flush
    if (this.#cloudVersion !== null) return false; // not a cold start

    const pending = this.#journal.read();
    if (!pending || pending.userId !== this.#user.id) return false;

    const rowVersion = row.version ?? 0;
    // Did anyone else write while this device was away? The journal recorded
    // the version the local edits were made against; if the row has moved on,
    // committing over it would destroy the OTHER device's work — the same
    // failure this method exists to prevent, just pointed the other way. There
    // is no field-level merge, so keep the local copy recoverable and let the
    // caller adopt the cloud snapshot.
    //
    // A null baseline means the edits predate any successful pull, so nothing
    // can be proven about them; treat that as a conflict too.
    if (pending.baseVersion == null || pending.baseVersion !== rowVersion) {
      this.#stashConflict();
      this.#markClean();
      this.#toast('Another device saved while you were away — your unsynced copy was kept as a backup');
      return false;
    }

    this.#flushing     = true;
    this.#cloudVersion = rowVersion;
    this.#dirty        = true;
    try {
      const ok = await this.#commitState(this.#store.getState());
      if (ok) {
        this.#markClean();
        this.#emitStatus('synced');
        this.#toast('Recovered changes that had not finished syncing');
        await this.#pushFamilyShares();
        await this.#pullMemberContributions();
        await this.#pullFamilyShares();
        this.#bus.emit('state:changed', this.#store.getState());
        return true;
      }
      // The row moved between our SELECT and our UPDATE — a genuine race with
      // another device writing right now, rather than one that wrote while we
      // were away (that case is caught by the baseline check above).
      this.#stashConflict();
      this.#markClean();
      this.#toast('Another device saved first — your unsynced copy was kept as a backup');
      return false;
    } catch (e) {
      // Transient failure (offline, 5xx). Adopting the cloud here would destroy
      // exactly the data this method exists to protect, so keep local state,
      // keep the journal, and let the backoff retry.
      console.error('[SyncService] Pending-edit recovery failed:', e);
      this.#emitStatus('error');
      this.#toast('Could not sync your unsaved changes yet — they are safe on this device');
      this.#retryPushLater();
      return true;
    } finally {
      this.#flushing = false;
    }
  }

  /** @returns {boolean} isFirstSignIn */
  async #doPull() {
    if (!this.#sb || !this.#user) return false;

    // Commit any pending local edit BEFORE overwriting local state. Without
    // this, a realtime UPDATE arriving inside schedulePush()'s 1s debounce
    // window wiped the just-saved transaction from memory AND localStorage,
    // and the queued push then uploaded the clobbered result.
    //
    // This branch needs a CAS baseline to push against, so it only covers the
    // in-session case. A cold start has #cloudVersion === null and is handled
    // by #recoverPendingLocalEdits() once the row has been read.
    if (this.#dirty && !this.#flushing && this.#cloudVersion !== null) {
      this.#flushing = true;
      clearTimeout(this.#saveTimer);
      try { await this.#doPush(); } catch (_) { /* handled inside #doPush */ }
      finally { this.#flushing = false; }
      // #doPush pulls on conflict, so state may already be current.
      if (!this.#dirty && this.#cloudVersion !== null) return false;
    }

    this.#emitStatus('syncing');
    try {
      const { data, error } = await this.#sb
        .from('user_data').select('data, version, updated_at')
        .eq('id', this.#user.id).single();

      if (error && error.code !== 'PGRST116') throw error;

      if (data?.data) {
        // Cold start carrying work the cloud never received: the row we just
        // read is BEHIND this device, so adopting it would delete real entries.
        // Commit local over it first — see #recoverPendingLocalEdits().
        if (await this.#recoverPendingLocalEdits(data)) return false;

        // Migrate the cloud snapshot to the current schema BEFORE it becomes
        // active state (older snapshots may miss newer arrays / openingBalance).
        this.#store.replaceState(data.data, (s) => this.#migrateDefaults(s));
        this.#cloudVersion = data.version ?? 0;
        // Local state now mirrors the cloud — nothing outstanding to push.
        this.#markClean();
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

    // Resolve a non-null account_id (the column is NOT NULL): prefer the tx's own
    // account, then a split account, then the share's account. A null here would
    // fail the same way the member-side delete did.
    const share = this.#sharedData.find((s) => s._ownerId === ownerId);
    const accountId =
      txData.accountId ??
      txData.splits?.[0]?.accountId ??
      share?.accounts?.[0]?.id ??
      (share?.permission ? Object.keys(share.permission)[0] : null);

    const { error } = await this.#sb.from('family_contributions').upsert({
      owner_id:     ownerId,
      member_email: this.#user.email.toLowerCase(),
      account_id:   accountId,
      tx_data:      txData,
      synced:       false,
    }, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;

    // Optimistic: add tx to the matching share and re-derive its balances.
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

    // Resolve the target tx and its account BEFORE optimistically hiding it, so
    // the delete marker can carry a non-null account_id. The family_contributions
    // table's account_id column is NOT NULL — sending null here is what made
    // member-side deletes fail with a constraint violation (the marker never
    // reached the owner, so the owner kept the transaction).
    const share = this.#sharedData.find((s) =>
      (s.transactions || []).some((t) => t.id === txId),
    );
    const target = share?.transactions?.find((t) => t.id === txId) || null;
    const accountId =
      target?.accountId ??
      target?.splits?.[0]?.accountId ??
      share?.accounts?.[0]?.id ??
      (share?.permission ? Object.keys(share.permission)[0] : null);

    // Optimistic: hide the tx and re-derive the affected share's balances.
    this.#pendingRemovals.add(txId);
    if (share) {
      share.transactions = (share.transactions || []).filter((t) => t.id !== txId);
      this.#deriveShareBalances(share);
      this.#bus.emit('state:changed', this.#store.getState());
    }

    // Stable delete-marker id = 'del_' + txId → upsert is idempotent on double-tap
    const { error } = await this.#sb.from('family_contributions').upsert({
      owner_id:     ownerId,
      member_email: this.#user.email.toLowerCase(),
      account_id:   accountId,
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
   * Edit a transaction the member previously contributed to a shared account.
   *
   * An edit is a REPLACE, not a second add: the owner is sent a `_replace`
   * marker for the old row plus an add carrying the SAME transaction id. The
   * owner applies deletes before computing which adds are new, so the pair
   * lands as an in-place update. Sending only the add would be skipped as a
   * duplicate id; minting a fresh id (the old behaviour) left the original in
   * the owner's ledger and the account was double-charged.
   *
   * `_replace` also tells the owner this needs EDIT rights rather than DELETE
   * rights, so a member with 'edit' can still correct their own entry.
   *
   * @param {string} ownerId
   * @param {string} txId     the id being replaced (kept on the new row)
   * @param {object} txData   the updated transaction
   */
  async updateContribution(ownerId, txId, txData) {
    if (!this.#sb || !this.#user) throw new Error('Not signed in');

    const share = this.#sharedData.find((s) => s._ownerId === ownerId);
    const next  = { ...txData, id: txId };
    const accountId =
      next.accountId ??
      next.splits?.[0]?.accountId ??
      share?.accounts?.[0]?.id ??
      (share?.permission ? Object.keys(share.permission)[0] : null);
    const email = this.#user.email.toLowerCase();

    const { error: delErr } = await this.#sb.from('family_contributions').upsert({
      owner_id: ownerId, member_email: email, account_id: accountId,
      tx_data: { _delete: true, _replace: true, id: `rep_${txId}`, targetId: txId },
      synced: false,
    }, { onConflict: 'id', ignoreDuplicates: true });
    if (delErr) throw delErr;

    const { error: addErr } = await this.#sb.from('family_contributions').upsert({
      owner_id: ownerId, member_email: email, account_id: accountId,
      tx_data: next, synced: false,
    }, { onConflict: 'id', ignoreDuplicates: true });
    if (addErr) throw addErr;

    // Optimistic: swap the row in place so the list doesn't flicker through an
    // empty state, and keep it pinned until the owner's snapshot confirms.
    if (share) {
      share.transactions = (share.transactions || []).map((t) => (t.id === txId ? next : t));
      this.#deriveShareBalances(share);
      this.#pendingAdditions.set(txId, { tx: next, ownerId });
      this.#bus.emit('state:changed', this.#store.getState());
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

  /**
   * Revoke a member's access: delete their family_shares row and tell their
   * client to refresh.
   *
   * Removing someone from state.family alone was not enough — the row survived,
   * so their #pullFamilyShares() kept returning the last snapshot (every shared
   * account, its transactions, and ALL of the owner's categories) indefinitely.
   *
   * @param {string} email
   */
  async revokeMemberShare(email) {
    if (!this.#sb || !this.#user || !email) return;
    const addr = email.toLowerCase().trim();
    try {
      await this.#sb.from('family_shares')
        .delete()
        .eq('owner_id', this.#user.id)
        .eq('member_email', addr);
      // Nudge their client so the snapshot disappears immediately rather than
      // at their next cold start.
      this.#broadcastToMember(addr);
    } catch (e) {
      console.warn('[SyncService] revokeMemberShare error:', e);
    }
  }

  /**
   * The shared budgets, each carrying the owner-computed spend for its current
   * period. See the comment at the call site for why the figure travels rather
   * than the inputs.
   * @param {object} state
   * @param {string[]} ids
   * @returns {object[]}
   */
  #sharedBudgets(state, ids) {
    if (!ids.length) return [];
    const svc = new BudgetService();
    return (state.budgets || [])
      .filter((b) => ids.includes(b.id))
      .map((b) => {
        let spent = 0;
        // A budget the owner has since broken (deleted category, bad period)
        // must not take the whole push down with it.
        try { spent = svc.currentSpend(b); } catch (e) {
          console.warn('[SyncService] budget spend failed for', b.id, e);
        }
        return { ...b, spent };
      });
  }

  async #pushFamilyShares() {
    const state = this.#store.getState();
    if (!this.#sb || !this.#user) return;
    for (const member of state.family || []) {
      if (!member.email) continue;
      const permMap  = {};
      (member.permissions || []).forEach((p) => { permMap[p.accountId] = p.access; });
      const sharedIds = Object.keys(permMap);
      // Budgets are granted individually — they carry no accountId to inherit
      // from — so they have their own map and their own shorter ladder.
      const budgetPermMap = {};
      (member.budgetPermissions || []).forEach((p) => { budgetPermMap[p.budgetId] = p.access; });
      const sharedBudgetIds = Object.keys(budgetPermMap);
      // Un-sharing EVERYTHING is a revocation, not a no-op: leaving the row in
      // place would keep the member's stale snapshot alive forever. A member
      // holding only budget grants still needs their space, so this checks both.
      if (!sharedIds.length && !sharedBudgetIds.length) {
        await this.revokeMemberShare(member.email); continue;
      }
      const snapshot = {
        // What this member will see the space called. Per-member, because
        // family_shares is keyed (owner_id, member_email) — so "Household" for
        // one person and "Business" for another already works, without any
        // schema change. Falling back to the owner's own name is what it used
        // to be unconditionally, which made every space you shared carry your
        // personal name whatever it actually contained.
        sharedBy:     member.spaceName || state.user.name || this.#user.email,
        ownerName:    state.user.name || this.#user.email,
        // Owner's home currency so members can embed correct exchangeRate /
        // refAmount on contributed transactions (#21).
        homeCurrency: state.user.homeCurrency,
        permission:   permMap,
        accounts:     state.accounts.filter((a) => sharedIds.includes(a.id)),
        transactions: state.transactions.filter((t) =>
          permMap[t.accountId] || (t.splits || []).some((s) => permMap[s.accountId]),
        ),
        categories:   state.categories,
        // Debts and regular items carry an accountId, so they scope exactly the
        // way transactions do — sharing an account shares what hangs off it.
        debts:        (state.debts || []).filter((d) => permMap[d.accountId]),
        regularItems: (state.regularItems || []).filter((r) => permMap[r.accountId]),
        // Budgets need the SPEND SENT, not computed. BudgetService.currentSpend
        // sums over ALL the owner's transactions; the member only receives the
        // ones touching shared accounts, so computing it their side would
        // understate it — by more, the more the owner spends elsewhere. Sending
        // every transaction to fix that is the leak the filter above exists to
        // prevent. Granting a budget IS the consent to disclose its total; a
        // budget without its real spend is not worth sharing.
        budgets:      this.#sharedBudgets(state, sharedBudgetIds),
        budgetPermission: budgetPermMap,
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
        .eq('member_email', this.#user.email.toLowerCase())
        // Deterministic order: the UI still passes positional shareIndex values
        // captured at render time, and an unordered select made those indices
        // shift between opening a sheet and submitting it.
        .order('owner_id');
      if (error) { console.warn('[SyncService] pullFamilyShares error:', error); return; }

      const rawIds = new Set((data || []).flatMap((r) => (r.snapshot?.transactions || []).map((t) => t.id)));

      this.#sharedData = (data || [])
        .filter((r) => r.snapshot && r.owner_id !== this.#user.id)
        .map((r) => ({ ...r.snapshot, _ownerId: r.owner_id }))
        // Sort locally too — .order() only helps if the backend honours it.
        .sort((a, b) => String(a._ownerId).localeCompare(String(b._ownerId)));

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

  /**
   * Current access level a member holds on each of the owner's accounts.
   * @param {string} email
   * @returns {Record<string,string>} accountId → 'view'|'add'|'edit'|'full'
   */
  #memberPermissions(email) {
    const key    = (email || '').toLowerCase().trim();
    const member = (this.#store.getState().family || [])
      .find((m) => (m.email || '').toLowerCase().trim() === key);
    const map = {};
    for (const p of (member?.permissions || [])) map[p.accountId] = p.access;
    return map;
  }

  /**
   * Decide whether an incoming contribution is allowed, against the CURRENT
   * permission map rather than whatever the member's cached snapshot claimed.
   *
   * This is the owner's only enforcement point: permissions are otherwise
   * checked in render code, which a stale or hostile client never runs. Access
   * levels follow FAMILY_ACCESS_LEVELS — add ≤ edit ≤ full.
   *
   * @param {object} row  a family_contributions row
   * @returns {{ok:true}|{ok:false, reason:string}}
   */
  #authoriseContribution(row) {
    const perms = this.#memberPermissions(row.member_email);
    const tx    = row.tx_data || {};
    const level = (accId) => perms[accId] || null;

    if (tx._delete === true) {
      const targetId = tx.targetId || tx.id;
      const target   = (this.#store.getState().transactions || []).find((t) => t.id === targetId);
      // Already gone — treat as satisfied so the row doesn't retry forever.
      if (!target) return { ok: true };
      const access = level(target.accountId);
      // A replace marker is the delete half of an edit, so it needs edit rights,
      // not delete rights. A standalone delete needs 'full'.
      const allowed = tx._replace
        ? ['edit', 'full'].includes(access)
        : access === 'full';
      return allowed
        ? { ok: true }
        : { ok: false, reason: `no ${tx._replace ? 'edit' : 'delete'} access on ${target.accountId}` };
    }

    // An add touches its own account plus every split account.
    const touched = new Set([tx.accountId, ...(tx.splits || []).map((s) => s.accountId || tx.accountId)]
      .filter(Boolean));
    if (!touched.size) return { ok: false, reason: 'no account on the contribution' };
    for (const accId of touched) {
      if (!['add', 'edit', 'full'].includes(level(accId))) {
        return { ok: false, reason: `no write access on ${accId}` };
      }
    }
    return { ok: true };
  }

  async #pullMemberContributions() {
    if (!this.#sb || !this.#user) return;
    try {
      const { data, error } = await this.#sb
        .from('family_contributions')
        .select('id, tx_data, member_email, account_id')
        .eq('owner_id', this.#user.id)
        .eq('synced', false);
      if (error || !data?.length) return;

      const state = this.#store.getState();

      // Authorise BEFORE applying. A member whose access was downgraded or
      // revoked may still hold a stale snapshot and keep submitting; without
      // this the owner applied whatever arrived, including deletes targeting
      // arbitrary transactions.
      const rejected = [];
      const rows     = [];
      for (const row of data) {
        const verdict = this.#authoriseContribution(row);
        if (verdict.ok) rows.push(row);
        else {
          rejected.push(row);
          console.warn('[SyncService] Rejected contribution from',
            row.member_email, '—', verdict.reason);
        }
      }

      // Rejected rows are consumed, not left pending, or they would be retried
      // on every pull forever.
      if (rejected.length) {
        try {
          await this.#sb.from('family_contributions')
            .update({ synced: true }).in('id', rejected.map((r) => r.id));
        } catch (_) { /* best effort */ }
        this.#toast(`${rejected.length} family change${rejected.length > 1 ? 's' : ''} blocked — permission removed`);
      }
      if (!rows.length) return;

      const deleteRows = rows.filter((r) => r.tx_data?._delete === true);
      const addRows    = rows.filter((r) => !r.tx_data?._delete && r.tx_data?.id);

      if (deleteRows.length) {
        const deleteIds = new Set(deleteRows.map((r) => r.tx_data.targetId || r.tx_data.id));
        // Just drop the transactions — owner balances are derived and recomputed
        // by the Store's persist hook below, so there is no manual revert to do.
        state.transactions = state.transactions.filter((t) => !deleteIds.has(t.id));
      }

      // Computed AFTER the deletes so an edit (delete marker + add carrying the
      // same id) lands as a replacement rather than being skipped as a duplicate.
      const existingIds = new Set(state.transactions.map((t) => t.id));
      const newRows     = addRows.filter((r) => r.tx_data?.id && !existingIds.has(r.tx_data.id));

      newRows.forEach((row) => {
        const tx = { ...row.tx_data, _fromFamily: true };
        state.transactions.push(tx);
      });

      if (newRows.length || deleteRows.length) {
        // This state came FROM the cloud (member contributions) and is committed
        // explicitly two lines down, so suppress the local-change hook — letting
        // it schedule a push would re-upload what we just wrote and bump the
        // version again for every other device.
        this.#store.withoutLocalChange(() => this.#store.persist());
        // Version-guarded write (NOT a blind upsert) so a concurrent device's
        // newer snapshot is never clobbered. On a lost race we pull the winner;
        // the contributions stay synced=false and are re-applied next pull.
        const committed = await this.#commitState(state);
        if (committed) {
          const ids = rows.map((r) => r.id);
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
