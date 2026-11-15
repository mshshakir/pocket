/**
 * sample.smoke.mjs — the sample book a first-time visitor opens with.
 *
 *   D1  built for several "todays": balances land where the story needs them,
 *       every opening balance is sensible, all of it flagged as sample
 *   D2  every feature has data: card, loan, lent money, reimbursements,
 *       gold / silver / shares, bills, deliveries, shortcuts, habits,
 *       budgets of every period, account groups, a paused repeat
 *   A1  in the app, with no saved book: every screen shows its feature
 *   A2  "Remove sample data" leaves an empty book with the default categories
 *
 * Run: node src/__smoke__/sample.smoke.mjs
 */
import { SampleBook } from '../data/SampleBook.js';
import { BookCleaner } from '../domain/services/BookCleaner.js';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nSample book suite');

// ── D: the data ─────────────────────────────────────────────────────────
for (const day of ['2026-11-15', '2026-11-01', '2026-11-30', '2027-01-03', '2027-02-28', '2027-06-20']) {
  const b = new SampleBook(day).build();
  const acc = (name) => b.accounts.find((a) => a.name === name);
  const opening = b.accounts.filter((a) => ['bank', 'cash', 'savings'].includes(a.type)).every((a) => a.openingBalance > 0);
  ok(`D1 ${day}: cash just under its alert, every opening balance above zero`, acc('Cash').balance === 124000 && acc('Cash').balance < acc('Cash').lowBalance && opening,
    b.accounts.map((a) => `${a.name}:${a.openingBalance}`).join(' '));
  const lists = ['accounts', 'transactions', 'budgets', 'debts', 'regularItems', 'holdings', 'claims', 'habits', 'accountGroups'];
  ok(`D1 ${day}: everything flagged sample`, lists.every((l) => b[l].length && b[l].every(BookCleaner.isSample)));
  ok(`D1 ${day}: no entry after today`, b.transactions.every((t) => t.date <= day), b.transactions.filter((t) => t.date > day).map((t) => t.date).join());
}
{
  const b = new SampleBook('2026-11-15').build();
  const has = (pred) => b.transactions.some(pred);
  ok('D2 a credit card with limit, statement and due days', b.accounts.some((a) => a.type === 'card' && a.creditLimit > 0 && a.statementDay && a.dueDay));
  ok('D2 an account left out of totals, two groups', b.accounts.some((a) => a.excludeFromTotals) && b.accountGroups.length === 2 && b.accounts.every((a) => a.groupId));
  ok('D2 a loan with instalments and money lent', b.debts.some((d) => d.type === 'borrowed' && d.instalmentAmount) && b.debts.some((d) => d.type === 'lent'));
  ok('D2 no interest: instalments add up to exactly the loan, and no debt is repaid beyond what was lent or borrowed',
    b.debts.filter((d) => d.instalmentAmount).every((d) => d.instalmentAmount * d.instalmentCount === d.principal)
    && b.debts.every((d) => b.transactions.filter((t) => t.debtId === d.id && t.debtRole === 'payment').reduce((s, t) => s + t.amount, 0) <= d.principal)
    && !b.transactions.some((t) => /interest(?!-free)|\bemi\b/i.test(`${t.payee} ${t.note}`)) && !b.categories.some((c) => /interest/i.test(c.name)));
  ok('D2 reimbursements: open, part paid, and paid back', has((t) => t.reimbBy && t.claimId) && has((t) => t.tags?.includes('reimbursement')) && b.claims.length === 2);
  ok('D2 gold, silver and shares, with buys, a sale and a dividend', ['gold', 'silver', 'shares'].every((k) => b.holdings.some((h) => h.kind === k))
    && has((t) => t.holdingId && t.qty > 0) && has((t) => t.holdingId && t.qty < 0) && has((t) => t.holdingId && t.type === 'income'));
  ok('D2 a bill that asks first, repeats, a paused repeat', has((t) => t.askFirst && t.recurring) && has((t) => t.recurring && !t.askFirst) && has((t) => t.pauses?.length));
  ok('D2 deliveries paid by month, and shortcuts', b.regularItems.filter((i) => i.payLater).length === 2 && has((t) => t.settles) && b.regularItems.filter((i) => !i.payLater).length === 2);
  ok('D2 budgets of every period, habits with limits', ['gregorian', 'hijri', 'week', 'year', 'range'].every((p) => b.budgets.some((x) => x.period === p))
    && b.habits.every((h) => h.limitCount || h.limitAmount));
  ok('D2 transfer legs point at each other', b.transactions.filter((t) => t.type === 'transfer').every((t) => b.transactions.some((o) => o.id === t.transferPairId && o.transferPairId === t.id)));
  const ids = b.transactions.map((t) => t.id);
  ok('D2 entry ids are unique', new Set(ids).size === ids.length);
}

