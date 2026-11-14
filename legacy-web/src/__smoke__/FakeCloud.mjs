/**
 * FakeCloud — an in-memory stand-in for the Supabase book API the web app
 * uses (supabase/migrations/0012_book_api.sql), for the smoke suites.
 *
 * It mirrors the parts the app relies on:
 *   rpc('pocket_get_book')            the caller's book, or null before the first save
 *   rpc('pocket_get_changes', {since}) the same as a change set: the head in full, and
 *                                     the transactions changed or removed since the
 *                                     cursor (worked out against what that cursor
 *                                     served, so books edited directly still delta);
 *                                     all of them when `since` is null or unknown
 *   rpc('pocket_apply_changes', …)    a change set, with the same sharing rules:
 *                                     owners change anything; members change only
 *                                     transactions, by their access to the account
 *                                     (add → new entries, edit → change, full →
 *                                     delete; their own entries with add access)
 *   rpc('pocket_get_shared')          the books shared with the caller
 *   rpc('pocket_get_shared_changes', {since})  the same as change sets per share,
 *                                     worked out like pocket_get_changes
 *   rpc('pocket_entitlements')        the caller's plan (plans[userId], or Family for life);
 *                                     with a plan that doesn't allow it, loading and
 *                                     saving are refused with PP402 as in migration 0020
 *   channel().on('postgres_changes')  live updates, fired by emit()
 *
 * Tests read and seed books directly with book() / setBook().
 */
const RANK = { view: 0, add: 1, edit: 2, full: 3, owner: 4 };

/** What every user has unless a test sets plans[userId]: everything, for life. */
const FAMILY_FOR_LIFE = Object.freeze({
  plan: 'family', planName: 'Family', paidPlan: 'family', term: 'lifetime', source: 'comp', state: 'active',
  endsAt: null, graceUntil: null, autoRenew: false,
  access: { sync: 'write', telegram: 'write', sharing: 'write' },
  seats: 5, seatsUsed: 1, coveredBy: [], aiCredits: 0, aiUnlimited: true, trialAvailable: true,
});

/** The server's plan refusal (SQLSTATE PP402), as PostgREST reports it. */
class PlanRefusal extends Error {
  constructor(details, hint) {
    super('PLAN_REQUIRED');
    this.code = 'PP402';
    this.details = details;
    this.hint = hint;
  }
}
const LISTS = ['accountGroups', 'accounts', 'categories', 'budgets', 'debts',
  'regularItems', 'family', 'spaces', 'transactions'];

export class FakeCloud {
  /** @type {Map<string, object>} owner id → book */
  #books = new Map();
  /** @type {Map<string, string>} owner id → email */
  #emails = new Map();
  #handlers = [];
  /** @type {Map<string, {ownerId: string, rows: Map<string, string>}>} cursor → what it served */
  #served = new Map();
  #tick = 0;

  /** Every rpc call made, in order: { fn, args, userId }. */
  calls = [];
  /** Set to an rpc name to make its next call fail (network-style). */
  failNext = null;
  /** While true, every call fails as if the network were down. */
  offline = false;
  /** The most recent auth listener the app registered. */
  authCb = null;
  /**
   * Shares to serve as-is, keyed by member email, for suites that test what a
   * member does with a share rather than how it is computed.
   * @type {Map<string, object[]>}
   */
  servedShares = new Map();
  /**
   * Plans by user id, shaped like pocket_entitlements(). Users not listed have
   * Family for life (so suites about other things are unaffected).
   * @type {Map<string, object>}
   */
  plans = new Map();

  /** Seed (or replace) a book. */
  setBook(ownerId, state, email = `${ownerId}@x.com`) {
    this.#books.set(ownerId, structuredClone(state));
    this.#emails.set(ownerId, email);
  }

  /** The cloud copy of a book (live object), or null. */
  book(ownerId) {
    return this.#books.get(ownerId) ?? null;
  }

