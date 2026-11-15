/**
 * reimbursements.smoke.mjs — money someone pays you back, and loans.
 *
 *   R1  sharing: Spread evenly (pro-rata), Oldest first, Per item; extra over what's owed
 *   R2  counting: a paid-back expense counts what you bore; a payback isn't income;
 *       an extra counted as income is; loans and repayments count nothing
 *   R3  status: paid, % reimbursed, closed, outstanding
 *   A1  expense form: "Someone will pay me back" saves who / how much / claim
 *   A2  Debts → Reimbursements lists it; Paid back Per item 10,000 of 12,000 with
 *       "The rest won't be paid back" closes it in one save
 *   A3  Transactions: the expense keeps ₹12,000 with "Reimbursed 83%"; the payback
 *       says "not income"; Dashboard spending ₹2,000 and income ₹0; balance up ₹10,000
 *   A4  a claim of two items, Spread evenly; over-payment kept as credit; credit used later
 *   A5  over-payment counted as income shows as income; Won't be paid back closes with no money
 *   A6  loans: lending and repayments don't touch Dashboard income or spending
 *   A7  export: Paid back by / Amount paid back / % reimbursed; category totals net of paid back
 *   A8  Transactions filter; can't untick an expense already paid back; help mentions it
 *
 * Run: node src/__smoke__/reimbursements.smoke.mjs
 */
import { ReimbursementService } from '../domain/services/ReimbursementService.js';
import { CountedEntries } from '../domain/services/CountedEntries.js';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nReimbursements suite');

{
  const items = [
    { id: 'a', outstanding: 1000000 }, { id: 'b', outstanding: 500000 },
    { id: 'c', outstanding: 1100000 }, { id: 'd', outstanding: 400000 },
  ];
  const sum = (r) => r.parts.reduce((n, p) => n + p.amount, 0);
  const sp = ReimbursementService.allocate(items, 2700000, 'spread');
  const by = Object.fromEntries(sp.parts.map((p) => [p.id || p.txId, p.amount]));
  ok('R1 Spread evenly: 27,000 of 30,000 → 9,000 / 4,500 / 9,900 / 3,600', by.a === 900000 && by.b === 450000 && by.c === 990000 && by.d === 360000 && sum(sp) === 2700000, JSON.stringify(by));
  const old = ReimbursementService.allocate(items, 2700000, 'oldest');
  ok('R1 Oldest first: 10,000 / 5,000 / 11,000 / 1,000', old.parts.map((p) => p.amount).join() === '1000000,500000,1100000,100000');
  const per = ReimbursementService.allocate(items, 0, 'items', { a: 1000000, c: 2000000 });
  ok('R1 Per item: typed amounts, capped at what each is owed', per.parts.length === 2 && per.parts[1].amount === 1100000 && per.used === 2100000);
  const over = ReimbursementService.allocate(items, 3200000, 'spread');
  ok('R1 paid 32,000 for 30,000 owed → everything covered, 2,000 extra', over.used === 3000000 && over.extra === 200000);
  const odd = ReimbursementService.allocate([{ id: 'x', outstanding: 100 }, { id: 'y', outstanding: 200 }], 100, 'spread');
  ok('R1 rounding: parts add up exactly', sum(odd) === 100, JSON.stringify(odd.parts));
}

