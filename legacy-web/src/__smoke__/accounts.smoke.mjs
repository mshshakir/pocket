/**
 * accounts.smoke.mjs — leave out of totals, low-balance alert, icons by type, reorder.
 *
 *   R1  reorderWithin keeps other accounts in their places
 *   I1  old accounts that only got the wallet icon get their type's icon (Cash keeps it)
 *   I2  form: the icon follows the type until one is picked by hand
 *   E1  "Leave out of totals": out of the Dashboard total, group total, net worth and You owe; chip shown
 *   L1  low balance: a Dashboard note for accounts under their floor; cards have no floor
 *   O1  Reorder: rows per group, arrows move within the group, order saved and stamped
 *   O2  dragging a row's handle moves it
 *   H1  Accounts help mentions low balance, totals and Reorder
 *
 * Run: node src/__smoke__/accounts.smoke.mjs
 */
import { AccountService } from '../domain/services/AccountService.js';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nAccounts suite');

{
  const list = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  ok('R1 putting d before b leaves a and c where they were', AccountService.reorderWithin(list, ['d', 'b']).map((x) => x.id).join('') === 'adcb');
  ok('R1 unknown ids are ignored', AccountService.reorderWithin(list, ['zz', 'c', 'a']).map((x) => x.id).join('') === 'cbad');
}

