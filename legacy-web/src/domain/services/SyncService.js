/**
 * SyncService — Supabase cloud sync, auth, and family sharing.
 *
 * Encapsulates all cloud operations so the rest of the app never
 * directly touches the Supabase SDK.  Emits EventBus events so the
 * UI can react without coupling to this service.
 *
 * The cloud keeps a book as rows (one per transaction, account, category …;
 * see supabase/migrations 0009–0012). Saving sends only the items that changed
 * since the last sync, through one database function (`pocket_apply_changes`)
 * that also enforces the sharing rules. Loading asks only for what changed
 * since the last load (`pocket_get_changes`, merged by BookDelta onto the
 * copy kept in SyncBaseline), in the app's usual shape, so the rest of the app
 * is unaware of the storage underneath. The whole book is read only on a
 * device's first load, or when the copy here can't be trusted.
 *
 * Offline / reload safety: SyncBaseline keeps the copy the cloud last
 * confirmed. Whatever differs from it was changed here and not yet saved, so
 * after a reload those exact items are replayed onto the newest cloud copy —
 * nothing written by another device in the meantime is overwritten, and
 * nothing written here is lost.
 *
 * Family sharing: a member reads the owner's shared accounts live
 * (`pocket_get_shared`) and writes straight into the owner's book; the
 * database checks their access on every row.
 *
 * Events emitted:
 *   'sync:status'    { status: 'local'|'syncing'|'synced'|'error' }
 *   'sync:user'      { user: object|null }
 */
import { Store }          from '../../core/Store.js';
import { Repository }     from '../../core/Repository.js';
import { SyncJournal }    from '../../core/SyncJournal.js';
import { SyncBaseline }   from '../../core/SyncBaseline.js';
import { BookDiff }       from '../../core/BookDiff.js';
import { BookDelta }      from '../../core/BookDelta.js';
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
/** How long a row we just wrote is treated as our own echo on the live feed. */
const ECHO_WINDOW_MS = 8000;
/** Live updates arrive per row; gather a burst into one reload. */
const LIVE_DEBOUNCE_MS = 400;

/**
 * Cloud tables that make up a book, with the app list each row belongs to and
 * the column that names that item (child tables name their parent item).
 */
const BOOK_TABLES = Object.freeze([
  ['transactions',               'transactions',  'id'],
  ['transaction_splits',         'transactions',  'transaction_id'],
  ['accounts',                   'accounts',      'id'],
  ['account_groups',             'accountGroups', 'id'],
  ['categories',                 'categories',    'id'],
  ['budgets',                    'budgets',       'id'],
  ['budget_categories',          'budgets',       'budget_id'],
  ['debts',                      'debts',         'id'],
  ['regular_items',              'regularItems',  'id'],
  ['family_members',             'family',        'id'],
  ['member_account_permissions', 'family',        'member_id'],
  ['member_budget_permissions',  'family',        'member_id'],
  ['spaces',                     'spaces',        'id'],
  ['space_accounts',             'spaces',        'space_id'],
  ['space_budgets',              'spaces',        'space_id'],
  ['space_members',              'spaces',        'space_id'],
  ['book_settings',              'settings',      null],
  ['book_fx_rates',              'settings',      null],
  ['merchant_categories',        'settings',      null],
]);

export class SyncService {
  /** @type {Store} */           #store;
  /** @type {EventBus} */        #bus;
  /** @type {CurrencyService} */ #fx;

  // Supabase SDK client (null until sbInit() succeeds)
  #sb = null;
  #user = null;
  /**
   * Whether the cloud copy has been read this session. Saving before that
   * would compare against an unknown baseline, so pushes wait for it.
   */
  #loaded = false;
  #saveTimer = null;
  #channel = null;
  #sharesChannels = [];
  #subscribed = false;
  #liveTimer = null;
  #sharesTimer = null;
  /** Rows this device just wrote ("list:id" → expiry), to skip their echoes. */
  #echo = new Map();

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
  /** The copy of the book the cloud last confirmed — survives a reload. */
  /** @type {SyncBaseline} */ #baseline;
  /** True only for a user-initiated sign-out (not a failed token refresh). */
  #explicitSignOut = false;

