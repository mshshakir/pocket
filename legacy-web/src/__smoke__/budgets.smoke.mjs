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
 *   R1  carry over: unspent up to a cap; overspending only when asked, never below zero
 *   V1  history: the six periods before, newest first; a suggestion from the average, rounded up tidily
 *   V2  set dates: no history; the suggestion scales the usual daily spend
 *   S1  ranking: over, going over, faster than planned, the rest, not started, ended
 *   B1  in the app: the top card adds up monthly budgets and shows spending with no budget
 *   B2  the card that is over its limit comes first
 *   B3  the budget page shows the periods before and who spent it
 *   B4  Suggest fills the limit from past spending
 *   B5  rollover options are saved; overspending carried shows as a minus
 *   T1  Telegram totals: spent, limit, ahead, the period and names only; none when off or not running
 *   T2  the form's Telegram alerts switch: on for new budgets, saved off when unticked
 *
 * Run: node src/__smoke__/budgets.smoke.mjs
 */
import { BudgetPeriod } from '../domain/services/BudgetPeriod.js';
import { BudgetPace } from '../domain/services/BudgetPace.js';
import { BudgetOutlook } from '../domain/services/BudgetOutlook.js';
import { BudgetAdvisor } from '../domain/services/BudgetAdvisor.js';
import { BudgetSummary } from '../domain/services/BudgetSummary.js';
import { BudgetAlertStatus } from '../domain/services/BudgetAlertStatus.js';
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

// ── R, V, S: rollover, history, ranking ─────────────────────────────────
{
  // BudgetService.carry is static; reach it through the bundle-free module.
  const { BudgetService } = await import('../domain/services/BudgetService.js').catch(() => ({}));
  if (BudgetService?.carry) {
    const c = (b, prev) => BudgetService.carry({ amount: 10000, ...b }, prev);
    ok('R1 unspent 4,000 carries in full', c({}, 6000).rollover === 4000 && c({}, 6000).limit === 14000);
    ok('R1 a cap of 1,500 limits it', c({ rolloverCap: 1500 }, 6000).rollover === 1500);
    ok('R1 overspending carries only when asked', c({}, 13000).rollover === 0 && c({ rolloverOverspend: true }, 13000).rollover === -3000 && c({ rolloverOverspend: true }, 13000).limit === 7000);
    ok('R1 never below zero', c({ rolloverOverspend: true }, 50000).limit === 0);
  } else {
    ok('R1 BudgetService loads outside the app', false);
  }
}
{
  const spendBy = { '2026-10': 400000, '2026-09': 300000, '2026-08': 0, '2026-07': 500000 };
  const fake = {
    period: (b, today) => new BudgetPeriod(b, { today }),
    spendBetween: (b, from, to) => (b.period === 'range' ? (to.slice(0, 7) === '2026-11' || true ? 900000 : 0) : (spendBy[from.slice(0, 7)] || 0)),
  };
  const a = new BudgetAdvisor(fake);
  const h = a.history({ period: 'gregorian', categoryIds: ['c'], amount: 350000 }, 6, '2026-11-15');
  ok('V1 six months before, newest first, labelled', h.length === 6 && h[0].label === 'October 2026' && h[0].spent === 400000 && h[5].label === 'May 2026' && h[0].limit === 350000, h.map((x) => x.label).join());
  const sg = a.suggest({ period: 'gregorian', categoryIds: ['c'], currency: 'INR' }, 3, '2026-11-15');
  ok('V1 average of the last 3 with spending (Oct, Sep, Jul = 4,000) → ₹4,000; months with nothing are left out', sg && sg.amount === 400000 && /3 months/.test(sg.basis), JSON.stringify(sg));
  ok('V1 tidy rounding up', BudgetAdvisor.tidy(463000) === 470000 && BudgetAdvisor.tidy(12300) === 13000 && BudgetAdvisor.tidy(5) === 100);
  ok('V1 nothing picked, nothing suggested', a.suggest({ period: 'gregorian', categoryIds: [] }) === null);
  const r = a.suggest({ period: 'range', startDate: '2026-12-01', endDate: '2026-12-10', categoryIds: ['c'], currency: 'INR' }, 3, '2026-11-15');
  ok('V2 set dates: 9,000 over 90 days = 100 a day × 10 days → ₹1,000', r && r.amount === 100000 && a.history({ period: 'range', startDate: '2026-12-01', endDate: '2026-12-10' }, 6, '2026-11-15').length === 0, JSON.stringify(r));

  const act = { status: 'active' };
  const rk = (x) => BudgetSummary.rank({ spent: 0, limit: 1000, due: 0, period: act, paceState: 'on-track', ...x });
  ok('S1 order', rk({ spent: 1000 }) === 0 && rk({ spent: 500, due: 600 }) === 1 && rk({ paceState: 'ahead' }) === 2 && rk({}) === 3
    && rk({ period: { status: 'upcoming' } }) === 4 && rk({ period: { status: 'ended' }, spent: 5000 }) === 5);
}

