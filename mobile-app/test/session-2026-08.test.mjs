/**
 * session-2026-08.test.mjs — regression tests for the 2026-08-15 mobile port.
 *
 *   J1  SyncJournal survives a "process restart" and carries the baseline the
 *       edits were made against — the marker that makes cold-start recovery
 *       possible at all.
 *   J2  A different user's marker is ignored (signing in as someone else on the
 *       same device must not inherit their verdict).
 *   P1  Settings defaults drive the resolvers, and degrade rather than dangle
 *       when the account is archived or deleted.
 *   P2  Renaming or deleting the default payment method migrates the preference.
 *   V1  A voice reply naming several categories becomes splits summing EXACTLY
 *       to the parent — TransactionComposer's L1 invariant rejects anything else.
 *   V2  Several items under ONE category stay a single un-split transaction.
 *   V3  The pre-items response shape still works.
 *   S1  Store fires the local-change hook even when the local write failed.
 *   R1  AccountRef round-trips a shared account reference, and degrades safely
 *       on a malformed value rather than inventing an owner.
 *   R2  RegularLogService merges local logs with contributions from an owner's
 *       snapshot — without it, a log against a shared account vanishes the
 *       moment it is submitted, because it never lands locally.
 *   R3  ...and lifts out ONLY logs belonging to the user's own regular items;
 *       the owner's own regular purchases are none of their business.
 *   M1  Spaces on mobile: the projection re-points reads, and HOME returns the
 *       real state object so nothing that mutates through it breaks.
 *   M2  The registry is in-memory on mobile — a cold start returns you home
 *       rather than to a space that may have been revoked meanwhile.
 *   M3  Settings writes must reach the REAL user object. Every one of them went
 *       through the projected state, where flush() would persist the real book
 *       and the screen would repaint as if it had saved.
 *   C1  Conflict backups are readable, not just writable. They were written for
 *       a while with nothing able to read them back — preserved and unreachable.
 *   M1  The mobile share snapshot must carry EVERY field the web one does. Both
 *       platforms write the SAME family_shares row, so a field missing here is
 *       silently stripped from what the member sees the moment a phone pushes.
 *   M2  ...and the row must be filed under its space_id, or phase C of the
 *       migration breaks sharing from this device.
 *
 * Run:  node test/session-2026-08.test.mjs
 */
import { Repository } from '../src/core/Repository.js';
import { SyncJournal } from '../src/core/SyncJournal.js';
import { Store } from '../src/core/Store.js';
import { StateMigrator } from '../src/data/StateMigrator.js';
import { AccountService } from '../src/domain/services/AccountService.js';
import { PaymentTypeService } from '../src/domain/services/PaymentTypeService.js';
import { ReceiptScanService } from '../src/domain/services/ReceiptScanService.js';
import { TransactionComposer } from '../src/domain/services/TransactionComposer.js';
import { AccountRef } from '../src/domain/services/AccountRef.js';
import { Space } from '../src/domain/services/Space.js';
import { SpaceRegistry } from '../src/domain/services/SpaceRegistry.js';
import { RegularLogService } from '../src/domain/services/RegularLogService.js';
import { SpaceGuard } from '../src/domain/services/SpaceGuard.js';
import { BudgetView } from '../src/domain/services/BudgetView.js';
import { RegularLogSubmitter } from '../src/domain/services/RegularLogSubmitter.js';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};

/** An AsyncStorage stand-in whose contents survive a simulated restart. */
const makeStorage = (backing = new Map()) => ({
  backing,
  getItem:    async (k) => (backing.has(k) ? backing.get(k) : null),
  setItem:    async (k, v) => { backing.set(k, v); },
  removeItem: async (k) => { backing.delete(k); },
});

const seed = () => ({
  user: {
    homeCurrency: 'USD', defaultCurrency: 'USD', hijriOffset: 0,
    customPaymentTypes: [], hiddenPaymentTypes: [],
    defaultAccountId: '', defaultPaymentType: 'card',
  },
  accounts: [
    { id: 'a1', name: 'Cash',    type: 'cash', currency: 'USD', openingBalance: 0, balance: 0 },
    { id: 'a2', name: 'Savings', type: 'bank', currency: 'USD', openingBalance: 0, balance: 0 },
  ],
  categories: [
    { id: 'c1', name: 'Food',     type: 'expense', parentId: null, color: '#f97316', icon: 'tag' },
    { id: 'c2', name: 'Fuel',     type: 'expense', parentId: null, color: '#0ea5e9', icon: 'tag' },
    { id: 'c3', name: 'Pharmacy', type: 'expense', parentId: null, color: '#22c55e', icon: 'tag' },
  ],
  transactions: [], budgets: [], debts: [], family: [], regularItems: [],
  merchantCategories: {}, accountGroups: [],
});

const storage = makeStorage();
Repository.setBackend(storage);
await Repository.prepare();
SyncJournal.setBackend(storage);
await SyncJournal.prepare();

const store = Store.getInstance();
store.init(seed, (s) => StateMigrator.migrate(s));

console.log('\n2026-08 mobile port regression suite');

