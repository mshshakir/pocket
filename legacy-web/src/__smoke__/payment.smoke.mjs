/**
 * payment.smoke.mjs — headless smoke test for payment-method management.
 *
 * Boots the real app in jsdom and drives the manage sheet the way a user
 * would: rename a built-in, rename a custom one, delete an unused method,
 * fail to delete one that's in use, and confirm the ledger was migrated.
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

const state = {
  user: {
    homeCurrency: 'USD', defaultCurrency: 'USD', theme: 'light',
    showHijri: false, hijriOffset: 0,
    customPaymentTypes: ['amex'], hiddenPaymentTypes: [],
  },
  accounts: [{ id: 'a1', name: 'Cash', type: 'cash', currency: 'USD', openingBalance: 0, balance: 0 }],
  categories: [{ id: 'c1', name: 'Food', type: 'expense', parentId: null, color: '#f97316', icon: 'tag' }],
  transactions: [
    { id: 't1', accountId: 'a1', categoryId: 'c1', amount: 500, currency: 'USD', type: 'expense',
      date: '2026-01-05', paymentType: 'card', recordState: 'cleared', tags: [] },
    { id: 't2', accountId: 'a1', categoryId: 'c1', amount: 700, currency: 'USD', type: 'expense',
      date: '2026-01-06', paymentType: 'card', recordState: 'cleared', tags: [] },
    { id: 't3', accountId: 'a1', categoryId: 'c1', amount: 300, currency: 'USD', type: 'expense',
      date: '2026-01-07', paymentType: 'amex', recordState: 'cleared', tags: [] },
  ],
  budgets: [], debts: [], family: [], regularItems: [],
  merchantCategories: {}, accountGroups: [],
};

const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="app"></div></body></html>`,
  { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;
window.localStorage.setItem('pocket.v1', JSON.stringify(state));
window.lucide = { createIcons() {} };
window.Chart  = function () { return { destroy() {} }; };
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.fetch  = () => Promise.reject(new Error('offline'));
window.confirm = () => true;

window.eval(bundle);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(60);

const app  = window.__app;
const doc  = window.document;
const $    = (sel) => doc.querySelector(sel);
const svc  = app.paymentTypeService;
const saved = () => JSON.parse(window.localStorage.getItem('pocket.v1'));
const sheetRows = () => [...doc.querySelectorAll('#paymentSheetRoot .sheet-row-name')]
  .map((r) => r.textContent.trim());

console.log('\npayment method smoke test');
ok('app booted', !!app);

// ── 1. Dropdown exposes both commands ──────────────────────────────────────
app.openModal('transaction', {});
await wait(20);
const optVals = [...doc.querySelectorAll('#txForm select[name=paymentType] option')].map((o) => o.value);
ok('dropdown lists built-ins + custom', ['card','cash','transfer','cheque','online','amex'].every((v) => optVals.includes(v)), optVals.join(','));
ok('dropdown offers Add custom',    optVals.includes('__add_payment__'));
ok('dropdown offers Manage methods', optVals.includes('__manage_payment__'));

// ── 2. Choosing "Manage" opens the sheet and never leaks into the form ─────
const sel = $('#txForm select[name=paymentType]');
$('#txForm [name=amount]').value = '31.50';
sel.value = '__manage_payment__';
app.onPaymentTypeChange(sel);
await wait(30);
ok('manage sheet opened', $('#paymentSheetRoot')?.classList.contains('open'));
ok('sheet lists every method',
   ['Card','Cash','Transfer','Cheque','Online','Amex'].every((n) => sheetRows().includes(n)),
   sheetRows().join(' | '));

// ── 3. Delete is offered only for unused methods ───────────────────────────
const rowFor = (label) => [...doc.querySelectorAll('#paymentSheetRoot .sheet-row-static')]
  .find((r) => r.querySelector('.sheet-row-name')?.textContent.trim() === label);
ok('in-use method shows its count',
   rowFor('Card')?.querySelector('.sheet-row-meta')?.textContent.includes('2'),
   rowFor('Card')?.querySelector('.sheet-row-meta')?.textContent);
ok('in-use method hides the delete button',
   !rowFor('Card')?.querySelector('button[title=Delete]'));
ok('unused method offers delete', !!rowFor('Cheque')?.querySelector('button[title=Delete]'));
ok('every method offers rename',   !!rowFor('Card')?.querySelector('button[title=Rename]'));

// ── 4. Deleting an unused built-in ─────────────────────────────────────────
app.paymentSheet.remove('cheque');
await wait(20);
ok('cheque removed from the list', !svc.allTypes().includes('cheque'), svc.allTypes().join(','));
ok('cheque recorded as hidden, not lost', svc.hiddenTypes().includes('cheque'));
ok('deletion persisted', saved().user.hiddenPaymentTypes.includes('cheque'));

// ── 5. Deleting an in-use method is blocked ────────────────────────────────
app.paymentSheet.remove('card');
await wait(20);
ok('card survives the blocked delete', svc.allTypes().includes('card'));
const errText = $('#paymentSheetRoot .text-rose-500')?.textContent || '';
ok('block explains why, with a count', errText.includes('2 transactions') && errText.includes('reassign'), errText);

// ── 6. Renaming a built-in migrates the ledger ─────────────────────────────
app.paymentSheet.edit('card');
await wait(20);
ok('rename input pre-filled with the current name', $('#paymentSheetRoot [data-pm-input]')?.value === 'card');
$('#paymentSheetRoot [data-pm-input]').value = 'Credit card';
app.paymentSheet.submit();
await wait(20);
ok('renamed built-in appears', svc.allTypes().includes('Credit card'), svc.allTypes().join(','));
ok('old built-in name gone',   !svc.allTypes().includes('card'));
const afterRename = saved().transactions.filter((t) => t.paymentType === 'Credit card');
ok('both transactions migrated', afterRename.length === 2, String(afterRename.length));
ok('no transaction left on the old name',
   !saved().transactions.some((t) => t.paymentType === 'card'));

// ── 7. Renaming a custom method ────────────────────────────────────────────
app.paymentSheet.edit('amex');
await wait(20);
$('#paymentSheetRoot [data-pm-input]').value = 'AmEx Gold';
app.paymentSheet.submit();
await wait(20);
ok('custom renamed in place', svc.allTypes().includes('AmEx Gold') && !svc.allTypes().includes('amex'));
ok('its transaction migrated', saved().transactions.some((t) => t.paymentType === 'AmEx Gold'));

// ── 8. Duplicate names rejected ────────────────────────────────────────────
app.paymentSheet.edit('cash');
await wait(20);
$('#paymentSheetRoot [data-pm-input]').value = 'AmEx Gold';
app.paymentSheet.submit();
await wait(20);
ok('duplicate rename rejected',
   ($('#paymentSheetRoot .text-rose-500')?.textContent || '').includes('already exists'));
ok('cash unchanged after the rejection', svc.allTypes().includes('cash'));
app.paymentSheet.cancel();
await wait(10);

// ── 9. Adding from inside the sheet ────────────────────────────────────────
app.paymentSheet.startAdd();
await wait(20);
$('#paymentSheetRoot [data-pm-input]').value = 'Apple Pay';
app.paymentSheet.submit();
await wait(20);
ok('new method added', svc.allTypes().includes('Apple Pay'));

// ── 10. Restore brings deleted built-ins back ──────────────────────────────
app.paymentSheet.restoreBuiltIns();
await wait(20);
ok('cheque restored', svc.allTypes().includes('cheque'));
ok('a renamed built-in does NOT come back as a duplicate',
   svc.allTypes().filter((t) => t.toLowerCase() === 'card').length <= 1,
   svc.allTypes().join(','));

// ── 11. Closing follows the rename and keeps the form intact ───────────────
app.paymentSheet.close();
await wait(30);
ok('sheet closed', !$('#paymentSheetRoot').classList.contains('open'));
ok('selection followed the rename card → Credit card',
   $('#txForm select[name=paymentType]')?.value === 'Credit card',
   $('#txForm select[name=paymentType]')?.value);
ok('typed amount survived the sheet', $('#txForm [name=amount]')?.value === '31.50',
   $('#txForm [name=amount]')?.value);

// ── 12. Saving uses the renamed method ─────────────────────────────────────
await app.submitTx({ preventDefault() {}, target: $('#txForm') }, '');
await wait(60);
const newest = saved().transactions.find((t) => t.amount === 3150);
ok('new transaction saved with the renamed method', newest?.paymentType === 'Credit card', newest?.paymentType);

// ── 13. A method deleted while selected falls back safely ──────────────────
app.openModal('transaction', {});
await wait(20);
const sel2 = $('#txForm select[name=paymentType]');
sel2.value = 'Apple Pay';
sel2.dataset.prev = 'Apple Pay';
app.openPaymentTypeManager(sel2);
await wait(30);
ok('command value never reaches the form', sel2.value !== '__manage_payment__', sel2.value);
app.paymentSheet.remove('Apple Pay');
await wait(20);
app.paymentSheet.close();
await wait(30);
const fallback = $('#txForm select[name=paymentType]')?.value;
ok('selection falls back to a live method',
   !!fallback && svc.allTypes().includes(fallback), fallback);
app.closeModal();

// ── 14. An unknown legacy method (e.g. from CSV import) is preserved ───────
// 'bank-transfer' is not in the offered list; opening a record that carries it
// must keep it rather than silently re-assign the transaction to 'card'.
app.openModal('transaction', {
  prefill: {
    type: 'expense', amount: 100, currency: 'USD', accountId: 'a1', categoryId: 'c1',
    payee: '', note: '', date: '2026-01-08', paymentType: 'bank-transfer', transferToAccountId: '',
  },
});
await wait(20);
const legacyOpts = [...doc.querySelectorAll('#txForm select[name=paymentType] option')].map((o) => o.value);
ok('legacy method kept in the list so editing does not silently change it',
   legacyOpts.includes('bank-transfer') && $('#txForm select[name=paymentType]')?.value === 'bank-transfer',
   `${$('#txForm select[name=paymentType]')?.value} in ${legacyOpts.join(',')}`);
app.closeModal();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
