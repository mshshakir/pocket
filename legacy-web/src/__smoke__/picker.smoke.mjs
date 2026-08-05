/**
 * picker.smoke.mjs — headless smoke test for the two-step category picker.
 *
 * Boots the real app inside jsdom against a seeded localStorage, then drives
 * the picker exactly the way a user would (open tx modal → open picker →
 * drill into a parent → pick a subcategory → submit) and asserts the
 * transaction is saved with the right categoryId.
 *
 * Run:  node src/__smoke__/picker.smoke.mjs
 * (from a tree where `npm i jsdom` has been run)
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const bundle = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};

// ── Seed a state with a deliberately long, deep category list ──────────────
const cats = [];
const push = (o) => { cats.push(o); return o; };
const parents = ['Food & Drink', 'Transport', 'Bills', 'Housing', 'Shopping'];
parents.forEach((name, pi) => {
  const p = push({ id: `p${pi}`, name, type: 'expense', parentId: null, color: '#f97316', icon: 'tag' });
  for (let i = 0; i < 12; i++) {
    push({ id: `c${pi}_${i}`, name: `${name} sub ${i}`, type: 'expense', parentId: p.id, color: '#3b82f6', icon: 'tag' });
  }
});
push({ id: 'solo', name: 'Bank fees', type: 'expense', parentId: null, color: '#ef4444', icon: 'tag' });
push({ id: 'inc0', name: 'Salary', type: 'income', parentId: null, color: '#22c55e', icon: 'tag' });

const state = {
  user: { homeCurrency: 'USD', defaultCurrency: 'USD', theme: 'light', showHijri: false, hijriOffset: 0 },
  accounts: [{ id: 'a1', name: 'Cash', type: 'cash', currency: 'USD', openingBalance: 0, balance: 0 }],
  categories: cats,
  transactions: [], budgets: [], debts: [], family: [], regularItems: [],
  merchantCategories: {}, accountGroups: [],
};

const dom = new JSDOM(
  `<!doctype html><html><head></head><body><div id="app"></div></body></html>`,
  { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' },
);
const { window } = dom;
window.localStorage.setItem('pocket.v1', JSON.stringify(state));
window.lucide = { createIcons() {} };
window.Chart  = function () { return { destroy() {} }; };
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.fetch  = () => Promise.reject(new Error('offline'));
window.confirm = () => true;
window.alert   = () => {};

window.eval(bundle);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(60);

const app = window.__app;
const doc = window.document;
const $   = (sel) => doc.querySelector(sel);

console.log('\ncategory picker smoke test');
ok('app booted', !!app);

// ── 1. Transaction modal renders a CategoryField, not a <select> ───────────
app.openModal('transaction', {});
await wait(20);
ok('tx modal open', !!$('#txForm'));
ok('category <select> is gone', !$('#txForm select[name=categoryId]'));
ok('CategoryField rendered', !!$('#txCategory'));
ok('hidden categoryId input present', !!$('#txCategory input[type=hidden][name=categoryId]'));

// ── 2. Picker opens on step 1 showing PARENTS only ─────────────────────────
app.openCategoryPicker('txCategory');
await wait(20);
const rowsStep1 = [...doc.querySelectorAll('#catPickerRoot .sheet-row')];
const namesStep1 = rowsStep1.map((r) => r.querySelector('.sheet-row-name')?.textContent.trim());
ok('picker overlay open', $('#catPickerRoot')?.classList.contains('open'));
ok('shows the 5 parents + childless root + Uncategorised + add row',
   parents.every((p) => namesStep1.includes(p)) && namesStep1.includes('Bank fees'),
   namesStep1.join(' | '));
ok('does NOT list 60 subcategories up front', !namesStep1.some((n) => n?.includes('sub 7')),
   `${namesStep1.length} rows`);
ok('income category filtered out of an expense tx', !namesStep1.includes('Salary'));

// ── 3. Drilling into a parent shows only its children ──────────────────────
app.catPicker.openParent('p1');
await wait(10);
const namesStep2 = [...doc.querySelectorAll('#catPickerRoot .sheet-row')]
  .map((r) => r.querySelector('.sheet-row-name')?.textContent.trim());
ok('step 2 lists that parent\'s children', namesStep2.includes('Transport sub 3'));
ok('step 2 excludes other parents\' children', !namesStep2.some((n) => n?.startsWith('Bills sub')));
ok('single mode offers no "Whole group" row', !namesStep2.some((n) => n?.startsWith('Whole group')));

// ── 4. Search short-circuits both steps ────────────────────────────────────
app.catPicker.setQuery('bills sub 4');
await wait(10);
const hits = [...doc.querySelectorAll('#catPickerRoot .sheet-row')]
  .map((r) => r.querySelector('.sheet-row-name')?.textContent.replace(/\s+/g, ' ').trim());
ok('search finds a deep leaf by full path', hits.some((h) => h?.includes('Bills sub 4')), hits.join(' | '));
app.catPicker.setQuery('');
await wait(10);

// ── 5. Picking writes back into the form without destroying it ─────────────
$('#txForm [name=amount]').value = '42.50';
$('#txForm [name=payee]').value  = 'Test Merchant';
app.catPicker.openParent('p0');
await wait(10);
app.catPicker.choose('c0_5');
await wait(20);
ok('picker closed after a single pick', !$('#catPickerRoot').classList.contains('open'));
ok('hidden input carries the chosen id',
   $('#txCategory input[name=categoryId]')?.value === 'c0_5',
   $('#txCategory input[name=categoryId]')?.value);
ok('button label shows Parent / Child',
   $('#txCategory [data-cat-label]')?.textContent.includes('Food & Drink / Food & Drink sub 5'),
   $('#txCategory [data-cat-label]')?.textContent);
ok('typed amount survived the picker', $('#txForm [name=amount]')?.value === '42.50');
ok('typed payee survived the picker', $('#txForm [name=payee]')?.value === 'Test Merchant');

// ── 6. Inline quick-add creates and selects ────────────────────────────────
app.openCategoryPicker('txCategory');
await wait(20);
app.catPicker.openParent('p2');
await wait(10);
app.catPicker.toggleAdd(true);
await wait(10);
$('#catPickerRoot [data-cat-new]').value = 'Water bill';
app.catPicker.submitAdd();
await wait(20);
const created = app.getState?.()?.categories?.find?.((c) => c.name === 'Water bill')
             || JSON.parse(window.localStorage.getItem('pocket.v1')).categories.find((c) => c.name === 'Water bill');
ok('quick-add created the subcategory', !!created);
ok('quick-add parented it correctly', created?.parentId === 'p2', created?.parentId);
ok('quick-add derived an icon/colour', !!created?.icon && !!created?.color, `${created?.icon}/${created?.color}`);
ok('quick-add auto-selected it', $('#txCategory input[name=categoryId]')?.value === created?.id);

// duplicate guard
app.openCategoryPicker('txCategory');
await wait(20);
app.catPicker.openParent('p2');
await wait(10);
app.catPicker.toggleAdd(true);
await wait(10);
$('#catPickerRoot [data-cat-new]').value = 'water BILL';
app.catPicker.submitAdd();
await wait(10);
ok('duplicate name rejected with a reason',
   ($('#catPickerRoot [data-cat-add-error]')?.textContent || '').includes('already exists'));
app.catPicker.close();
await wait(10);

// ── 7. Submitting the form saves the category ──────────────────────────────
app.openModal('transaction', {});
await wait(20);
$('#txForm [name=amount]').value = '9.99';
app.openCategoryPicker('txCategory');
await wait(20);
app.catPicker.openParent('p3');
await wait(10);
app.catPicker.choose('c3_2');
await wait(20);
// jsdom runs with runScripts:'outside-only', so inline onsubmit= attributes are
// never invoked — call the handler the way the attribute would.
await app.submitTx({ preventDefault() {}, target: $('#txForm') }, '');
await wait(60);
const saved = JSON.parse(window.localStorage.getItem('pocket.v1')).transactions;
ok('transaction saved', saved.length === 1, `${saved.length} rows`);
ok('saved with the picked categoryId', saved[0]?.categoryId === 'c3_2', saved[0]?.categoryId);
ok('saved with the typed amount', saved[0]?.amount === 999, String(saved[0]?.amount));

// ── 8. Splits use the picker too ───────────────────────────────────────────
app.openModal('transaction', {});
await wait(20);
app.toggleSplits();
await wait(20);
// NB: toggleSplits() re-renders the modal (pre-existing behaviour), so the
// amount is typed after the toggle, not before.
$('#txForm [name=amount]').value = '10';
ok('split rows render CategoryFields', !!$('#splitCat_0') && !!$('#splitCat_1'));
ok('split category <select> is gone', !$('#txForm select[name=split_cat_0]'));
app.openCategoryPicker('splitCat_0');
await wait(20);
app.catPicker.openParent('p0');
await wait(10);
app.catPicker.choose('c0_1');
await wait(20);
ok('split hidden input updated', $('#splitCat_0 input[name=split_cat_0]')?.value === 'c0_1');
app.openCategoryPicker('splitCat_1');
await wait(20);
app.catPicker.openParent('p1');
await wait(10);
app.catPicker.choose('c1_3');
await wait(20);
$('#txForm [name=split_amt_0]').value = '4';
$('#txForm [name=split_amt_1]').value = '6';
app.setSplitAmount(0, '4', 'USD');
app.setSplitAmount(1, '6', 'USD');
await app.submitTx({ preventDefault() {}, target: $('#txForm') }, '');
await wait(60);
const withSplits = JSON.parse(window.localStorage.getItem('pocket.v1')).transactions
  .find((t) => Array.isArray(t.splits) && t.splits.length === 2);
ok('split transaction saved', !!withSplits);
ok('both split categories persisted',
   withSplits?.splits?.[0]?.categoryId === 'c0_1' && withSplits?.splits?.[1]?.categoryId === 'c1_3',
   JSON.stringify(withSplits?.splits?.map((s) => s.categoryId)));
app.closeModal();
await wait(10);

// ── 8b. A mid-edit re-render must not wipe the form ────────────────────────
app.openModal('transaction', {});
await wait(20);
const fill = () => {
  $('#txForm [name=amount]').value      = '77.25';
  $('#txForm [name=payee]').value       = 'Draft Merchant';
  $('#txForm [name=note]').value        = 'keep me';
  $('#txForm [name=date]').value        = '2026-03-04';
  $('#txForm [name=paymentType]').value = 'cash';
};
fill();
app.openCategoryPicker('txCategory');
await wait(20);
app.catPicker.openParent('p0');
await wait(10);
app.catPicker.choose('c0_3');
await wait(20);

app.toggleSplits();
await wait(30);
ok('splits toggled on', !!$('#splitCat_0'));
ok('amount survives toggleSplits',      $('#txForm [name=amount]')?.value === '77.25', $('#txForm [name=amount]')?.value);
ok('payee survives toggleSplits',       $('#txForm [name=payee]')?.value === 'Draft Merchant');
ok('note survives toggleSplits',        $('#txForm [name=note]')?.value === 'keep me');
ok('date survives toggleSplits',        $('#txForm [name=date]')?.value === '2026-03-04');
ok('paymentType survives toggleSplits', $('#txForm [name=paymentType]')?.value === 'cash');

app.addSplit();
await wait(30);
ok('third split row added',        !!$('#splitCat_2'));
ok('amount survives addSplit',     $('#txForm [name=amount]')?.value === '77.25');
app.removeSplit(2);
await wait(30);
ok('amount survives removeSplit',  $('#txForm [name=amount]')?.value === '77.25');

app.toggleSplits(); // back off splits — the category field returns
await wait(30);
ok('category survives the splits round trip',
   $('#txCategory input[name=categoryId]')?.value === 'c0_3',
   $('#txCategory input[name=categoryId]')?.value);
ok('amount survives toggling splits back off', $('#txForm [name=amount]')?.value === '77.25');

// Trailing-decimal amounts must round-trip through a refresh unchanged
// (0.50 must not come back as 0.5, which would look like a silent edit).
$('#txForm [name=amount]').value = '0.50';
app.setHijriOffset(2);
await wait(30);
ok('trailing-zero amount echoed verbatim', $('#txForm [name=amount]')?.value === '0.50',
   $('#txForm [name=amount]')?.value);
app.setHijriOffset(0);
await wait(20);

// Switching type keeps the values but drops a now-invalid category.
$('#txForm [name=amount]').value = '55';
app.setTxType('income');
await wait(30);
ok('type switched to income', $('#txForm [name=type]')?.value === 'income');
ok('amount survives a type switch', $('#txForm [name=amount]')?.value === '55');
ok('payee survives a type switch',  $('#txForm [name=payee]')?.value === 'Draft Merchant');
ok('note survives a type switch',   $('#txForm [name=note]')?.value === 'keep me');
ok('expense category dropped on switch to income',
   !$('#txCategory input[name=categoryId]')?.value,
   $('#txCategory input[name=categoryId]')?.value);
const incomeNames = (() => {
  app.openCategoryPicker('txCategory');
  return [...doc.querySelectorAll('#catPickerRoot .sheet-row')]
    .map((r) => r.querySelector('.sheet-row-name')?.textContent.trim());
})();
ok('picker now offers income categories', incomeNames.includes('Salary'), incomeNames.join(' | '));
ok('picker no longer offers expense categories', !incomeNames.includes('Food & Drink'));
app.catPicker.close();

app.setTxType('expense');
await wait(30);
ok('switching back keeps the amount', $('#txForm [name=amount]')?.value === '55');

// Re-opening the modal fresh must NOT inherit the previous draft.
app.closeModal();
await wait(10);
app.openModal('transaction', {});
await wait(20);
ok('a fresh open starts blank', !$('#txForm [name=amount]')?.value && !$('#txForm [name=payee]')?.value,
   `${$('#txForm [name=amount]')?.value}/${$('#txForm [name=payee]')?.value}`);
app.closeModal();
await wait(10);

// ── 9. Budget modal runs the picker in multi mode ──────────────────────────
app.openModal('budget', {});
await wait(20);
ok('budget CategoryField rendered', !!$('#budgetCategories'));
ok('budget field is multi mode', $('#budgetCategories')?.dataset.mode === 'multi');
app.openCategoryPicker('budgetCategories');
await wait(20);
app.catPicker.openParent('p0');
await wait(10);
const multiNames = [...doc.querySelectorAll('#catPickerRoot .sheet-row')]
  .map((r) => r.querySelector('.sheet-row-name')?.textContent.trim());
ok('multi mode DOES offer "Whole group"', multiNames.some((n) => n?.startsWith('Whole group')));
app.catPicker.choose('c0_0');
app.catPicker.choose('c0_1');
await wait(10);
ok('multi mode stays open across picks', $('#catPickerRoot').classList.contains('open'));
app.catPicker.done();
await wait(20);
const budgetIds = [...doc.querySelectorAll('#budgetCategories input[name=categoryIds]')].map((i) => i.value);
ok('two hidden categoryIds inputs emitted', budgetIds.length === 2 && budgetIds.includes('c0_0') && budgetIds.includes('c0_1'),
   budgetIds.join(','));
ok('label summarises the multi selection',
   ($('#budgetCategories [data-cat-label]')?.textContent || '').includes('+1 more'));
app.closeModal();
await wait(10);

// ── 10. Regular item modal ─────────────────────────────────────────────────
app.openModal('regularItem', {});
await wait(20);
ok('regular item CategoryField rendered', !!$('#regularItemCategory'));
app.closeModal();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
