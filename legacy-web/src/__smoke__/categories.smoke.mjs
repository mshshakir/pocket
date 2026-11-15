/**
 * categories.smoke.mjs — merging categories, rename clashes, smarter delete.
 *
 *   M1  targets: same type, not itself, not its own sub; one with subs only into a main
 *   M2  preview counts entries (incl. split legs), regulars, budgets, habits, subs
 *   M3  merge moves every reference, dedupes lists, removes the source
 *   M4  subs move under the target; a same-named sub merges into the target's
 *   M5  undo puts everything back, even after the arrays were swapped
 *   A1  in the app: More options → Merge shows the picker and the preview line
 *   A2  merging shows a toast with Undo; Undo brings it back
 *   A3  renaming to a name that's taken offers a merge
 *   A4  Delete on a used category opens "move and delete"; an unused one just goes
 *
 * Run: node src/__smoke__/categories.smoke.mjs
 */
import { CategoryMerge } from '../domain/services/CategoryMerge.js';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nCategories suite');

const cat = (id, name, parentId = null, type = 'expense') => ({ id, name, parentId, type, color: '#10b981', icon: 'tag' });
const book = () => ({
  user: { collapsedCategories: ['groc', 'food'] },
  categories: [
    cat('food', 'Food'), cat('snacks', 'Snacks', 'food'), cat('veg', 'Vegetables', 'food'),
    cat('groc', 'Grocery'), cat('gveg', 'vegetables', 'groc'), cat('fruit', 'Fruit', 'groc'),
    cat('fuel', 'Fuel'), cat('salary', 'Salary', null, 'income'),
  ],
  transactions: [
    { id: 't1', categoryId: 'groc', amount: 100 },
    { id: 't2', categoryId: 'gveg', amount: 200 },
    { id: 't3', categoryId: null, splits: [{ categoryId: 'gveg', amount: 50 }, { categoryId: 'fuel', amount: 50 }] },
    { id: 't4', categoryId: 'fuel', amount: 300 },
  ],
  budgets: [
    { id: 'b1', categoryIds: ['groc', 'food'], categoryId: 'groc' },
    { id: 'b2', categoryId: 'gveg' },
  ],
  regularItems: [{ id: 'r1', name: 'Milk', categoryId: 'groc' }],
  habits: [{ id: 'h1', name: 'Veg', categoryIds: ['gveg', 'veg'] }],
  merchantCategories: { bigbasket: 'groc', shell: 'fuel' },
});

