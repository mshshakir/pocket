/**
 * pause-repeats.smoke.mjs — pausing a repeating entry or bill.
 *
 *   P1  RepeatPause: inside / outside, open-ended, merging, resume keeps past days
 *   P2  a paused monthly repeat makes no copies in the pause, and none later after resuming
 *   P3  a paused "ask me" bill isn't due; Bills shows "Paused until …" with Resume
 *   P4  in the app: Pause for 2 months from the Bills list; Resume; pause until I resume
 *   P5  copies and payments don't carry the pause
 *
 * Run: node src/__smoke__/pause-repeats.smoke.mjs
 */
import { RepeatPause } from '../domain/services/RepeatPause.js';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nPause repeats suite');

{
  const t = { pauses: [{ from: '2026-12-01', to: '2026-12-31' }] };
  ok('P1 inside and outside a pause', RepeatPause.on(t, '2026-12-15') && !RepeatPause.on(t, '2027-01-01') && !RepeatPause.on(t, '2026-11-30'));
  const open = { pauses: RepeatPause.withPause({}, '2027-02-01', null) };
  ok('P1 until I resume covers every later day', RepeatPause.on(open, '2030-01-01') && !RepeatPause.on(open, '2027-01-31'));
  const merged = RepeatPause.withPause(t, '2027-01-01', '2027-01-15');
  ok('P1 touching pauses merge', merged.length === 1 && merged[0].to === '2027-01-15', JSON.stringify(merged));
  const r = RepeatPause.resumed({ pauses: [{ from: '2026-11-01', to: null }, { from: '2027-03-01', to: '2027-03-10' }] }, '2026-11-20');
  ok('P1 resume: the running pause ends yesterday (kept); a later one stays', r.length === 2 && r[0].to === '2026-11-19' && r[1].from === '2027-03-01', JSON.stringify(r));
  const r2 = RepeatPause.resumed({ pauses: [{ from: '2026-12-01', to: null }] }, '2026-11-20');
  ok('P1 resume before a pause starts removes it', r2.length === 0);
  ok('P1 label', RepeatPause.label({ pauses: [{ from: '2026-11-01', to: null }] }, '2026-11-20', (d) => d) === 'Paused until you resume'
    && RepeatPause.label(t, '2026-11-20', (d) => d) === 'Pauses 2026-12-01 – 2026-12-31');
}

const bundleSrc = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addMonths = (n) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n); return iso(d); };
const TODAY = iso(new Date());
const start = addMonths(-6);           // 1st of the month, 6 months ago
const pauseFrom = addMonths(-4), pauseTo = iso(new Date(new Date(addMonths(-2) + 'T12:00:00').getTime() - 86400000)); // 2 months
function boot() {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
      <div id="viewContent"></div><div id="sidebarNav"></div><div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
    </body></html>`, { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  window.localStorage.setItem('pocket.v1', JSON.stringify({
    user: { homeCurrency: 'INR', defaultCurrency: 'INR', theme: 'light', showHijri: false, hijriOffset: 0, customPaymentTypes: [], hiddenPaymentTypes: [], defaultAccountId: 'bank' },
    accounts: [{ id: 'bank', name: 'HDFC', currency: 'INR', type: 'bank', color: '#3b82f6', icon: 'landmark', openingBalance: 50000000, balance: 50000000 }],
    categories: [],
    transactions: [
      { id: 'rent', type: 'expense', amount: 2000000, currency: 'INR', accountId: 'bank', payee: 'Rent', date: start, recurring: { rule: 'monthly', interval: 1, until: null }, pauses: [{ from: pauseFrom, to: pauseTo }], tags: [] },
      { id: 'elec', type: 'expense', amount: 150000, currency: 'INR', accountId: 'bank', payee: 'Electricity', date: start, recurring: { rule: 'monthly', interval: 1, until: null }, askFirst: true, tags: [] },
    ],
    budgets: [], debts: [], family: [], merchantCategories: {}, accountGroups: [], regularItems: [],
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
const w = boot();
await wait(100);
const app = w.__app;
const st = () => app.store.getState();
const view = () => w.document.getElementById('viewContent');
const copies = (id) => st().transactions.filter((t) => t.recurringSourceId === id).map((t) => t.date).sort();

{
  const c = copies('rent');
  ok('P2 rent: no copies in the 2 paused months, copies either side', c.length === 4 && !c.some((d) => d >= pauseFrom && d <= pauseTo), JSON.stringify(c));
  ok('P5 copies don\'t carry the pause', st().transactions.filter((t) => t.recurringSourceId === 'rent').every((t) => t.pauses === undefined));

  app.navigate('calendar'); app.setCalTab('bills');
  await wait(10);
  const before = app.bills.due(TODAY).filter((d) => d.template.id === 'elec').length;
  ok('P3 electricity has bills due (asks each time)', before >= 6, String(before));
  const row = () => [...view().querySelectorAll('.p-3')].find((r) => /Electricity/.test(r.textContent));
  ok('P4 Bills list has Pause', !!row()?.querySelector('.repeat-pause'));
  app.openModal('pauseRepeat', { id: 'elec' });
  await wait(10);
  const f = w.document.querySelector('form.pause-repeat-form');
  f.querySelector('[name="from"]').value = start;
  f.querySelector('[name="length"][value="open"]').checked = true;
  app.submitRepeatPause({ preventDefault() {}, target: f }, 'elec');
  await wait(10);
  ok('P3 paused until I resume: nothing due', app.bills.due(TODAY).filter((d) => d.template.id === 'elec').length === 0);
  app.navigate('calendar'); app.setCalTab('bills');
  await wait(10);
  ok('P3 Bills shows "Paused until you resume" and Resume (not "ended")', /Paused until you resume/.test(row()?.textContent || '') && !!row()?.querySelector('.repeat-resume') && !/ended/.test(row().textContent));
  app.resumeRepeat('elec');
  await wait(10);
  const el = st().transactions.find((t) => t.id === 'elec');
  ok('P4 Resume: the pause ends yesterday and is kept', el.pauses.length === 1 && el.pauses[0].to < TODAY);
  const after = app.bills.due(TODAY).filter((d) => d.template.id === 'elec');
  ok('P4 …so the paused months stay skipped; only from today on is due', after.every((d) => d.date >= TODAY), JSON.stringify(after.map((d) => d.date)));

  app.openModal('pauseRepeat', { id: 'rent' });
  await wait(10);
  const g = w.document.querySelector('form.pause-repeat-form');
  g.querySelector('[name="length"][value="2"]').checked = true;
  app.submitRepeatPause({ preventDefault() {}, target: g }, 'rent');
  await wait(10);
  const rent = st().transactions.find((t) => t.id === 'rent');
  const last = rent.pauses.at(-1);
  ok('P4 Pause 2 months from today', last.from === TODAY && last.to > TODAY && last.to <= addMonths(3), JSON.stringify(last));
  app.navigate('calendar'); app.setCalTab('bills');
  await wait(10);
  const rentRow = [...view().querySelectorAll('.p-3')].find((r) => /Rent/.test(r.textContent));
  ok('P4 Rent shows "Paused until …"', /Paused until/.test(rentRow?.textContent || ''));

  const pay = app.bills;
  const tpl = st().transactions.find((t) => t.id === 'elec');
  const occ = pay.due(TODAY).find((d) => d.template.id === 'elec')?.date || TODAY;
  const copy = pay.pay(tpl, occ, { amount: 160000, paidOn: TODAY });
  ok('P5 a bill payment doesn\'t carry the pause', copy.pauses === undefined);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
