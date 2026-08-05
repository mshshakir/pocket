/**
 * MobileSyncService — Supabase sync for the mobile app.
 *
 * Speaks the SAME protocol as the web app's SyncService against the SAME
 * `user_data` row, so web and mobile share one book:
 *
 *   - version'd compare-and-swap writes (`.eq('version', expected)`) — a stale
 *     device can never blind-overwrite a newer snapshot
 *   - #cloudVersion === null means "no pull has succeeded yet"; pushing is
 *     refused on an unknown baseline (web audit C5)
 *   - a pull flushes any pending debounced push first (C6)
 *   - transient `_`-prefixed keys are stripped before upload (M9)
 *   - StateMigrator runs on every inbound snapshot, so an older schema from
 *     the cloud is brought current before it becomes live state (C8)
 *
 * Deliberately NOT ported for v1: family sharing (contributions, shares,
 * realtime channels). The web app remains the place to manage those; nothing
 * here writes to the family tables, so mobile cannot corrupt that flow.
 *
 * Auth: email one-time code (signInWithOtp + verifyOtp). The web app's Google
 * OAuth needs a browser redirect that Expo Go can't complete cleanly; email
 * codes work everywhere. Both providers resolve to the same Supabase user as
 * long as the email matches.
 */
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Store } from '../../core/Store.js';
import { EventBus } from '../../core/EventBus.js';
import { Repository } from '../../core/Repository.js';
import { StateMigrator } from '../../data/StateMigrator.js';
import { CurrencyService } from './CurrencyService.js';
import { LedgerMath } from './LedgerMath.js';
import { APP_SUPABASE_URL, APP_SUPABASE_KEY } from '../../data/constants.js';

export class MobileSyncService {
  /** @type {Store} */    #store;
  /** @type {EventBus} */ #bus;
  /** @type {CurrencyService} */ #fx;

  #sb = null;
  #user = null;
  /** null = unknown (no successful pull yet) · 0 = confirmed empty · >0 = row version */
  #cloudVersion = null;
  #saveTimer = null;
  #dirty = false;
  #syncing = Promise.resolve();

  // ── Family sharing (member + owner) ──────────────────────────────────
  /** Shared accounts pulled from OTHER owners: [{...snapshot, _ownerId}]. */
  #sharedData = [];
  /** Optimistic add/remove bookkeeping, keyed by tx id. */
  #pendingAdditions = new Map();
  #pendingRemovals  = new Set();
  #sharesChannel  = null;
  #contribChannel = null;
  #userChannel    = null;

  constructor() {
    this.#store = Store.getInstance();
    this.#bus   = EventBus.getInstance();
    this.#fx    = new CurrencyService();
  }