{
  const state = {
    transactions: [
      { id: 'e1', type: 'expense', amount: 3000000, refAmount: 3000000, currency: 'INR', categoryId: 'med', date: '2026-10-10', reimbBy: 'Company', reimbExpected: 2700000 },
      { id: 'e2', type: 'expense', amount: 1000000, currency: 'INR', date: '2026-10-11', splits: [{ categoryId: 'x', amount: 600000 }, { categoryId: 'y', amount: 400000 }], reimbBy: 'Ali' },
      { id: 'p1', type: 'income', amount: 2700000, currency: 'INR', date: '2026-11-02', tags: ['reimbursement'], reimbBy: 'Company', reimbAlloc: [{ txId: 'e1', amount: 2700000, pay: 2700000 }] },
      { id: 'p2', type: 'income', amount: 600000, currency: 'INR', date: '2026-11-03', tags: ['reimbursement'], reimbBy: 'Ali', reimbAlloc: [{ txId: 'e2', amount: 500000, pay: 500000 }], reimbExtra: 100000, reimbExtraAs: 'income' },
      { id: 'l1', type: 'expense', amount: 500000, currency: 'INR', date: '2026-11-04', tags: ['debt'], debtRole: 'initial', debtId: 'd1' },
      { id: 'l2', type: 'income', amount: 200000, currency: 'INR', date: '2026-11-05', tags: ['debt-payment'], debtRole: 'payment', debtId: 'd1' },
      { id: 'n1', type: 'expense', amount: 99, currency: 'INR', date: '2026-11-05' },
    ],
  };
  const c = CountedEntries.byId(state);
  ok('R2 30,000 expense, 27,000 paid back → counts 3,000 (refAmount too)', c.get('e1').amount === 300000 && c.get('e1').refAmount === 300000 && c.get('e1')._paidBack === 2700000);
  ok('R2 splits reduced alike (half paid back → 3,000 / 2,000)', c.get('e2').splits.map((s) => s.amount).join() === '300000,200000');
  ok('R2 a payback isn\'t income, only its extra counted as income is', !c.has('p1') && c.get('p2').amount === 100000);
  ok('R2 a loan and its repayment count nothing', !c.has('l1') && !c.has('l2'));
  ok('R2 other entries untouched (same object)', c.get('n1') === state.transactions[6]);
  ok('R2 the entries themselves are unchanged', state.transactions[0].amount === 3000000 && state.transactions[1].splits[0].amount === 600000);

  const r = new ReimbursementService(state);
  const s1 = r.status(state.transactions[0]);
  ok('R3 expected 27,000, paid 27,000 → 100%, settled', s1.expected === 2700000 && s1.paid === 2700000 && s1.pct === 100 && s1.settled);
  const s2 = r.status(state.transactions[1]);
  ok('R3 5,000 of 10,000 → 50%, 5,000 to get back', s2.pct === 50 && s2.outstanding === 500000 && !s2.settled);
  state.transactions[1].reimbClosed = true;
  const s3 = new ReimbursementService(state).status(state.transactions[1]);
  ok('R3 closed: nothing more to get back, still 50% reimbursed', s3.closed && s3.outstanding === 0 && s3.pct === 50);
}