  /** What a member with this email is served from the books right now. */
  sharesFor(email) {
    return this.#shared({ id: `member:${email}`, email });
  }

  /** Number of pocket_apply_changes calls so far. */
  get saves() {
    return this.calls.filter((c) => c.fn === 'pocket_apply_changes').length;
  }

  /**
   * A `createClient` for window.supabase, signed in as `user` once the app
   * restores its session (pass `session: false` to start signed out).
   */
  client(user, { session = false } = {}) {
    this.#emails.set(user.id, this.#emails.get(user.id) || user.email);
    return () => this.#sb(user, session);
  }

  /** Fire a live-update event as if another device changed a row. */
  emit(table, ownerId, row, event = 'UPDATE') {
    for (const h of this.#handlers) {
      if (h.table === table && h.filter === `owner_id=eq.${ownerId}`) {
        h.fn({ eventType: event, new: { owner_id: ownerId, ...row }, old: {} });
      }
    }
  }

  #sb(user, session) {
    const cloud = this;
    return {
      auth: {
        onAuthStateChange(cb) { cloud.authCb = cb; },
        getSession: async () => ({ data: { session: session ? { user } : null } }),
        signOut: async () => {},
        signInWithOAuth: async () => ({}),
      },
      removeChannel() {},
      channel() {
        const ch = {
          on(_kind, cfg, fn) { cloud.#handlers.push({ table: cfg.table, filter: cfg.filter, fn }); return ch; },
          subscribe() { return ch; },
        };
        return ch;
      },
      rpc: async (fn, args = {}) => {
        cloud.calls.push({ fn, args: structuredClone(args), userId: user.id });
        if (cloud.offline || cloud.failNext === fn) {
          cloud.failNext = null;
          return { data: null, error: { message: 'network down' } };
        }
        try {
          return { data: cloud.#call(user, fn, args), error: null };
        } catch (e) {
          return { data: null, error: { message: e.message, code: e.code, details: e.details, hint: e.hint } };
        }
      },
    };
  }

  #call(user, fn, args) {
    if (fn === 'pocket_entitlements') return structuredClone(this.#planOf(user.id));
    if (fn === 'pocket_get_book') { this.#mayRead(user); return structuredClone(this.#books.get(user.id) ?? null); }
    if (fn === 'pocket_get_changes') { this.#mayRead(user); return this.#changes(user, args.since ?? null); }
    if (fn === 'pocket_get_shared') return this.#shared(user);
    if (fn === 'pocket_get_shared_changes') return this.#sharedChanges(user, args.since ?? null);
    if (fn === 'pocket_apply_changes') { this.#mayWrite(user, args.book); return this.#apply(user, args.book, args.changes); }
    throw new Error(`unknown rpc ${fn}`);
  }

  #planOf(userId) {
    return this.plans.get(userId) ?? FAMILY_FOR_LIFE;
  }

  #mayRead(user) {
    if (this.#planOf(user.id).access.sync === 'none') {
      throw new PlanRefusal('sync', 'The cloud copy needs a Sync or Family plan.');
    }
  }

  #mayWrite(user, book) {
    const plan = this.#planOf(user.id);
    if (book === user.id) {
      if (plan.access.sync !== 'write') throw new PlanRefusal('sync', 'Saving to the cloud needs a Sync or Family plan.');
    } else if (this.plans.has(user.id)
               && !plan.coveredBy.some((c) => c.ownerId === book && c.access === 'write')) {
      throw new PlanRefusal('shared', 'This shared space is read-only: its owner\'s Family plan is not active.');
    }
  }

  /** The caller's book as pocket_get_changes returns it. */
  #changes(user, since) {
    const book = this.#books.get(user.id);
    if (!book) return null;
    const { transactions = [], ...head } = structuredClone(book);
    const rows = new Map(transactions.map((t) => [t.id, JSON.stringify(t)]));
    const cursor = `fake:${++this.#tick}`;
    this.#served.set(cursor, { ownerId: user.id, rows });

    const before = since ? this.#served.get(since) : null;
    let put = transactions;
    let remove = [];
    if (before && before.ownerId === user.id) {
      put = transactions.filter((t) => before.rows.get(t.id) !== rows.get(t.id));
      remove = [...before.rows.keys()].filter((id) => !rows.has(id));
    }
    return { ...head, _delta: { cursor, full: since == null, count: transactions.length, put, remove } };
  }

