/**
 * deliveries.smoke.mjs — pay-later regular items: the usual pattern with
 * exceptions (DeliveryPlan) and what's owed to each vendor (VendorDues).
 *
 *   D1  usual days and quantity; days before tracking starts count nothing
 *   D2  a changed day wins over the usual and over a pause; marking the usual clears the mark
 *   D3  pauses merge and stop deliveries
 *   D4  a price change keeps old days at the old price
 *   D5  period totals and labels
 *   V1  what's owed starts after the last payment, never counted twice
 *   V2  grouped by vendor (two items, one dairy); payments by other items don't count
 *   V3  the statement lists the days, the changes and the total
 *   A1  in the app: the day window shows the deliveries; − / + marks a day; back to usual
 *   A2  pausing; paying the vendor records one expense per item and closes the days
 *   A3  the item form saves the pattern, and a price change keeps the old price for past days
 *   A4  the calendar: Dues tab with Pay / Bill, a mark on a changed day
 *
 * Run: node src/__smoke__/deliveries.smoke.mjs
 */
import { DeliveryPlan } from '../domain/services/DeliveryPlan.js';
import { VendorDues } from '../domain/services/VendorDues.js';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nDeliveries suite');

const milk = {
  id: 'ri_milk', name: 'Milk', vendor: 'Doodhwala', unit: 'L', payLater: true, currency: 'INR',
  usualQty: 1, usualDays: [1, 2, 3, 4, 5, 6], trackFrom: '2026-11-01', defaultAmount: 6400,
};
{
  const p = new DeliveryPlan(milk);
  // 1 Nov 2026 is a Sunday
  ok('D1 Mon–Sat: Sunday off, Monday 1 L', p.qtyOn('2026-11-01') === 0 && p.qtyOn('2026-11-02') === 1 && p.daysLabel === 'Mon–Sat');
  ok('D1 before tracking starts: nothing', p.qtyOn('2026-10-31') === 0 && p.stateOn('2026-10-31') === 'before');
  ok('D1 an item paid each time has no plan', new DeliveryPlan({ ...milk, payLater: false }).qtyOn('2026-11-02') === 0);
  ok('D1 every day when no days are chosen', new DeliveryPlan({ ...milk, usualDays: undefined }).daysLabel === 'Every day');
}
{
  let item = { ...milk };
  item.marks = DeliveryPlan.withMark(item, '2026-11-03', 2);
  item.marks = DeliveryPlan.withMark(item, '2026-11-04', 0);
  item.marks = DeliveryPlan.withMark(item, '2026-11-01', 1); // a Sunday delivery
  const p = new DeliveryPlan(item);
  ok('D2 changed days: 2 L, none, and a Sunday extra', p.qtyOn('2026-11-03') === 2 && p.qtyOn('2026-11-04') === 0 && p.qtyOn('2026-11-01') === 1 && p.stateOn('2026-11-04') === 'changed');
  item.marks = DeliveryPlan.withMark(item, '2026-11-03', 1);
  ok('D2 setting the usual again clears the mark', !('2026-11-03' in item.marks));
  item.pauses = DeliveryPlan.withPause(item, '2026-11-10', '2026-11-12');
  item.marks = DeliveryPlan.withMark(item, '2026-11-11', 1);
  const q = new DeliveryPlan(item);
  ok('D2 a changed day inside a pause still counts', q.qtyOn('2026-11-11') === 1 && q.qtyOn('2026-11-10') === 0);
  item.marks = DeliveryPlan.withMark(item, '2026-11-11', 0);
  ok('D2 marking 0 inside a pause is just the pause (no mark kept)', !('2026-11-11' in item.marks));
  ok('D2 back to usual', !('2026-11-04' in DeliveryPlan.withoutMark(item, '2026-11-04')));
}
{
  let item = { ...milk };
  item.pauses = DeliveryPlan.withPause(item, '2026-11-10', '2026-11-12');
  item.pauses = DeliveryPlan.withPause(item, '2026-11-13', '2026-11-15');
  item.pauses = DeliveryPlan.withPause(item, '2026-11-20', '2026-11-18');
  ok('D3 touching pauses merge; reversed dates are fixed', item.pauses.length === 2 && item.pauses[0].to === '2026-11-15' && item.pauses[1].from === '2026-11-18', JSON.stringify(item.pauses));
  const p = new DeliveryPlan(item);
  ok('D3 paused days bring nothing', p.qtyOn('2026-11-14') === 0 && p.stateOn('2026-11-14') === 'paused');
  ok('D3 a pause can be lifted', DeliveryPlan.withoutPause(item, '2026-11-11').length === 1);
}
{
  let item = { ...milk };
  item.prices = DeliveryPlan.withPrice(item, 6800, '2026-11-16');
  item.defaultAmount = 6800;
  const p = new DeliveryPlan(item);
  ok('D4 old days keep the old price; new days the new one', p.priceOn('2026-11-15') === 6400 && p.priceOn('2026-11-16') === 6800 && p.priceOn('2026-12-01') === 6800);
  item.prices = DeliveryPlan.withPrice(item, 7000, '2026-11-16');
  ok('D4 changing it again from the same day replaces it', item.prices.length === 2 && new DeliveryPlan(item).priceOn('2026-11-20') === 7000, JSON.stringify(item.prices));
}
{
  const item = { ...milk, marks: { '2026-11-03': 2, '2026-11-04': 0 } };
  const t = new DeliveryPlan(item).totals('2026-11-01', '2026-11-07');
  // Mon 2 → 1, Tue 3 → 2, Wed 4 → 0, Thu 5, Fri 6, Sat 7 → 1 each = 6 L on 5 days
  ok('D5 a week: 6 L on 5 days = ₹384', t.qty === 6 && t.days === 5 && t.amount === 38400, JSON.stringify({ q: t.qty, d: t.days, a: t.amount }));
  ok('D5 labels', DeliveryPlan.rangeLabel('2026-11-01', '2026-11-15') === '1–15 Nov 2026' && DeliveryPlan.rangeLabel('2026-10-28', '2026-11-03') === '28 Oct – 3 Nov 2026'
     && new DeliveryPlan(item).qtyLabel(1.5) === '1.5 L');
  ok('D5 dates across a month end', DeliveryPlan.addDays('2026-11-30', 1) === '2026-12-01' && DeliveryPlan.addDays('2027-01-01', -1) === '2026-12-31');
}