// ── in the app ────────────────────────────────────────────────────────────
const bundleSrc = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Date();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = iso(today);
function boot() {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
      <div id="viewContent"></div><div id="sidebarNav"></div><div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
    </body></html>`, { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  window.localStorage.setItem('pocket.v1', JSON.stringify({
    user: { homeCurrency: 'INR', defaultCurrency: 'INR', theme: 'light', showHijri: false, hijriOffset: 0, customPaymentTypes: [], hiddenPaymentTypes: [], defaultAccountId: 'bank' },
    accounts: [{ id: 'bank', name: 'HDFC', currency: 'INR', type: 'bank', color: '#3b82f6', icon: 'landmark', openingBalance: 50000000, balance: 50000000 }],
    categories: [{ id: 'med', name: 'Medical', type: 'expense', icon: 'stethoscope', color: '#ef4444' }],
    transactions: [], budgets: [], debts: [], family: [], merchantCategories: {}, accountGroups: [], regularItems: [],
  }));
  window.__charts = [];
  window.lucide = { createIcons() {} };
  window.Chart = function (ctx, cfg) { window.__charts.push(cfg); return { destroy() {} }; };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.fetch = () => Promise.reject(new Error('offline'));
  window.confirm = () => true;
  window.alert = () => {};
  window.eval(bundleSrc);
  return window;
}
const w = boot();
await wait(100);
const app = w.__app;
const st = () => app.store.getState();
const view = () => w.document.getElementById('viewContent');
const fill = (f, values) => {
  for (const [k, v] of Object.entries(values)) {
    const el = f.querySelector(`[name="${k}"]`);
    if (!el) throw new Error(`no field ${k}`);
    if (el.type === 'radio') f.querySelector(`[name="${k}"][value="${v}"]`).checked = true;
    else if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
  }
};
const bank = () => Math.round(st().accounts.find((a) => a.id === 'bank').balance);
const dash = () => {
  app.navigate('dashboard');
  const n = (sel) => Number((view().querySelector(sel)?.textContent || '').replace(/[^0-9.]/g, ''));
  return { income: n('.text-emerald-500.text-2xl, .text-2xl.text-emerald-500'), expense: n('.text-2xl.text-rose-500') };
};
async function addExpense(amount, extra) {
  app.openModal('transaction');
  await wait(10);
  const f = w.document.getElementById('txForm');
  fill(f, { amount: String(amount), categoryId: 'med', date: TODAY, accountId: 'bank', ...extra });
  await app.submitTx({ preventDefault() {}, target: f }, '');
  await wait(10);
  return st().transactions.at(-1);
}
const payForm = () => w.document.querySelector('form.reimb-form');

{
  const e = await addExpense(12000, { reimbOn: true, reimbBy: 'Company' });
  ok('A1 saved with who pays back; expects all of it', e.reimbBy === 'Company' && !e.reimbExpected && e.amount === 1200000, JSON.stringify(e));
  ok('A1 counts in full until paid back (Dashboard spending ₹12,000)', dash().expense === 12000, JSON.stringify(dash()));

  app.navigate('debts');
  await wait(10);
  const sec = view().querySelector('.owed-reimb');
  ok('A2 Debts has a "Reimbursements" section with Company ₹12,000', !!sec && /Reimbursements/.test(sec.textContent) && /Company/.test(sec.textContent) && /12,000/.test(sec.textContent));
  const key = ReimbursementService.groupKey(e);
  app.openModal('reimbursement', { key });
  await wait(10);
  let f = payForm();
  ok('A2 Spread evenly is the default; three ways to share', f.querySelector('[name="mode"]:checked')?.value === 'spread' && f.querySelectorAll('[name="mode"]').length === 3);
  fill(f, { mode: 'items', [`part_${e.id}`]: '10000', [`close_${e.id}`]: true, accountId: 'bank' });
  app.updatePaybackPreview(f);
  ok('A2 Per item shows an amount and a "rest won\'t be paid back" switch per item', f.querySelector('[data-per-item]').style.display === '' && f.querySelector('[data-batch-close]').style.display === 'none');
  app.submitPayback({ preventDefault() {}, target: f }, key);
  await wait(10);
  const p = st().transactions.find((t) => t.tags?.includes('reimbursement'));
  ok('A2 one payback entry: ₹10,000 into HDFC, shared to the expense', p && p.amount === 1000000 && p.accountId === 'bank' && p.reimbAlloc.length === 1 && p.reimbAlloc[0].amount === 1000000);
  ok('A2 the rest closed in the same save', st().transactions.find((t) => t.id === e.id).reimbClosed === true);
  ok('A2 nothing left in Reimbursements', (app.navigate('debts'), !view().querySelector('.owed-reimb')));

  app.navigate('transactions');
  await wait(10);
  const rows = view().textContent;
  ok('A3 the expense keeps ₹12,000 and shows "Reimbursed 83% · ₹10,000"', /12,000/.test(rows) && /Reimbursed 83% · ₹10,000/.test(rows), rows.slice(0, 400));
  ok('A3 the payback reads "Paid back by Company · not income"', /Paid back by Company · not income/.test(rows));
  ok('A3 no "not paid back" wording anywhere', !/not paid back/i.test(rows));
  const d = dash();
  ok('A3 Dashboard: spending ₹2,000, income ₹0', d.expense === 2000 && d.income === 0, JSON.stringify(d));
  ok('A3 HDFC balance: −12,000 + 10,000', bank() === 50000000 - 200000, String(bank()));
}

{
  const a = await addExpense(10000, { reimbOn: true, reimbBy: 'Star Health', claimName: 'Nov hospital', claimRef: 'CL-77' });
  const b = await addExpense(5000, { reimbOn: true, reimbBy: 'Star Health', claimName: 'nov hospital' });
  ok('A4 both in one claim (matched by name), with its reference', a.claimId && a.claimId === b.claimId && st().claims.find((c) => c.id === a.claimId)?.ref === 'CL-77');
  const key = ReimbursementService.groupKey(a);
  app.navigate('debts');
  ok('A4 listed as the claim, by Star Health, ref shown', /Nov hospital/.test(view().querySelector('.owed-reimb')?.textContent || '') && /CL-77/.test(view().querySelector('.owed-reimb').textContent));
  app.openModal('reimbursement', { key });
  await wait(10);
  let f = payForm();
  fill(f, { amount: '9000', accountId: 'bank' });
  app.updatePaybackPreview(f);
  ok('A4 preview: 6,000 and 3,000', [...f.querySelectorAll('.reimb-share')].map((x) => x.textContent).join('|') === 'Gets ₹6,000.00|Gets ₹3,000.00', [...f.querySelectorAll('.reimb-share')].map((x) => x.textContent).join('|'));
  app.submitPayback({ preventDefault() {}, target: f }, key);
  await wait(10);
  const r = app.reimbursements;
  ok('A4 Spread evenly: 6,000 and 3,000 paid back (60% each)', r.paidBack(a.id) === 600000 && r.paidBack(b.id) === 300000 && r.status(a).pct === 60);
  app.openModal('reimbursement', { key });
  await wait(10);
  f = payForm();
  fill(f, { amount: '7000', accountId: 'bank' });
  app.updatePaybackPreview(f);
  ok('A4 paying 7,000 for 6,000 owed asks about the extra', f.querySelector('[data-extra]').style.display === '' && /1,000/.test(f.querySelector('.reimb-extra-text').textContent));
  fill(f, { extraAs: 'keep' });
  app.submitPayback({ preventDefault() {}, target: f }, key);
  await wait(10);
  ok('A4 both now 100% reimbursed; ₹1,000 kept as credit', app.reimbursements.status(a).pct === 100 && app.reimbursements.status(b).settled && app.reimbursements.credit('Star Health') === 100000);
  const incomeNow = dash().income;
  ok('A4 kept credit isn\'t income', incomeNow === 0, String(incomeNow));
  const c = await addExpense(2500, { reimbOn: true, reimbBy: 'Star Health' });
  const k2 = ReimbursementService.groupKey(c);
  app.openModal('reimbursement', { key: k2 });
  await wait(10);
  ok('A4 the next item offers the ₹1,000 credit', /1,000\.00 credit from Star Health/.test(payForm().textContent));
  app.useReimbCredit(k2, payForm());
  await wait(10);
  ok('A4 credit used: 1,000 of 2,500 paid back, no credit left', app.reimbursements.paidBack(c.id) === 100000 && app.reimbursements.credit('Star Health') === 0);
}

{
  const e = await addExpense(4000, { reimbOn: true, reimbBy: 'Brother', reimbExpected: '3000' });
  ok('A5 expecting 3,000 of 4,000', e.reimbExpected === 300000);
  const before = dash();
  const key = ReimbursementService.groupKey(e);
  app.openModal('reimbursement', { key });
  await wait(10);
  const f = payForm();
  fill(f, { amount: '3500', accountId: 'bank', mode: 'oldest', extraAs: 'income' });
  app.submitPayback({ preventDefault() {}, target: f }, key);
  await wait(10);
  const after = dash();
  ok('A5 extra ₹500 counted as income; spending down ₹3,000', after.income - before.income === 500 && before.expense - after.expense === 3000, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);

  const g = await addExpense(800, { reimbOn: true, reimbBy: 'Friend' });
  const exp = dash().expense;
  app.waiveReimbursement(ReimbursementService.groupKey(g), null);
  await wait(10);
  const t = st().transactions.find((x) => x.id === g.id);
  ok('A5 Won\'t be paid back: closed, still your spending, no entry added', t.reimbClosed === true && dash().expense === exp && !st().transactions.some((x) => x.reimbBy === 'Friend' && x.type === 'income'));
  app.navigate('transactions');
  ok('A5 its row reads "Reimbursed 0% · closed"', /Reimbursed 0% · closed/.test(view().textContent));
}

{
  const before = dash();
  const balance = bank();
  app.openModal('debt');
  await wait(10);
  const df = [...w.document.querySelectorAll('form')].find((x) => /submitDebt\(/.test(x.getAttribute('onsubmit') || ''));
  if (df) {
    const set = (n, v) => { const el = df.querySelector(`[name="${n}"]`); if (el) { if (el.type === 'radio') { const r = df.querySelector(`[name="${n}"][value="${v}"]`); if (r) r.checked = true; } else el.value = v; } };
    set('type', 'lent'); set('counterparty', 'Sam'); set('principal', '5000'); set('amount', '5000'); set('accountId', 'bank'); set('date', TODAY); set('startDate', TODAY);
    app.submitDebt({ preventDefault() {}, target: df }, '');
    await wait(10);
  }
  const loanTx = st().transactions.find((t) => t.debtRole === 'initial');
  ok('A6 lending ₹5,000 moves the balance', !!loanTx && bank() === balance - 500000, `${!!df} ${bank()} ${balance}`);
  const after = dash();
  ok('A6 …but isn\'t spending', after.expense === before.expense && after.income === before.income, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  app.navigate('transactions');
  ok('A6 the row says "Loan · not income or spending"', /Loan · not income or spending/.test(view().textContent));
}

{
  const { LedgerEntries } = await import('../domain/export/LedgerEntries.js');
  const rows = new LedgerEntries(st(), { fx: { convert: (m) => m, fromMinor: (m) => m / 100 } }).all();
  const big = rows.find((r) => r.amount === 1200000);
  ok('A7 export row: Paid back by Company, ₹10,000 paid back, 83% reimbursed, counts ₹2,000', big.reimbBy === 'Company' && big.paidBackHome === 1000000 && Math.round(big.reimbPct * 100) === 83 && big.countedHome === 200000, JSON.stringify(big));
  const pay = rows.find((r) => r.kind === 'Paid back' && r.amount === 1000000);
  ok('A7 the payback row counts nothing; a loan row counts nothing', pay.countedHome === 0 && rows.filter((r) => r.kind === 'Loan').every((r) => r.countedHome === 0));
  const { ExportFormat } = await import('../domain/export/ExportFormat.js');
  const labels = ExportFormat.TX_COLUMNS.map(([, l]) => l);
  ok('A7 export columns: Paid back by · Amount paid back · % reimbursed', ['Paid back by', 'Amount paid back', '% reimbursed'].every((l) => labels.includes(l)) && !labels.some((l) => /not paid/i.test(l)));
}

{
  app.navigate('transactions');
  app.txFilterSet('reimb', 'open');
  await wait(10);
  const txt = view().textContent;
  ok('A8 filter "To get back": only Star Health\'s 2,500 is open', /2,500/.test(txt) && !/12,000/.test(txt), txt.slice(0, 300));
  app.txFilterSet('reimb', 'payments');
  await wait(10);
  const t2 = view().textContent;
  ok('A8 filter "Money paid back": only the paybacks', /Paid back by Company/.test(t2) && /Paid back by Star Health/.test(t2) && !/Reimbursed 83%/.test(t2) && !/will pay back/.test(t2));
  app.txFilterSet('reimb', '');

  const e = st().transactions.find((t) => t.reimbBy === 'Company' && t.type === 'expense');
  app.openModal('transaction', { id: e.id });
  await wait(10);
  const f = w.document.getElementById('txForm');
  ok('A8 editing shows "Reimbursed 83%" and the closed box', /Reimbursed 83%/.test(f.textContent) && !!f.querySelector('[name="reimbClosed"]'));
  fill(f, { reimbOn: false });
  await app.submitTx({ preventDefault() {}, target: f }, e.id);
  await wait(10);
  ok('A8 can\'t untick it once money came back', st().transactions.find((t) => t.id === e.id).reimbBy === 'Company');
  app.closeModal();
  app.openHelp('debts');
  await wait(10);
  const help = w.document.querySelector('.help-sheet')?.textContent || '';
  ok('A8 Debts help explains reimbursements', /Reimbursements/.test(help) && /Someone will pay me back/.test(help) && /not income/i.test(help));
  app.closeModal();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