// ═══ J — the durable pending marker ════════════════════════════════════════
console.log('\n J — sync journal');
{
  const j = new SyncJournal();
  j.mark('user-1', 7);
  await j.flush();

  ok('J1 the marker reached storage', storage.backing.has('pocket.v1.pending'));

  // Simulate the process being killed and relaunched: fresh cache, same disk.
  SyncJournal.setBackend(makeStorage(storage.backing));
  await SyncJournal.prepare();
  const revived = new SyncJournal();

  ok('J1 it survived a restart', !!revived.read(), JSON.stringify(revived.read()));
  ok('J1 …carrying the baseline the edits were made against',
     revived.read()?.baseVersion === 7, String(revived.read()?.baseVersion));
  ok('J1 …and is pending for that user', revived.isPendingFor('user-1'));
  ok('J2 …but NOT for a different user', !revived.isPendingFor('user-2'));

  // A burst of edits must keep the ORIGINAL timestamp but track the newest
  // baseline, so `since` measures how long work has been at risk.
  const first = revived.read().since;
  revived.mark('user-1', 9);
  ok('J2 a later edit keeps the original timestamp', revived.read().since === first);
  ok('J2 …and advances the baseline', revived.read().baseVersion === 9);

  revived.clear();
  await revived.flush();
  ok('J2 clear() forgets it', !revived.read() && !storage.backing.has('pocket.v1.pending'));
}

// ═══ P — Settings defaults ═════════════════════════════════════════════════
console.log('\n P — default account / payment type');
{
  const accounts = new AccountService();
  const payments = new PaymentTypeService(store);
  const state    = store.getState();

  ok('P1 no preference falls back to the first account', accounts.defaultId() === 'a1',
     accounts.defaultId());

  state.user.defaultAccountId = 'a2';
  ok('P1 the preference is honoured', accounts.defaultId() === 'a2', accounts.defaultId());

  accounts.archive('a2', true);
  ok('P1 an archived default degrades to a live account', accounts.defaultId() === 'a1',
     accounts.defaultId());

  accounts.archive('a2', false);
  accounts.delete('a2');
  ok('P1 deleting the default clears the preference', state.user.defaultAccountId === '',
     state.user.defaultAccountId);

  state.user.defaultPaymentType = 'cash';
  ok('P2 the payment preference is honoured', payments.defaultType() === 'cash',
     payments.defaultType());

  payments.rename('cash', 'notes');
  ok('P2 renaming migrates it', state.user.defaultPaymentType === 'notes',
     state.user.defaultPaymentType);
  ok('P2 …and it still resolves', payments.defaultType() === 'notes', payments.defaultType());

  payments.remove('notes');
  ok('P2 deleting it leaves a valid fallback',
     payments.allTypes().includes(payments.defaultType()), payments.defaultType());
}

// ═══ V — voice entry splits by category ════════════════════════════════════
console.log('\n V — voice multi-category split');
{
  store.getState().user.geminiApiKey = 'test-key';
  const receipts = new ReceiptScanService();

  const heard = async (obj) => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }),
    });
    return receipts.parseVoice({ base64: 'x', mimeType: 'audio/aac' });
  };

  const split = await heard({
    type: 'expense', total: 100, currency: 'USD', date: '2026-08-12',
    payee: 'Carrefour', note: 'groceries and petrol',
    items: [
      { description: 'groceries', amount: 60, categoryId: 'c1' },
      { description: 'petrol',    amount: 40, categoryId: 'c2' },
    ],
  });
  ok('V1 two categories became two split legs',
     Array.isArray(split.splits) && split.splits.length === 2, JSON.stringify(split.splits));
  ok('V1 the legs sum EXACTLY to the parent',
     split.splits.reduce((s, x) => s + x.amount, 0) === Math.round(split.amount * 100),
     `${split.splits.reduce((s, x) => s + x.amount, 0)} vs ${Math.round(split.amount * 100)}`);
  ok('V1 the parent carries no category', split.categoryId === '');

  // The real test: TransactionComposer enforces L1 (exact minor-unit sum). A
  // prefill that cannot pass it is a form the user can never save.
  const composed = new TransactionComposer().create({
    type: 'expense', amount: split.amount, currency: 'USD',
    accountId: 'a1', categoryId: null, date: '2026-08-12',
    paymentType: 'card', payee: 'Carrefour', note: '',
    splits: split.splits.map((sp) => ({ ...sp, accountId: 'a1' })),
  });
  ok('V1 the composer accepts it (L1 satisfied)', composed.ok !== false,
     composed.reason || '');
  // create() returns {ok, ids}; read the row back out of state to inspect it.
  const stored = store.getState().transactions.find((t) => t.id === composed.ids?.[0]);
  ok('V1 the stored row carries both legs and no parent category',
     (stored?.splits || []).length === 2 && (stored?.categoryId ?? null) === null,
     JSON.stringify({ splits: (stored?.splits || []).length, cat: stored?.categoryId }));

  // Each item rounds DOWN to 1000 minor units (3000 total) while the stated
  // total is 3001 — a one-unit disagreement, which is exactly what submitTx
  // and TransactionComposer refuse to save.
  const drift = await heard({
    type: 'expense', total: 30.01, currency: 'USD', date: '2026-08-12',
    payee: 'Shop', note: 'three ways',
    items: [
      { description: 'a', amount: 10.004, categoryId: 'c1' },
      { description: 'b', amount: 10.004, categoryId: 'c2' },
      { description: 'c', amount: 10.004, categoryId: 'c3' },
    ],
  });
  const driftSum = drift.splits.reduce((s, x) => s + x.amount, 0);
  ok('V1b a residue really was present to reconcile', drift.splits.length === 3);
  ok('V1b the legs still sum exactly to the parent',
     driftSum === Math.round(drift.amount * 100),
     `${driftSum} vs ${Math.round(drift.amount * 100)}`);
  // The invariant alone is satisfied by simply discarding the stated total and
  // using the itemised sum. What must ALSO hold is that a plausible stated
  // total is honoured, with the residue absorbed by the largest leg — that is
  // the difference between "30.01 as spoken" and a silently rounded 30.00.
  ok('V1b …and the spoken total is honoured, not quietly rounded away',
     drift.amount === 30.01, String(drift.amount));
  ok('V1b …with the residue carried on one leg',
     drift.splits.some((sp) => sp.amount === 1001),
     JSON.stringify(drift.splits.map((sp) => sp.amount)));

  const misheard = await heard({
    type: 'expense', total: 400, currency: 'USD', date: '2026-08-12',
    payee: 'Shop', note: 'forty not four hundred',
    items: [
      { description: 'a', amount: 25, categoryId: 'c1' },
      { description: 'b', amount: 15, categoryId: 'c2' },
    ],
  });
  ok('V1c an implausible total defers to the itemised sum', misheard.amount === 40,
     String(misheard.amount));

  const single = await heard({
    type: 'expense', total: 50, currency: 'USD', date: '2026-08-12',
    payee: 'Shop', note: 'bread and milk',
    items: [
      { description: 'bread', amount: 20, categoryId: 'c1' },
      { description: 'milk',  amount: 30, categoryId: 'c1' },
    ],
  });
  ok('V2 one category stays un-split', !single.splits, JSON.stringify(single.splits));
  ok('V2 …carrying that category', single.categoryId === 'c1', String(single.categoryId));
  ok('V2 …and the full amount', single.amount === 50, String(single.amount));

  const legacy = await heard({
    type: 'expense', amount: 12, currency: 'USD', date: '2026-08-12',
    payee: 'Kiosk', note: 'coffee', categoryId: 'c1',
  });
  ok('V3 the old flat response shape still works',
     !legacy.splits && legacy.categoryId === 'c1' && legacy.amount === 12,
     JSON.stringify(legacy));
}