// ── T: Telegram totals ──────────────────────────────────────────────────
{
  const fake = {
    period: (b, today) => new BudgetPeriod(b, { today }),
    currentSpend: () => 25000,
    effectiveLimit: (b) => ({ limit: b.amount, rollover: 0 }),
    targetCategoryIds: (b) => b.categoryIds,
  };
  const names = { c1: 'Food', c2: 'Home', c3: 'Fun' };
  const of = (b, today = '2026-11-10') => BudgetAlertStatus.of({ currency: 'INR', categoryIds: ['c1'], amount: 30000, period: 'gregorian', ...b }, { budgets: fake, categoryName: (id) => names[id], today });
  const st = of({});
  ok('T1 totals for the period: 250 of 300 on day 10 of 30 is ahead by 150', st && st.key === '2026-11-01…2026-11-30' && st.spent === 25000 && st.limit === 30000 && st.ahead === 15000 && st.name === 'Food' && st.label === 'November' && st.at === '2026-11-10', JSON.stringify(st));
  ok('T1 only totals and names', Object.keys(st).sort().join() === 'ahead,at,currency,from,key,label,limit,name,spent,to');
  ok('T1 none when switched off, before set dates start, or with no limit',
    of({ alerts: false }) === null && of({ period: 'range', startDate: '2026-12-01', endDate: '2026-12-05' }) === null && of({ amount: 0 }) === null);
  ok('T1 names: two shown, the rest counted', BudgetAlertStatus.name(['A', 'B', 'C', 'D']) === 'A, B +2' && of({ categoryIds: ['c1', 'c2'] }).name === 'Food, Home');
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
  ok('A3 four periods without the Hijri add-on', kinds === 'gregorian,week,year,range', kinds);
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

{
  const lastMonth = new BudgetPeriod({ period: 'gregorian' }, { today: addDays(month.from, -1) });
  const w = boot({
    family: [{ id: 'fm1', email: 'wife@example.com', name: 'Sakina', initials: 'S', color: '#f00', permissions: [] }],
    transactions: [
      tx('f1', today, 50000, 'c1'),                                         // Food: over its 400
      tx('f2', today, 2500, 'c1', { addedBy: 'wife@example.com' }),
      tx('h1', today, 30000, 'c2'),                                         // Home: no budget
      tx('lm', lastMonth.from, 120000, 'c1'),                               // last month's food
    ],
    budgets: [
      { id: 'bA', categoryIds: ['c2'], categoryId: 'c2', amount: 0, currency: 'INR', period: 'year', rollover: false },
      { id: 'bF', categoryIds: ['c1'], categoryId: 'c1', amount: 40000, currency: 'INR', period: 'gregorian', rollover: false },
    ].slice(1),
  });
  await wait(100);
  const app = w.__app;
  app.navigate('budgets');
  await wait(30);
  const v = w.document.querySelector('#viewContent');
  const sum = v.querySelector('.budget-summary')?.textContent.replace(/\s+/g, ' ') || '';
  ok('B1 monthly budgets: ₹525 of ₹400', /Monthly budgets \(1\)/.test(sum) && /₹\s?525/.test(sum) && /of ₹\s?400/.test(sum), sum);
  ok('B1 Home has no budget: ₹300 spent with no budget, named', /Spent with no budget this month ₹\s?300/.test(sum) && /Home ₹\s?300/.test(sum), sum);

  // B2: add a calm budget first in the list; the over one still comes first.
  app.store.getState().budgets.unshift({ id: 'bH', categoryIds: ['c2'], categoryId: 'c2', amount: 10000000, currency: 'INR', period: 'year', rollover: false });
  app.navigate('budgets');
  await wait(30);
  const order = [...v.querySelectorAll('[onclick^="window.__app.openBudgetDetail"]')].map((el) => el.getAttribute('onclick').match(/'(b\w+)'/)[1]);
  ok('B2 the over-limit Food budget is shown before the calm Home one', order[0] === 'bF' && order.includes('bH'), order.join());

  app.openBudgetDetail('bF');
  await wait(30);
  const page = v.textContent.replace(/\s+/g, ' ');
  ok('B3 periods before: last month ₹1,200 of ₹400', !!v.querySelector('.budget-history') && /₹\s?1,200(\.00)? \/ ₹\s?400/.test(page), page.slice(0, 400));
  ok('B3 by person: You ₹500, Sakina ₹25', /By person You ₹\s?500(\.00)? Sakina ₹\s?25/.test(page), (v.querySelector('.budget-by-person')?.textContent || '').replace(/\s+/g, ' '));

  app.openModal('budget');
  await wait(20);
  const f = w.document.querySelector('form');
  const pick = (form, id) => { form.querySelectorAll('[name="categoryIds"]').forEach((i) => i.remove()); const inp = w.document.createElement('input'); inp.type = 'hidden'; inp.name = 'categoryIds'; inp.value = id; form.appendChild(inp); };
  app.suggestBudgetLimit(f);
  ok('B4 asks for categories first', /Pick categories first/.test(f.querySelector('#budgetSuggest').textContent));
  pick(f, 'c1');
  app.suggestBudgetLimit(f);
  ok('B4 fills ₹1,200 from last month', Number(f.querySelector('[name="amount"]').value) === 1200 && /average over the last 1 month/.test(f.querySelector('#budgetSuggest').textContent), `${f.querySelector('[name="amount"]').value} ${f.querySelector('#budgetSuggest').textContent}`);

  // B5: save Food with rollover incl. overspending: last month 1,200 of 400 → −400 (not below zero)
  app.openModal('budget', { id: 'bF' });
  await wait(20);
  const f2 = w.document.querySelector('form');
  f2.querySelector('[name="rollover"]').checked = true;
  f2.querySelector('[name="rolloverOverspend"]').checked = true;
  f2.querySelector('[name="rolloverCap"]').value = '100';
  app.submitBudget({ preventDefault() {}, target: f2 }, 'bF');
  const bF = app.store.getState().budgets.find((b) => b.id === 'bF');
  ok('B5 saved: rollover with overspending, cap ₹100', bF.rollover === true && bF.rolloverOverspend === true && bF.rolloverCap === 10000, JSON.stringify(bF));
  app.navigate('budgets');
  await wait(30);
  const card = [...v.querySelectorAll('.card')].find((c) => /incl\. overspending/.test(c.textContent))?.textContent.replace(/\s+/g, ' ') || '';
  ok('B5 the card shows the limit taken to zero, (−₹400)', /\/ ₹\s?0(\.00)? \(−₹\s?400/.test(card), card.slice(0, 200));
}

{
  const w = boot();
  await wait(100);
  const app = w.__app;
  app.openModal('budget');
  await wait(20);
  const f = w.document.querySelector('form');
  ok('T2 Telegram alerts ticked for a new budget', f.querySelector('[name="alerts"]').checked === true);
  f.querySelectorAll('[name="categoryIds"]').forEach((i) => i.remove());
  const inp = w.document.createElement('input'); inp.type = 'hidden'; inp.name = 'categoryIds'; inp.value = 'c1'; f.appendChild(inp);
  f.querySelector('[name="amount"]').value = '100';
  app.submitBudget({ preventDefault() {}, target: f });
  const b = app.store.getState().budgets[0];
  ok('T2 saved with alerts on', b && b.alerts === true, JSON.stringify(b));
  app.openModal('budget', { id: b.id });
  await wait(20);
  const f2 = w.document.querySelector('form');
  f2.querySelector('[name="alerts"]').checked = false;
  app.submitBudget({ preventDefault() {}, target: f2 }, b.id);
  ok('T2 unticked is saved off', app.store.getState().budgets[0].alerts === false);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
