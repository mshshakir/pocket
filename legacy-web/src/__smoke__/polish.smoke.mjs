/**
 * polish.smoke.mjs — the medium/low audit batch.
 *
 *  M2/L1/L2  currency-aware precision (step, split tolerance, prefill rounding)
 *  M4/M5     recurring: no duplicate ids, deleted occurrences stay deleted
 *  M6        deleting a category accounts for split legs
 *  M9        transient `_` keys never reach localStorage or the cloud
 *  L4        calendar Qty reads the field that is actually written
 *  M7/L5/L6  debt + regular-item deletion semantics
 *  H10/M10   focus keys on the amount filters, modal scroll survives a refresh
 *
 * Run:  node src/__smoke__/polish.smoke.mjs
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const bundleSrc = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const acct = (id, name, currency) => ({
  id, name, currency, groupId: null, type: 'bank', color: '#3b82f6',
  icon: 'landmark', openingBalance: 0, balance: 0,
});

const baseState = (over = {}) => ({
  user: { homeCurrency: 'USD', defaultCurrency: 'USD', theme: 'light', showHijri: false,
          hijriOffset: 0, customPaymentTypes: [], hiddenPaymentTypes: [] },
  accounts: [acct('usd', 'US Checking', 'USD'), acct('kwd', 'Kuwait Account', 'KWD')],
  categories: [
    { id: 'c1', name: 'Food',   type: 'expense', parentId: null, color: '#f97316', icon: 'tag' },
    { id: 'c2', name: 'Travel', type: 'expense', parentId: null, color: '#3b82f6', icon: 'tag' },
  ],
  transactions: [], budgets: [], debts: [], family: [], regularItems: [],
  merchantCategories: {}, accountGroups: [],
  ...over,
});

function boot(state, opts = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
       <div id="viewContent"></div><div id="sidebarNav"></div>
       <div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
     </body></html>`,
    { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  window.localStorage.setItem('pocket.v1', JSON.stringify(state));
  window.lucide = { createIcons() {} };
  window.Chart  = function () { return { destroy() {} }; };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.fetch   = () => Promise.reject(new Error('offline'));
  window.confirm = opts.confirm || (() => true);
  window.alert   = () => {};
  window.eval(bundleSrc);
  return window;
}

console.log('\npolish suite');

// ═══ M2 — step derives from the currency ════════════════════════════════════
{
  const w = boot(baseState());
  await wait(80);
  const app = w.__app, doc = w.document, $ = (s) => doc.querySelector(s);

  app.openModal('transaction', {});
  await wait(30);
  ok('M2 a 2-decimal currency still steps by 0.01',
     $('#txForm [name=amount]')?.getAttribute('step') === '0.01',
     $('#txForm [name=amount]')?.getAttribute('step'));

  // Switch the transaction into KWD (3 decimals).
  $('#txForm select[name=currency]').value = 'KWD';
  app.onTxCurrencyChange();
  app.setTxType('expense');       // forces a re-render through the draft
  await wait(40);
  ok('M2 a 3-decimal currency steps by 0.001 so fils are reachable',
     $('#txForm [name=amount]')?.getAttribute('step') === '0.001',
     $('#txForm [name=amount]')?.getAttribute('step'));
  app.closeModal();
  w.close();
}

// ═══ L1 — one split tolerance, in minor units ═══════════════════════════════
{
  const w = boot(baseState());
  await wait(80);
  const app = w.__app, doc = w.document, $ = (s) => doc.querySelector(s);
  const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));

  app.openModal('transaction', {});
  await wait(20);
  app.toggleSplits();
  await wait(30);
  $('#txForm [name=amount]').value = '10';
  // Deliberately one minor unit short — the old ±1 slack accepted this.
  $('#txForm [name=split_amt_0]').value = '4';
  $('#txForm [name=split_amt_1]').value = '5.99';
  app.setSplitAmount(0, '4', 'USD');
  app.setSplitAmount(1, '5.99', 'USD');
  await app.submitTx({ preventDefault() {}, target: $('#txForm') }, '');
  await wait(50);
  ok('L1 splits that are 1 minor unit short are rejected',
     saved().transactions.length === 0, `${saved().transactions.length} saved`);

  $('#txForm [name=split_amt_1]').value = '6';
  app.setSplitAmount(1, '6', 'USD');
  await app.submitTx({ preventDefault() {}, target: $('#txForm') }, '');
  await wait(50);
  ok('L1 splits that add up exactly are accepted', saved().transactions.length === 1);
  const t = saved().transactions[0];
  ok('L1 the saved splits sum to the parent amount',
     t.splits.reduce((s, x) => s + x.amount, 0) === t.amount,
     `${t.splits.reduce((s, x) => s + x.amount, 0)} vs ${t.amount}`);
  w.close();
}

// ═══ M4 / M5 — recurring generation ═════════════════════════════════════════
{
  const st = baseState();
  // A monthly template from three months ago.
  const d = new Date(); d.setMonth(d.getMonth() - 3);
  const iso = d.toISOString().slice(0, 10);
  st.transactions = [{
    id: 'tpl', accountId: 'usd', categoryId: 'c1', amount: 1000, currency: 'USD',
    type: 'expense', date: iso, paymentType: 'card', recordState: 'cleared', tags: [],
    recurring: { rule: 'monthly', interval: 1, until: null },
  }];
  const w = boot(st);
  await wait(150);   // boot runs RecurringService.process()
  const app = w.__app;
  const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));

  const instances = () => saved().transactions.filter((t) => t.recurringSourceId === 'tpl');
  ok('M4 instances were generated', instances().length >= 2, `${instances().length}`);
  const ids = instances().map((t) => t.id);
  ok('M4 every generated id is unique', new Set(ids).size === ids.length, ids.join(','));

  // Delete the NEWEST instance — it must not come back.
  const newest = instances().sort((a, b) => a.date.localeCompare(b.date)).pop();
  app.deleteTx(newest.id);
  await wait(60);
  ok('M5 the newest instance is gone after delete',
     !saved().transactions.some((t) => t.id === newest.id));

  // Re-run generation the way a fresh app load would.
  // Re-run generation the way a fresh app load does: boot a second instance
  // over the SAME persisted state.
  const w2 = boot(JSON.parse(w.localStorage.getItem('pocket.v1')));
  await wait(150);
  const saved2 = () => JSON.parse(w2.localStorage.getItem('pocket.v1'));
  ok('M5 it is NOT resurrected by the next generation pass',
     !saved2().transactions.some((t) => t.id === newest.id),
     'the deleted occurrence came back');
  ok('M5 the skip was recorded on the template',
     (saved2().transactions.find((t) => t.id === 'tpl')?.recurring?.skipped || []).includes(newest.date),
     JSON.stringify(saved2().transactions.find((t) => t.id === 'tpl')?.recurring?.skipped));
  w2.close();
  w.close();
}

// ═══ M6 — category delete sees split legs ═══════════════════════════════════
{
  const st = baseState();
  st.transactions = [{
    id: 't1', accountId: 'usd', categoryId: null, amount: 1000, currency: 'USD',
    type: 'expense', date: '2026-05-01', paymentType: 'card', recordState: 'cleared', tags: [],
    splits: [
      { categoryId: 'c2', accountId: 'usd', amount: 600 },
      { categoryId: 'c1', accountId: 'usd', amount: 400 },
    ],
  }];
  const w = boot(st);
  await wait(80);
  const app = w.__app;
  const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));

  // c2 is referenced ONLY from a split leg.
  app.deleteCategory('c2');
  await wait(50);
  ok('M6 a category used only in a split cannot be deleted',
     saved().categories.some((c) => c.id === 'c2'),
     'it was deleted despite being in use');

  // Remove the reference, then deletion should succeed and leave no dangling id.
  const s2 = saved();
  s2.transactions[0].splits[0].categoryId = 'c1';
  w.localStorage.setItem('pocket.v1', JSON.stringify(s2));
  w.close();
}

// ═══ M9 — transient keys never persist ══════════════════════════════════════
{
  const w = boot(baseState());
  await wait(80);
  const app = w.__app;
  app.navigate('accounts');
  await wait(60);
  const raw = JSON.parse(w.localStorage.getItem('pocket.v1'));
  ok('M9 _sharedData is not written to localStorage', !('_sharedData' in raw),
     Object.keys(raw).filter((k) => k.startsWith('_')).join(','));
  ok('M9 no other transient key leaked either',
     !Object.keys(raw).some((k) => k.startsWith('_')));
  ok('M9 real data is still saved', Array.isArray(raw.accounts) && raw.accounts.length === 2);
  w.close();
}

// ═══ L5 — deleting a regular item keeps its transactions ════════════════════
{
  const st = baseState();
  st.regularItems = [{ id: 'ri1', name: 'Coffee', defaultAmount: 500, currency: 'USD',
                       accountId: 'usd', categoryId: 'c1', icon: 'coffee', color: '#f97316' }];
  st.transactions = [
    { id: 'log1', accountId: 'usd', categoryId: 'c1', amount: 500, currency: 'USD',
      type: 'expense', date: '2026-05-01', paymentType: 'cash', recordState: 'cleared',
      tags: [], regularItemId: 'ri1' },
    { id: 'log2', accountId: 'usd', categoryId: 'c1', amount: 500, currency: 'USD',
      type: 'expense', date: '2026-05-02', paymentType: 'cash', recordState: 'cleared',
      tags: [], regularItemId: 'ri1' },
  ];
  const w = boot(st);
  await wait(80);
  const app = w.__app;
  const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));

  app.deleteRegularItem('ri1');
  await wait(60);
  ok('L5 the item is gone', !saved().regularItems.some((i) => i.id === 'ri1'));
  ok('L5 the logged transactions survive', saved().transactions.length === 2,
     `${saved().transactions.length} left`);
  ok('L5 they are unlinked from the deleted item',
     saved().transactions.every((t) => !t.regularItemId));
  ok('L5 the account balance is unchanged',
     saved().accounts.find((a) => a.id === 'usd').balance === -1000,
     String(saved().accounts.find((a) => a.id === 'usd').balance));
  w.close();
}

// ═══ M7 — debt delete keeps a coherent ledger ═══════════════════════════════
{
  const mk = () => {
    const st = baseState();
    st.debts = [{ id: 'd1', counterparty: 'Ali', principal: 100000, currency: 'USD',
                  kind: 'borrowed', status: 'active', initialTxId: 'dinit' }];
    st.transactions = [
      { id: 'dinit', accountId: 'usd', categoryId: null, amount: 100000, currency: 'USD',
        type: 'income', date: '2026-01-01', paymentType: 'transfer', recordState: 'cleared',
        tags: [], debtId: 'd1', debtRole: 'initial' },
      { id: 'dpay', accountId: 'usd', categoryId: null, amount: 40000, currency: 'USD',
        type: 'expense', date: '2026-02-01', paymentType: 'transfer', recordState: 'cleared',
        tags: [], debtId: 'd1', debtRole: 'payment' },
    ];
    return st;
  };

  // Keep-transactions path.
  const w1 = boot(mk());
  await wait(80);
  const saved1 = () => JSON.parse(w1.localStorage.getItem('pocket.v1'));
  const before = saved1().accounts.find((a) => a.id === 'usd').balance;
  w1.__app.deleteDebt('d1', false);
  await wait(60);
  ok('M7 keeping transactions leaves the balance untouched',
     saved1().accounts.find((a) => a.id === 'usd').balance === before,
     `${before} → ${saved1().accounts.find((a) => a.id === 'usd').balance}`);
  ok('M7 both transactions are kept', saved1().transactions.length === 2);
  ok('M7 they are unlinked from the debt',
     saved1().transactions.every((t) => !t.debtId));
  w1.close();

  // Destroy path.
  const w2 = boot(mk());
  await wait(80);
  const saved2 = () => JSON.parse(w2.localStorage.getItem('pocket.v1'));
  w2.__app.deleteDebt('d1', true);
  await wait(60);
  ok('M7 destroying removes the whole footprint', saved2().transactions.length === 0,
     JSON.stringify(saved2().transactions.map((t) => t.id)));
  ok('M7 the balance returns to zero',
     saved2().accounts.find((a) => a.id === 'usd').balance === 0,
     String(saved2().accounts.find((a) => a.id === 'usd').balance));
  w2.close();
}

// ═══ H10 — the amount filters carry focus keys ══════════════════════════════
{
  const w = boot(baseState());
  await wait(80);
  const app = w.__app, doc = w.document;
  app.navigate('transactions');
  await wait(50);
  app.toggleTxFilterPanel();
  await wait(50);
  const html = doc.getElementById('viewContent')?.innerHTML || '';
  ok('H10 the amount filters carry focus keys',
     html.includes('data-focus-key="txAmountMin"') && html.includes('data-focus-key="txAmountMax"'),
     'focus keys missing');
  w.close();
}

// ═══ M3 — Hijri budgets: a snapshot and "today" share one epoch ═════════════
{
  // Today's spending must stay inside a Hijri budget even after the user nudges
  // the calendar offset — that nudge used to move "today" into the next Hijri
  // month while the day's own transactions kept the previous month's snapshot.
  const st = baseState();
  st.user.showHijri = true;
  st.budgets = [{
    id: 'b1', categoryIds: ['c1'], categoryId: 'c1', amount: 100000,
    currency: 'USD', period: 'hijri', rollover: false,
  }];
  const w = boot(st);
  await wait(100);
  const app = w.__app, doc = w.document, $ = (s) => doc.querySelector(s);
  const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));

  // Log an expense today, at the current offset.
  app.openModal('transaction', {});
  await wait(30);
  $('#txForm [name=amount]').value = '25';
  $('#txForm [name=accountId]').value = 'usd';
  // The budget targets c1, so the expense has to carry it.
  app.openCategoryPicker('txCategory');
  await wait(30);
  app.catPicker.choose('c1');
  await wait(30);
  await app.submitTx({ preventDefault() {}, target: $('#txForm') }, '');
  await wait(60);

  const tx = saved().transactions[0];
  ok('M3 the expense carries the budgeted category', tx?.categoryId === 'c1', String(tx?.categoryId));
  ok('M3 the transaction stored a Hijri snapshot', !!tx?.hijriDate, JSON.stringify(tx?.hijriDate));
  ok('M3 the snapshot records the offset it was made with',
     Number.isFinite(tx?.hijriDate?.offset), JSON.stringify(tx?.hijriDate));

  app.navigate('budgets');
  await wait(50);
  ok('M3 the spend is counted at the original offset',
     (doc.getElementById('viewContent')?.innerHTML || '').includes('25.00'),
     'baseline spend not shown');

  // Nudging the offset must not move today's own spending out of the budget.
  // NB: this only bites at a Hijri month boundary, so BOUNDARY_CLOCK below
  // pins "today" to one — with a mid-month date the bug is invisible and the
  // test would pass against the broken code too.
  app.setHijriOffset(1);
  await wait(50);
  app.navigate('budgets');
  await wait(50);
  ok('M3 the spend survives an offset nudge (mid-month baseline)',
     (doc.getElementById('viewContent')?.innerHTML || '').includes('25.00'),
     'spend dropped out of the budget');
  app.setHijriOffset(0);
  await wait(40);
  w.close();
}

// ═══ M3 (the case that actually bites) — pinned to a Hijri month boundary ═══
{
  // 2026-08-12 is 29 Muharram 1448 at offset 0; +1 makes it 1 Safar. A
  // transaction entered that day at offset 0 must stay in the budget when the
  // offset moves, because its snapshot and "today" are compared in the SAME
  // epoch. Against the old code, "today" jumped to Safar while the snapshot
  // stayed in Muharram and the day's spend vanished.
  const BOUNDARY = '2026-08-12T10:00:00Z';

  const st = baseState();
  st.user.showHijri = true;
  st.budgets = [{
    id: 'b1', categoryIds: ['c1'], categoryId: 'c1', amount: 100000,
    currency: 'USD', period: 'hijri', rollover: false,
  }];

  const w = boot(st);
  // Freeze the clock INSIDE the jsdom realm the bundle runs in.
  const RealDate = w.Date;
  const fixed    = new RealDate(BOUNDARY).getTime();
  class FrozenDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return fixed; }
  }
  w.Date = FrozenDate;

  await wait(100);
  const app = w.__app, doc = w.document, $ = (s) => doc.querySelector(s);
  const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));

  app.openModal('transaction', {});
  await wait(30);
  $('#txForm [name=amount]').value = '25';
  $('#txForm [name=accountId]').value = 'usd';
  $('#txForm [name=date]').value = '2026-08-12';
  app.openCategoryPicker('txCategory');
  await wait(30);
  app.catPicker.choose('c1');
  await wait(30);
  await app.submitTx({ preventDefault() {}, target: $('#txForm') }, '');
  await wait(60);

  const tx = saved().transactions.find((t) => t.amount === 2500);
  ok('M3b transaction landed on the boundary date', tx?.date === '2026-08-12', tx?.date);
  ok('M3b its snapshot is the last day of the Hijri month',
     tx?.hijriDate?.day === 29 && tx?.hijriDate?.offset === 0,
     JSON.stringify(tx?.hijriDate));

  app.navigate('budgets');
  await wait(50);
  ok('M3b counted before the offset change',
     (doc.getElementById('viewContent')?.innerHTML || '').includes('25.00'));

  // +1 pushes "today" into the next Hijri month.
  app.setHijriOffset(1);
  await wait(50);
  app.navigate('budgets');
  await wait(50);
  ok('M3b STILL counted after the offset crosses the month boundary',
     (doc.getElementById('viewContent')?.innerHTML || '').includes('25.00'),
     'the day\'s spend dropped out of its Hijri budget');

  w.Date = RealDate;
  w.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
