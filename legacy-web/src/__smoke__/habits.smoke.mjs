/**
 * habits.smoke.mjs — shortcuts in the Add form, and habits in Reports.
 *
 *   S1  shortcuts are the regular items that aren't deliveries
 *   S2  payees logged 4+ times in 60 days without a shortcut are suggested
 *   S3  a shortcut fills the entry and links it to the item
 *   H1  a habit matches by shortcut, by category, or by a whole word
 *   H2  a month's count and amount, compared with the same days of last month
 *   H3  a limit: near at 80%, over past 100%; the note after saving
 *   H4  every shortcut is a habit by itself until a saved one takes it over
 *   H5  suggestions: 5+ times, not dismissed, not already followed
 *   A1  in the app: the Add form shows the shortcut chips; tapping one fills it
 *   A2  Reports → Habits shows the cards; saving a habit; the limit toast
 *   A3  a suggestion can be tracked or dismissed; deleting has Undo
 *   G1  a payee paid about monthly for 3 months is offered as a bill (not if it already repeats)
 *   G2  a payee on 8+ of the last 14 days is offered as a delivery
 *   M1  shortcuts can be found, edited and deleted (Regulars → Shortcuts; a pencil chip in Add)
 *   C1  bills on the calendar: paid green, not paid red, coming up dashed; the day window has Pay
 *   G3  in the app: "Make it a bill" turns the last payment into a monthly repeat; No thanks is remembered
 *
 * Run: node src/__smoke__/habits.smoke.mjs
 */
import { ShortcutService } from '../domain/services/ShortcutService.js';
import { HabitService } from '../domain/services/HabitService.js';
import { SuggestionService } from '../domain/services/SuggestionService.js';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nHabits suite');

const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const TODAY = '2026-11-15';
let n = 0;
const tx = (date, payee, amount, extra = {}) => ({ id: `t${++n}`, type: 'expense', date, payee, amount, currency: 'INR', accountId: 'a1', categoryId: 'c1', ...extra });
const items = [
  { id: 'ri_coffee', name: 'Coffee', defaultAmount: 2000, currency: 'INR', accountId: 'a1', categoryId: 'c2' },
  { id: 'ri_milk', name: 'Milk', payLater: true, currency: 'INR' },
];
const habits = new HabitService({ convert: (m) => m });

