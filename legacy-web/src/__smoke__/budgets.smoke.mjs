/**
 * budgets.smoke.mjs — budget periods, pace, and what's still to come.
 *
 *   P1  month, week (Mon–Sun), year and set dates give the right window
 *   P2  where today sits: days gone, days left, upcoming / active / ended
 *   P3  the window before (rollover) for month, week, year; none for dates
 *   P4  labels; a broken date range falls back to a month
 *   K1  pace: on track within 3%, ahead, below, over; per-day after bills
 *   K2  no pace before a dated budget starts, after it ends, or for one day
 *   O1  still to come: unpaid bills in the window for the budget's categories
 *   O2  a split bill counts only its legs in the budget
 *   O3  deliveries: owed so far plus the rest of the window; nothing once ended
 *   F1  stored fields: rollover dropped and dates kept only for set dates
 *   A1  in the app: a card shows the pace mark, the pace line and the bill still to come
 *   A2  a week budget counts only this week; a set-dates budget only its dates
 *   A3  the form offers five periods; set dates need valid dates; editing back to a month drops them
 *   A4  rollover over a week uses last week
 *
 * Run: node src/__smoke__/budgets.smoke.mjs
 */
import { BudgetPeriod } from '../domain/services/BudgetPeriod.js';
import { BudgetPace } from '../domain/services/BudgetPace.js';
import { BudgetOutlook } from '../domain/services/BudgetOutlook.js';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nBudgets suite');

const P = (budget, today) => new BudgetPeriod(budget, { today });

// ── P: periods ──────────────────────────────────────────────────────────
{
  const m = P({ period: 'gregorian' }, '2026-11-15');
  ok('P1 month: 1–30 Nov, 30 days', m.from === '2026-11-01' && m.to === '2026-11-30' && m.days === 30);
  const feb = P({ period: 'gregorian' }, '2028-02-10');
  ok('P1 month: leap February ends on the 29th', feb.to === '2028-02-29');
  const w = P({ period: 'week' }, '2026-11-15'); // a Sunday
  ok('P1 week: Sunday belongs to the week from Monday 9 Nov', w.from === '2026-11-09' && w.to === '2026-11-15' && w.days === 7, `${w.from}…${w.to}`);
  const w2 = P({ period: 'week' }, '2026-11-16'); // Monday
  ok('P1 week: Monday starts a new one', w2.from === '2026-11-16' && w2.to === '2026-11-22');
  const y = P({ period: 'year' }, '2026-11-15');
  ok('P1 year: whole calendar year', y.from === '2026-01-01' && y.to === '2026-12-31' && y.days === 365);
  const r = P({ period: 'range', startDate: '2026-12-01', endDate: '2026-12-10' }, '2026-11-15');
  ok('P1 set dates: exactly those days', r.from === '2026-12-01' && r.to === '2026-12-10' && r.days === 10);

  ok('P2 month on the 15th: 15 gone, 16 to go today included, 15 after today', m.elapsed === 15 && m.remaining === 16 && m.daysAfterToday === 15 && m.status === 'active');
  ok('P2 dates not started: upcoming, nothing gone', r.status === 'upcoming' && r.elapsed === 0 && r.remaining === 10);
  const rEnd = P({ period: 'range', startDate: '2026-11-01', endDate: '2026-11-10' }, '2026-11-15');
  ok('P2 dates over: ended, nothing left', rEnd.status === 'ended' && rEnd.remaining === 0 && rEnd.daysAfterToday === 0);
  ok('P2 contains', r.contains('2026-12-01') && r.contains('2026-12-10') && !r.contains('2026-12-11') && !r.contains('2026-11-30'));

  const pm = P({ period: 'gregorian' }, '2026-01-20').previous();
  ok('P3 month before January is last December', pm.from === '2025-12-01' && pm.to === '2025-12-31');
  const pw = w.previous();
  ok('P3 week before', pw.from === '2026-11-02' && pw.to === '2026-11-08');
  ok('P3 year before', y.previous().from === '2025-01-01' && y.previous().to === '2025-12-31');
  ok('P3 set dates: no window before, no rollover', r.previous() === null && r.repeats === false);
  const h = P({ period: 'hijri' }, '2026-11-15');
  const hp = h.previous();
  ok('P3 Hijri: window of 29–30 days with the month before right behind it', h.days >= 29 && h.days <= 30 && hp.to === BudgetPeriod.addDays(h.from, -1) && h.contains('2026-11-15'));

  ok('P4 labels', m.label === 'November' && w.label === '9–15 Nov' && y.label === '2026' && r.label === '1–10 Dec 2026', [m.label, w.label, y.label, r.label].join(' | '));
  ok('P4 range across years', BudgetPeriod.rangeLabel('2026-12-30', '2027-01-02', true) === '30 Dec 2026 – 2 Jan 2027');
  const bad = P({ period: 'range', startDate: '2026-12-10', endDate: '2026-12-01' }, '2026-11-15');
  ok('P4 end before start falls back to the month', bad.kind === 'gregorian' && bad.from === '2026-11-01');
  ok('P4 unknown kind is a month', P({ period: 'fortnight' }, '2026-11-15').kind === 'gregorian');
}

