/**
 * owed.smoke.mjs — credit cards, loan instalments, and "I owe" on Debts.
 *
 *   C1  statement/due dates: month ends clamp (31 → 30 Apr, 28 Feb), years wrap
 *   C2  a card's bill, what's paid since, what's left, next bill, due date, status
 *   C3  a card without a statement day: owed and limit only
 *   L1  instalments: dates, paid count, behind, next, due now, status
 *   A1  account form: card fields only for Credit Card; saved as minor units / days
 *   A2  Debts → I owe: Loans, Credit cards, Bills groups; total = their sum
 *   A3  Pay on a card opens a transfer into it, filled in with what's owed
 *   A4  a loan with instalments from the form: shows behind + Pay; Pay fills the instalment
 *   A5  the card page shows this bill and Pay bill once the days are set
 *   A6  Dashboard reminds about an overdue instalment
 *   A7  help: Debts explains the groups and instalments; Accounts the card fields
 *
 * Run: node src/__smoke__/owed.smoke.mjs
 */
import { CardCycle } from '../domain/services/CardCycle.js';
import { LoanInstalments } from '../domain/services/LoanInstalments.js';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nOwed suite');

const fx = { convert: (m) => m, convertStrict: (m) => m };
{
  ok('C1 day 31 in April → 30 Apr; in Feb 2026 → 28 Feb', CardCycle.nextAfter(31, '2026-04-01') === '2026-04-30' && CardCycle.nextAfter(31, '2026-02-01') === '2026-02-28');
  ok('C1 last statement before the 5th of January is 5 Dec of last year', CardCycle.lastOn(5, '2026-01-03') === '2025-12-05');
  ok('C1 due after a statement on the 25th is the 5th of next month', CardCycle.nextAfter(5, '2026-12-25') === '2027-01-05');
}
{
  const card = { id: 'card', type: 'card', currency: 'INR', statementDay: 5, dueDay: 25, creditLimit: 100000 };
  const txs = [
    { id: 'x1', type: 'expense', accountId: 'card', amount: 30000, currency: 'INR', date: '2026-10-20' },
    { id: 'x2', type: 'expense', accountId: 'card', amount: 5000, currency: 'INR', date: '2026-11-08' },
    { id: 'x3', type: 'transfer', transferDir: 'in', accountId: 'card', amount: 10000, currency: 'INR', date: '2026-11-10' },
    { id: 'x4', type: 'expense', accountId: 'other', amount: 999, currency: 'INR', date: '2026-11-09' },
  ];
  const c = CardCycle.of(card, -25000, txs, '2026-11-15', fx);
  ok('C2 bill ₹300 (closed 5 Nov), paid ₹100, ₹200 left, ₹50 on the next bill', c.statement === '2026-11-05' && c.bill === 30000 && c.paid === 10000 && c.billLeft === 20000 && c.unbilled === 5000, JSON.stringify(c));
  ok('C2 due 25 Nov; 10 days away is "open"', c.dueDate === '2026-11-25' && c.status === 'open');
  ok('C2 limit ₹1000: ₹250 used, ₹750 left, 25%', c.owed === 25000 && c.available === 75000 && c.usedPct === 25);
  ok('C2 three days before due → soon; after due → overdue', CardCycle.of(card, -25000, txs, '2026-11-22', fx).status === 'soon' && CardCycle.of(card, -25000, txs, '2026-11-26', fx).status === 'overdue');
  const paidUp = [...txs, { id: 'x5', type: 'transfer', transferDir: 'in', accountId: 'card', amount: 20000, currency: 'INR', date: '2026-11-12' }];
  const p = CardCycle.of(card, -5000, paidUp, '2026-11-26', fx);
  ok('C2 once payments cover the bill → paid, even past the due date', p.billLeft === 0 && p.status === 'paid', JSON.stringify(p));
  ok('C2 nothing owed at the statement → clear', CardCycle.of(card, 0, [], '2026-11-15', fx).status === 'clear');
}
{
  const c = CardCycle.of({ id: 'c', type: 'card', currency: 'INR', creditLimit: 50000 }, -12000, [], '2026-11-15', fx);
  ok('C3 no statement day: status none, owed and limit still shown', c.status === 'none' && c.owed === 12000 && c.available === 38000 && c.bill === undefined);
}
{
  const debt = { id: 'd1', principal: 120000, dateTaken: '2026-06-10', instalmentAmount: 10000, instalmentDay: 5, instalmentCount: 12, status: 'active' };
  ok('L1 first instalment 5 Jul, 12 in all, last 5 Jun next year', LoanInstalments.dates(debt)[0] === '2026-07-05' && LoanInstalments.dates(debt).length === 12 && LoanInstalments.dates(debt).at(-1) === '2027-06-05');
  const behind = LoanInstalments.of(debt, 30000, '2026-11-15');
  ok('L1 5 fallen due, 3 paid: ₹200 behind, overdue, pay ₹200', behind.paidCount === 3 && behind.behind === 20000 && behind.status === 'overdue' && behind.dueNow === 20000, JSON.stringify(behind));
  const onTrack = LoanInstalments.of(debt, 50000, '2026-11-15');
  ok('L1 5 paid: on track, next 5 Dec, pay one instalment', onTrack.status === 'open' && onTrack.nextDate === '2026-12-05' && onTrack.dueNow === 10000 && onTrack.behind === 0);
  ok('L1 3 days before → soon', LoanInstalments.of(debt, 50000, '2026-12-02').status === 'soon');
  ok('L1 all paid → done, nothing due', LoanInstalments.of(debt, 120000, '2026-12-02').status === 'done' && LoanInstalments.of(debt, 120000, '2026-12-02').dueNow === 0);
  ok('L1 without instalments → null', LoanInstalments.of({ principal: 1 }, 0, '2026-12-02') === null);
}