  /** The shares as pocket_get_shared_changes returns them. */
  #sharedChanges(user, since) {
    const cursor = `fake:${++this.#tick}`;
    const key = (sh) => `${sh._ownerId}|${sh._spaceId}`;
    const before = since ? this.#served.get(since) : null;
    const known = before && before.ownerId === `shares:${user.id}` ? before.rows : null;
    const rows = new Map();
    const shares = this.#shared(user).map(({ transactions = [], ...head }) => {
      const mine = new Map(transactions.map((t) => [t.id, JSON.stringify(t)]));
      rows.set(key(head), mine);
      const was = known?.get(key(head));
      const put = was ? transactions.filter((t) => was.get(t.id) !== mine.get(t.id)) : transactions;
      const remove = was ? [...was.keys()].filter((id) => !mine.has(id)) : [];
      return { ...head, _delta: { full: since == null, count: transactions.length, put, remove } };
    });
    this.#served.set(cursor, { ownerId: `shares:${user.id}`, rows });
    return { cursor, shares };
  }

  /** How many pocket_get_shared_changes calls asked for every share in full. */
  get fullShareLoads() {
    return this.calls.filter((c) => c.fn === 'pocket_get_shared_changes' && c.args.since == null).length;
  }

  /** How many pocket_get_changes calls asked for the whole book. */
  get fullLoads() {
    return this.calls.filter((c) => c.fn === 'pocket_get_changes' && c.args.since == null).length;
  }

  // ── sharing ────────────────────────────────────────────────────────────────

  /** The member entry for `email` in a book, if any. */
  #memberOf(book, email) {
    return (book?.family || []).find((m) => (m.email || '').toLowerCase() === email.toLowerCase()) || null;
  }

  /** A member's grants as { id: access } (the book keeps them as a list). */
  static #grants(list, idKey) {
    return Object.fromEntries((list || []).map((p) => [p[idKey], p.access]));
  }

  #access(ownerId, user, accountId) {
    if (ownerId === user.id) return 'owner';
    const m = this.#memberOf(this.#books.get(ownerId), user.email);
    return FakeCloud.#grants(m?.permissions, 'accountId')[accountId] ?? null;
  }

  #rank(access) {
    return access == null ? -1 : (RANK[access] ?? -1);
  }

  #shared(user) {
    if (this.servedShares.has(user.email)) return structuredClone(this.servedShares.get(user.email));
    const out = [];
    for (const [ownerId, book] of this.#books) {
      if (ownerId === user.id) continue;
      const m = this.#memberOf(book, user.email);
      const perm = FakeCloud.#grants(m?.permissions, 'accountId');
      const bperm = FakeCloud.#grants(m?.budgetPermissions, 'budgetId');
      if (!Object.keys(perm).length && !Object.keys(bperm).length) continue;
      const space = (book.spaces || []).find((s) => (s.members || []).some((x) => x.memberId === m.id));
      const inShare = (accountId) => accountId in perm;
      const ownerName = book.user?.name || this.#emails.get(ownerId);
      out.push(structuredClone({
        _ownerId: ownerId,
        _spaceId: space?.id || 'default',
        sharedBy: m.spaceName || ownerName,
        ownerName,
        homeCurrency: book.user?.homeCurrency,
        permission: perm,
        budgetPermission: bperm,
        accounts: (book.accounts || []).filter((a) => inShare(a.id)),
        transactions: (book.transactions || []).filter((t) => inShare(t.accountId)
          || (t.splits || []).some((s) => inShare(s.accountId))),
        categories: book.categories || [],
        debts: (book.debts || []).filter((d) => inShare(d.accountId)),
        regularItems: (book.regularItems || []).filter((r) => inShare(r.accountId)),
        budgets: (book.budgets || []).filter((b) => b.id in bperm)
          .map(({ sharedSpend, ...b }) => ({ ...b, spent: sharedSpend ?? 0 })),
        updatedAt: new Date().toISOString(),
      }));
    }
    return out.sort((a, b) => a._ownerId.localeCompare(b._ownerId));
  }

  // ── saving ─────────────────────────────────────────────────────────────────

  #apply(user, ownerId, changes) {
    const isOwner = ownerId === user.id;
    if (!this.#books.has(ownerId)) {
      if (!isOwner) throw new Error('You don\'t have permission to change this book');
      this.#books.set(ownerId, {});
    }
    const book = this.#books.get(ownerId);

    if (!isOwner) this.#checkMember(user, ownerId, book, changes);

    for (const list of LISTS) {
      if (!Array.isArray(book[list])) book[list] = [];
      for (const raw of changes.put?.[list] || []) {
        const { _pos, ...item } = raw;
        const at = book[list].findIndex((x) => x.id === item.id);
        if (at >= 0) book[list][at] = item;
        else if (_pos && _pos - 1 < book[list].length) book[list].splice(_pos - 1, 0, item);
        else book[list].push(item);
      }
      const gone = new Set(changes.remove?.[list] || []);
      if (gone.size) book[list] = book[list].filter((x) => !gone.has(x.id));
    }
    if ('user' in changes) {
      book.user = changes.user;
      if (changes.fxRatesUpdatedAt != null) book.fxRatesUpdatedAt = changes.fxRatesUpdatedAt;
      else delete book.fxRatesUpdatedAt;
      if (changes._transferDirBackfilled != null) book._transferDirBackfilled = changes._transferDirBackfilled;
      else delete book._transferDirBackfilled;
    }
    if ('fxRates' in changes) book.fxRates = changes.fxRates;
    if ('merchantCategories' in changes) book.merchantCategories = changes.merchantCategories;
    if ('bookExtra' in changes) Object.assign(book, changes.bookExtra);

    const rows = [];
    for (const list of LISTS) {
      for (const it of changes.put?.[list] || []) rows.push([list, it.id]);
      for (const id of changes.remove?.[list] || []) rows.push([list, id]);
    }
    for (const [list, id] of rows) this.emit(list === 'transactions' ? 'transactions' : list, ownerId, { id });
    return new Date().toISOString();
  }

  #checkMember(user, ownerId, book, changes) {
    const deny = (what) => { throw new Error(`You don't have permission to ${what} this entry`); };
    const other = Object.keys(changes).filter((k) => !['put', 'remove'].includes(k));
    const lists = [...Object.keys(changes.put || {}), ...Object.keys(changes.remove || {})];
    if (other.length || lists.some((l) => l !== 'transactions')) deny('change');

    const mine = (t) => (t?.addedBy || '').toLowerCase() === user.email.toLowerCase();
    for (const tx of changes.put?.transactions || []) {
      const old = (book.transactions || []).find((t) => t.id === tx.id);
      const need = this.#rank(this.#access(ownerId, user, tx.accountId));
      if (!old) {
        if (need < RANK.add || !mine(tx)) deny('add');
      } else {
        const had = this.#rank(this.#access(ownerId, user, old.accountId));
        const ok = had >= RANK.edit || (had >= RANK.add && mine(old));
        if (!ok || need < RANK.add) deny('change');
      }
    }
    for (const id of changes.remove?.transactions || []) {
      const old = (book.transactions || []).find((t) => t.id === id);
      if (!old) continue;
      const had = this.#rank(this.#access(ownerId, user, old.accountId));
      if (!(had >= RANK.full || (had >= RANK.add && mine(old)))) deny('delete');
    }
  }
}
