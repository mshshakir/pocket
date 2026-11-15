/**
 * categories.smoke.mjs — merging categories, rename clashes, smarter delete.
 *
 *   M1  targets: same type, not itself, not its own sub; one with subs only into a main
 *   M2  preview counts entries (incl. split legs), regulars, budgets, habits, subs
 *   M3  merge moves every reference, dedupes lists, removes the source
 *   M4  subs move under the target; a same-named sub merges into the target's
 *   M5  undo puts everything back, even after the arrays were swapped
 *   P1  several at once: targets, mixed types refused, a picked sub + its picked parent
 *   P2  several at once: counts each changed thing once; undo puts all back
 *   K1  keep one of the ticked: which can be kept; the rest go into it
 *   K2  into a new category: placed under a shared parent, else main; undo removes it
 *   A1  in the app: Edit → Merge shows the picker and the preview line
 *   A2  merging shows a toast with Undo; Undo brings it back
 *   A3  renaming to a name that's taken offers a merge
 *   A4  Delete on a used category opens "move and delete"; an unused one just goes
 *   A6  the picker offers Keep …, other categories and + New category…; both work with Undo
 *   A5  Categories → Merge: tick several, other types greyed, merge them into one, Undo
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

{
  const m = new CategoryMerge(book());
  ok('P1 Grocery + Fuel can go into Food only', m.targetsMany(['groc', 'fuel']).map((c) => c.id).join() === 'food');
  ok('P1 expense + income refused', /one type/.test(m.checkMany(['fuel', 'salary'], 'food').reason || ''));
  ok('P1 not into one of the picked ones, nor a sub of one', !m.targetsMany(['groc', 'fuel']).some((c) => ['groc', 'fuel', 'fruit', 'gveg'].includes(c.id)));
  const s = book();
  const before = JSON.stringify(s);
  const mm = new CategoryMerge(s);
  const pre = mm.previewMany(['groc', 'gveg', 'fuel'], 'food');
  ok('P1 preview leaves the book alone', JSON.stringify(s) === before);
  const res = mm.applyMany(['groc', 'gveg', 'fuel'], 'food');
  ok('P1 picked sub + its parent + another: all go into Food', res.ok && !s.categories.some((c) => ['groc', 'gveg', 'fuel'].includes(c.id)) && s.transactions.every((t) => !t.categoryId || t.categoryId === 'food'), JSON.stringify(res.reason || ''));
  ok('P1 Fruit still moves under Food', s.categories.find((c) => c.id === 'fruit').parentId === 'food');
  ok('P2 split entry counted once: 4 entries, 1 regular, 2 budgets, 1 habit; preview agrees', res.summary.entries === 4 && res.summary.regulars === 1 && res.summary.budgets === 2 && res.summary.habits === 1 && res.summary.merged === 3 && JSON.stringify(pre) === JSON.stringify(res.summary), JSON.stringify(res.summary));
  ok('P2 split legs both in Food', s.transactions[2].splits.every((x) => x.categoryId === 'food'));
  mm.revert(res.undo);
  const norm = (st) => JSON.stringify({ ...st, categories: [...st.categories].sort((a, b) => a.id.localeCompare(b.id)) });
  ok('P2 undo puts all three back exactly', norm(s) === norm(JSON.parse(before)));
}

{
  const m = new CategoryMerge(book());
  const keep = m.keepOptions(['groc', 'fuel']).map((c) => c.id);
  ok('K1 Grocery or Fuel can be kept', keep.join() === 'groc,fuel', keep.join());
  ok('K1 a sub can\'t be kept when its parent (with other subs) is ticked', !m.keepOptions(['groc', 'gveg']).some((c) => c.id === 'gveg'));
  ok('K1 one ticked has nothing to keep', m.keepOptions(['fuel']).length === 0);
  ok('K2 new for two subs of Food goes under Food; for mains, a main', m.newParentFor(['snacks', 'veg']) === 'food' && m.newParentFor(['groc', 'fuel']) === null && m.newParentFor(['food', 'snacks']) === null);
  const s = book();
  const before = JSON.stringify(s);
  const mm = new CategoryMerge(s);
  const res = mm.applyIntoNew(['groc', 'fuel'], { id: 'newc', name: 'Household', type: 'expense', parentId: null, icon: 'home', color: '#000' });
  ok('K2 both go into the new Household; entries follow', res.ok && res.summary.created === 'Household' && s.categories.some((c) => c.id === 'newc') && s.transactions[3].categoryId === 'newc' && !s.categories.some((c) => c.id === 'groc' || c.id === 'fuel'));
  ok('K2 Fruit moves under the new one', s.categories.find((c) => c.id === 'fruit').parentId === 'newc');
  mm.revert(res.undo);
  const norm = (st) => JSON.stringify({ ...st, categories: [...st.categories].sort((a, b) => a.id.localeCompare(b.id)) });
  ok('K2 undo removes the new one and puts everything back', norm(s) === norm(JSON.parse(before)));
  const bad = new CategoryMerge(book()).applyIntoNew(['fuel', 'salary'], { id: 'x', name: 'X', type: 'expense', parentId: null });
  ok('K2 a failed merge leaves no new category behind', !bad.ok);
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
  ok('A1 the edit form shows a Merge button', !!w.document.querySelector('.category-merge-btn'));
  ok('A1 a new category has no Merge button', (app.openModal('category'), !w.document.querySelector('.category-merge-btn')));
  app.openCategoryMerge('groc');
  await wait(20);
  const opts = [...w.document.querySelectorAll('select[name="into"] option')].map((o) => o.value).filter(Boolean);
  ok('A1 picker offers Food, Fuel and + New (no Keep with one ticked)', opts.join() === 'food,fuel,__new' && !w.document.querySelector('optgroup[label^="Keep"]'), opts.join());
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

{
  const w = boot();
  await wait(100);
  const app = w.__app;
  app.navigate('categories');
  await wait(20);
  const view = () => w.document.getElementById('viewContent');
  ok('A5 the Categories screen shows Merge', !!view().querySelector('.category-pick-toggle'));
  app.toggleCategoryPicking();
  await wait(20);
  ok('A5 ticking mode: bar with 0 selected and Merge disabled', /0 selected/.test(view().querySelector('.category-pick-bar')?.textContent || '') && view().querySelector('.category-pick-bar button[disabled]'));
  app.toggleCategoryPick('groc');
  await wait(20);
  ok('A5 after ticking an expense, Salary (income) is greyed out', !view().querySelector('[data-pick="salary"]') && view().querySelector('[data-pick="fuel"]'));
  app.toggleCategoryPick('fuel');
  await wait(20);
  ok('A5 2 selected', /2 selected/.test(view().querySelector('.category-pick-bar').textContent));
  app.mergePickedCategories();
  await wait(20);
  ok('A5 picker titled "Merge 2 categories", offers Food', /Merge 2 categories/.test(w.document.body.textContent) && [...w.document.querySelectorAll('select[name="into"] optgroup[label="Or move into"] option')].map((o) => o.value).join() === 'food');
  app.previewCategoryMerge('groc,fuel', 'food');
  ok('A5 preview counts both', /Moves 4 entries/.test(w.document.getElementById('categoryMergePreview').textContent), w.document.getElementById('categoryMergePreview').textContent);
  const f = w.document.querySelector('form');
  f.querySelector('[name="into"]').value = 'food';
  app.mergeCategory({ preventDefault() {}, target: f }, 'groc,fuel');
  await wait(20);
  ok('A5 both gone, ticking ends, toast says 2 categories', !ids(w).includes('groc') && !ids(w).includes('fuel') && !view().querySelector('.category-pick-bar') && /2 categories merged into Food · 4 entries moved/.test(toastText(w)), toastText(w));
  w.document.querySelector('.toast-action').click();
  await wait(20);
  ok('A5 Undo brings both back', ids(w).includes('groc') && ids(w).includes('fuel') && ids(w).includes('gveg'));
  app.toggleCategoryPicking(); app.navigate('dashboard'); app.navigate('categories');
  await wait(20);
  ok('A5 leaving the screen ends ticking', !view().querySelector('.category-pick-bar'));
}

{
  const w = boot();
  await wait(100);
  const app = w.__app;
  app.openCategoryMerge(['groc', 'fuel']);
  await wait(20);
  const sel = w.document.querySelector('select[name="into"]');
  const groups = [...sel.querySelectorAll('optgroup')].map((g) => g.label + ':' + [...g.querySelectorAll('option')].map((o) => o.value).join('|'));
  ok('A6 Keep Grocery / Keep Fuel, then Food, then + New', groups.join(' ; ') === 'Keep one of these:groc|fuel ; Or move into:food' && sel.querySelector('option[value="__new"]'), groups.join(' ; '));
  app.previewCategoryMerge('groc,fuel', 'fuel');
  const kp = w.document.getElementById('categoryMergePreview').textContent;
  ok('A6 Keep Fuel: removes Grocery, moves its 1 entry, its subs move under Fuel', /Removes Grocery\./.test(kp) && /Moves 1 entry to Fuel/.test(kp) && /vegetables and Fruit move under Fuel/.test(kp), kp);
  let f = w.document.querySelector('form');
  sel.value = 'fuel';
  app.mergeCategory({ preventDefault() {}, target: f }, 'groc,fuel');
  await wait(20);
  ok('A6 Keep Fuel: Grocery gone, Fuel stays with its entries', !ids(w).includes('groc') && ids(w).includes('fuel') && w.__app.store.getState().transactions.find((t) => t.id === 't1').categoryId === 'fuel' && /Grocery merged into Fuel · 1 entry moved/.test(toastText(w)), toastText(w));
  w.document.querySelector('.toast-action').click();
  await wait(20);
  ok('A6 Undo brings Grocery back', ids(w).includes('groc'));

  app.openCategoryMerge(['groc', 'fuel']);
  await wait(20);
  f = w.document.querySelector('form');
  f.querySelector('[name="into"]').value = '__new';
  app.previewCategoryMerge('groc,fuel', '__new');
  ok('A6 + New shows the name box and asks for a name', w.document.getElementById('categoryMergeNew').style.display === '' && /Type a name/.test(w.document.getElementById('categoryMergePreview').textContent));
  f.querySelector('[name="newName"]').value = 'food';
  app.previewCategoryMerge('groc,fuel', '__new');
  ok('A6 a taken name is caught', /Food already exists/.test(w.document.getElementById('categoryMergePreview').textContent));
  f.querySelector('[name="newName"]').value = 'Household';
  app.previewCategoryMerge('groc,fuel', '__new');
  const np = w.document.getElementById('categoryMergePreview').textContent;
  ok('A6 preview: makes Household, removes both, moves 3 entries', /Makes a new category Household/.test(np) && /Removes Grocery and Fuel/.test(np) && /Moves 3 entries to Household/.test(np), np);
  app.mergeCategory({ preventDefault() {}, target: f }, 'groc,fuel');
  await wait(20);
  const hh = w.__app.store.getState().categories.find((c) => c.name === 'Household');
  ok('A6 Household made; both gone; toast says (new)', hh && !ids(w).includes('groc') && !ids(w).includes('fuel') && w.__app.store.getState().transactions.find((t) => t.id === 't4').categoryId === hh.id && /2 categories merged into Household \(new\) · 3 entries moved/.test(toastText(w)), toastText(w));
  w.document.querySelector('.toast-action').click();
  await wait(20);
  ok('A6 Undo removes Household and brings both back', !w.__app.store.getState().categories.some((c) => c.name === 'Household') && ids(w).includes('groc') && ids(w).includes('fuel'));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