  /** @returns {object[]} shared-account snapshots from other owners */
  get sharedData() { return this.#sharedData; }

  /** @param {string} ownerId @returns {object|null} */
  shareByOwner(ownerId) {
    return this.#sharedData.find((s) => s._ownerId === ownerId) || null;
  }

  // ── Init / auth ───────────────────────────────────────────────────────

  /** @returns {boolean} true when Supabase is configured */
  init() {
    if (!APP_SUPABASE_URL || !APP_SUPABASE_KEY) return false;
    try {
      this.#sb = createClient(APP_SUPABASE_URL, APP_SUPABASE_KEY, {
        auth: {
          storage: AsyncStorage,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false, // no URL hash on native
        },
      });
      return true;
    } catch (e) {
      console.error('[MobileSync] init error:', e);
      return false;
    }
  }

  /** @returns {object|null} */
  get currentUser() { return this.#user; }

  /** Restore a persisted session, then pull. */
  async restoreSession() {
    if (!this.#sb) return { signedIn: false };
    try {
      const { data } = await this.#sb.auth.getSession();
      const user = data?.session?.user ?? null;
      if (user) {
        this.#user = user;
        this.#emit('syncing');
        await this.pull();
        return { signedIn: true };
      }
    } catch (e) {
      console.warn('[MobileSync] getSession failed:', e);
    }
    this.#emit('local');
    return { signedIn: false };
  }

  /**
   * Step 1 of email sign-in: send a one-time code.
   * @param {string} email
   * @returns {Promise<{ok:boolean, error?:string}>}
   */
  async requestCode(email) {
    if (!this.#sb) return { ok: false, error: 'Sync not configured' };
    const { error } = await this.#sb.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
    });
    return error ? { ok: false, error: MobileSyncService.explainAuthError(error) } : { ok: true };
  }

  /**
   * Turn Supabase's terse auth errors into something actionable.
   *
   * The rate-limit one especially: Supabase's built-in mailer allows only
   * **2 emails per hour, project-wide**, and that specific limit cannot be
   * raised in the dashboard — it needs custom SMTP. "Email rate limit
   * exceeded" gives no hint of any of that.
   *
   * @param {{message?:string, status?:number}} error
   * @returns {string}
   */
  static explainAuthError(error) {
    const msg = (error?.message || '').toLowerCase();

    if (msg.includes('rate limit') || error?.status === 429) {
      return 'Too many sign-in emails.\n\n'
           + 'Supabase\'s built-in mailer allows only 2 emails per hour for the '
           + 'whole project, and that cap can\'t be raised without setting up '
           + 'custom SMTP.\n\n'
           + 'Wait up to an hour and try once more — you only need to sign in '
           + 'once per device, after which the session is remembered.';
    }
    if (msg.includes('signups not allowed') || msg.includes('not authorized')) {
      return 'This email has no account yet, and sign-ups are disabled in your '
           + 'Supabase Auth settings. Enable sign-ups, or use the address you '
           + 'already sign in with on the web.';
    }
    if (msg.includes('email') && msg.includes('disabled')) {
      return 'The Email provider is turned off in Supabase Auth. '
           + 'Enable it under Authentication → Sign In / Providers.';
    }
    if (msg.includes('token') && (msg.includes('expired') || msg.includes('invalid'))) {
      return 'That code is wrong or has expired (codes last 1 hour). '
           + 'Request a new one — but note the 2-per-hour cap.';
    }
    return error?.message || 'Sign-in failed';
  }

  /**
   * Step 2: verify the emailed code and adopt the session.
   * @param {string} email
   * @param {string} token
   * @returns {Promise<{ok:boolean, error?:string}>}
   */
  async verifyCode(email, token) {
    if (!this.#sb) return { ok: false, error: 'Sync not configured' };
    const { data, error } = await this.#sb.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: token.trim(),
      type: 'email',
    });
    if (error || !data?.user) {
      return { ok: false, error: error ? MobileSyncService.explainAuthError(error) : 'Invalid code' };
    }
    this.#user = data.user;
    this.#emit('syncing');
    await this.pull();
    this.#bus.emit('auth:changed', { user: this.#user });
    return { ok: true };
  }

  /**
   * Native Google sign-in (requires a DEVELOPMENT BUILD — the native module
   * isn't in Expo Go). Gets a Google ID token via
   * @react-native-google-signin/google-signin, then hands it to Supabase's
   * signInWithIdToken. On success it adopts the session exactly like the email
   * path (pull + subscribe + auth:changed).
   * @returns {Promise<{ok:boolean, error?:string}>}
   */
  async signInWithGoogle() {
    if (!this.#sb) return { ok: false, error: 'Sync not configured' };
    let GoogleSignin;
    try { ({ GoogleSignin } = require('@react-native-google-signin/google-signin')); }
    catch {
      return { ok: false, error: 'Google sign-in needs a development build (not Expo Go). See the README, then build with EAS.' };
    }
    const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
    if (!webClientId) {
      return { ok: false, error: 'Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (see README → Google sign-in).' };
    }
    try {
      GoogleSignin.configure({ webClientId, iosClientId });
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const res = await GoogleSignin.signIn();
      // v13+ returns { type, data: { idToken } }; older returns { idToken }.
      const idToken = res?.data?.idToken ?? res?.idToken ?? null;
      if (!idToken) return { ok: false, error: 'Google did not return an ID token.' };

      const { data, error } = await this.#sb.auth.signInWithIdToken({ provider: 'google', token: idToken });
      if (error || !data?.user) {
        return { ok: false, error: error ? MobileSyncService.explainAuthError(error) : 'Sign-in failed' };
      }
      this.#user = data.user;
      this.#emit('syncing');
      await this.pull();
      this.#bus.emit('auth:changed', { user: this.#user });
      return { ok: true };
    } catch (e) {
      const code = e?.code;
      if (code === 'SIGN_IN_CANCELLED' || code === '-5' || code === 'CANCELED') return { ok: false, error: null };
      return { ok: false, error: String(e?.message || e) };
    }
  }

  /** Sign out. Local data is kept — this device may hold un-pushed edits. */
  async signOut() {
    try { await this.#sb?.auth.signOut(); } catch (_) {}
    try { require('@react-native-google-signin/google-signin').GoogleSignin.signOut(); } catch (_) {}
    this.#teardownFamily();
    this.#user = null;
    this.#cloudVersion = null;
    this.#sharedData = [];
    this.#pendingAdditions.clear();
    this.#pendingRemovals.clear();
    // Drop the cloud-derived slice from local state so the next user never sees
    // the previous one's shared data; no push (session just ended).
    const state = this.#store.getState();
    state._sharedData = [];
    this.#store.withoutLocalChange(() => this.#store.persist());
    this.#emit('local');
    this.#bus.emit('auth:changed', { user: null });
  }

  // ── Push ──────────────────────────────────────────────────────────────

  /** Debounced push — wire this to Store's local-change hook. */
  schedulePush() {
    if (!this.#sb || !this.#user) return;
    this.#dirty = true;
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.push(), 1500);
  }

  push() {
    this.#syncing = this.#syncing.then(() => this.#doPush()).catch(() => {});
    return this.#syncing;
  }

  async #doPush() {
    if (!this.#sb || !this.#user) return;
    if (this.#cloudVersion === null) {
      // No successful pull yet — uploading would overwrite an unknown baseline.
      console.warn('[MobileSync] holding push until a pull succeeds');
      this.#emit('error');
      return;
    }
    this.#emit('syncing');
    try {
      const ok = await this.#commitState(this.#store.getState());
      if (!ok) {
        // Another device advanced the version; adopt the winner. The losing
        // local copy is stashed so a conflict never silently destroys work.
        await this.#stashConflict();
        await this.#doPull();
        this.#dirty = false;
        this.#bus.emit('toast', { message: 'Another device saved first — local copy kept as backup' });
        return;
      }
      this.#dirty = false;
      this.#emit('synced');
      // Web parity: after every successful push, re-publish the snapshots that
      // family members read and drain any pending inbound contributions, so an
      // owner's edit to a shared account/transaction reaches members promptly
      // (keeps the intentional live add/delete sync working both ways).
      this.#pushFamilyShares().catch(() => {});
      this.#pullMemberContributions().catch(() => {});
    } catch (e) {
      console.error('[MobileSync] push error:', e);
      this.#emit('error');
    }
  }

  /** Version-guarded write — the single choke point for uploads. */
  async #commitState(rawState) {
    const state    = Repository.stripTransient(rawState);
    const expected = this.#cloudVersion;
    if (expected === null) throw new Error('cloud state not loaded');

    if (expected > 0) {
      const { data: rows, error } = await this.#sb
        .from('user_data')
        .update({ data: state, version: expected + 1, updated_at: new Date().toISOString() })
        .eq('id', this.#user.id)
        .eq('version', expected)
        .select('version');
      if (error) throw error;
      if (!rows || !rows.length) return false;
      this.#cloudVersion = expected + 1;
      return true;
    }
    const { error } = await this.#sb.from('user_data').upsert({
      id: this.#user.id, data: state, version: 1, updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (error) throw error;
    this.#cloudVersion = 1;
    return true;
  }

  // ── Pull ──────────────────────────────────────────────────────────────

  pull() {
    this.#syncing = this.#syncing.then(() => this.#doPull()).catch(() => {});
    return this.#syncing;
  }

  async #doPull() {
    if (!this.#sb || !this.#user) return;

    // Commit a pending local edit before overwriting local state (C6).
    if (this.#dirty && this.#cloudVersion !== null) {
      clearTimeout(this.#saveTimer);
      try { await this.#doPush(); } catch (_) {}
      if (!this.#dirty) return;
    }

    this.#emit('syncing');
    try {
      const { data, error } = await this.#sb
        .from('user_data')
        .select('data, version')
        .eq('id', this.#user.id)
        .single();
      if (error && error.code !== 'PGRST116') throw error;

      if (data?.data) {
        this.#store.replaceState(data.data, (s) => StateMigrator.migrate(s));
        this.#cloudVersion = data.version ?? 0;
        this.#dirty = false;
        // As the OWNER, apply anything family members contributed while we were
        // away, then refresh the accounts OTHERS share with us.
        await this.#pullMemberContributions();
        await this.#pullFamilyShares();
        this.#subscribeFamily();
        this.#emit('synced');
        this.#bus.emit('state:changed', this.#store.getState());
      } else {
        // Genuine first sign-in from this account: publish local state.
        this.#cloudVersion = 0;
        await this.#doPush();
        await this.#pullFamilyShares();
        this.#subscribeFamily();
      }
    } catch (e) {
      console.error('[MobileSync] pull error:', e);
      this.#emit('error');
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  async #stashConflict() {
    try {
      await AsyncStorage.setItem('pocket.v1.conflict', JSON.stringify({
        savedAt: new Date().toISOString(),
        state: Repository.stripTransient(this.#store.getState()),
      }));
    } catch (_) { /* best effort */ }
  }

  #emit(status) {
    this.#bus.emit('sync:status', { status });
  }

  // ── Test seams ────────────────────────────────────────────────────────
  // Node tests inject a fake Supabase client + user and drive the family
  // paths directly, without a real auth round-trip. Not used by the app.

  /** @param {object} sb @param {object} user */
  _testInject(sb, user) {
    this.#sb = sb;
    this.#user = user;
    this.#cloudVersion = 3; // pretend a pull already succeeded
  }

  /** Apply pending member contributions as the owner. */
  _testPullContribs() { return this.#pullMemberContributions(); }

  /** Refresh shares as a member. */
  _testPullShares() { return this.#pullFamilyShares(); }

  // ══════════════════════════════════════════════════════════════════════
  // Family sharing — ported verbatim from the web SyncService so the live
  // add/delete round-trip and every audit protection (H6/H8/H9/M8) behave
  // identically on mobile. Web and mobile hit the same family_shares /
  // family_contributions tables.
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Member submits a transaction to a shared account. The row lands in the
   * owner's family_contributions inbox; their client applies it after an
   * authorisation check (#authoriseContribution).
   * @param {string} ownerId @param {object} txData
   */
  async submitContribution(ownerId, txData) {
    if (!this.#sb || !this.#user) throw new Error('Not signed in');
    const share = this.#sharedData.find((s) => s._ownerId === ownerId);
    const accountId = txData.accountId
      ?? txData.splits?.[0]?.accountId
      ?? share?.accounts?.[0]?.id
      ?? (share?.permission ? Object.keys(share.permission)[0] : null);

    const { error } = await this.#sb.from('family_contributions').upsert({
      owner_id: ownerId, member_email: this.#user.email.toLowerCase(),
      account_id: accountId, tx_data: txData, synced: false,
    }, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;

    if (share) {
      share.transactions = [txData, ...(share.transactions || [])];
      this.#deriveShareBalances(share);
      this.#pendingAdditions.set(txData.id, { tx: txData, ownerId });
      this.#bus.emit('state:changed', this.#store.getState());
    }
  }

  /**
   * Member edits a previously-contributed row: a `_replace` delete marker plus
   * an add carrying the SAME id, so the owner applies it as an in-place update
   * rather than a duplicate (audit H6). `_replace` needs only 'edit' rights.
   * @param {string} ownerId @param {string} txId @param {object} txData
   */
  async updateContribution(ownerId, txId, txData) {
    if (!this.#sb || !this.#user) throw new Error('Not signed in');
    const share = this.#sharedData.find((s) => s._ownerId === ownerId);
    const next  = { ...txData, id: txId };
    const accountId = next.accountId
      ?? next.splits?.[0]?.accountId
      ?? share?.accounts?.[0]?.id
      ?? (share?.permission ? Object.keys(share.permission)[0] : null);
    const email = this.#user.email.toLowerCase();

    let r = await this.#sb.from('family_contributions').upsert({
      owner_id: ownerId, member_email: email, account_id: accountId,
      tx_data: { _delete: true, _replace: true, id: `rep_${txId}`, targetId: txId },
      synced: false,
    }, { onConflict: 'id', ignoreDuplicates: true });
    if (r.error) throw r.error;
    r = await this.#sb.from('family_contributions').upsert({
      owner_id: ownerId, member_email: email, account_id: accountId,
      tx_data: next, synced: false,
    }, { onConflict: 'id', ignoreDuplicates: true });
    if (r.error) throw r.error;

    if (share) {
      share.transactions = (share.transactions || []).map((t) => (t.id === txId ? next : t));
      this.#deriveShareBalances(share);
      this.#pendingAdditions.set(txId, { tx: next, ownerId });
      this.#bus.emit('state:changed', this.#store.getState());
    }
  }

  /**
   * Member deletes a row they contributed. Sends a delete marker carrying a
   * non-null account_id (the column is NOT NULL) and hides the row optimistically.
   * @param {string} ownerId @param {string} txId
   */
  async deleteContribution(ownerId, txId) {
    if (!this.#sb || !this.#user) throw new Error('Not signed in');
    if (this.#pendingRemovals.has(txId)) {
      this.#sharedData.forEach((s) => { s.transactions = (s.transactions || []).filter((t) => t.id !== txId); });
      this.#bus.emit('state:changed', this.#store.getState());
      return;
    }
    const share  = this.#sharedData.find((s) => (s.transactions || []).some((t) => t.id === txId));
    const target = share?.transactions?.find((t) => t.id === txId) || null;
    const accountId = target?.accountId
      ?? target?.splits?.[0]?.accountId
      ?? share?.accounts?.[0]?.id
      ?? (share?.permission ? Object.keys(share.permission)[0] : null);

    this.#pendingRemovals.add(txId);
    if (share) {
      share.transactions = (share.transactions || []).filter((t) => t.id !== txId);
      this.#deriveShareBalances(share);
      this.#bus.emit('state:changed', this.#store.getState());
    }
    const { error } = await this.#sb.from('family_contributions').upsert({
      owner_id: ownerId, member_email: this.#user.email.toLowerCase(),
      account_id: accountId,
      tx_data: { _delete: true, id: `del_${txId}`, targetId: txId },
      synced: false,
    }, { onConflict: 'id', ignoreDuplicates: true });
    if (error) { this.#pendingRemovals.delete(txId); throw error; }
  }

  /**
   * Owner revokes a member: delete their family_shares row and nudge their
   * client (audit H8). Removing them from state.family alone leaves the row
   * serving a stale snapshot forever.
   * @param {string} email
   */
  async revokeMemberShare(email) {
    if (!this.#sb || !this.#user || !email) return;
    const addr = email.toLowerCase().trim();
    try {
      await this.#sb.from('family_shares').delete()
        .eq('owner_id', this.#user.id).eq('member_email', addr);
      this.#broadcastToMember(addr);
    } catch (e) { console.warn('[MobileSync] revokeMemberShare:', e); }
  }

  /** Re-pull shares after a short delay (used post-contribution). @param {number} ms */
  scheduleSharesRefresh(ms) {
    setTimeout(async () => {
      if (!this.#sb || !this.#user) return;
      try { await this.#pullFamilyShares(); this.#bus.emit('state:changed', this.#store.getState()); }
      catch (_) {}
    }, ms);
  }

  /** Publish this owner's shared accounts to each family member. */
  async pushFamilyShares() { return this.#pushFamilyShares(); }

  async #pushFamilyShares() {
    const state = this.#store.getState();
    if (!this.#sb || !this.#user) return;
    for (const member of state.family || []) {
      if (!member.email) continue;
      const permMap = {};
      (member.permissions || []).forEach((p) => { permMap[p.accountId] = p.access; });
      const sharedIds = Object.keys(permMap);
      if (!sharedIds.length) { await this.revokeMemberShare(member.email); continue; }
      const snapshot = {
        sharedBy:     state.user.name || this.#user.email,
        homeCurrency: state.user.homeCurrency,
        permission:   permMap,
        accounts:     state.accounts.filter((a) => sharedIds.includes(a.id)),
        transactions: state.transactions.filter((t) =>
          permMap[t.accountId] || (t.splits || []).some((s) => permMap[s.accountId])),
        categories:   state.categories,
        updatedAt:    new Date().toISOString(),
      };
      try {
        await this.#sb.from('family_shares').upsert({
          owner_id: this.#user.id, member_email: member.email.toLowerCase().trim(), snapshot,
        }, { onConflict: 'owner_id,member_email' });
        this.#broadcastToMember(member.email.toLowerCase().trim());
      } catch (e) { console.warn('[MobileSync] pushFamilyShares:', e); }
    }
  }

  #broadcastToMember(email) {
    if (!this.#sb) return;
    const ch = this.#sb.channel('pocket_family_' + email.replace(/[^a-z0-9]/g, '_'));
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
        .from('family_shares').select('owner_id, snapshot')
        .eq('member_email', this.#user.email.toLowerCase())
        .order('owner_id');
      if (error) { console.warn('[MobileSync] pullFamilyShares:', error); return; }

      const rawIds = new Set((data || []).flatMap((r) => (r.snapshot?.transactions || []).map((t) => t.id)));
      this.#sharedData = (data || [])
        .filter((r) => r.snapshot && r.owner_id !== this.#user.id)
        .map((r) => ({ ...r.snapshot, _ownerId: r.owner_id }))
        .sort((a, b) => String(a._ownerId).localeCompare(String(b._ownerId)));

      for (const txId of [...this.#pendingRemovals]) if (!rawIds.has(txId)) this.#pendingRemovals.delete(txId);
      if (this.#pendingRemovals.size) {
        this.#sharedData.forEach((s) => {
          s.transactions = (s.transactions || []).filter((t) => !this.#pendingRemovals.has(t.id));
        });
      }
      for (const [txId, { tx, ownerId }] of [...this.#pendingAdditions]) {
        const share = this.#sharedData.find((s) => s._ownerId === ownerId);
        if (!share) { this.#pendingAdditions.delete(txId); continue; }
        if ((share.transactions || []).some((t) => t.id === txId)) { this.#pendingAdditions.delete(txId); continue; }
        share.transactions = [tx, ...(share.transactions || [])];
      }
      for (const share of this.#sharedData) this.#deriveShareBalances(share);
    } catch (e) { console.warn('[MobileSync] pullFamilyShares:', e); }
  }

  #deriveShareBalances(share) {
    if (!share || !Array.isArray(share.accounts)) return;
    const balances = LedgerMath.balances(share.accounts, share.transactions || [], this.#fx);
    for (const a of share.accounts) a.balance = balances.get(a.id) ?? a.balance ?? 0;
  }

  /** Current access a member holds per account — read live, not from cache. */
  #memberPermissions(email) {
    const key = (email || '').toLowerCase().trim();
    const member = (this.#store.getState().family || [])
      .find((m) => (m.email || '').toLowerCase().trim() === key);
    const map = {};
    for (const p of (member?.permissions || [])) map[p.accountId] = p.access;
    return map;
  }

  /**
   * Owner-side authorisation for an incoming contribution (audit H9). Checked
   * against the CURRENT permission map, so a downgraded/revoked member with a
   * stale client cannot write. add ≤ edit ≤ full; delete needs full; a
   * `_replace` delete needs only edit.
   */
  #authoriseContribution(row) {
    const perms = this.#memberPermissions(row.member_email);
    const tx    = row.tx_data || {};
    const level = (id) => perms[id] || null;

    if (tx._delete === true) {
      const targetId = tx.targetId || tx.id;
      const target = (this.#store.getState().transactions || []).find((t) => t.id === targetId);
      if (!target) return { ok: true }; // already gone
      const access = level(target.accountId);
      const allowed = tx._replace ? ['edit', 'full'].includes(access) : access === 'full';
      return allowed ? { ok: true }
        : { ok: false, reason: `no ${tx._replace ? 'edit' : 'delete'} access on ${target.accountId}` };
    }
    const touched = new Set([tx.accountId, ...(tx.splits || []).map((s) => s.accountId || tx.accountId)].filter(Boolean));
    if (!touched.size) return { ok: false, reason: 'no account on contribution' };
    for (const id of touched) {
      if (!['add', 'edit', 'full'].includes(level(id))) return { ok: false, reason: `no write access on ${id}` };
    }
    return { ok: true };
  }

  async #pullMemberContributions() {
    if (!this.#sb || !this.#user) return;
    try {
      const { data, error } = await this.#sb
        .from('family_contributions').select('id, tx_data, member_email, account_id')
        .eq('owner_id', this.#user.id).eq('synced', false);
      if (error || !data?.length) return;

      const state = this.#store.getState();
      const rejected = [], rows = [];
      for (const row of data) {
        (this.#authoriseContribution(row).ok ? rows : rejected).push(row);
      }
      if (rejected.length) {
        try {
          await this.#sb.from('family_contributions').update({ synced: true })
            .in('id', rejected.map((r) => r.id));
        } catch (_) {}
        this.#bus.emit('toast', { message: `${rejected.length} family change${rejected.length > 1 ? 's' : ''} blocked — permission removed` });
      }
      if (!rows.length) return;

      const deleteRows = rows.filter((r) => r.tx_data?._delete === true);
      const addRows    = rows.filter((r) => !r.tx_data?._delete && r.tx_data?.id);

      if (deleteRows.length) {
        const ids = new Set(deleteRows.map((r) => r.tx_data.targetId || r.tx_data.id));
        state.transactions = state.transactions.filter((t) => !ids.has(t.id));
      }
      // AFTER deletes, so an edit (delete + re-add of same id) lands as replace.
      const existing = new Set(state.transactions.map((t) => t.id));
      const newRows  = addRows.filter((r) => !existing.has(r.tx_data.id));
      newRows.forEach((r) => state.transactions.push({ ...r.tx_data, _fromFamily: true }));

      if (newRows.length || deleteRows.length) {
        // Applied FROM the cloud → commit without triggering another push.
        this.#store.withoutLocalChange(() => this.#store.persist());
        const committed = await this.#commitState(state);
        if (committed) {
          await this.#sb.from('family_contributions').update({ synced: true }).in('id', rows.map((r) => r.id));
          await this.#pushFamilyShares();
          this.#bus.emit('state:changed', state);
        } else {
          await this.#doPull();
        }
      }
    } catch (e) { console.warn('[MobileSync] pullMemberContributions:', e); }
  }

  #subscribeFamily() {
    if (!this.#sb || !this.#user || this.#sharesChannel) return;
    const email = this.#user.email?.toLowerCase().replace(/[^a-z0-9]/g, '_') || '';
    this.#sharesChannel = this.#sb.channel('pocket_family_' + email)
      .on('broadcast', { event: 'share_updated' }, async () => {
        await this.#pullFamilyShares();
        this.#bus.emit('state:changed', this.#store.getState());
      })
      .subscribe();
    this.#contribChannel = this.#sb.channel('pocket_contrib_' + this.#user.id)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'family_contributions',
        filter: `owner_id=eq.${this.#user.id}`,
      }, () => this.#pullMemberContributions())
      .subscribe();
    // Main-book realtime: another device saving the user_data row live-refreshes
    // this app. Skip while a local edit is pending — the CAS in #doPush settles
    // conflicts; pulling mid-edit would clobber unsynced work.
    this.#userChannel = this.#sb.channel('pocket_user_' + this.#user.id)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'user_data',
        filter: `id=eq.${this.#user.id}`,
      }, (payload) => {
        // Ignore our OWN writes (and anything not newer than what we hold) —
        // otherwise every local save echoes back here and triggers a full
        // replaceState + re-render, which shows up as UI jank after each edit.
        const incoming = payload?.new?.version;
        if (this.#dirty) return;
        if (incoming != null && this.#cloudVersion != null && incoming <= this.#cloudVersion) return;
        this.pull();
      })
      .subscribe();
  }

  #teardownFamily() {
    for (const ch of [this.#sharesChannel, this.#contribChannel, this.#userChannel]) {
      if (ch) { try { this.#sb?.removeChannel(ch); } catch (_) {} }
    }
    this.#sharesChannel = this.#contribChannel = this.#userChannel = null;
  }
}
