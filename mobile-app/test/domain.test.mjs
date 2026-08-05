/**
 * domain.test.mjs — the mobile app's business core, tested under plain node.
 *
 * Runs the SAME invariants the web app's smoke suites enforce, against the
 * ported domain + TransactionComposer:
 *
 *   C3/C4  transfer type conversions keep the pair intact
 *   H4     transfers are denominated in the source account's currency
 *   L1     splits must sum exactly (minor units)
 *   M4/M5  recurring: unique ids, deleted occurrences stay deleted
 *   M9     transient `_` keys never reach storage
 *
 * Run:  npm run test:domain   (or: node test/domain.test.mjs)
 */
import { Repository } from '../src/core/Repository.js';
import { Store } from '../src/core/Store.js';
import { StateMigrator } from '../src/data/StateMigrator.js';
import { AccountService } from '../src/domain/services/AccountService.js';
import { TransactionComposer } from '../src/domain/services/TransactionComposer.js';
import { RecurringService } from '../src/domain/services/RecurringService.js';
import { TransactionService } from '../src/domain/services/TransactionService.js';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};

// ── Boot the domain exactly like AppContext does ──────────────────────────
const mem = new Map();
Repository.setBackend({
  getItem: async (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: async (k, v) => { mem.set(k, v); },
  removeItem: async (k) => { mem.delete(k); },
});
await Repository.prepare();

const seed = () => ({
  user: { homeCurrency: 'USD', defaultCurrency: 'USD', hijriOffset: 0,
          customPaymentTypes: [], hiddenPaymentTypes: [] },
  accounts: [
    { id: 'usd', name: 'US Checking', type: 'bank', currency: 'USD', openingBalance: 0, balance: 0 },
    { id: 'aed', name: 'Dubai Card',  type: 'card', currency: 'AED', openingBalance: 0, balance: 0 },
  ],
  categories: [{ id: 'c1', name: 'Food', type: 'expense', parentId: null, color: '#f97316', icon: 'tag' }],
  transactions: [], budgets: [], debts: [], family: [], regularItems: [],
  merchantCategories: {}, accountGroups: [],
});

const store = Store.getInstance();
const accounts = new AccountService();
store.setDeriveHook(() => accounts.recompute());
store.init(seed, (s) => StateMigrator.migrate(s));
accounts.recompute();

const composer = new TransactionComposer();
const state = () => store.getState();
const acc = (id) => state().accounts.find((a) => a.id === id);

console.log('\nmobile domain suite');

// ── H4: transfer denominated in the source account currency ────────────────
{
  const res = composer.create({
    type: 'transfer', amount: 100, currency: 'AED', // wrong currency on purpose
    accountId: 'usd', transferToAccountId: 'aed', date: '2026-06-01',
  });
  ok('H4 transfer created', res.ok, res.reason);
  const out = state().transactions.find((t) => t.transferDir === 'out');
  const inn = state().transactions.find((t) => t.transferDir === 'in');
  ok('H4 source leg is in the SOURCE currency despite the draft saying AED',
     out?.currency === 'USD', out?.currency);
  ok('H4 destination leg is in the destination currency', inn?.currency === 'AED', inn?.currency);
  ok('H4 legs are mutually paired',
     out?.transferPairId === inn?.id && inn?.transferPairId === out?.id);
  ok('H4 source debited exactly what was typed', out?.amount === 10000, String(out?.amount));
  ok('H4 both legs carry a Hijri snapshot with its offset',
     Number.isFinite(out?.hijriDate?.offset) && Number.isFinite(inn?.hijriDate?.offset));
}

// ── C3: transfer → expense deletes the counter-leg ─────────────────────────
{
  const out = state().transactions.find((t) => t.transferDir === 'out');
  const res = composer.update(out.id, {
    type: 'expense', amount: 100, currency: 'USD',
    accountId: 'usd', categoryId: 'c1', date: '2026-06-01', paymentType: 'card',
  });
  ok('C3 conversion accepted', res.ok, res.reason);
  ok('C3 exactly one row remains', state().transactions.length === 1,
     `${state().transactions.length} rows`);
  ok('C3 no orphan pair reference', !state().transactions.some((t) => t.transferPairId));
  ok('C3 destination no longer credited (money not invented)',
     acc('aed').balance === 0, String(acc('aed').balance));
  ok('C3 source debited once', acc('usd').balance === -10000, String(acc('usd').balance));
}

// ── C4: expense → transfer builds both legs ─────────────────────────────────
{
  const only = state().transactions[0];
  const res = composer.update(only.id, {
    type: 'transfer', amount: 100, accountId: 'usd',
    transferToAccountId: 'aed', date: '2026-06-01',
  });
  ok('C4 conversion accepted', res.ok, res.reason);
  ok('C4 two legs exist', state().transactions.length === 2, `${state().transactions.length}`);
  const dirs = new Set(state().transactions.map((t) => t.transferDir));
  ok('C4 both directions present', dirs.has('in') && dirs.has('out'));
  ok('C4 source account moved', acc('usd').balance === -10000, String(acc('usd').balance));
  ok('C4 destination credited', acc('aed').balance > 0, String(acc('aed').balance));
  // Clean up for the next block.
  composer.remove(state().transactions.find((t) => t.transferDir === 'out').id);
  ok('cleanup removed the pair together', state().transactions.length === 0);
}

// ── L1: splits must sum exactly ─────────────────────────────────────────────
{
  const bad = composer.create({
    type: 'expense', amount: 10, currency: 'USD', accountId: 'usd', date: '2026-06-02',
    splits: [
      { categoryId: 'c1', accountId: 'usd', amount: 400 },
      { categoryId: 'c1', accountId: 'usd', amount: 599 }, // 1 minor unit short
    ],
  });
  ok('L1 one-minor-unit-short splits rejected', !bad.ok, 'accepted!');

  const good = composer.create({
    type: 'expense', amount: 10, currency: 'USD', accountId: 'usd', date: '2026-06-02',
    splits: [
      { categoryId: 'c1', accountId: 'usd', amount: 400 },
      { categoryId: 'c1', accountId: 'usd', amount: 600 },
    ],
  });
  ok('L1 exact splits accepted', good.ok, good.reason);
  const t = state().transactions[0];
  ok('L1 stored splits sum to the parent',
     t.splits.reduce((s, x) => s + x.amount, 0) === t.amount);
  composer.remove(t.id);
}

// ── M4/M5: recurring — unique ids, deletions stick ──────────────────────────
{
  const d = new Date(); d.setMonth(d.getMonth() - 3);
  const res = composer.create({
    type: 'expense', amount: 10, currency: 'USD', accountId: 'usd',
    categoryId: 'c1', date: d.toISOString().slice(0, 10),
    recurring: { rule: 'monthly', interval: 1, until: null },
  });
  ok('M4 recurring template created', res.ok, res.reason);
  const tplId = res.ids[0];
  const instances = () => state().transactions.filter((t) => t.recurringSourceId === tplId);
  ok('M4 instances generated', instances().length >= 2, String(instances().length));
  const ids = instances().map((t) => t.id);
  ok('M4 ids unique', new Set(ids).size === ids.length);

  const newest = instances().sort((a, b) => a.date.localeCompare(b.date)).pop();
  new TransactionService().delete(newest.id);
  new RecurringService().process(); // the next app load
  ok('M5 deleted occurrence NOT regenerated',
     !state().transactions.some((t) => t.id === newest.id), 'came back');
  ok('M5 skip recorded on the template',
     (state().transactions.find((t) => t.id === tplId)?.recurring?.skipped || [])
       .includes(newest.date));
}

// ── M9: transient keys never persist ────────────────────────────────────────
{
  state()._sharedData = [{ big: 'snapshot' }];
  store.persist();
  await new Repository().flushWrites();
  const raw = JSON.parse(mem.get('pocket.v1'));
  ok('M9 _sharedData stripped from storage', !('_sharedData' in raw),
     Object.keys(raw).filter((k) => k.startsWith('_')).join(','));
  delete state()._sharedData;
}

// ── Reports + debts wire up to the shared services ──────────────────────────
{
  const { ReportService } = await import('../src/domain/services/ReportService.js');
  const { DebtService }   = await import('../src/domain/services/DebtService.js');
  const reports = new ReportService();
  const debts   = new DebtService();

  const today = new Date().toISOString().slice(0, 10);
  composer.create({ type: 'expense', amount: 30, currency: 'USD', accountId: 'usd', categoryId: 'c1', date: today });
  composer.create({ type: 'expense', amount: 20, currency: 'USD', accountId: 'usd', categoryId: 'c1', date: today });

  const byCat = reports.spendingByCategory(30);
  const food = byCat.find((r) => r.categoryId === 'c1');
  ok('Reports: spending rolls up by category', !!food && food.amount === 5000, JSON.stringify(byCat));

  const dbt = debts.create({ type: 'borrowed', counterparty: 'Ali', principal: 100, currency: 'USD', accountId: 'usd' });
  ok('Debts: created with an initial transaction', dbt.ok && debts.remaining(dbt.debt) === 10000);
  debts.addPayment(dbt.debt, 40, 'usd');
  ok('Debts: repayment reduces the balance', debts.remaining(dbt.debt) === 6000, String(debts.remaining(dbt.debt)));
  const linked = debts.delete(dbt.debt, false); // keep transactions
  ok('Debts: keep-delete leaves both transactions', linked === 2 &&
     state().transactions.filter((t) => t.debtId).length === 0);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
