/**
 * hijri-off.smoke.mjs — turning Hijri off in Settings hides Hijri dates
 * everywhere it was still showing.
 *
 *   H1  New transaction: no Hijri date (or miqaat) under the date field; with
 *       Hijri on, it is there.
 *   H2  Regular payments for a day (day logs): no Hijri date; with Hijri on, it is there.
 *   H3  Calendar view: a plain Gregorian calendar even if a Hijri or "both" mode
 *       was chosen before; with Hijri on, the chosen mode stands.
 *   H4  Changing the date in the transaction form keeps the preview empty.
 *
 * Run: node src/__smoke__/hijri-off.smoke.mjs
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const bundleSrc = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');
const MONTHS = ['Moharram', 'Safar', 'Rabi al', 'Jumada', 'Rajab', 'Shabaan', 'Ramadaan', 'Shawwal', 'Zilqadah', 'Zilhaj'];
const hasHijri = (text) => MONTHS.some((m) => text.includes(m));

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const state = (showHijri, calendarMode) => ({
  user: { homeCurrency: 'INR', defaultCurrency: 'INR', theme: 'light', showHijri, calendarMode,
          hijriOffset: 0, customPaymentTypes: [], hiddenPaymentTypes: [] },
  accounts: [{ id: 'a1', name: 'Wallet', currency: 'INR', groupId: null, type: 'cash', color: '#3b82f6', icon: 'wallet', openingBalance: 0, balance: 0 }],
  categories: [{ id: 'c1', name: 'Food', type: 'expense', parentId: null, color: '#f97316', icon: 'tag' }],
  transactions: [], budgets: [], debts: [], family: [], merchantCategories: {}, accountGroups: [],
  regularItems: [{ id: 'r1', name: 'Milk', accountId: 'a1', categoryId: 'c1', currency: 'INR', defaultAmount: 6000, frequency: 'daily' }],
});

function boot(s) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
       <div id="viewContent"></div><div id="sidebarNav"></div>
       <div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
     </body></html>`,
    { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  window.localStorage.setItem('pocket.v1', JSON.stringify(s));
  window.lucide = { createIcons() {} };
  window.Chart  = function () { return { destroy() {} }; };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.fetch   = () => Promise.reject(new Error('offline'));
  window.confirm = () => true;
  window.alert   = () => {};
  window.eval(bundleSrc);
  return window;
}

console.log('\nHijri off suite');

for (const on of [false, true]) {
  const w = boot(state(on, 'both'));
  await wait(80);
  const app = w.__app, $ = (s) => w.document.querySelector(s);

  app.openModal('transaction', {});
  await wait(30);
  const preview = $('#hijriDatePreview')?.textContent ?? '';
  ok(`H1 Hijri ${on ? 'on' : 'off'}: new transaction ${on ? 'shows' : 'has no'} Hijri date`, on ? hasHijri(preview) : preview.trim() === '', preview);
  if (!on) {
    app.updateHijriPreview('2026-11-01');
    ok('H4 changing the date keeps it empty', ($('#hijriDatePreview')?.textContent ?? '').trim() === '');
  }
  app.closeModal();

  app.openModal('dayLogs', { date: '2026-11-14' });
  await wait(30);
  const logs = w.document.body.textContent;
  ok(`H2 Hijri ${on ? 'on' : 'off'}: regular payments for a day ${on ? 'show' : 'have no'} Hijri date`, on ? hasHijri(logs) : !hasHijri(logs));
  app.closeModal();
}

for (const mode of ['hijri', 'both']) {
  const off = boot(state(false, mode));
  await wait(80);
  off.__app.navigate('calendar');
  await wait(40);
  const text = off.document.querySelector('#viewContent')?.textContent ?? '';
  ok(`H3 Hijri off, mode "${mode}" chosen before: calendar shows no Hijri months`, text.length > 50 && !hasHijri(text), text.slice(0, 120));
}
{
  const on = boot(state(true, 'hijri'));
  await wait(80);
  on.__app.navigate('calendar');
  await wait(40);
  ok('H3 Hijri on, mode "hijri": the Hijri calendar stands', hasHijri(on.document.querySelector('#viewContent')?.textContent ?? ''));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
