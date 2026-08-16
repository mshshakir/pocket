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
 *   C1  Conflict backups are readable, not just writable. They were written for
 *       a while with nothing able to read them back — preserved and unreachable.
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
import { RegularLogService } from '../src/domain/services/RegularLogService.js';

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

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
