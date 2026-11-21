/**
 * payment.smoke.mjs — payment type is no longer asked (owner, 20 Nov 2026).
 *
 *   P1  The entry form has no payment field and no manage/add buttons.
 *   P2  A new entry takes its payment type from the account:
 *       cash account → cash, credit card → card, bank → online.
 *   P3  Editing an old entry keeps the payment type it was saved with.
 *   P4  Settings has no "Default payment"; the transaction filters and the
 *       export screen have no payment filter.
 *
 * Run:  node src/__smoke__/payment.smoke.mjs
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const bundle = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);

const state = {
  user: {
    homeCurrency: 'USD', defaultCurrency: 'USD', theme: 'light',
    showHijri: false, hijriOffset: 0, customPaymentTypes: ['amex'], hiddenPaymentTypes: [],
  },
  accounts: [
    { id: 'a1', name: 'Cash', type: 'cash', currency: 'USD', openingBalance: 0, balance: 0 },
    { id: 'a2', name: 'Amex', type: 'card', currency: 'USD', openingBalance: 0, balance: 0 },
    { id: 'a3', name: 'HDFC', type: 'bank', currency: 'USD', openingBalance: 0, balance: 0 },
  ],
  categories: [{ id: 'c1', name: 'Food', type: 'expense', parentId: null, color: '#f97316', icon: 'tag' },
               { id: 'c2', name: 'Groceries', type: 'expense', parentId: 'c1', color: '#f97316', icon: 'tag' }],
  transactions: [
    { id: 'old', accountId: 'a3', categoryId: 'c2', amount: 500, currency: 'USD', type: 'expense',
      date: today, paymentType: 'cheque', recordState: 'cleared', tags: [] },
  ],
  budgets: [], debts: [], family: [], regularItems: [], merchantCategories: {}, accountGroups: [],
};

const dom = new JSDOM(`<!doctype html><html><head></head><body>
  <div id="viewContent"></div><div id="sidebarNav"></div><div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
</body></html>`, { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;
window.localStorage.setItem('pocket.v1', JSON.stringify(state));
window.lucide = { createIcons() {} };
window.Chart  = function () { return { destroy() {} }; };
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.fetch  = () => Promise.reject(new Error('offline'));
window.confirm = () => true;
window.alert = () => {};
window.eval(bundle);
await wait(80);

console.log('\npayment type suite');
const app = window.__app, doc = window.document, $ = (s) => doc.querySelector(s);
const saved = () => app.store.getState().transactions;

/** Opens a new entry on an account and saves it. */
async function add(accountId, amount) {
  app.openModal('transaction', {});
  await wait(20);
  const f = $('#txForm');
  f.querySelector('[name=amount]').value = String(amount);
  const acc = f.querySelector('[name=accountId]'); if (acc) acc.value = accountId;
  const cat = f.querySelector('[name=categoryId]'); if (cat) cat.value = 'c2';
  await app.submitTx({ preventDefault() {}, target: f });
  await wait(20);
  return saved().find((t) => t.amount === amount * 100);
}

app.openModal('transaction', {});
await wait(20);
const form = $('#txForm')?.textContent || '';
ok('P1 no payment field', !/Payment/.test(form) && !doc.querySelector('[data-pay-chip]') && !/__manage_payment__|__add_payment__/.test($('#txForm')?.innerHTML || ''));
app.closeModal();

ok('P2 cash account → cash', (await add('a1', 11))?.paymentType === 'cash');
ok('P2 credit card → card', (await add('a2', 12))?.paymentType === 'card');
ok('P2 bank → online', (await add('a3', 13))?.paymentType === 'online');

app.openModal('transaction', { id: 'old' });
await wait(20);
await app.submitTx({ preventDefault() {}, target: $('#txForm') }, 'old');
await wait(20);
ok('P3 an old entry keeps its payment type when edited', saved().find((t) => t.id === 'old')?.paymentType === 'cheque');

app.openModal('settings');
await wait(20);
ok('P4 no Default payment in Settings', !/Default payment/.test(doc.body.textContent));
app.closeModal();
app.navigate('transactions');
await wait(20);
app.toggleTxFilterPanel?.();
await wait(20);
ok('P4 no payment filter on transactions', !/Payment method/.test($('#viewContent')?.textContent || ''));
app.openModal('export');
await wait(20);
ok('P4 no payment filter on export', !/\bPayment\b/.test([...doc.querySelectorAll('.field-label')].map((e) => e.textContent).join(' ')));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