{
  const m = new CategoryMerge(book());
  const t = m.targets('groc').map((c) => c.id);
  ok('M1 Grocery (has subs) can go into Food or Fuel only', t.join() === 'food,fuel', t.join());
  ok('M1 a sub can go into any other expense category', m.targets('fruit').map((c) => c.id).includes('snacks'));
  ok('M1 not into its own sub, not into income', !m.check('food', 'snacks').ok && !m.check('fuel', 'salary').ok);
  ok('M1 not into a sub when it has subs', /only go into a main/.test(m.check('groc', 'snacks').reason || ''));
}
{
  const p = new CategoryMerge(book()).preview('groc', 'food');
  ok('M2 3 entries (one is a split leg), 1 regular, 2 budgets, 1 habit', p.entries === 3 && p.regulars === 1 && p.budgets === 2 && p.habits === 1, JSON.stringify(p));
  ok('M2 Fruit moves, vegetables merges', p.movedSubs.join() === 'Fruit' && p.mergedSubs.join() === 'vegetables');
  ok('M2 usage counts subs too', new CategoryMerge(book()).usage('groc') === 3 + 1 + 2 + 1);
}
{
  const s = book();
  const before = structuredClone(s);
  const m = new CategoryMerge(s);
  const res = m.apply('groc', 'food');
  ok('M3 ok', res.ok);
  ok('M3 entries move; the split leg too', s.transactions[0].categoryId === 'food' && s.transactions[1].categoryId === 'veg' && s.transactions[2].splits[0].categoryId === 'veg' && s.transactions[2].splits[1].categoryId === 'fuel');
  ok('M3 regular and payee memory move', s.regularItems[0].categoryId === 'food' && s.merchantCategories.bigbasket === 'food' && s.merchantCategories.shell === 'fuel');
  ok('M3 budget lists dedupe', s.budgets[0].categoryIds.join() === 'food' && s.budgets[0].categoryId === 'food' && s.budgets[1].categoryIds.join() === 'veg');
  ok('M3 habit list dedupes', s.habits[0].categoryIds.join() === 'veg');
  ok('M3 Grocery and its vegetables are gone; collapse state cleaned', !s.categories.some((c) => c.id === 'groc' || c.id === 'gveg') && s.user.collapsedCategories.join() === 'food');
  ok('M4 Fruit moved under Food', s.categories.find((c) => c.id === 'fruit').parentId === 'food');
  ok('M3 untouched things stay', s.transactions[3].categoryId === 'fuel' && s.categories.find((c) => c.id === 'food').name === 'Food');

  // A sync swaps arrays in between: undo still finds things by id.
  s.transactions = structuredClone(s.transactions);
  s.categories = structuredClone(s.categories);
  m.revert(res.undo);
  const sortById = (l) => [...l].sort((a, b) => a.id.localeCompare(b.id));
  ok('M5 undo restores categories', JSON.stringify(sortById(s.categories)) === JSON.stringify(sortById(before.categories)));
  ok('M5 undo restores entries, budgets, regulars, habits, payees, collapse state',
    JSON.stringify(s.transactions) === JSON.stringify(before.transactions) &&
    JSON.stringify(s.budgets) === JSON.stringify(before.budgets) &&
    JSON.stringify(s.regularItems) === JSON.stringify(before.regularItems) &&
    JSON.stringify(s.habits) === JSON.stringify(before.habits) &&
    JSON.stringify(s.merchantCategories) === JSON.stringify(before.merchantCategories) &&
    JSON.stringify(s.user) === JSON.stringify(before.user));
}