const curd = { id: 'ri_curd', name: 'Curd', vendor: 'doodhwala', payLater: true, currency: 'INR', usualQty: 1, usualDays: [0], trackFrom: '2026-11-01', defaultAmount: 3000 };
const paper = { id: 'ri_paper', name: 'Newspaper', payLater: true, currency: 'INR', usualQty: 1, trackFrom: '2026-11-01', defaultAmount: 800 };
const coffee = { id: 'ri_coffee', name: 'Coffee', currency: 'INR', defaultAmount: 2000 };
const state = { regularItems: [milk, curd, paper, coffee], transactions: [
  { id: 't1', regularItemId: 'ri_milk', date: '2026-11-08', amount: 38400, settles: { from: '2026-11-01', to: '2026-11-07', qty: 6 } },
  { id: 't2', regularItemId: 'ri_coffee', date: '2026-11-09', amount: 2000 },
] };
{
  const dues = new VendorDues({ store: { getState: () => state } });
  ok('V1 only pay-later items', dues.items().map((i) => i.id).join() === 'ri_milk,ri_curd,ri_paper');
  ok('V1 owed from the day after the last payment', dues.openFrom(milk) === '2026-11-08' && dues.paidTo('ri_milk') === '2026-11-07' && dues.isPaid(milk, '2026-11-07') && !dues.isPaid(milk, '2026-11-08'));
  const d = dues.due(milk, '2026-11-14');
  ok('V1 8–14 Nov: 6 L = ₹384', d.from === '2026-11-08' && d.qty === 6 && d.amount === 38400, JSON.stringify({ f: d.from, q: d.qty, a: d.amount }));
  ok('V1 nothing open when paid up', dues.due(milk, '2026-11-07') === null);
  const groups = dues.byVendor('2026-11-14');
  const dairy = groups.find((g) => g.vendor === 'Doodhwala');
  ok('V2 milk and curd under one vendor (name case ignored)', dairy && dairy.lines.length === 2 && dairy.amount === 38400 + 2 * 3000, JSON.stringify(dairy && { n: dairy.lines.length, a: dairy.amount }));
  ok('V2 an item without a vendor name is its own vendor; largest first', groups.length === 2 && groups[1].vendor === 'Newspaper' && groups[1].amount === 14 * 800);
  ok('V2 the last payment is shown', dairy.lastPaid?.id === 't1');
  ok('V2 total owed by currency', dues.totalOwed('2026-11-14').INR === 38400 + 6000 + 11200);
  const text = VendorDues.statement(dairy, (m) => `₹${m / 100}`);
  ok('V3 statement: vendor, period, day lines, totals', text.startsWith('Doodhwala') && text.includes('Milk · 8–14 Nov 2026') && text.includes('9 Nov  1 L  ₹64')
     && text.includes('Milk: 6 L on 6 days = ₹384') && text.includes('Total due: ₹444'), text);
}