  constructor() {
    this.#store    = Store.getInstance();
    this.#bus      = EventBus.getInstance();
    this.#fx       = new CurrencyService();
    this.#journal  = new SyncJournal();
    this.#baseline = new SyncBaseline();
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
   * Flush any pending push the moment the page stops being visible, and catch
   * up on shared books when it comes back.
   *
   * `visibilitychange → hidden` is the last event a mobile browser reliably
   * delivers: switching apps, locking the screen or changing tab all fire it,
   * and the OS may then discard the tab without ever running `unload` or
   * `beforeunload`. `pagehide` covers the navigation/refresh case.
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
      // the baseline + journal mean the next boot recovers whatever did not
      // make it out.
      this.push();
    };

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
      else if (this.#user) this.scheduleSharesRefresh(0);
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
    // Mark this as deliberate so the SIGNED_OUT handler knows it may wipe local
    // data. A SIGNED_OUT arriving WITHOUT this flag is a failed token refresh,
    // where wiping would destroy work the user never chose to discard.
    this.#explicitSignOut = true;
    this.#sb.auth.signOut().catch(() => {});
    if (this.#user) this.#resetToGuest(true, { wipeLocal: true });
  }

  /** Remove all realtime channels so they don't leak across sessions/users. */
  #teardownChannels() {
    for (const ch of [this.#channel, ...this.#sharesChannels]) {
      if (ch) { try { this.#sb?.removeChannel(ch); } catch (_) {} }
    }
    this.#channel = null;
    this.#sharesChannels = [];
    this.#subscribed = false;
  }

  async restoreSession() {
    if (!this.#sb) return {};

    // Listener for auth changes AFTER initial load: OAuth sign-in completion and
    // explicit/remote sign-out (or failed token refresh). The initial restore is
    // handled by getSession() below.
    this.#sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        if (!this.#user) this.#adoptSession(session.user);
      } else if (event === 'SIGNED_OUT' && this.#user) {
        this.#resetToGuest(true, { wipeLocal: this.#explicitSignOut });
      }
    });

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
    this.#baseline.load(user.id);
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
   *           every local record (and the baseline): any unsaved edit still
   *           lives only here and is replayed after the next sign-in.
   */
  #resetToGuest(showSignIn, { wipeLocal = false } = {}) {
    this.#teardownChannels();
    this.#user = null;
    this.#loaded = false;
    this.#sharedData = [];
    this.#pendingRemovals.clear();
    this.#pendingAdditions.clear();

    if (wipeLocal) {
      this.#markClean();
      this.#baseline.clear();
      this.#store.reset(() => SeedFactory.create(), (s) => this.#migrateDefaults(s));
    } else {
      const state = this.#store.getState();
      state._sharedData       = [];
      state._currentUserEmail = null;
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
   * @param {string} ownerId
   * @returns {object|null}
   */
  shareByOwner(ownerId) {
    return this.#sharedData.find((s) => s._ownerId === ownerId) || null;
  }

  /** Re-read the books shared with this user and notify the UI. */
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
    this.#journal.mark(this.#user.id, null);
    const now = Date.now();
    if (!this.#dirtySince) this.#dirtySince = now;
    const wait = Math.max(0, Math.min(
      PUSH_DEBOUNCE_MS,
      this.#dirtySince + MAX_PUSH_WAIT_MS - now,
    ));
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.push(), wait);
  }

  /** Mark local state as fully committed. */
  #markClean() {
    this.#dirty       = false;
    this.#dirtySince  = 0;
    this.#pushRetries = 0;
    this.#journal.clear();
  }

  /** Re-arm a failed push with exponential backoff. */
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
   * What the cloud should hold for the current state: persisted keys only.
   * (`_transferDirBackfilled` is a real book flag despite its underscore.)
   */
  #snapshot(state = this.#store.getState()) {
    const snap = BookDiff.clone(Repository.stripTransient(state));
    if (state._transferDirBackfilled !== undefined) snap._transferDirBackfilled = state._transferDirBackfilled;
    this.#stampSharedSpend(snap);
    return snap;
  }

