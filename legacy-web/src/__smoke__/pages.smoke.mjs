/**
 * pages.smoke.mjs — page help and the Regulars default tab.
 *
 *   R1  Regulars: tabs are Calendar · Bills · Deliveries · Shortcuts, Calendar opens first
 *   R2  coming back to Regulars opens Calendar again; links can still open another tab
 *   H1  Accounts, Regulars, Budgets, Debts and Categories have a ? by the title; Dashboard doesn't
 *   H2  a one-time hint shows until the guide is opened or "Got it" is tapped
 *   H3  the guide opens with the page's own title and bullets
 *
 * Run: node src/__smoke__/pages.smoke.mjs
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nPages suite');

const bundleSrc = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function boot() {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
      <div id="viewContent"></div><div id="sidebarNav"></div><div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
    </body></html>`, { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  window.localStorage.setItem('pocket.v1', JSON.stringify({
    user: { homeCurrency: 'INR', defaultCurrency: 'INR', theme: 'light', showHijri: false, hijriOffset: 0, customPaymentTypes: [], hiddenPaymentTypes: [] },
    accounts: [{ id: 'a1', name: 'Wallet', currency: 'INR', type: 'cash', color: '#3b82f6', icon: 'wallet', openingBalance: 0, balance: 0 }],
    categories: [{ id: 'c1', name: 'Food', type: 'expense', parentId: null, color: '#10b981', icon: 'tag' }],
    transactions: [], budgets: [], debts: [], family: [], merchantCategories: {}, accountGroups: [], regularItems: [],
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
const view = () => w.document.getElementById('viewContent');
const tabs = () => [...view().querySelectorAll('button[onclick^="window.__app.setCalTab"]')].map((b) => b.textContent.trim());
const activeTab = () => view().querySelector('button[onclick^="window.__app.setCalTab"].border-b-2')?.textContent.trim();

app.navigate('calendar');
await wait(20);
ok('R1 tabs: Calendar · Bills · Deliveries · Shortcuts', tabs().join(' · ') === 'Calendar · Bills · Deliveries · Shortcuts', tabs().join(' · '));
ok('R1 Calendar is open', activeTab() === 'Calendar', activeTab());
app.setCalTab('bills');
await wait(10);
ok('R2 switching to Bills works', activeTab() === 'Bills');
app.navigate('dashboard'); app.navigate('calendar');
await wait(10);
ok('R2 coming back opens Calendar again', activeTab() === 'Calendar', activeTab());
app.navigate('dashboard'); app.navigate('calendar'); app.setCalTab('deliveries');
await wait(10);
ok('R2 a link to Deliveries still lands on Deliveries', activeTab() === 'Deliveries', activeTab());

for (const [route, title] of [['accounts', 'Accounts'], ['calendar', 'Regulars'], ['budgets', 'Budgets'], ['debts', 'Debts'], ['categories', 'Categories']]) {
  app.navigate(route);
  await wait(10);
  const h1 = view().querySelector('h1');
  ok(`H1 ${title} has a ? by its title`, h1 && /^\s*\S/.test(h1.textContent) && h1.textContent.includes(title) && h1.querySelector('.help-btn'));
}
app.navigate('dashboard');
await wait(10);
ok('H1 Dashboard has no ?', !view().querySelector('.help-btn'));

app.navigate('budgets');
await wait(10);
ok('H2 Budgets shows the one-time hint', /Tap \? for a quick guide/.test(view().querySelector('.help-hint')?.textContent || ''));
app.openHelp('budgets');
await wait(10);
const sheet = w.document.querySelector('.help-sheet');
ok('H3 the Budgets guide opens with its title and the rollover bullet', sheet && /Budgets/.test(sheet.querySelector('h3').textContent) && /Roll over/.test(sheet.textContent));
app.closeModal();
await wait(10);
ok('H2 after opening, the Budgets hint is gone', !view().querySelector('.help-hint'));

app.navigate('debts');
await wait(10);
ok('H2 Debts still has its own hint', !!view().querySelector('.help-hint'));
app.dismissHelpHint('debts');
await wait(10);
ok('H2 "Got it" hides it, and the ? stays', !view().querySelector('.help-hint') && view().querySelector('.help-btn'));
ok('H2 remembered on this device', JSON.parse(w.localStorage.getItem('pocket.helpSeen')).join() === 'budgets,debts');

app.openHelp('categories');
await wait(10);
ok('H3 the Categories guide explains Merge and Delete', /Merge/.test(w.document.querySelector('.help-sheet').textContent) && /Delete/.test(w.document.querySelector('.help-sheet').textContent));
app.closeModal();
app.openHelp('calendar');
await wait(10);
ok('H3 the Regulars guide covers all four tabs', ['Calendar', 'Bills', 'Deliveries', 'Shortcuts'].every((t) => w.document.querySelector('.help-sheet').textContent.includes(t)));

app.closeModal();
app.openHelp('accounts');
await wait(10);
const acc = w.document.querySelector('.help-sheet').textContent;
ok('H3 the Accounts guide covers types, starting balance, transfers and fixing a balance', ['Cash', 'Credit Card', 'Starting balance', 'Transfer', 'Balance adjustment', 'Archived'].every((t) => acc.includes(t)));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