{
  ok('S1 shortcuts leave deliveries out', ShortcutService.list({ regularItems: items }).map((i) => i.id).join() === 'ri_coffee');
  const state = { regularItems: items, transactions: [
    ...[1, 5, 9, 20].map((d) => tx(addDays(TODAY, -d), 'Auto', 6000)),
    tx(addDays(TODAY, -2), 'Auto', 8000),
    ...[1, 2, 3].map((d) => tx(addDays(TODAY, -d), 'Swiggy', 30000)),
    ...[1, 2, 3, 4].map((d) => tx(addDays(TODAY, -d), 'coffee', 2000)),
    tx(addDays(TODAY, -70), 'Auto', 6000),
  ] };
  const s = ShortcutService.suggestions(state, TODAY);
  ok('S2 Auto suggested at its usual amount; Swiggy (3) and Coffee (has a shortcut) are not', s.length === 1 && s[0].payee === 'Auto' && s[0].amount === 6000 && s[0].count === 5, JSON.stringify(s));
  const p = ShortcutService.prefill(items[0], [{ id: 'a1' }]);
  ok('S3 prefill: payee, amount, category, account and the item link', p.payee === 'Coffee' && p.amount === 2000 && p.categoryId === 'c2' && p.accountId === 'a1' && p.regularItemId === 'ri_coffee');
  ok('S3 an account that isn\'t yours isn\'t prefilled', !('accountId' in ShortcutService.prefill(items[0], [])));
}
{
  const h = { id: 'h1', name: 'Coffee', words: ['coffee', 'chai'], categoryIds: ['c9'], itemIds: ['ri_coffee'] };
  ok('H1 by shortcut', HabitService.matches(h, tx(TODAY, 'Cafe', 1, { regularItemId: 'ri_coffee' })));
  ok('H1 by category', HabitService.matches(h, tx(TODAY, 'Cafe', 1, { categoryId: 'c9' })));
  ok('H1 by a whole word in the payee or note, any case', HabitService.matches(h, tx(TODAY, 'Morning CHAI', 1)) && HabitService.matches(h, tx(TODAY, 'Cafe', 1, { note: 'filter coffee' })));
  ok('H1 not part of a word, not income', !HabitService.matches(h, tx(TODAY, 'Coffeeshop', 1)) && !HabitService.matches(h, tx(TODAY, 'chai', 1, { type: 'income' })));
}
{
  const h = { id: 'h1', name: 'Coffee', words: ['coffee'], categoryIds: [], itemIds: [], limitCount: 5 };
  const state = { regularItems: [], habits: [h], transactions: [
    tx('2026-11-02', 'Coffee', 2000), tx('2026-11-03', 'Coffee', 2000), tx('2026-11-10', 'Coffee', 2500), tx('2026-11-14', 'Coffee', 2000),
    tx('2026-10-05', 'Coffee', 2000), tx('2026-10-20', 'Coffee', 2000),
    tx('2026-12-01', 'Coffee', 2000),
  ] };
  const st = habits.stats(h, state, TODAY, 'INR');
  ok('H2 this month: 4 times, ₹85, about ₹21.25 each', st.count === 4 && st.amount === 8500 && st.average === 2125, JSON.stringify(st));
  ok('H2 compared with 1–15 Oct (one entry, ₹20): +325%; all of October 2 times', st.change === 325 && st.prevMonthCount === 2, `${st.change} ${st.prevMonthCount}`);
  ok('H2 days, six months of trend, weekdays', st.days.join() === '2026-11-02,2026-11-03,2026-11-10,2026-11-14' && st.trend.length === 6 && st.trend[5].count === 4 && st.weekdays.reduce((a, b) => a + b) === 6);
  ok('H3 4 of 5 is near (80%)', st.limit.state === 'near' && st.limit.countLeft === 1);
  state.transactions.push(tx(TODAY, 'Coffee', 2000));
  const note = habits.noteFor(state.transactions.at(-1), state, TODAY, 'INR', (m) => `₹${m / 100}`);
  ok('H3 the note after the 5th', note === '5th Coffee this month · that\'s your limit', note);
  state.transactions.push(tx(TODAY, 'Coffee', 2000));
  ok('H3 6 of 5 is over', habits.stats(h, state, TODAY, 'INR').limit.state === 'over'
     && habits.noteFor(state.transactions.at(-1), state, TODAY, 'INR', String) === '6th Coffee this month · 1 over your limit');
  const amountHabit = { ...h, limitCount: null, limitAmount: 20000 };
  ok('H3 an amount limit: ₹125 of ₹200 is fine, no note', habits.stats(amountHabit, state, TODAY, 'INR').limit.state === 'ok'
     && habits.noteFor(state.transactions.at(-1), { ...state, habits: [amountHabit] }, TODAY, 'INR', String) === null);
}
{
  const state = { regularItems: items, habits: [], transactions: [] };
  const all = habits.all(state);
  ok('H4 the Coffee shortcut is a habit by itself (not the delivery)', all.length === 1 && all[0].id === 'item:ri_coffee' && all[0].implicit);
  state.habits = [{ id: 'h1', name: 'Caffeine', words: [], categoryIds: [], itemIds: ['ri_coffee'] }];
  ok('H4 a saved habit with that shortcut takes it over', habits.all(state).map((h) => h.id).join() === 'h1');
}
{
  const state = { regularItems: [], habits: [{ id: 'h1', name: 'Swiggy', words: ['swiggy'], categoryIds: [], itemIds: [] }], user: { dismissedHabitSuggestions: ['uber'] },
    transactions: [1, 2, 3, 4, 5].flatMap((d) => [tx(addDays(TODAY, -d), 'Auto', 6000), tx(addDays(TODAY, -d), 'Swiggy', 30000), tx(addDays(TODAY, -d), 'Uber', 20000)]) };
  const s = habits.suggestions(state, TODAY, 'INR');
  ok('H5 Auto suggested; Swiggy is followed; Uber was dismissed', s.length === 1 && s[0].payee === 'Auto' && s[0].count === 5 && s[0].amount === 30000, JSON.stringify(s));
  state.transactions.pop();
  state.transactions = state.transactions.filter((t) => !(t.payee === 'Auto' && t.date === addDays(TODAY, -5)));
  ok('H5 four times isn\'t enough', habits.suggestions(state, TODAY, 'INR').length === 0);
}