// ── in the app ────────────────────────────────────────────────────────────
const bundleSrc = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
function boot(extra = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
      <div id="viewContent"></div><div id="sidebarNav"></div><div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
    </body></html>`, { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  window.localStorage.setItem('pocket.v1', JSON.stringify({
    user: { homeCurrency: 'INR', defaultCurrency: 'INR', theme: 'light', showHijri: false, hijriOffset: 0, customPaymentTypes: [], hiddenPaymentTypes: [], defaultAccountId: 'a1' },
    accounts: [
      { id: 'a1', name: 'Bank', currency: 'INR', type: 'bank', color: '#3b82f6', icon: 'landmark', openingBalance: 500000, balance: 500000 },
      { id: 'card', name: 'HDFC Card', currency: 'INR', type: 'card', color: '#ef4444', icon: 'credit-card', openingBalance: 0, balance: 0, creditLimit: 100000 },
    ],
    categories: [{ id: 'c1', name: 'Food', type: 'expense', parentId: null, color: '#10b981', icon: 'tag' }],
    transactions: [
      { id: 'cs1', type: 'expense', accountId: 'card', categoryId: 'c1', amount: 25000, currency: 'INR', date: addDays(today, -2), payee: 'Shop' },
      { id: 'bill1', type: 'expense', accountId: 'a1', categoryId: 'c1', amount: 40000, currency: 'INR', date: addDays(today, -33), payee: 'Electricity', askFirst: true, recurring: { rule: 'monthly', interval: 1, skipped: [] } },
    ],
    budgets: [], debts: [], family: [], merchantCategories: {}, accountGroups: [], regularItems: [],
    ...extra,
  }));
  window.lucide = { createIcons() {} };
  window.Chart = function () { return { destroy() {} }; };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.fetch = () => Promise.reject(new Error('offline'));
  window.confirm = () => true;
  window.alert = () => {};
  window.eval(bundleSrc);
  return window;
}
const view = (w) => w.document.getElementById('viewContent');
const form = (w) => w.document.querySelector('#modalRoot form, .modal form, form');

const w = boot();
await wait(100);
const app = w.__app;
{
  app.openModal('account');
  await wait(10);
  const box = () => w.document.getElementById('accCardFields');
  ok('A1 card fields hidden for a new Bank account', box() && box().style.display === 'none');
  app.openModal('account', { id: 'card' });
  await wait(10);
  ok('A1 card fields shown for the card, limit filled in', box().style.display === '' && Number(box().querySelector('[name="creditLimit"]').value) === 1000);
  const f = box().closest('form');
  f.querySelector('[name="statementDay"]').value = '5';
  f.querySelector('[name="dueDay"]').value = '25';
  f.querySelector('[name="creditLimit"]').value = '2000';
  app.submitAccount({ preventDefault() {}, target: f }, 'card');
  await wait(10);
  const c = app.store.getState().accounts.find((a) => a.id === 'card');
  ok('A1 saved: limit 200000 minor, statement 5, due 25', c.creditLimit === 200000 && c.statementDay === 5 && c.dueDay === 25, JSON.stringify({ l: c.creditLimit, s: c.statementDay, d: c.dueDay }));
}
{
  // a plain loan from a person
  app.store.getState().debts.push({ id: 'dbt1', type: 'borrowed', counterparty: 'Ahmed', principal: 100000, currency: 'INR', accountId: 'a1', dateTaken: addDays(today, -10), status: 'active', initialTxId: 'none' });
  app.navigate('debts');
  await wait(20);
  const v = view(w);
  ok('A2 groups: Loans, Credit cards, Bills', v.querySelector('.owe-loans') && v.querySelector('.owe-cards') && v.querySelector('.owe-bills'), v.textContent.slice(0, 200));
  const s = app.owed.summary(today);
  ok('A2 total = loan ₹1000 + card ₹250 + overdue bill ₹400', s.totals.loans === 100000 && s.totals.cards === 25000 && s.totals.bills === 40000 && s.totals.all === 165000, JSON.stringify(s.totals));
  ok('A2 the You owe card shows the total and the breakdown', /1,650/.test(v.querySelector('.owe-total').textContent) && /Loans .*Cards .*Bills/.test(v.querySelector('.owe-total').textContent), v.querySelector('.owe-total').textContent.replace(/\s+/g, ' '));
  ok('A2 the bill row says overdue and has Pay', /Electricity/.test(v.querySelector('.owe-bills').textContent) && /overdue/.test(v.querySelector('.owe-bills').textContent));
}
{
  app.payCardBill('card');
  await wait(20);
  const f = w.document.querySelector('[name="transferToAccountId"]')?.closest('form');
  ok('A3 Pay opens a transfer Bank → HDFC Card', f && f.querySelector('[name="transferToAccountId"]').value === 'card' && f.querySelector('[name="accountId"]').value === 'a1');
  const amt = Number(f?.querySelector('[name="amount"]').value);
  const c = app.owed.cardCycle(app.store.getState().accounts.find((a) => a.id === 'card'), today);
  ok('A3 filled with what is owed on the card', amt * 100 === (c.billLeft > 0 ? c.billLeft : c.owed), `${amt} vs ${JSON.stringify(c)}`);
  app.closeModal();
}
{
  app.openModal('debt');
  await wait(10);
  const f = w.document.querySelector('[name="counterparty"]').closest('form');
  f.querySelector('[name="counterparty"]').value = 'Car loan';
  f.querySelector('[name="principal"]').value = '1200';
  f.querySelector('[name="accountId"]').value = 'a1';
  f.querySelector('[name="dateTaken"]').value = addDays(today, -100);
  f.querySelector('[name="instalments"]').checked = true;
  f.querySelector('[name="instalmentAmount"]').value = '100';
  f.querySelector('[name="instalmentDay"]').value = '1';
  f.querySelector('[name="instalmentCount"]').value = '12';
  app.submitDebt({ preventDefault() {}, target: f }, '');
  await wait(20);
  const d = app.store.getState().debts.find((x) => x.counterparty === 'Car loan');
  ok('A4 saved with instalments: ₹100 on the 1st, 12 times', d && d.instalmentAmount === 10000 && d.instalmentDay === 1 && d.instalmentCount === 12);
  const card = [...view(w).querySelectorAll('.loan-instalments')].map((n) => n.textContent.replace(/\s+/g, ' ')).find((t) => /Behind/.test(t));
  ok('A4 the loan shows it is behind with a Pay button', !!card && /Pay ₹/.test(card), card);
  const i = LoanInstalments.of(d, 0, today);
  app.payLoanInstalment(d.id);
  await wait(10);
  const pf = w.document.querySelector('form [name="amount"]');
  ok('A4 Pay fills what is behind', pf && Math.round(Number(pf.value) * 100) === i.dueNow, `${pf?.value} vs ${i.dueNow}`);
  app.closeModal();

  app.navigate('dashboard');
  await wait(20);
  const rem = [...view(w).querySelectorAll('.owe-reminder')].map((n) => n.textContent.replace(/\s+/g, ' '));
  ok('A6 Dashboard reminds: Car loan instalment, overdue', rem.some((t) => /Car loan instalment/.test(t) && /overdue/.test(t)), rem.join(' | '));
}
{
  app.openAccountDetail('card');
  await wait(20);
  const panel = view(w).querySelector('.card-panel');
  ok('A5 the card page shows this bill and Pay bill', panel && /This bill/.test(panel.textContent) && /due/.test(panel.textContent) && (/Pay bill/.test(panel.textContent) || /No bill|Bill paid/.test(panel.textContent)), panel?.textContent.replace(/\s+/g, ' '));
  ok('A5 limit bar: used and left of ₹2,000', /left of ₹2,000/.test(panel.textContent));
}
{
  app.openHelp('debts');
  await wait(10);
  const t = w.document.querySelector('.help-sheet').textContent;
  ok('A7 Debts help: the four groups and instalments', ['Loans', 'Credit cards', 'Bills', 'Deliveries', 'monthly instalments'].every((k) => t.includes(k)));
  app.closeModal();
  app.openHelp('accounts');
  await wait(10);
  ok('A7 Accounts help: card limit, statement day, due day', ['limit', 'statement day', 'due day', 'Pay bill'].every((k) => w.document.querySelector('.help-sheet').textContent.includes(k)));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