// ═══ S — a failed local write must not also suppress the cloud push ════════
console.log('\n S — store durability');
{
  let hookCalls = 0;
  store.setLocalChangeHook(() => { hookCalls++; });

  // Serialisation failure is the one case mobile's async save CAN report.
  const state = store.getState();
  const circular = {};
  circular.self = circular;
  state.boom = circular;   // NB: no leading _, or stripTransient removes it

  const before = hookCalls;
  store.persist();
  delete state.boom;

  ok('S1 the push hook fires even when the local write failed', hookCalls > before,
     `${hookCalls - before} calls`);
  store.setLocalChangeHook(null);
}

// ═══ R — shared accounts in regular purchases (ported from web) ════════════
console.log('\n R — regular logs across two books');
{
  // R1 — the encoding both platforms must agree on.
  const local = AccountRef.parse('acc_1');
  ok('R1 a plain id parses as local', local.accountId === 'acc_1' && !local.isShared);
  const shared = AccountRef.parse('shared:own_9:acc_1');
  ok('R1 a shared ref carries both ids',
     shared.accountId === 'acc_1' && shared.ownerId === 'own_9' && shared.isShared,
     JSON.stringify({ a: shared.accountId, o: shared.ownerId }));
  ok('R1 it round-trips', shared.toValue() === 'shared:own_9:acc_1', shared.toValue());
  ok('R1 an empty value round-trips to empty', AccountRef.parse('').toValue() === '');
  // A malformed value must degrade to LOCAL, never invent an owner — an
  // invented owner id would route a contribution to nobody.
  const bad = AccountRef.parse('shared:nocolon');
  ok('R1 a malformed ref degrades to local', !bad.isShared && bad.accountId === 'nocolon',
     JSON.stringify({ a: bad.accountId, o: bad.ownerId }));
  ok('R1 fromRecord reads the two stored fields',
     AccountRef.fromRecord({ accountId: 'a', sharedOwnerId: 'o' }).toValue() === 'shared:o:a');

  // R2/R3 — the merge. Mobile never populates state._sharedData, so the service
  // must read through the sync dependency instead.
  const st = store.getState();
  st.regularItems = [{ id: 'ri_mine', name: 'Coffee', accountId: 'shared1', sharedOwnerId: 'own_9' }];
  st.transactions = [
    { id: 'tLocal', regularItemId: 'ri_mine', date: '2026-08-10', amount: 500, currency: 'USD' },
    { id: 'tPlain', date: '2026-08-10', amount: 100, currency: 'USD' },
  ];
  const fakeSync = {
    sharedData: [{
      _ownerId: 'own_9', sharedBy: 'Abbas',
      transactions: [
        { id: 'tShared', regularItemId: 'ri_mine',  date: '2026-08-11', amount: 700, currency: 'AED' },
        { id: 'tTheirs', regularItemId: 'ri_theirs', date: '2026-08-11', amount: 900, currency: 'AED' },
      ],
    }],
  };
  const logs = new RegularLogService({ store, sync: fakeSync });
  const all  = logs.all();

  ok('R2 the local log is present', all.some((t) => t.id === 'tLocal'));
  ok('R2 the contributed log is present too — it never lands locally',
     all.some((t) => t.id === 'tShared'), JSON.stringify(all.map((t) => t.id)));
  ok('R2 a non-regular transaction is excluded', !all.some((t) => t.id === 'tPlain'));
  ok('R3 the owner\'s OWN regular purchases stay invisible',
     !all.some((t) => t.id === 'tTheirs'), JSON.stringify(all.map((t) => t.id)));

  const contributed = all.find((t) => t.id === 'tShared');
  ok('R2 the contributed row is tagged for delete routing',
     contributed._shared === true && contributed._ownerId === 'own_9',
     JSON.stringify({ s: contributed._shared, o: contributed._ownerId }));
  ok('R2 tagging does not mutate the snapshot',
     fakeSync.sharedData[0].transactions[0]._shared === undefined);

  ok('R2 onDate finds a contributed log', logs.onDate('2026-08-11').some((t) => t.id === 'tShared'));
  ok('R2 find() resolves it by id, which is how a delete is routed',
     logs.find('tShared')?._ownerId === 'own_9');
}