{
  const state = { regularItems: [], user: {}, transactions: [
    tx('2026-08-05', 'Airtel', 59900), tx('2026-09-04', 'Airtel', 59900), tx('2026-10-05', 'Airtel', 64900), tx('2026-11-04', 'Airtel', 59900),
    tx('2026-09-10', 'Gym', 150000), tx('2026-10-10', 'Gym', 150000),
    tx('2026-07-01', 'Rent', 2000000), tx('2026-08-01', 'Rent', 2000000), tx('2026-09-01', 'Rent', 2000000),
    tx('2026-10-01', 'Cafe', 1), tx('2026-10-03', 'Cafe', 1), tx('2026-11-01', 'Cafe', 1), tx('2026-11-02', 'Cafe', 1),
  ] };
  let b = SuggestionService.bills(state, TODAY);
  ok('G1 Airtel: 4 months, amount changes; Gym only 2; Rent stopped in Sept', b.length === 1 && b[0].payee === 'Airtel' && b[0].count === 4 && b[0].changes && b[0].last.date === '2026-11-04', JSON.stringify(b.map((x) => [x.payee, x.count])));
  state.transactions.push(tx('2026-11-04', 'airtel', 59900, { recurring: { rule: 'monthly', interval: 1 } }));
  ok('G1 not once it repeats', SuggestionService.bills(state, TODAY).length === 0);
  state.transactions.pop();
  state.user.dismissedSuggestions = [SuggestionService.dismissKey('bill', 'AIRTEL')];
  ok('G1 not once dismissed', SuggestionService.bills(state, TODAY).length === 0);

  const d = { regularItems: [], user: {}, transactions: [
    ...[0, 1, 2, 3, 4, 6, 7, 9].map((k) => tx(addDays(TODAY, -k), 'Paperwala', 1000)),
    ...[0, 1, 2, 3, 4, 5, 6].map((k) => tx(addDays(TODAY, -k), 'Chai', 1500)),
  ] };
  const g = SuggestionService.deliveries(d, TODAY);
  ok('G2 Paperwala on 8 days; Chai on 7 is not enough', g.length === 1 && g[0].payee === 'Paperwala' && g[0].days === 8 && g[0].amount === 1000, JSON.stringify(g));
  d.regularItems.push({ id: 'ri_p', name: 'paperwala', payLater: true });
  ok('G2 not once it\'s a delivery', SuggestionService.deliveries(d, TODAY).length === 0);
}