const bundleSrc = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function boot() {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
      <div id="viewContent"></div><div id="sidebarNav"></div><div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
    </body></html>`, { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  const acc = (id, name, type, bal, extra = {}) => ({ id, name, type, currency: 'INR', color: '#3b82f6', icon: 'wallet', openingBalance: bal, balance: bal, ...extra });
  window.localStorage.setItem('pocket.v1', JSON.stringify({
    user: { homeCurrency: 'INR', defaultCurrency: 'INR', theme: 'light', showHijri: false, hijriOffset: 0, customPaymentTypes: [], hiddenPaymentTypes: [] },
    accounts: [
      acc('cash', 'Wallet', 'cash', 200000),
      acc('bank', 'HDFC', 'bank', 1000000),
      acc('biz', 'Shop account', 'bank', 5000000),
      acc('save', 'Savings', 'savings', 300000),
    ],
    categories: [{ id: 'c1', name: 'Food', type: 'expense', parentId: null, color: '#10b981', icon: 'tag' }],
    transactions: [], budgets: [], debts: [], family: [], merchantCategories: {}, accountGroups: [], regularItems: [],
  }));
  window.lucide = { createIcons() {} };
  window.__charts = [];
  window.Chart = function (ctx, cfg) { window.__charts.push(cfg); return { destroy() {} }; };
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
const find = (id) => st().accounts.find((a) => a.id === id);
const view = () => w.document.getElementById('viewContent');

ok('I1 HDFC (bank) → landmark, Savings → its type icon, Wallet (cash) keeps wallet', find('bank').icon === 'landmark' && find('save').icon === AccountService.typeIcon('savings') && find('cash').icon === 'wallet', `${find('bank').icon} ${find('save').icon} ${find('cash').icon}`);
{
  app.openModal('account');
  await wait(10);
  const f = w.document.querySelector('[name="type"]').form;
  const checked = () => f.querySelector('input[name="icon"]:checked')?.value;
  ok('I2 a new Bank account starts with the landmark icon', checked() === 'landmark');
  const type = f.querySelector('[name="type"]');
  type.value = 'card'; app.onAccountTypeChange(type);
  ok('I2 switching to Credit Card moves it to credit-card, shows card fields, hides the floor', checked() === 'credit-card' && f.querySelector('#accCardFields').style.display === '' && f.querySelector('#accLowField').style.display === 'none');
  f.querySelector('input[name="icon"][value="gift"]').checked = true;
  type.value = 'cash'; app.onAccountTypeChange(type);
  ok('I2 an icon picked by hand stays when the type changes', checked() === 'gift');
  app.closeModal();
}
{
  app.openModal('account', { id: 'biz' });
  await wait(10);
  const f = w.document.querySelector('[name="excludeFromTotals"]').form;
  f.querySelector('[name="excludeFromTotals"]').checked = true;
  app.submitAccount({ preventDefault() {}, target: f }, 'biz');
  await wait(10);
  ok('E1 saved as left out of totals', find('biz').excludeFromTotals === true);
  ok('E1 total balance leaves it out (₹15,000 not ₹65,000)', app.accountService.totalBalanceInHome() === 1500000, String(app.accountService.totalBalanceInHome()));
  app.navigate('dashboard');
  await wait(10);
  ok('E1 the Dashboard shows ₹15,000 and 3 accounts', /15,000/.test(view().textContent) && /3 accounts/.test(view().textContent));
  app.navigate('accounts');
  await wait(10);
  ok('E1 the account shows "Not in totals"; the group total is ₹15,000', !!view().querySelector('.not-in-totals') && /15,000/.test(view().textContent) && !/65,000/.test(view().textContent));
  w.__charts.length = 0;
  app.navigate('reports');
  await wait(30);
  const series = w.__charts.flatMap((c) => c?.data?.datasets || []).map((d) => d.data).filter((d) => Array.isArray(d) && d.length);
  ok('E1 net worth in Reports ends at ₹15,000, not ₹65,000', series.some((d) => d.at(-1) === 15000) && !series.some((d) => d.at(-1) === 65000), JSON.stringify(series.map((d) => d.at(-1))));
}
{
  app.openModal('account', { id: 'cash' });
  await wait(10);
  const f = w.document.querySelector('[name="lowBalance"]').form;
  f.querySelector('[name="lowBalance"]').value = '3000';
  app.submitAccount({ preventDefault() {}, target: f }, 'cash');
  await wait(10);
  ok('L1 floor saved in minor units', find('cash').lowBalance === 300000);
  app.navigate('dashboard');
  await wait(10);
  const card = view().querySelector('.low-balance-card');
  ok('L1 Dashboard: "Low balance — Wallet below ₹3,000, ₹2,000"', card && /Wallet/.test(card.textContent) && /below ₹3,000/.test(card.textContent) && /2,000/.test(card.textContent), card?.textContent.replace(/\s+/g, ' '));
  find('cash').lowBalance = 100000;
  app.navigate('accounts'); app.navigate('dashboard');
  await wait(10);
  ok('L1 above the floor: no note', !view().querySelector('.low-balance-card'));
}
{
  app.navigate('accounts');
  app.toggleAccountReorder();
  await wait(10);
  const rows = () => [...view().querySelectorAll('[data-sort-list] [data-sort-id]')].map((r) => r.dataset.sortId);
  ok('O1 Reorder shows rows with handles, in order', rows().join() === 'cash,bank,biz,save' && view().querySelectorAll('[data-sort-handle]').length === 4, rows().join());
  ok('O1 the first row can\'t move up', view().querySelector('[data-sort-id="cash"] [aria-label="Move up"]').disabled);
  app.moveAccount('cash', 1);
  await wait(10);
  ok('O1 Wallet moves down one; saved in the book', st().accounts.map((a) => a.id).join() === 'bank,cash,biz,save' && rows().join() === 'bank,cash,biz,save');
  ok('O1 each account stamped with its place (so it syncs)', st().accounts.map((a) => a.sortOrder).join() === '1,2,3,4');

  const handle = view().querySelector('[data-sort-id="bank"] [data-sort-handle]');
  const ev = (type, y) => handle.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true, clientY: y }));
  ev('pointerdown', 0); ev('pointermove', 10); ev('pointerup', 10);
  await wait(10);
  ok('O2 dragging HDFC down past Wallet swaps them', st().accounts.map((a) => a.id).join() === 'cash,bank,biz,save', st().accounts.map((a) => a.id).join());

  app.navigate('dashboard'); app.navigate('accounts');
  await wait(10);
  ok('O1 leaving the page ends Reorder', !view().querySelector('[data-sort-list]'));
}
{
  app.openHelp('accounts');
  await wait(10);
  const t = w.document.querySelector('.help-sheet').textContent;
  ok('H1 Accounts help: low balance, Leave out of totals, Reorder', /drops below/.test(t) && /Leave out of totals/.test(t) && /Reorder/.test(t));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