// ═══ C — conflict backups must be recoverable, not merely kept ═════════════
console.log('\n C — conflict backup recovery');
{
  const { MobileSyncService } = await import('../src/domain/services/MobileSyncService.js');
  const sync = new MobileSyncService();

  // AsyncStorage is a native module with no node implementation, which is
  // exactly why the read path went untested for so long. MobileSyncService.
  // setStorage() is the same seam Repository.setBackend already provides.
  const mem = makeStorage();
  MobileSyncService.setStorage(mem);

  const key = 'pocket.v1.conflict.1755300000000';
  await mem.setItem(key, JSON.stringify({
    savedAt: '2026-08-15T12:00:00.000Z',
    state: { accounts: [{ id: 'rec1', name: 'Recovered' }], transactions: [] },
  }));
  await mem.setItem('pocket.v1.conflicts',
    JSON.stringify([{ key, savedAt: '2026-08-15T12:00:00.000Z' }]));

  const index = await sync.conflictBackups();
  ok('C1 the backup index is readable', index.length === 1 && index[0].key === key,
     JSON.stringify(index));
  const restored = await sync.readConflictBackup(key);
  ok('C1 the backup itself is readable',
     restored?.accounts?.[0]?.id === 'rec1', JSON.stringify(restored));
  ok('C1 a missing key reads as null, not a throw',
     (await sync.readConflictBackup('pocket.v1.conflict.nope')) === null);
}