// ── A: in the app ───────────────────────────────────────────────────────
const bundleSrc = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
function boot() {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
      <div id="viewContent"></div><div id="sidebarNav"></div><div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
    </body></html>`, { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  window.lucide = { createIcons() {} };
  window.Chart = function () { return { destroy() {} }; };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.fetch = () => Promise.reject(new Error('offline'));
  window.confirm = () => true;
  window.alert = () => {};
  window.addEventListener('error', (e) => errors.push(String(e.error?.stack || e.message)));
  window.eval(bundleSrc);
  return window;
}
{
  const w = boot();
  await wait(150);
  const app = w.__app;
  const v = w.document.querySelector('#viewContent');
  const text = () => v.textContent.replace(/\s+/g, ' ');
  const show = async (id, after) => { app.navigate(id); await wait(30); if (after) { after(); await wait(30); } return text(); };

  const st = app.store.getState();
  ok('A1 the app opened the sample book in rupees', st.user.homeCurrency === 'INR' && st.transactions.length > 300 && BookCleaner.hasSample(st));
  ok('A1 no extra repeat copies were needed (the sample is complete)', st.transactions.length === new Set(st.transactions.map((t) => t.id)).size);

  const dash = await show('dashboard');
  ok('A1 Dashboard has reminders (card bill, loan instalment or low cash)', /Cash|instalment|card/i.test(dash) && /HDFC/.test(dash), dash.slice(0, 300));

  const accounts = await show('accounts');
  ok('A1 Accounts: groups, the card and the left-out account', /Everyday/.test(accounts) && /Savings & investments/.test(accounts) && /HDFC Credit Card/.test(accounts) && /Office petty cash/.test(accounts), accounts.slice(0, 300));

  const budgets = await show('budgets');
  ok('A1 Budgets: top card and eight budgets', !!v.querySelector('.budget-summary') && v.querySelectorAll('[onclick^="window.__app.openBudgetDetail"]').length === 8);
  ok('A1 Budgets: pace marks, bills still to come, a trip that starts later', v.querySelectorAll('.budget-pace-mark').length >= 4 && !!v.querySelector('.budget-due-line') && /Starts /.test(budgets), budgets.slice(0, 400));

  const debts = await show('debts');
  ok('A1 Debts: the family loan is one instalment behind', /Behind ₹\s?10,000/.test(debts), (debts.match(/Behind[^P]*/) || [''])[0]);
  ok('A1 Debts: the family loan, Imran, and the claims', /Mustafa bhai/.test(debts) && /Imran/.test(debts) && /Pune client visit/.test(debts) && /Clinic visit/.test(debts), debts.slice(0, 500));

  const inv = await show('investments');
  ok('A1 Investments: gold, silver, TCS and Infosys', /24k gold coins/.test(inv) && /Silver bar/.test(inv) && /Tata Consultancy Services/.test(inv) && /Infosys/.test(inv), inv.slice(0, 400));

  const bills = await show('calendar', () => app.setCalTab('bills'));
  ok('A1 Regulars → Bills: electricity coming up, rent, the paused gym', /Tata Power/.test(bills) && /Kapoor/.test(bills) && /Cult\.fit/.test(bills), bills.slice(0, 500));
  const deliveries = await show('calendar', () => app.setCalTab('deliveries'));
  ok('A1 Regulars → Deliveries: milk and newspaper with something owed', /Milk/.test(deliveries) && /Newspaper/.test(deliveries) && /₹/.test(deliveries), deliveries.slice(0, 400));
  const shortcuts = await show('calendar', () => app.setCalTab('shortcuts'));
  ok('A1 Regulars → Shortcuts: chai and auto', /Chai/.test(shortcuts) && /Auto/.test(shortcuts));

  const habits = await show('reports', () => app.setReportTab('habits'));
  ok('A1 Reports → Habits: food delivery and cabs', /Food delivery/.test(habits) && /Cabs & autos/.test(habits), habits.slice(0, 400));
  const overview = await show('reports', () => app.setReportTab('overview'));
  ok('A1 Reports overview renders', overview.length > 200);

  const txs = await show('transactions');
  ok('A1 Transactions list renders entries', /Swiggy|Zomato|BigBasket|DMart/.test(txs));

  ok('A1 no errors while showing every screen', errors.length === 0, errors.slice(0, 2).join(' | '));

  app.removeSampleData();
  await wait(30);
  const after = app.store.getState();
  const left = ['transactions', 'accounts', 'budgets', 'debts', 'regularItems', 'holdings', 'claims', 'habits', 'accountGroups'].filter((l) => (after[l] || []).length);
  ok('A2 Remove sample data empties the book and keeps the 12 default categories', left.length === 0 && after.categories.length === 12 && !BookCleaner.hasSample(after), `left: ${left.join()} cats ${after.categories.length}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
