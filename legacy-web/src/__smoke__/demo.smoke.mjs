/**
 * demo.smoke.mjs — app.html?demo: the sample book, without touching a real one.
 *
 *   M1  ?demo opens the sample with a banner, even when this device has a saved book
 *   M2  changes in the demo are not saved; the saved book and its owner are untouched
 *   M3  ?demo=budgets / bills / habits open that screen
 *   M4  Sign in leaves the demo for the real app
 *   M5  without ?demo nothing changes: the saved book opens, no banner
 *
 * Run: node src/__smoke__/demo.smoke.mjs
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nDemo suite');

const bundleSrc = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mine = JSON.stringify({
  user: { homeCurrency: 'INR', defaultCurrency: 'INR', theme: 'light', showHijri: false, hijriOffset: 0, customPaymentTypes: [], hiddenPaymentTypes: [] },
  accounts: [{ id: 'a1', name: 'My real wallet', currency: 'INR', type: 'cash', color: '#3b82f6', icon: 'wallet', openingBalance: 500, balance: 500 }],
  categories: [{ id: 'c1', name: 'Food', type: 'expense', parentId: null, color: '#10b981', icon: 'tag' }],
  transactions: [], budgets: [], debts: [], family: [], merchantCategories: {}, accountGroups: [], regularItems: [],
});
function boot(search, saved = true) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
      <div id="viewContent"></div><div id="sidebarNav"></div><div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
    </body></html>`, { url: `https://local.test/app.html${search}`, pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  if (saved) { window.localStorage.setItem('pocket.v1', mine); window.localStorage.setItem('pocket.v1.owner', 'user-123'); }
  window.lucide = { createIcons() {} };
  window.Chart = function () { return { destroy() {} }; };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.fetch = () => Promise.reject(new Error('offline'));
  window.confirm = () => true;
  window.alert = () => {};
  window.eval(bundleSrc);
  return window;
}
const text = (w) => w.document.querySelector('#viewContent').textContent.replace(/\s+/g, ' ');
{
  const w = boot('?demo');
  await wait(150);
  const app = w.__app;
  ok('M1 the sample opens, with the banner, over a saved book', /looking at sample data/.test(text(w)) && app.store.getState().accounts.some((a) => a.name === 'HDFC Bank') && !/My real wallet/.test(text(w)));
  app.store.getState().transactions.push({ id: 'demo-x', type: 'expense', amount: 100, currency: 'INR', date: '2026-11-15', accountId: app.store.getState().accounts[0].id });
  app.store.persist();
  ok('M2 the saved book and its owner are untouched', w.localStorage.getItem('pocket.v1') === mine && w.localStorage.getItem('pocket.v1.owner') === 'user-123');
  app.openModal('auth');
  await wait(20);
  ok('M4 Sign in doesn\'t open the sign-in window inside the demo', !w.document.querySelector('[name="email"]'));
  ok('M4 the banner\'s button goes to the real app\'s sign-in', w.document.querySelector('.demo-banner a')?.getAttribute('href') === '/app.html#signin');
}
for (const [want, re] of [['budgets', /Monthly budgets/], ['bills', /Tata Power/], ['habits', /Food delivery/], ['investments', /24k gold coins/], ['nonsense', /Dashboard|Total balance/]]) {
  const w = boot(`?demo=${want}`);
  await wait(150);
  ok(`M3 ?demo=${want} opens its screen`, re.test(text(w)), text(w).slice(0, 160));
}
{
  const w = boot('');
  await wait(150);
  ok('M5 without ?demo: the saved book, no banner', /My real wallet/.test(JSON.stringify(w.__app.store.getState().accounts)) && !w.document.querySelector('.demo-banner'));
}
{
  const w = boot('?demo', false);
  await wait(150);
  ok('M2 a first visit in the demo saves nothing to the device', w.localStorage.getItem('pocket.v1') === null && w.localStorage.getItem('pocket.v1.owner') === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