// ═══ M — the mobile snapshot must not degrade what web publishes ═══════════
console.log('\n M — share snapshot parity with web');
{
  const { MobileSyncService } = await import('../src/domain/services/MobileSyncService.js');
  const src = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/domain/services/MobileSyncService.js', import.meta.url), 'utf8'));

  // Read the snapshot literal directly: constructing a signed-in service with a
  // live Supabase client is not possible here, and the risk being guarded is a
  // MISSING FIELD, which is visible in the source.
  const snap = src.slice(src.indexOf('const snapshot = {'), src.indexOf('updatedAt:', src.indexOf('const snapshot = {')));
  for (const field of ['sharedBy', 'ownerName', 'homeCurrency', 'permission', 'accounts',
                       'transactions', 'categories', 'debts', 'regularItems',
                       'budgets', 'budgetPermission']) {
    ok(`M1 snapshot carries ${field}`, snap.includes(`${field}:`),
       'a field missing here is stripped from the member view when a phone pushes');
  }
  ok('M1 budget spend is computed owner-side, not left to the member',
     /#sharedBudgets\(state, sharedBudgetIds\)/.test(snap));
  ok('M1 a budget-only member is not treated as a full revocation',
     src.includes('!sharedIds.length && !sharedBudgetIds.length'));

  ok('M2 the row is filed under its space_id',
     src.includes('space_id: this.#spaceIdFor(member)'));
  ok('M2 …targeting the three-column index from phase A',
     src.includes("onConflict: 'owner_id,member_email,space_id'"));
  ok('M2 the pull reads space_id back', src.includes("select('owner_id, space_id, snapshot')"));
  ok('M2 …defaulting to \'default\' for pre-migration rows',
     src.includes("_spaceId: r.space_id || 'default'"));
  ok('M2 revoke can target one space', /revokeMemberShare\(email, spaceId = null\)/.test(src));
  void MobileSyncService;
}

// ═══ M — Spaces on mobile ══════════════════════════════════════════════════
console.log('\n M — spaces');
{
  const st = store.getState();
  st.accounts   = [{ id: 'mine1', name: 'My Cash', currency: 'USD', openingBalance: 0, balance: 0 }];
  st.categories = [{ id: 'mycat', name: 'Mine', type: 'expense', parentId: null }];
  st.budgets    = [{ id: 'mybg', categoryId: 'mycat', amount: 100, currency: 'USD', period: 'gregorian' }];
  st.user.homeCurrency = 'USD';

  const share = {
    _ownerId: 'abbas1', _spaceId: 'default', sharedBy: 'Abbas', homeCurrency: 'AED',
    permission: { own1: 'edit' },
    accounts:   [{ id: 'own1', name: 'Abbas Wallet', currency: 'AED', balance: 0 }],
    categories: [{ id: 'owncat', name: 'Theirs', type: 'expense', parentId: null }],
    transactions: [{ id: 'owntx', accountId: 'own1', amount: 500, currency: 'AED' }],
    budgets:    [{ id: 'ownbg', categoryId: 'owncat', amount: 900, currency: 'AED', spent: 400 }],
    debts: [], regularItems: [],
  };
  const registry = new SpaceRegistry({
    store,
    sync: { sharedData: [share] },
    spaceFactory: (opts) => new Space(opts),
    // Exactly what AppContext injects — RN has no sessionStorage.
    sessionStore: (() => {
      const mem = new Map();
      return { getItem: (k) => (mem.has(k) ? mem.get(k) : null),
               setItem: (k, v) => { mem.set(k, v); },
               removeItem: (k) => { mem.delete(k); } };
    })(),
  });

  ok('M1 home is the default', registry.isHome);
  ok('M1 the home projection IS the real state object, not a copy',
     registry.active().project() === store.getState(),
     'a copy would silently break every mutation that goes through it');

  registry.activate('abbas1');
  const proj = registry.active().project();
  ok('M1 a guest space re-points accounts', proj.accounts[0].id === 'own1',
     JSON.stringify(proj.accounts.map((a) => a.id)));
  ok('M1 …and categories, which is the whole point',
     proj.categories[0].id === 'owncat' && !proj.categories.some((c) => c.id === 'mycat'));
  ok('M1 …and budgets, carrying the owner\'s computed spend',
     proj.budgets[0].id === 'ownbg' && proj.budgets[0].spent === 400,
     JSON.stringify(proj.budgets));
  ok('M1 totals convert to the OWNER\'s currency', proj.user.homeCurrency === 'AED',
     proj.user.homeCurrency);
  ok('M1 my own book is untouched underneath',
     store.getState().accounts[0].id === 'mine1' && store.getState().user.homeCurrency === 'USD');

  // M3 — the trap the port had to avoid. project() replaces `user` with a fresh
  // object, so a settings write through the projection lands on a copy while
  // store.flush() persists the real book: the screen repaints, nothing saved.
  proj.user.homeCurrency = 'EUR';
  ok('M3 writing through the projected user does NOT reach the book',
     store.getState().user.homeCurrency === 'USD', store.getState().user.homeCurrency);
  store.getState().user.homeCurrency = 'GBP';
  ok('M3 …while writing through store.getState() does',
     store.getState().user.homeCurrency === 'GBP');
  store.getState().user.homeCurrency = 'USD';

  // M2 — session, not user data.
  const persisted = JSON.parse(JSON.stringify(store.getState()));
  ok('M2 the active space is not written into the book',
     persisted.activeSpace === undefined && persisted.user.activeSpace === undefined);
  const fresh = new SpaceRegistry({
    store, sync: { sharedData: [share] }, spaceFactory: (o) => new Space(o),
    sessionStore: (() => { const m = new Map(); return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; })(),
  });
  ok('M2 a cold start returns to your own space', fresh.isHome);

  // Revocation still reports, so the UI can say so rather than relocate silently.
  const gone = new SpaceRegistry({
    store, sync: { sharedData: [] }, spaceFactory: (o) => new Space(o),
    sessionStore: (() => { const m = new Map(); m.set('pocket.v1.space', 'abbas1'); return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; })(),
  });
  const lost = gone.reconcile();
  ok('M2 a revoked space is reported, not silently dropped', !!lost, JSON.stringify(lost));
  ok('M2 …and it lands home', gone.isHome);
}

// ═══ W — the React binding ═════════════════════════════════════════════════
// Space and SpaceRegistry are covered above by real objects. The wiring that
// makes them reach a screen is JSX, which nothing here can import — and it is
// where the whole port actually lives. Two mutations proved the gap: breaking
// useAppState's projection, and dropping the injected session store, both left
// every assertion above green.
//
// So these read the source. A string match is a weak test and is used only for
// wiring that has exactly one correct spelling; W3 is the one that matters and
// is a scan for a HAZARD rather than for a blessed line, so it keeps biting as
// the screens change.
console.log('\n W — the React binding');
{
  const fs = await import('node:fs');
  const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  const ctx = read('../src/state/AppContext.js');

  ok('W1 useAppState scopes state to the active space',
     /state:\s*space\s*\?\s*space\.project\(\)\s*:/.test(ctx),
     'without this every screen renders the local book no matter which space is selected');
  ok('W1 …and still exposes the unscoped book for callers that mutate',
     /localState:\s*ctx\.services\.store\.getState\(\)/.test(ctx));
  ok('W1 …and says plainly when you are in someone else\'s book',
     /inGuestSpace:\s*!!space\s*&&\s*!space\.isHome/.test(ctx));
  ok('W2 the registry gets an injected session store',
     /new SpaceRegistry\(\{[\s\S]*?sessionStore:/.test(ctx),
     'falling through to the default would hand RN a Map that outlives the cold start');
  ok('W2 the switcher is mounted once, above the navigator',
     /<SpaceBar\s*\/>/.test(read('../App.js')));

  // W3 — the hazard scan.
  //
  // The first version of this looked only for DIRECT writes (`state.user.x =`,
  // `state.accounts.push(…)`) and passed clean while five reachable paths were
  // corrupting data. It even passed over `store.getState().transactions.push(tx)`
  // in RegularsScreen, a literal push, because the pattern anchored on `state.`.
  //
  // The real hazard is not a syntax. It is a screen that takes an id out of the
  // projection and hands it to something that writes to the LOCAL book: at home
  // the two are the same object and everything works, in a guest space the id
  // is the owner's and the row lands orphaned in the member's ledger. Nothing
  // throws, because every service resolves ids with `.find()` and returns early
  // on a miss.
  //
  // So the scan is structural instead: a screen that calls `useAppState()` — the
  // projecting hook — and also reaches a write must show that it consults
  // SpaceGuard (or `inGuestSpace`) somewhere. That is a coarse check and it can
  // be satisfied without being correct, which is why the routing decisions
  // themselves are tested against real objects in the G block below. What it
  // buys is the thing that actually failed here: a NEW screen, or a newly
  // mutating one, cannot be added without confronting the question.
  const screens = fs.readdirSync(new URL('../src/screens/', import.meta.url))
    .filter((f) => f.endsWith('.js'))
    .map((f) => [f, read(`../src/screens/${f}`)]);
  const uiFiles = fs.readdirSync(new URL('../src/ui/', import.meta.url))
    .filter((f) => f.endsWith('.js') && f !== 'theme.js')
    .map((f) => [f, read(`../src/ui/${f}`)]);
  const all = [...screens, ...uiFiles];

  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  /** Anything that changes the member's own book. */
  const WRITES = /(?:store\.getState\(\)|\bs\b|\bst\b|\breal\(\))\s*\.\s*(?:user|accounts|categories|transactions|budgets|debts|regularItems|family)\b[\s\S]{0,40}?(?:=(?!=)|\.\s*(?:push|splice|unshift|pop|shift)\s*\()|services\.(?:accounts|categories|transactions|budgets|debts|recurring|composer|familyShares)\s*\.\s*(?:create|update|delete|remove|addPayment|markPaid|setAccess|unshareAccount)\s*\(|store\.(?:replaceState|reset)\s*\(/;
  /** Evidence the file asked whose book it is on. */
  const ASKS = /\bguard\b|\binGuestSpace\b|useOwnState|routeNewTransaction|routeEditTransaction|routeDeleteTransaction|routeLogRegular|requireHome/;
  /** Only files on the projecting hook can be caught out by a projection. */
  const PROJECTS = /useAppState\s*\(/;

  const offenders = all
    .filter(([, src]) => {
      const body = strip(src);
      return PROJECTS.test(body) && WRITES.test(body) && !ASKS.test(body);
    })
    .map(([f]) => f);
  ok('W3 every projecting screen that writes also asks whose book it is on',
     offenders.length === 0, offenders.join(', '));

  // W4 — the direct-write scan is still worth keeping, narrowed to what it can
  // actually see. `project()` hands back a fresh `user` object, so a write
  // straight through `state.user` is discarded whatever else the file does.
  const DIRECT = /\bstate\.(user\.[A-Za-z_$][\w$]*\s*=(?!=)|(?:accounts|categories|transactions|budgets|debts|regularItems|family)\s*\.\s*(?:push|splice|unshift|pop|shift)\s*\()/;
  const direct = all
    .filter(([f, src]) => f !== 'SettingsScreen.js' && f !== 'FamilyScreen.js' && DIRECT.test(strip(src)))
    .map(([f]) => f);
  ok('W4 no screen writes straight through the projected state object',
     direct.length === 0, direct.join(', '));

  // W5 — the two screens that must never see a projection at all.
  for (const f of ['SettingsScreen.js', 'FamilyScreen.js']) {
    const src = read(`../src/screens/${f}`);
    ok(`W5 ${f} takes its state from useOwnState`,
       /useOwnState\s*\(\)/.test(src) && !/useAppState\s*\(\)/.test(src),
       'a projection here exports or overwrites the wrong person\'s book');
  }
}

// ═══ G — SpaceGuard: may I, and against whose book? ════════════════════════
// The source scan above can only prove a screen ASKED. These prove the answers.
// Each case here is one of the five paths an audit found reachable and silently
// wrong; the routing they now go through is a plain object, so it can be
// exercised without React.
console.log('\n G — SpaceGuard routing');
{
  const share = {
    _ownerId: 'abbas1', _spaceId: 'default', sharedBy: 'Abbas', homeCurrency: 'AED',
    permission: { editable: 'edit', viewonly: 'view', mine: 'full' },
    accounts: [{ id: 'editable', name: 'Joint', currency: 'AED' },
               { id: 'viewonly', name: 'Their savings', currency: 'AED' },
               { id: 'mine',     name: 'Housekeeping', currency: 'AED' }],
    categories: [{ id: 'ocat', name: 'Groceries', type: 'expense', parentId: null }],
    transactions: [
      { id: 'theirs',  accountId: 'editable', amount: 100, currency: 'AED', type: 'expense' },
      { id: 'ours',    accountId: 'editable', amount: 100, currency: 'AED', type: 'expense',
        addedBy: 'Member@Example.com' },
      { id: 'locked',  accountId: 'viewonly', amount: 100, currency: 'AED', type: 'expense' },
      { id: 'full',    accountId: 'mine',     amount: 100, currency: 'AED', type: 'expense' },
      { id: 'xfer',    accountId: 'editable', amount: 100, currency: 'AED', type: 'transfer' },
    ],
    budgets: [], debts: [], regularItems: [],
  };
  const mkRegistry = (shares) => new SpaceRegistry({
    store, sync: { sharedData: shares }, spaceFactory: (o) => new Space(o),
    sessionStore: (() => { const m = new Map(); return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; })(),
  });
  const sync = { currentUser: { email: 'member@example.com' } };

  // ── At home nothing is refused ──────────────────────────────────────────
  const homeGuard = new SpaceGuard({ spaces: mkRegistry([share]), store, sync });
  ok('G1 at home, personal screens are open', homeGuard.requireHome('accounts').ok);
  ok('G1 at home, a new transaction is a local one',
     homeGuard.routeNewTransaction().ok && homeGuard.routeNewTransaction().sharedMode === null);
  ok('G1 at home, any row edits locally',
     homeGuard.routeEditTransaction('anything').sharedMode === null);

  // ── In a guest space ────────────────────────────────────────────────────
  const reg = mkRegistry([share]);
  reg.activate('abbas1');
  const g = new SpaceGuard({ spaces: reg, store, sync });

  ok('G2 personal screens are refused', !g.requireHome('accounts').ok);
  ok('G2 …and the refusal names the space',
     g.requireHome('accounts').message.includes('Abbas'),
     g.requireHome('accounts').message);

  const nu = g.routeNewTransaction();
  ok('G3 a new transaction becomes a contribution', nu.ok && !!nu.sharedMode);
  ok('G3 …addressed to the owner', nu.sharedMode.ownerId === 'abbas1', nu.sharedMode.ownerId);
  ok('G3 …on an account that actually accepts one',
     nu.sharedMode.accountId !== 'viewonly', nu.sharedMode.accountId);

  // The duplicate-row bug: an edit MUST carry the id it is editing.
  const ed = g.routeEditTransaction('ours');
  ok('G4 my own contribution is editable', ed.ok, ed.message);
  ok('G4 …and the route carries editTxId, so submitting updates rather than duplicates',
     ed.sharedMode?.editTxId === 'ours', JSON.stringify(ed.sharedMode));
  ok('G4 …against the right account', ed.sharedMode?.accountId === 'editable');

  ok('G5 someone else\'s entry on an edit-level account is refused',
     !g.routeEditTransaction('theirs').ok);
  ok('G5 …naming who can', g.routeEditTransaction('theirs').message.includes('Only'),
     g.routeEditTransaction('theirs').message);
  ok('G5 …but full access means the whole account is yours to manage',
     g.routeEditTransaction('full').ok);
  ok('G5 a view-only account refuses even your own row',
     !g.routeEditTransaction('locked').ok);
  ok('G5 transfers stay with the owner — one leg would land with no counter-leg',
     !g.routeEditTransaction('xfer').ok);

  // Reports and Dashboard still compute locally, so they can offer a local row
  // while the space bar says otherwise. Acting on it must not silently write.
  const local = g.routeEditTransaction('a-row-in-my-own-book');
  ok('G6 a local row reached from inside a guest space is refused', !local.ok);
  ok('G6 …and says which book it is in, not "not found"',
     /own book/.test(local.message), local.message);

  const del = g.routeDeleteTransaction('ours');
  ok('G7 deleting my own contribution routes to the owner',
     del.ok && del.contribution?.ownerId === 'abbas1' && del.contribution?.txId === 'ours',
     JSON.stringify(del));
  ok('G7 …and someone else\'s is refused rather than silently no-opped',
     !g.routeDeleteTransaction('theirs').ok);

  // The path that actually corrupted data.
  const ownersItem = { id: 'ri1', name: 'Coffee', accountId: 'editable', categoryId: 'ocat' };
  const lr = g.routeLogRegular(ownersItem);
  ok('G8 logging the owner\'s regular item becomes a contribution',
     lr.ok && lr.contribution?.ownerId === 'abbas1', JSON.stringify(lr));
  ok('G8 …never a local push, which is what orphaned the row',
     lr.contribution !== null);
  ok('G8 a view-only account refuses the log',
     !g.routeLogRegular({ id: 'ri2', accountId: 'viewonly' }).ok);
  ok('G8 an item from my OWN book is refused while I am standing in a space',
     !g.routeLogRegular({ id: 'ri3', accountId: 'mine-local-acct' }).ok);
  ok('G9 at home the same item logs locally',
     homeGuard.routeLogRegular(ownersItem).contribution === null);

  // Signed out: `addedBy` cannot match, so only `full` grants anything.
  const anon = new SpaceGuard({ spaces: reg, store, sync: { currentUser: null } });
  ok('G10 signed out, an unowned row is not treated as mine',
     !anon.routeEditTransaction('ours').ok);
  ok('G10 …while full access still stands on its own',
     anon.routeEditTransaction('full').ok);
}

// ═══ L — RegularLogSubmitter: the write that actually corrupted data ═══════
//
// G8 above proves SpaceGuard ROUTES this correctly. That was not enough: the
// routing was correct and the caller ignored it, because the caller was a
// module-level function inside a JSX file that nothing could import. A mutation
// putting the old `ref.isShared ? … : null` back left all 126 assertions green.
// These exercise the submitter itself, so the call site is covered too.
console.log('\n L — regular-item logs land in the right book');
{
  const submitted = [];
  const share = {
    _ownerId: 'abbas1', _spaceId: 'default', sharedBy: 'Abbas', homeCurrency: 'AED',
    permission: { joint: 'edit', theirs: 'view' },
    accounts: [{ id: 'joint', name: 'Joint', currency: 'AED' },
               { id: 'theirs', name: 'Savings', currency: 'AED' }],
    categories: [{ id: 'ocat', name: 'Groceries', type: 'expense', parentId: null }],
    transactions: [], budgets: [], debts: [],
    regularItems: [{ id: 'ri-owner', name: 'Bread', accountId: 'joint', categoryId: 'ocat', defaultAmount: 500, currency: 'AED' }],
  };
  const sync = {
    sharedData: [share],
    currentUser: { email: 'member@example.com' },
    shareByOwner: (id) => (id === 'abbas1' ? share : null),
    submitContribution: async (ownerId, tx) => { submitted.push({ ownerId, tx }); },
    scheduleSharesRefresh: () => {},
  };
  const fx = { convert: (a) => a };
  const mkReg = () => new SpaceRegistry({
    store, sync, spaceFactory: (o) => new Space(o),
    sessionStore: (() => { const m = new Map(); return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; })(),
  });

  // The owner's item, logged from inside the owner's space. Two taps from the
  // Items tab, and the one that used to push an orphan into the member's book.
  const reg = mkReg();
  reg.activate('abbas1');
  const guard = new SpaceGuard({ spaces: reg, store, sync });
  const inSpace = new RegularLogSubmitter({ store, sync, fx, guard });
  const item = share.regularItems[0];

  const before = store.getState().transactions.length;
  const res = await inSpace.submit(item, '2026-08-15');

  ok('L1 logging the owner\'s item is reported as shared', res.ok && res.shared, JSON.stringify(res));
  ok('L1 …and it reached the OWNER', submitted.length === 1 && submitted[0].ownerId === 'abbas1',
     JSON.stringify(submitted.map((x) => x.ownerId)));
  ok('L1 …and NOTHING was pushed into the member\'s own book',
     store.getState().transactions.length === before,
     `${before} → ${store.getState().transactions.length}`);
  ok('L1 the row carries the owner\'s account and category',
     submitted[0].tx.accountId === 'joint' && submitted[0].tx.categoryId === 'ocat',
     JSON.stringify(submitted[0].tx));
  ok('L1 …and addedBy, without which the owner rejects it and the member cannot withdraw it',
     submitted[0].tx.addedBy === 'member@example.com', String(submitted[0].tx.addedBy));
  ok('L1 …denominated for the OWNER\'s reporting, not the member\'s',
     submitted[0].tx.refAmount === 500, String(submitted[0].tx.refAmount));

  ok('L2 a view-only account refuses the log',
     !(await inSpace.submit({ id: 'x', accountId: 'theirs', defaultAmount: 1 })).ok);
  ok('L2 …and says why', /view-only/.test(
     (await inSpace.submit({ id: 'x', accountId: 'theirs', defaultAmount: 1 })).reason || ''));

  // At home the same submitter writes locally, as it always did.
  const homeGuard = new SpaceGuard({ spaces: mkReg(), store, sync });
  const atHome = new RegularLogSubmitter({ store, sync, fx, guard: homeGuard });
  const localItem = { id: 'ri-mine', name: 'Coffee', accountId: 'a1', categoryId: 'c1', defaultAmount: 300, currency: 'USD' };
  const n0 = store.getState().transactions.length;
  const r2 = await atHome.submit(localItem, '2026-08-15');
  ok('L3 at home the log is local', r2.ok && !r2.shared);
  ok('L3 …and lands in the member\'s own book',
     store.getState().transactions.length === n0 + 1);
  ok('L3 …with no addedBy, which marks a row as a contribution',
     store.getState().transactions.at(-1).addedBy === undefined);
  store.getState().transactions.pop();

  // An item of MINE on an account shared with me: the ORIGINAL shared case,
  // which must keep working now that the space is consulted first.
  const n1 = submitted.length;
  const mineOnTheirs = { id: 'ri-x', name: 'Fuel', accountId: 'joint',
    sharedOwnerId: 'abbas1', categoryId: 'ocat', defaultAmount: 200, currency: 'AED' };
  const r3 = await atHome.submit(mineOnTheirs, '2026-08-15');
  ok('L4 my own item on a shared account still contributes', r3.ok && r3.shared);
  ok('L4 …to that account\'s owner', submitted.length === n1 + 1 && submitted.at(-1).ownerId === 'abbas1');
}

// ═══ B — BudgetView: the owner's spend, not a recomputed zero ══════════════
console.log('\n B — BudgetView');
{
  const fx = { convert: (amt) => amt };   // same-currency fixture
  // Derived from today, not pinned to 2026-08: #periodStart uses the real clock,
  // so a hard-coded month would pass this month and fail the next.
  const thisMonth = new Date().toISOString().slice(0, 7);
  const guestState = {
    user: { homeCurrency: 'AED' },
    categories: [
      { id: 'food', name: 'Food', parentId: null },
      { id: 'cofe', name: 'Coffee', parentId: 'food' },
      { id: 'fuel', name: 'Fuel', parentId: null },
    ],
    transactions: [
      { id: 't1', type: 'expense', date: `${thisMonth}-02`, categoryId: 'cofe', amount: 30, currency: 'AED' },
      { id: 't2', type: 'expense', date: '2019-01-01',       categoryId: 'food', amount: 999, currency: 'AED' },
      { id: 't3', type: 'income',  date: `${thisMonth}-03`,  categoryId: 'food', amount: 500, currency: 'AED' },
    ],
  };
  const b = { id: 'b1', categoryId: 'food', amount: 1000, currency: 'AED', period: 'gregorian', spent: 640, rollover: true };
  const view = BudgetView.for({ inGuestSpace: true, state: guestState, services: { fx } });

  ok('B1 spend is the figure the OWNER computed over their whole ledger',
     view.spend(b) === 640, String(view.spend(b)));
  ok('B1 …not a local recomputation, which came out 0 for every shared budget',
     view.spend(b) !== 0);
  ok('B2 a budget on a parent covers its children', view.categoryIds(b).includes('cofe'));
  ok('B2 …and nothing else', !view.categoryIds(b).includes('fuel'));
  ok('B3 the visible breakdown uses only what was shared with me',
     view.splitByCategory(b).some((r) => r.categoryId === 'cofe' && r.amount === 30),
     JSON.stringify(view.splitByCategory(b)));
  ok('B3 …excluding income and earlier periods',
     view.transactions(b).length === 1 && view.transactions(b)[0].id === 't1',
     JSON.stringify(view.transactions(b).map((t) => t.id)));
  ok('B4 category names come from the owner\'s tree',
     view.categoryName('cofe') === 'Food › Coffee', view.categoryName('cofe'));
  ok('B5 the view admits it cannot honour rollover here', view.limitIsExact === false);
  ok('B5 …so the limit is face value, not a silently flat "rollover" figure',
     view.limit(b) === 1000);

  const own = BudgetView.for({
    inGuestSpace: false, state: store.getState(),
    services: { fx, budgets: new (class { currentSpend() { return 7; } effectiveLimit() { return { limit: 9 }; }
      targetCategoryIds() { return ['x']; } spendByCategory() { return []; } periodTransactions() { return []; } })(),
      categories: { fullName: () => 'n', find: () => null, hasChildren: () => false } },
  });
  ok('B6 at home it is the service, untouched', own.spend({}) === 7 && own.limit({}) === 9);
  ok('B6 …and it does not claim the guest caveat', own.isGuest === false && own.limitIsExact === true);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