  /**
   * A member granted a budget sees its spend, but only receives the
   * transactions of accounts shared with them — so they can't work it out.
   * The owner's app records the current figure on each shared budget
   * (`sharedSpend`, computed over ALL the owner's accounts); granting the
   * budget is the consent to disclose that total. It refreshes with each save.
   * @param {object} snap  the snapshot being saved (mutated)
   */
  #stampSharedSpend(snap) {
    const granted = new Set((snap.family || [])
      .flatMap((m) => (m.budgetPermissions || []).map((p) => p.budgetId)));
    if (!granted.size) {
      for (const b of snap.budgets || []) delete b.sharedSpend;
      return;
    }
    const svc = new BudgetService();
    for (const b of snap.budgets || []) {
      if (!granted.has(b.id)) { delete b.sharedSpend; continue; }
      // A broken budget (deleted category, bad period) must not stop a save.
      try { b.sharedSpend = Math.round(svc.currentSpend(b)); } catch (_) { b.sharedSpend = 0; }
    }
  }

  /**
   * Send one change set to a book. Rows written are remembered briefly so
   * their echo on the live feed doesn't trigger a pointless reload.
   * @param {string} bookId   owner id of the book written to
   * @param {object} changes  see BookDiff
   */
  async #send(bookId, changes) {
    const { error } = await this.#sb.rpc('pocket_apply_changes', { book: bookId, changes });
    if (error) throw error;
    const until = Date.now() + ECHO_WINDOW_MS;
    for (const k of BookDiff.touchedKeys(changes)) this.#echo.set(k, until);
    if (changes.user || changes.fxRates || changes.merchantCategories || changes.bookExtra) {
      this.#echo.set('settings', until);
    }
  }

  async #doPush() {
    if (!this.#sb || !this.#user) return;

    // No successful load yet this session (offline sign-in, transient 5xx).
    // A diff against an unknown cloud copy can't be trusted, so hold the
    // change — #dirty stays set and the next pull carries it over.
    if (!this.#loaded) {
      console.warn('[SyncService] Skipping push: cloud state not loaded yet');
      this.#emitStatus('error');
      this.#retryPushLater();
      return;
    }

    const snap = this.#snapshot();
    const changes = BookDiff.changes(this.#baseline.state, snap);
    if (!changes) {
      this.#markClean();
      this.#emitStatus('synced');
      return;
    }

    this.#emitStatus('syncing');
    try {
      await this.#send(this.#user.id, changes);
      this.#baseline.set(snap);
      // Edits made while the save was in flight are still outstanding.
      if (BookDiff.changes(snap, this.#snapshot())) {
        this.#pushRetries = 0;
        this.schedulePush();
      } else {
        this.#markClean();
      }
      this.#emitStatus('synced');
    } catch (e) {
      console.error('[SyncService] Cloud save error:', e);
      this.#emitStatus('error');
      this.#toast('Sync error: ' + (e.message || e));
      // Keep #dirty, the journal and the baseline as they are: the same diff
      // is retried below and, failing that, after the next start.
      this.#retryPushLater();
    }
  }

  // ── Pull ──────────────────────────────────────────────────────────────

  /**
   * Public pull — serialised through the sync queue so concurrent live
   * updates can't interleave replaceState() calls.
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
   * The edits made on this device that the cloud hasn't received: the
   * difference between the local state and the last confirmed copy.
   *
   * Only meaningful when there is something outstanding (this session's
   * #dirty flag, or the durable journal from a previous one). Without a
   * baseline the edits can't be told apart from stale data, so — as before —
   * the local copy is kept as a restorable backup and the cloud wins.
   * @returns {object|null} a change set, or null when nothing is pending
   */
  #pendingLocalChanges() {
    const outstanding = this.#dirty || this.#journal.read()?.userId === this.#user.id;
    if (!outstanding) return null;
    if (!this.#baseline.state) {
      this.#stashConflict();
      this.#markClean();
      this.#toast('Unsynced changes from before couldn\'t be matched — kept as a backup in Settings');
      return null;
    }
    return BookDiff.changes(this.#baseline.state, this.#snapshot());
  }

  /** @returns {boolean} isFirstSignIn */
  async #doPull() {
    if (!this.#sb || !this.#user) return false;

    // Save any pending local edit BEFORE reading, so the copy we read already
    // contains it.
    if (this.#dirty && !this.#flushing && this.#loaded) {
      this.#flushing = true;
      clearTimeout(this.#saveTimer);
      try { await this.#doPush(); } catch (_) { /* handled inside #doPush */ }
      finally { this.#flushing = false; }
    }

    this.#emitStatus('syncing');
    try {
      const { book, cursor } = await this.#loadBook();

      if (!book) {
        // First sign-in: this device's book becomes the cloud book.
        this.#loaded = true;
        this.#dirty = true;
        await this.#doPush();
        this.#emitStatus('synced');
        return true;
      }

      // Carry this device's unsaved edits over onto the newer cloud copy.
      const pending = this.#pendingLocalChanges();
      const coldStart = !this.#loaded;
      const next = BookDiff.apply(BookDiff.clone(book), pending);
      this.#store.replaceState(next, (s) => this.#migrateDefaults(s));
      this.#baseline.set(book, cursor);
      this.#loaded = true;

      // Anything that now differs from the cloud copy — the replayed edits, or
      // fields the app's migrations filled in — is saved straight away.
      if (BookDiff.changes(book, this.#snapshot())) {
        this.#dirty = true;
        await this.#doPush();
        if (pending && coldStart) this.#toast('Recovered changes that had not finished syncing');
      } else {
        this.#markClean();
      }

      new RecurringService().process();
      await this.#pullFamilyShares();
      this.#emitStatus(this.#dirty ? 'error' : 'synced');
      this.#bus.emit('state:changed', this.#store.getState());
      return false;
    } catch (e) {
      console.error('[SyncService] Cloud load error:', e);
      this.#emitStatus('error');
      this.#toast('Sync error: ' + (e.message || e));
      return false;
    }
  }

  /**
   * The cloud's book: only what changed since the last load when this device
   * has a trusted copy, otherwise all of it. `book` is null before the first save.
   * @returns {Promise<{book: object|null, cursor: string|null}>}
   */
  async #loadBook() {
    const since = this.#baseline.state ? this.#baseline.cursor : null;
    if (since) {
      const changes = await this.#readChanges(since);
      if (!changes) return { book: null, cursor: null };
      const merged = BookDelta.merge(this.#baseline.state, changes);
      if (merged) return merged;
      console.warn('[SyncService] local copy out of step with the cloud — loading the whole book');
    }
    const full = await this.#readChanges(null);
    if (!full) return { book: null, cursor: null };
    const merged = BookDelta.merge(null, full);
    if (!merged) throw new Error('The cloud book could not be read');
    return merged;
  }

  async #readChanges(since) {
    const { data, error } = await this.#sb.rpc('pocket_get_changes', { since });
    if (error) throw error;
    return data;
  }

  // ── Live updates ──────────────────────────────────────────────────────

  /** True when a live-feed row is the echo of our own recent write. */
  #isEcho(list, row) {
    const now = Date.now();
    for (const [k, until] of this.#echo) if (until < now) this.#echo.delete(k);
    const key = list === 'settings' ? 'settings' : `${list}:${row}`;
    return (this.#echo.get(key) || 0) >= now;
  }

  #subscribe() {
    if (!this.#sb || !this.#user || this.#subscribed) return;
    this.#subscribed = true;

    // Own book: any row changed by another device (or the Telegram bot, or a
    // family member) reloads the book once the burst settles.
    let ch = this.#sb.channel('pocket_book_' + this.#user.id);
    for (const [table, list, idCol] of BOOK_TABLES) {
      ch = ch.on('postgres_changes', {
        event: '*', schema: 'public', table, filter: `owner_id=eq.${this.#user.id}`,
      }, (payload) => {
        const row = payload?.new?.[idCol] ?? payload?.old?.[idCol];
        if (this.#isEcho(list, row)) return;
        clearTimeout(this.#liveTimer);
        this.#liveTimer = setTimeout(() => this.pull(), LIVE_DEBOUNCE_MS);
      });
    }
    this.#channel = ch.subscribe();
  }

  /** Live updates for the shared books this user reads (member side). */
  #subscribeShares() {
    for (const c of this.#sharesChannels) { try { this.#sb?.removeChannel(c); } catch (_) {} }
    this.#sharesChannels = [];
    if (!this.#sb || !this.#user) return;
    const owners = [...new Set(this.#sharedData.map((s) => s._ownerId))];
    for (const ownerId of owners) {
      let ch = this.#sb.channel(`pocket_shared_${ownerId}_${this.#user.id}`);
      for (const table of ['transactions', 'transaction_splits', 'accounts', 'categories']) {
        ch = ch.on('postgres_changes', {
          event: '*', schema: 'public', table, filter: `owner_id=eq.${ownerId}`,
        }, (payload) => {
          const row = payload?.new?.id ?? payload?.old?.id ?? payload?.new?.transaction_id;
          if (table === 'transactions' && this.#isEcho('shared', `${ownerId}:${row}`)) return;
          this.scheduleSharesRefresh(LIVE_DEBOUNCE_MS);
        });
      }
      this.#sharesChannels.push(ch.subscribe());
    }
  }

  // ── Family sharing (member side) ─────────────────────────────────────

  /** The share (book) a member is writing into, if it's loaded. */
  #shareOf(ownerId) {
    return this.#sharedData.find((s) => s._ownerId === ownerId) || null;
  }

  /** Write to a shared book, remembering the rows as our own echo. */
  async #sendShared(ownerId, changes) {
    const { error } = await this.#sb.rpc('pocket_apply_changes', { book: ownerId, changes });
    if (error) throw error;
    const until = Date.now() + ECHO_WINDOW_MS;
    for (const k of BookDiff.touchedKeys(changes)) {
      const id = k.slice(k.indexOf(':') + 1);
      this.#echo.set(`shared:${ownerId}:${id}`, until);
    }
  }

  /**
   * Add a transaction to an account someone shared with this user. It goes
   * straight into their book; the database checks this user may add there.
   *
   * @param {string} ownerId  Supabase user ID of the account owner
   * @param {object} txData   Transaction object to add
   */
  async submitContribution(ownerId, txData) {
    if (!this.#sb || !this.#user) throw new Error('Not signed in');
    const email = this.#user.email.toLowerCase();
    const tx = { ...txData, addedBy: txData.addedBy || email };
    await this.#sendShared(ownerId, { put: { transactions: [tx] } });

    // Optimistic: show it at once and re-derive the share's balances.
    const share = this.#shareOf(ownerId);
    if (share) {
      share.transactions = [tx, ...(share.transactions || []).filter((t) => t.id !== tx.id)];
      this.#deriveShareBalances(share);
      this.#pendingAdditions.set(tx.id, { tx, ownerId });
      this.#bus.emit('state:changed', this.#store.getState());
    }
  }

  /**
   * Delete a transaction in a shared book. Allowed for the entries this user
   * added, or anything with 'full' access — the database decides.
   *
   * @param {string} ownerId  Owner's Supabase user ID
   * @param {string} txId     Transaction ID to delete
   */
  async deleteContribution(ownerId, txId) {
    if (!this.#sb || !this.#user) throw new Error('Not signed in');
    if (this.#pendingRemovals.has(txId)) return;

    const share = this.#sharedData.find((s) => s._ownerId === ownerId)
      || this.#sharedData.find((s) => (s.transactions || []).some((t) => t.id === txId));
    const owner = share?._ownerId || ownerId;

    // Optimistic: hide it and re-derive the share's balances.
    this.#pendingRemovals.add(txId);
    const before = share?.transactions;
    if (share) {
      share.transactions = (share.transactions || []).filter((t) => t.id !== txId);
      this.#deriveShareBalances(share);
      this.#bus.emit('state:changed', this.#store.getState());
    }

    try {
      await this.#sendShared(owner, { remove: { transactions: [txId] } });
    } catch (error) {
      // Roll back the optimistic removal.
      this.#pendingRemovals.delete(txId);
      if (share && before) {
        share.transactions = before;
        this.#deriveShareBalances(share);
        this.#bus.emit('state:changed', this.#store.getState());
      }
      throw error;
    }
  }

  /**
   * Edit a transaction in a shared book, in place (same id). Allowed for the
   * entries this user added, or with 'edit'/'full' access.
   *
   * @param {string} ownerId
   * @param {string} txId     the id being replaced (kept on the new row)
   * @param {object} txData   the updated transaction
   */
  async updateContribution(ownerId, txId, txData) {
    if (!this.#sb || !this.#user) throw new Error('Not signed in');
    const next = { ...txData, id: txId };
    await this.#sendShared(ownerId, { put: { transactions: [next] } });

    const share = this.#shareOf(ownerId);
    if (share) {
      share.transactions = (share.transactions || []).map((t) => (t.id === txId ? next : t));
      this.#deriveShareBalances(share);
      this.#pendingAdditions.set(txId, { tx: next, ownerId });
      this.#bus.emit('state:changed', this.#store.getState());
    }
  }

  /**
   * Re-read the shared books after `delayMs` (debounced).
   * @param {number} delayMs
   */
  scheduleSharesRefresh(delayMs) {
    clearTimeout(this.#sharesTimer);
    this.#sharesTimer = setTimeout(async () => {
      if (!this.#sb || !this.#user) return;
      try {
        await this.#pullFamilyShares();
        this.#bus.emit('state:changed', this.#store.getState());
      } catch (_) {}
    }, delayMs);
  }

  /**
   * Re-derive a shared book's account balances from its transactions using the
   * SAME LedgerMath authority the rest of the app uses.
   * @param {object} share
   */
  #deriveShareBalances(share) {
    if (!share || !Array.isArray(share.accounts)) return;
    const balances = LedgerMath.balances(share.accounts, share.transactions || [], this.#fx);
    for (const a of share.accounts) a.balance = balances.get(a.id) ?? a.balance ?? 0;
  }

  /**
   * Revoking a member is now just removing them (or their permissions) from
   * the family list: that save soft-deletes their grants, and the database
   * stops serving them anything at once. Kept for the callers that still ask.
   * @param {string} _email
   * @param {string} [_spaceId]
   */
  async revokeMemberShare(_email, _spaceId = null) {
    this.schedulePush();
  }

  async #pullFamilyShares() {
    if (!this.#sb || !this.#user?.email) return;
    try {
      const { data, error } = await this.#sb.rpc('pocket_get_shared');
      if (error) { console.warn('[SyncService] pullFamilyShares error:', error); return; }

      const shares = Array.isArray(data) ? data : [];
      const rawIds = new Set(shares.flatMap((s) => (s.transactions || []).map((t) => t.id)));
      const ownersBefore = this.#sharedData.map((s) => s._ownerId).join(',');

      this.#sharedData = shares
        .filter((s) => s._ownerId !== this.#user.id)
        .sort((a, b) => (String(a._ownerId).localeCompare(String(b._ownerId))
          || String(a._spaceId).localeCompare(String(b._spaceId))));

      // Keep optimistic removals hidden until the server confirms them.
      for (const txId of [...this.#pendingRemovals]) {
        if (!rawIds.has(txId)) this.#pendingRemovals.delete(txId);
      }
      if (this.#pendingRemovals.size) {
        this.#sharedData.forEach((share) => {
          share.transactions = (share.transactions || []).filter((t) => !this.#pendingRemovals.has(t.id));
        });
      }

      // Keep optimistic additions/edits visible until the server includes them.
      for (const [txId, { tx, ownerId }] of [...this.#pendingAdditions]) {
        const share = this.#sharedData.find((s) => s._ownerId === ownerId);
        if (!share) { this.#pendingAdditions.delete(txId); continue; }
        const served = (share.transactions || []).find((t) => t.id === txId);
        if (served) { this.#pendingAdditions.delete(txId); continue; }
        share.transactions = [tx, ...(share.transactions || [])];
      }

      for (const share of this.#sharedData) this.#deriveShareBalances(share);

      if (this.#sharedData.map((s) => s._ownerId).join(',') !== ownersBefore) this.#subscribeShares();
    } catch (e) { console.warn('[SyncService] pullFamilyShares error:', e); }
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