// ── in the app ────────────────────────────────────────────────────────────
const bundleSrc = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function boot(answers = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
      <div id="viewContent"></div><div id="sidebarNav"></div><div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
    </body></html>`, { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  const b = book();
  window.localStorage.setItem('pocket.v1', JSON.stringify({
    user: { homeCurrency: 'INR', defaultCurrency: 'INR', theme: 'light', showHijri: false, hijriOffset: 0, customPaymentTypes: [], hiddenPaymentTypes: [], collapsedCategories: [] },
    accounts: [{ id: 'a1', name: 'Wallet', currency: 'INR', type: 'cash', color: '#3b82f6', icon: 'wallet', openingBalance: 0, balance: 0 }],
    categories: b.categories,
    transactions: b.transactions.map((t, i) => ({ type: 'expense', date: '2026-11-0' + (i + 1), payee: 'Shop', currency: 'INR', accountId: 'a1', ...t })),
    budgets: [], debts: [], family: [], merchantCategories: {}, accountGroups: [], regularItems: [],
  }));
  window.lucide = { createIcons() {} };
  window.Chart = function () { return { destroy() {} }; };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.fetch = () => Promise.reject(new Error('offline'));
  window.confirm = () => answers.confirm ?? true;
  window.alert = () => {};
  window.eval(bundleSrc);
  return window;
}
const ids = (w) => w.__app.store.getState().categories.map((c) => c.id);
const toastText = (w) => w.document.querySelector('.toast, #toast')?.textContent || w.document.body.textContent;

{
  const w = boot();
  await wait(100);
  const app = w.__app;
  app.openModal('category', { id: 'groc' });
  await wait(20);
  const more = w.document.querySelector('details.category-more');
  ok('A1 the edit form has More options with Merge', more && /Merge into another category/.test(more.textContent));
  ok('A1 a new category has no More options', (app.openModal('category'), !w.document.querySelector('details.category-more')));
  app.openCategoryMerge('groc');
  await wait(20);
  const opts = [...w.document.querySelectorAll('select[name="into"] option')].map((o) => o.value).filter(Boolean);
  ok('A1 picker offers Food and Fuel', opts.join() === 'food,fuel', opts.join());
  app.previewCategoryMerge('groc', 'food');
  const prev = w.document.getElementById('categoryMergePreview').textContent;
  ok('A1 preview: entries, Fruit moves, vegetables joins', /Moves 3 entries to Food/.test(prev) && /Fruit moves under Food/.test(prev) && /vegetables joins/.test(prev), prev);

  const f = w.document.querySelector('form');
  f.querySelector('[name="into"]').value = 'food';
  app.mergeCategory({ preventDefault() {}, target: f }, 'groc');
  await wait(20);
  ok('A2 Grocery is gone and its entry is in Food', !ids(w).includes('groc') && w.__app.store.getState().transactions.find((t) => t.id === 't1').categoryId === 'food');
  const undoBtn = w.document.querySelector('.toast-action');
  ok('A2 toast says what happened and offers Undo', /Grocery merged into Food · 3 entries moved/.test(toastText(w)) && undoBtn?.textContent === 'Undo', toastText(w));
  undoBtn.click();
  await wait(20);
  ok('A2 Undo brings Grocery back with its entry', ids(w).includes('groc') && ids(w).includes('gveg') && w.__app.store.getState().transactions.find((t) => t.id === 't1').categoryId === 'groc');
}
{
  const w = boot();
  await wait(100);
  const app = w.__app;
  app.openModal('category', { id: 'fuel' });
  await wait(20);
  const f = w.document.querySelector('form');
  f.querySelector('[name="name"]').value = 'food';
  app.submitCategory({ preventDefault() {}, target: f }, 'fuel');
  await wait(20);
  ok('A3 renaming Fuel to "food" (yes) merges it into Food', !ids(w).includes('fuel') && w.__app.store.getState().transactions.find((t) => t.id === 't4').categoryId === 'food');

  const w2 = boot({ confirm: false });
  await wait(100);
  w2.__app.openModal('category', { id: 'fuel' });
  await wait(20);
  const f2 = w2.document.querySelector('form');
  f2.querySelector('[name="name"]').value = 'Food';
  w2.__app.submitCategory({ preventDefault() {}, target: f2 }, 'fuel');
  await wait(20);
  ok('A3 saying no keeps Fuel as it was', ids(w2).includes('fuel') && w2.__app.store.getState().categories.find((c) => c.id === 'fuel').name === 'Fuel');

  w2.__app.openModal('category');
  await wait(20);
  const f3 = w2.document.querySelector('form');
  f3.querySelector('[name="name"]').value = 'FUEL';
  const n = ids(w2).length;
  w2.__app.submitCategory({ preventDefault() {}, target: f3 }, '');
  await wait(20);
  ok('A3 a new one with a taken name is not added', ids(w2).length === n && /already exists/.test(toastText(w2)));
}
{
  const w = boot();
  await wait(100);
  const app = w.__app;
  app.deleteCategory('fuel');
  await wait(20);
  ok('A4 deleting used Fuel opens "Delete Fuel" with a picker', /Delete Fuel/.test(w.document.body.textContent) && w.document.querySelector('select[name="into"]') && ids(w).includes('fuel'));
  const f = w.document.querySelector('form');
  f.querySelector('[name="into"]').value = 'food';
  app.mergeCategory({ preventDefault() {}, target: f }, 'fuel');
  await wait(20);
  ok('A4 Move and delete: Fuel gone, its entries in Food', !ids(w).includes('fuel') && w.__app.store.getState().transactions.find((t) => t.id === 't4').categoryId === 'food');
  app.store.getState().categories.push({ id: 'spare', name: 'Spare', type: 'expense', parentId: null, color: '#000', icon: 'tag' });
  app.deleteCategory('spare');
  await wait(20);
  ok('A4 an unused category is just deleted', !ids(w).includes('spare'));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