// ── K: pace ─────────────────────────────────────────────────────────────
{
  const period = P({ period: 'gregorian' }, '2026-11-15'); // 15/30 gone → plan is half
  const pace = (spent, due = 0, limit = 30000) => new BudgetPace({ limit, spent, due, period });
  ok('K1 half the limit on day 15 of 30 is on track', pace(15000).state === 'on-track' && pace(15000).markerPct === 50);
  ok('K1 within 3% still on track', pace(15800).state === 'on-track');
  ok('K1 ahead by 3,000', pace(18000).state === 'ahead' && pace(18000).ahead === 3000);
  ok('K1 below by 5,000', pace(10000).state === 'behind' && pace(10000).ahead === -5000);
  ok('K1 bills still to come that pass the limit make it over', pace(15000, 16000).state === 'over' && !pace(15000, 16000).overLimit);
  ok('K1 per day after bills: (30,000 − 12,000 − 2,000) ÷ 16 days = 1,000', pace(12000, 2000).perDay === 1000, String(pace(12000, 2000).perDay));
  ok('K1 nothing per day once it is all spent', pace(31000).perDay === 0 && pace(31000).overLimit);

  const up = P({ period: 'range', startDate: '2026-12-01', endDate: '2026-12-10' }, '2026-11-15');
  const end = P({ period: 'range', startDate: '2026-11-01', endDate: '2026-11-10' }, '2026-11-15');
  const one = P({ period: 'range', startDate: '2026-11-15', endDate: '2026-11-15' }, '2026-11-15');
  ok('K2 no pace before, after, or for a single day',
    [up, end, one].every((p) => !new BudgetPace({ limit: 1000, spent: 500, period: p }).applies && new BudgetPace({ limit: 1000, spent: 500, period: p }).markerPct === null));
}

// ── O: still to come ────────────────────────────────────────────────────
{
  const TODAY = '2026-11-15';
  const fakeBudgets = {
    countedCategoryIds: () => new Set(['c_rent', 'c_milk']),
    period: (b, today) => new BudgetPeriod(b, { today }),
  };
  const fx = { convert: (m, from, to) => (from === to ? m : m * 2) };
  const rent = { id: 'r', type: 'expense', payee: 'Rent', categoryId: 'c_rent', currency: 'INR' };
  const netflix = { id: 'n', type: 'expense', payee: 'Netflix', categoryId: 'c_fun', currency: 'INR' };
  const split = { id: 's', type: 'expense', payee: 'Society', currency: 'INR', splits: [{ categoryId: 'c_rent', amount: 3000 }, { categoryId: 'c_fun', amount: 1000 }] };
  const salary = { id: 'i', type: 'income', payee: 'Salary', categoryId: 'c_rent', currency: 'INR' };
  const bills = {
    occurrences: (from, to) => [
      { template: rent, date: '2026-11-01', status: 'paid', amount: 50000, currency: 'INR' },
      { template: rent, date: '2026-11-12', status: 'overdue', amount: 1000, currency: 'INR' },
      { template: rent, date: '2026-11-20', status: 'upcoming', amount: 2000, currency: 'USD' },
      { template: netflix, date: '2026-11-21', status: 'upcoming', amount: 649, currency: 'INR' },
      { template: split, date: '2026-11-25', status: 'upcoming', amount: 8000, currency: 'INR' },
      { template: salary, date: '2026-11-28', status: 'upcoming', amount: 99999, currency: 'INR' },
      { template: rent, date: '2026-11-29', status: 'paused', amount: 5000, currency: 'INR' },
    ].filter((o) => o.date >= from && o.date <= to),
  };
  const milk = { id: 'ri_milk', name: 'Milk', categoryId: 'c_milk', currency: 'INR' };
  const paper = { id: 'ri_paper', name: 'Paper', categoryId: 'c_other', currency: 'INR' };
  let asked = null;
  const vendorDues = {
    items: () => [milk, paper],
    due: (item, upTo) => (item === milk ? { amount: 700 } : { amount: 300 }),
    plan: () => ({ totals: (from, to) => { asked = [from, to]; return { amount: 1500 }; } }),
  };
  const o = new BudgetOutlook({ budgets: fakeBudgets, bills, vendorDues, fx });
  const res = o.stillDue({ period: 'gregorian', currency: 'INR' }, TODAY);
  const names = res.items.map((i) => `${i.name}:${i.amount}`);
  ok('O1 overdue and upcoming rent count (USD converted); paid, paused, other categories and income do not',
    names.includes('Rent:1000') && names.includes('Rent:4000') && !names.some((n) => n.startsWith('Netflix') || n.startsWith('Salary')) && res.items.filter((i) => i.name === 'Rent').length === 2, names.join(' '));
  ok('O2 the split bill counts its rent leg only: 8,000 × 3/4', names.includes('Society:6000'));
  ok('O3 milk: 700 owed + 1,500 for 16–30 Nov; paper is another category', names.includes('Milk:2200') && !names.some((n) => n.startsWith('Paper')) && asked?.join() === '2026-11-16,2026-11-30', `${names.join(' ')} ${asked}`);
  ok('O3 total', res.total === 1000 + 4000 + 6000 + 2200, String(res.total));
  const ended = o.stillDue({ period: 'range', startDate: '2026-11-01', endDate: '2026-11-10', currency: 'INR' }, TODAY);
  ok('O3 nothing still to come once the dates are over', ended.total === 0 && ended.items.length === 0);
  const none = new BudgetOutlook({ budgets: fakeBudgets, fx }).stillDue({ period: 'week', currency: 'INR' }, TODAY);
  ok('O1 works without bills or deliveries', none.total === 0);
}