// ── in the app ────────────────────────────────────────────────────────────
const bundleSrc = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const today = VendorDues.today();
const daysAgo = (n) => DeliveryPlan.addDays(today, -n);
function boot() {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
      <div id="viewContent"></div><div id="sidebarNav"></div><div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
    </body></html>`, { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  window.localStorage.setItem('pocket.v1', JSON.stringify({
    user: { homeCurrency: 'INR', defaultCurrency: 'INR', theme: 'light', showHijri: false, hijriOffset: 0, customPaymentTypes: [], hiddenPaymentTypes: [] },
    accounts: [{ id: 'a1', name: 'Wallet', currency: 'INR', type: 'cash', color: '#3b82f6', icon: 'wallet', openingBalance: 0, balance: 0 }],
    categories: [{ id: 'c1', name: 'Groceries', type: 'expense', parentId: null, color: '#10b981', icon: 'tag' }],
    transactions: [], budgets: [], debts: [], family: [], merchantCategories: {}, accountGroups: [],
    regularItems: [
      { id: 'ri_milk', name: 'Milk', vendor: 'Doodhwala', unit: 'L', payLater: true, currency: 'INR', accountId: 'a1', categoryId: 'c1',
        usualQty: 1, usualDays: [0, 1, 2, 3, 4, 5, 6], trackFrom: daysAgo(9), defaultAmount: 6400, icon: 'coffee', color: '#3b82f6' },
      { id: 'ri_coffee', name: 'Coffee', currency: 'INR', accountId: 'a1', defaultAmount: 2000, icon: 'coffee', color: '#f97316' },
    ],
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
{
  const w = boot();
  await wait(100);
  const app = w.__app;
  app.openModal('dayLogs', { date: daysAgo(3) });
  await wait(30);
  let body = w.document.body.textContent;
  ok('A1 the day window lists the delivery as usual, and keeps coffee for logging', /Deliveries/.test(body) && /Usual · ₹64/.test(body) && w.document.querySelector('#dayLogItem option[value="ri_coffee"]') && !w.document.querySelector('#dayLogItem option[value="ri_milk"]'));
  app.stepDelivery('ri_milk', daysAgo(3), 1);
  app.stepDelivery('ri_milk', daysAgo(2), -1);
  await wait(30);
  let m = app.vendorDues.items()[0];
  ok('A1 + makes it 2 L, − makes another day none', m.marks[daysAgo(3)] === 2 && m.marks[daysAgo(2)] === 0, JSON.stringify(m.marks));
  body = w.document.body.textContent;
  ok('A1 the window shows the change and "Back to usual"', /None today/.test(body) && /Back to usual/.test(body));
  app.resetDelivery('ri_milk', daysAgo(2));
  ok('A1 back to usual clears the mark', !(daysAgo(2) in app.vendorDues.items()[0].marks));

  app.openModal('pauseDeliveries', { itemId: 'ri_milk' });
  await wait(20);
  const pf = w.document.querySelector('form');
  pf.querySelector('[name=from]').value = daysAgo(1); pf.querySelector('[name=to]').value = DeliveryPlan.addDays(today, 3);
  app.submitPause({ preventDefault() {}, target: pf }, 'ri_milk');
  m = app.vendorDues.items()[0];
  ok('A2 a pause is saved and listed', m.pauses.length === 1 && /Coming up/.test(w.document.body.textContent));

  // 10 days (9 ago … today): usual 1 L, +1 three days ago, paused yesterday and today → 8 + 1 = 9 L? (8 usual days + 1 extra)
  const due = app.vendorDues.due(m);
  ok('A2 owed: 9 L = ₹576', due.qty === 9 && due.amount === 57600, JSON.stringify({ q: due.qty, a: due.amount }));
  app.openModal('settle', { vendor: 'Doodhwala' });
  await wait(20);
  const sf = w.document.querySelector('form');
  ok('A2 the pay window: period, amount, account, Bill', /Pay Doodhwala/.test(sf.textContent) && sf.querySelector('[name=amount_ri_milk]').value === '576' && sf.querySelector('[name=account]').value === 'a1' && /Bill/.test(sf.textContent));
  sf.querySelector('[name=amount_ri_milk]').value = '570';
  await app.submitSettle({ preventDefault() {}, target: sf }, 'Doodhwala', today);
  await wait(30);
  const st = JSON.parse(w.localStorage.getItem('pocket.v1'));
  const paid = st.transactions.filter((t) => t.regularItemId === 'ri_milk');
  ok('A2 one expense of the amount paid, covering the days, in the category', paid.length === 1 && paid[0].amount === 57000 && paid[0].type === 'expense' && paid[0].categoryId === 'c1'
     && paid[0].settles.from === daysAgo(9) && paid[0].settles.to === today && paid[0].payee === 'Doodhwala' && paid[0].accountId === 'a1', JSON.stringify(paid[0]));
  ok('A2 nothing owed after paying; paid days are locked', app.vendorDues.due(app.vendorDues.items()[0]) === null && app.vendorDues.isPaid(app.vendorDues.items()[0], daysAgo(3)));
  app.stepDelivery('ri_milk', daysAgo(3), 1);
  ok('A2 a paid day can\'t be changed', app.vendorDues.items()[0].marks[daysAgo(3)] === 2);

  // A3 the item form
  app.openModal('regularItem', { id: 'ri_milk' });
  await wait(20);
  const f = w.document.getElementById('regularItemForm');
  ok('A3 the form opens on "Pay the vendor later" with the pattern', f.querySelector('[name=pay][value=later]').checked && !f.querySelector('[data-later]').hidden
     && f.querySelector('[name=usualQty]').value === '1' && f.querySelectorAll('[name=usualDays]:checked').length === 7 && f.querySelector('[name=vendor]').value === 'Doodhwala');
  f.querySelector('[name=defaultAmount]').value = '68';
  f.querySelector('[name=priceFrom]').value = DeliveryPlan.addDays(today, 1);
  f.querySelectorAll('[name=usualDays]')[0].checked = false; // no Sundays
  app.submitRegularItem({ preventDefault() {}, target: f }, 'ri_milk');
  const after = app.vendorDues.items()[0];
  const plan = new DeliveryPlan(after);
  ok('A3 new price from tomorrow; today keeps ₹64; Sundays off', plan.priceOn(today) === 6400 && plan.priceOn(DeliveryPlan.addDays(today, 1)) === 6800 && plan.daysLabel === 'Mon–Sat' && after.defaultAmount === 6800, JSON.stringify(after.prices));
  app.openModal('regularItem');
  await wait(20);
  const nf = w.document.getElementById('regularItemForm');
  nf.querySelector('[name=name]').value = 'Paper';
  nf.querySelector('[name=defaultAmount]').value = '8';
  nf.querySelector('[name=pay][value=later]').checked = true;
  nf.querySelector('[name=pay][value=each]').checked = false;
  app.submitRegularItem({ preventDefault() {}, target: nf }, '');
  const paper = app.vendorDues.items().find((i) => i.name === 'Paper');
  ok('A3 a new pay-later item counts from today, every day, 1 each', paper && paper.trackFrom === today && paper.usualQty === 1 && paper.usualDays.length === 7 && paper.payLater === true);

  // A4 the calendar
  app.stepDelivery('ri_milk', DeliveryPlan.addDays(today, 5), 3);
  app.navigate?.('calendar');
  w.location.hash = '#calendar';
  await wait(50);
  app.setCalTab('dues');
  await wait(30);
  const v = w.document.getElementById('viewContent').innerHTML;
  ok('A4 Dues tab: vendors with Pay and Bill', /Dues/.test(v) && /Doodhwala/.test(v) && /Paper/.test(v) && /openModal\('settle'/.test(v) && /shareStatement/.test(v), v.slice(0, 300));
  app.setCalTab('grid');
  await wait(30);
  ok('A4 the grid marks a changed day', /cal-mark/.test(w.document.getElementById('viewContent').innerHTML));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