// ── in the app ────────────────────────────────────────────────────────────
const bundleSrc = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function boot(transactions = [], extra = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
      <div id="viewContent"></div><div id="sidebarNav"></div><div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
    </body></html>`, { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  window.localStorage.setItem('pocket.v1', JSON.stringify({
    user: { homeCurrency: 'INR', defaultCurrency: 'INR', theme: 'light', showHijri: false, hijriOffset: 0, customPaymentTypes: [], hiddenPaymentTypes: [] },
    accounts: [{ id: 'a1', name: 'Wallet', currency: 'INR', type: 'cash', color: '#3b82f6', icon: 'wallet', openingBalance: 0, balance: 0 }],
    categories: [{ id: 'c1', name: 'Food', type: 'expense', parentId: null, color: '#10b981', icon: 'tag' }],
    transactions, budgets: [], debts: [], family: [], merchantCategories: {}, accountGroups: [],
    regularItems: [{ id: 'ri_coffee', name: 'Coffee', currency: 'INR', accountId: 'a1', categoryId: 'c1', defaultAmount: 2000, icon: 'coffee', color: '#f97316' }],
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
const appToday = new Date().toISOString().slice(0, 10);
const recent = (d) => addDays(appToday, -d);
{
  const w = boot([1, 2, 3, 4].map((d) => tx(recent(d), 'Auto', 6000)));
  await wait(100);
  const app = w.__app;
  app.openModal('transaction');
  await wait(20);
  const chips = [...w.document.querySelectorAll('.shortcut-chip')].map((c) => c.textContent.trim());
  ok('A1 the Add form shows Coffee, a suggested Auto, and +', chips.some((c) => c.startsWith('Coffee')) && chips.some((c) => c.startsWith('Auto')) && w.document.querySelector('.shortcut-chip.add'), chips.join(' | '));
  app.useShortcut('ri_coffee');
  await wait(20);
  const f = w.document.querySelector('form');
  ok('A1 tapping Coffee fills payee and amount and links the item', f.querySelector('[name="payee"]').value === 'Coffee' && Number(f.querySelector('[name="amount"]').value) === 20 && f.querySelector('[name="regularItemId"]').value === 'ri_coffee');
  await app.submitTx({ preventDefault() {}, target: f });
  await wait(20);
  const saved = app.store.getState().transactions.at(-1);
  ok('A1 the saved entry keeps the link', saved.payee === 'Coffee' && saved.regularItemId === 'ri_coffee' && saved.amount === 2000);
}
{
  const txs = [...[1, 2, 3, 4, 5].map(() => tx(appToday, 'Swiggy', 30000)), tx(appToday, 'Coffee', 2000, { regularItemId: 'ri_coffee' })];
  const w = boot(txs);
  await wait(100);
  const app = w.__app;
  app.navigate?.('reports');
  await wait(20);
  app.setReportTab('habits');
  await wait(20);
  let body = w.document.getElementById('viewContent').textContent;
  ok('A2 Habits tab: the Coffee shortcut card and a Swiggy suggestion', /Coffee/.test(body) && /1 time/.test(body) && /You logged Swiggy 5 times/.test(body), body.slice(0, 400));
  app.trackSuggestedHabit('Swiggy');
  await wait(20);
  let f = w.document.querySelector('form');
  ok('A3 Track opens the habit form with Swiggy filled in', f.querySelector('[name="name"]').value === 'Swiggy' && f.querySelector('[name="words"]').value === 'Swiggy');
  f.querySelector('[name="limitCount"]').value = '6';
  app.submitHabit({ preventDefault() {}, target: f }, '', '');
  await wait(20);
  const h = app.store.getState().habits[0];
  ok('A2 saved: name, word, limit of 6', h.name === 'Swiggy' && h.words.join() === 'Swiggy' && h.limitCount === 6 && h.id);
  body = w.document.getElementById('viewContent').textContent;
  ok('A2 the card shows the limit and no suggestion now', /of 6 times/.test(body) && !/You logged Swiggy/.test(body));

  app.openModal('transaction');
  await wait(20);
  f = w.document.querySelector('form');
  f.querySelector('[name="payee"]').value = 'Swiggy';
  f.querySelector('[name="amount"]').value = '250';
  await app.submitTx({ preventDefault() {}, target: f });
  await wait(20);
  const toast = w.document.body.textContent;
  ok('A2 adding the 6th shows the limit note', /6th Swiggy this month · that's your limit/.test(toast), toast.match(/Added.{0,60}/)?.[0]);

  app.deleteHabit(h.id);
  await wait(10);
  ok('A3 deleting removes it', app.store.getState().habits.length === 0);
  w.document.querySelector('.toast-action')?.click();
  await wait(10);
  ok('A3 Undo brings it back', app.store.getState().habits.length === 1);

  app.store.getState().habits = [];
  app.dismissHabitSuggestion('Swiggy');
  await wait(10);
  body = w.document.getElementById('viewContent').textContent;
  ok('A3 No thanks hides the suggestion', !/You logged Swiggy/.test(body) && app.store.getState().user.dismissedHabitSuggestions.includes('Swiggy'));

  app.openModal('habit', { id: 'item:ri_coffee' });
  await wait(10);
  f = w.document.querySelector('form');
  f.querySelector('[name="name"]').value = 'Caffeine';
  app.submitHabit({ preventDefault() {}, target: f }, '', 'ri_coffee');
  await wait(10);
  const hs = app.store.getState().habits;
  ok('A2 editing a shortcut\'s own habit saves it, keeping the shortcut', hs.length === 1 && hs[0].name === 'Caffeine' && hs[0].itemIds.includes('ri_coffee')
     && app.habits.all(app.store.getState()).every((x) => x.id !== 'item:ri_coffee'));
}

{
  const months = [93, 62, 31, 2].map((k) => tx(recent(k), 'Airtel', 59900));
  const w = boot(months);
  await wait(100);
  const app = w.__app;
  app.navigate?.('calendar');
  await wait(20);
  app.setCalTab('bills');
  await wait(20);
  let body = w.document.getElementById('viewContent').textContent;
  ok('G3 the Bills tab offers Airtel', /You've paid Airtel once a month for 4 months/.test(body), body.slice(0, 300));
  app.acceptSuggestion('bill', 'Airtel');
  await wait(20);
  const f = w.document.querySelector('form');
  ok('G3 it opens the last payment set to repeat monthly', f.querySelector('[name="recurringEnabled"]').checked && f.querySelector('[name="payee"]').value === 'Airtel');
  await app.submitTx({ preventDefault() {}, target: f }, months[3].id);
  await wait(20);
  const st = app.store.getState();
  const last = st.transactions.find((t) => t.id === months[3].id);
  ok('G3 saved as a monthly repeat; no extra entries; no more suggestion', last.recurring?.rule === 'monthly' && st.transactions.filter((t) => t.payee === 'Airtel').length === 4
     && !/You've paid Airtel/.test(w.document.getElementById('viewContent').textContent), JSON.stringify(last.recurring));

  const w2 = boot([0, 1, 2, 3, 4, 5, 6, 7].map((k) => tx(recent(k), 'Paperwala', 1000)));
  await wait(100);
  w2.__app.navigate?.('calendar');
  w2.__app.setCalTab('deliveries');
  await wait(20);
  ok('G3 the Deliveries tab offers Paperwala', /Paperwala on 8 of the last 14 days/.test(w2.document.getElementById('viewContent').textContent));
  w2.__app.acceptSuggestion('delivery', 'Paperwala');
  await wait(20);
  const rf = w2.document.querySelector('form');
  ok('G3 Track it opens a new delivery with the name and price', rf.querySelector('[name="name"]').value === 'Paperwala' && Number(rf.querySelector('[name="defaultAmount"],[name="amount"]')?.value) === 10, rf.querySelector('[name="defaultAmount"],[name="amount"]')?.value);
  w2.__app.closeModal();
  w2.__app.dismissSuggestion('delivery', 'Paperwala');
  await wait(20);
  ok('G3 No thanks is remembered', !/Paperwala on 8/.test(w2.document.getElementById('viewContent').textContent) && w2.__app.store.getState().user.dismissedSuggestions.includes('delivery:paperwala'));
}

{
  const w = boot();
  await wait(100);
  const app = w.__app;
  app.openModal('transaction');
  await wait(20);
  ok('M1 the Add form has a pencil chip to manage shortcuts', /setCalTab\('shortcuts'\)/.test(w.document.querySelector('.shortcut-row').innerHTML));
  app.closeModal();
  app.navigate('calendar');
  app.setCalTab('shortcuts');
  await wait(20);
  const view = w.document.getElementById('viewContent');
  ok('M1 Regulars → Shortcuts lists Coffee with Edit', /Coffee/.test(view.textContent) && /regularItem',\{id:'ri_coffee'\}/.test(view.innerHTML));
  app.openModal('regularItem', { id: 'ri_coffee' });
  await wait(10);
  app.deleteRegularItem('ri_coffee');
  await wait(20);
  ok('M1 deleting it removes it from the list and from Add', !app.store.getState().regularItems.length && /No shortcuts yet/.test(view.textContent));
}

{
  const first = addDays(appToday, -40);
  const rent = { ...tx(first, 'Electricity', 180000), recurring: { rule: 'monthly', interval: 1, until: null }, askFirst: true };
  const net = { ...tx(addDays(appToday, -31), 'Broadband', 99900), recurring: { rule: 'monthly', interval: 1, until: null } };
  const w = boot([rent, net]);
  await wait(100);
  const app = w.__app;
  const occ = app.bills.occurrences(addDays(appToday, -45), addDays(appToday, 45), appToday);
  const e = occ.filter((o) => o.template.id === rent.id);
  ok('C1 the first date is paid, the next one is not paid yet, later ones are coming up',
     e[0].status === 'paid' && e[1].status === 'overdue' && e.slice(2).every((o) => o.status === 'upcoming'), e.map((o) => `${o.date}:${o.status}`).join(' '));
  ok('C1 an ordinary repeat is paid once copied', occ.filter((o) => o.template.id === net.id && o.date <= appToday).every((o) => o.status === 'paid'));
  app.navigate('calendar');
  app.setCalTab('grid');
  await wait(20);
  const due = e[1].date;
  const view = w.document.getElementById('viewContent');
  if (due.slice(0, 7) === appToday.slice(0, 7)) {
    ok('C1 the grid shows it in red with a count', view.querySelector('.cal-bill.overdue')?.textContent === 'Electricity' && /1 bill to pay/.test(view.textContent));
  } else {
    app.shiftCalMonth(-1); await wait(20);
    ok('C1 the grid shows it in red', view.querySelector('.cal-bill.overdue')?.textContent === 'Electricity');
  }
  app.openModal('dayLogs', { date: due });
  await wait(20);
  ok('C1 the day window lists the bill with Pay', /Electricity/.test(w.document.body.textContent) && /Not paid yet/.test(w.document.body.textContent) && /openModal\('payBill'/.test(w.document.body.innerHTML));
  app.openModal('payBill', { templateId: rent.id, date: due });
  await wait(20);
  const pf = w.document.querySelector('form');
  pf.querySelector('[name="amount"]').value = '1950';
  app.submitBill({ preventDefault() {}, target: pf }, rent.id, due);
  await wait(20);
  ok('C1 once paid it turns green', app.bills.occurrences(due, due, appToday).at(0).status === 'paid');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