// ── in the app ──────────────────────────────────────────────────────────
const bundleSrc = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const addDays = (iso, n) => BudgetPeriod.addDays(iso, n);
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
function boot(extra = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
      <div id="viewContent"></div><div id="sidebarNav"></div><div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
    </body></html>`, { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  window.localStorage.setItem('pocket.v1', JSON.stringify({
    user: { homeCurrency: 'INR', defaultCurrency: 'INR', theme: 'light', showHijri: false, hijriOffset: 0, customPaymentTypes: [], hiddenPaymentTypes: [] },
    accounts: [{ id: 'a1', name: 'Wallet', currency: 'INR', type: 'cash', color: '#3b82f6', icon: 'wallet', openingBalance: 0, balance: 0 }],
    categories: [
      { id: 'c1', name: 'Food', type: 'expense', parentId: null, color: '#10b981', icon: 'tag' },
      { id: 'c2', name: 'Home', type: 'expense', parentId: null, color: '#6366f1', icon: 'home' },
    ],
    transactions: [], budgets: [], debts: [], family: [], merchantCategories: {}, accountGroups: [], regularItems: [],
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
const tx = (id, date, amount, categoryId = 'c1', extra = {}) => ({ id, type: 'expense', date, amount, currency: 'INR', accountId: 'a1', categoryId, ...extra });
const week = new BudgetPeriod({ period: 'week' }, { today });
const month = new BudgetPeriod({ period: 'gregorian' }, { today });
{
  // A monthly Home budget with an "ask me" rent bill due tomorrow (when
  // tomorrow is still this month and a day every month has).
  const tomorrow = addDays(today, 1);
  const billDay = tomorrow <= month.to && Number(tomorrow.slice(8, 10)) <= 28 ? tomorrow : null;
  const txs = [tx('t1', today, 1000, 'c2')];
  if (billDay) {
    const prev = new BudgetPeriod({ period: 'gregorian' }, { today: addDays(month.from, -1) }).from.slice(0, 8) + billDay.slice(8, 10);
    txs.push({ ...tx('bill', prev, 25000, 'c2', { payee: 'Rent' }), recurring: { rule: 'monthly', interval: 1, until: null }, askFirst: true });
  }
  const w = boot({ transactions: txs, budgets: [{ id: 'b1', categoryIds: ['c2'], categoryId: 'c2', amount: 6000000, currency: 'INR', period: 'gregorian', rollover: false }] });
  await wait(100);
  const app = w.__app;
  app.navigate('budgets');
  await wait(30);
  const card = w.document.querySelector('#viewContent');
  ok('A1 the card has the pace mark (when the month has more than one day gone or to go)', !!card.querySelector('.budget-pace-mark'));
  ok('A1 the pace line says something plain', /On track|below plan|faster than planned|over the limit/.test(card.querySelector('.budget-pace')?.textContent || ''), card.querySelector('.budget-pace')?.textContent);
  if (billDay) {
    const dueLine = card.querySelector('.budget-due-line')?.textContent || '';
    ok('A1 the rent still to come shows on the card', /still to come/.test(dueLine) && /1 bill/.test(dueLine) && !!card.querySelector('.budget-due'), dueLine.trim());
    app.openBudgetDetail('b1');
    await wait(30);
    ok('A1 the budget page lists it by name', /Rent/.test(w.document.querySelector('#viewContent').textContent));
  } else {
    ok('A1 (no day left this month to put a bill on)', true);
  }
}
{
  const before = addDays(week.from, -1);
  const w = boot({
    transactions: [tx('in', today, 2000), tx('old', before, 9000), tx('dec', addDays(today, 40), 7000)],
    budgets: [
      { id: 'bw', categoryIds: ['c1'], categoryId: 'c1', amount: 1000000, currency: 'INR', period: 'week', rollover: true },
      { id: 'br', categoryIds: ['c1'], categoryId: 'c1', amount: 1000000, currency: 'INR', period: 'range', startDate: addDays(today, 38), endDate: addDays(today, 45), rollover: false },
    ],
  });
  await wait(100);
  const app = w.__app;
  const svc = { spent: (id) => { app.openBudgetDetail(id); return w.document.querySelector('#viewContent').textContent; } };
  const weekText = svc.spent('bw');
  ok('A2 the week budget counts this week only (₹20, not last week\'s ₹90)', /₹\s?20(\.00)?\b/.test(weekText) && !/₹\s?110/.test(weekText), weekText.replace(/\s+/g, ' ').slice(0, 200));
  ok('A4 rollover over a week: last week had ₹90 of ₹10,000 → +₹9,910', /\+₹\s?9,910/.test(weekText), weekText.replace(/\s+/g, ' ').slice(0, 240));
  const rangeText = svc.spent('br');
  ok('A2 the set-dates budget counts only its days (₹70) and says when it starts', /₹\s?70(\.00)?\b/.test(rangeText) && /Starts /.test(rangeText), rangeText.replace(/\s+/g, ' ').slice(0, 200));
}
{
  const w = boot();
  await wait(100);
  const app = w.__app;
  app.openModal('budget');
  await wait(20);
  const f = w.document.querySelector('form');
  const kinds = [...f.querySelectorAll('input[name="period"]')].map((i) => i.value).join();
  ok('A3 five periods', kinds === 'gregorian,hijri,week,year,range', kinds);
  ok('A3 dates hidden until Set dates is picked', f.querySelector('#budgetRange').classList.contains('hidden'));
  f.querySelector('input[value="range"]').checked = true;
  // jsdom here doesn't run inline handlers; run the group's onchange as the browser would.
  const group = f.querySelector('#budgetPeriods');
  new w.Function(group.getAttribute('onchange')).call(group);
  ok('A3 picking Set dates shows the dates and hides rollover', !f.querySelector('#budgetRange').classList.contains('hidden') && f.querySelector('#budgetRollover').classList.contains('hidden'));
  // pick a category the way the picker does: a hidden input named categoryIds
  const pick = (form) => { form.querySelectorAll('[name="categoryIds"]').forEach((i) => i.remove()); const inp = w.document.createElement('input'); inp.type = 'hidden'; inp.name = 'categoryIds'; inp.value = 'c1'; form.appendChild(inp); };
  pick(f);
  f.querySelector('[name="amount"]').value = '500';
  f.querySelector('[name="startDate"]').value = '2026-12-10';
  f.querySelector('[name="endDate"]').value = '2026-12-01';
  f.querySelector('[name="rollover"]').checked = true;
  app.submitBudget({ preventDefault() {}, target: f });
  ok('A3 end before start is refused', app.store.getState().budgets.length === 0);
  f.querySelector('[name="endDate"]').value = '2026-12-12';
  app.submitBudget({ preventDefault() {}, target: f });
  const b = app.store.getState().budgets[0];
  ok('A3 F1 saved with its dates and no rollover', b && b.period === 'range' && b.startDate === '2026-12-10' && b.endDate === '2026-12-12' && b.rollover === false, JSON.stringify(b));
  app.openModal('budget', { id: b.id });
  await wait(20);
  const f2 = w.document.querySelector('form');
  ok('A3 editing opens on Set dates with its dates', f2.querySelector('input[value="range"]').checked && f2.querySelector('[name="startDate"]').value === '2026-12-10');
  f2.querySelector('input[value="year"]').checked = true;
  app.submitBudget({ preventDefault() {}, target: f2 }, b.id);
  const b2 = app.store.getState().budgets[0];
  ok('A3 F1 back to a year drops the dates', b2.period === 'year' && !('startDate' in b2) && !('endDate' in b2), JSON.stringify(b2));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
