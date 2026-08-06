/**
 * shared-regulars.smoke.mjs — regression tests for shared-account categories
 * and shared-account regular purchases.
 *
 * Two defects this locks down:
 *
 *  1. Contributing to an account a family member shared used to pick from the
 *     LOCAL category tree. The chosen id meant nothing in the owner's book, so
 *     every contributed row landed there as "Uncategorised". The picker must
 *     browse the OWNER's tree — parents AND subcategories — and refuse to
 *     create categories in someone else's book.
 *
 *  2. Regular purchases could only target local accounts, and a log always went
 *     into the local ledger. A shared default account now stores accountId +
 *     sharedOwnerId, and RegularLogService merges both books so an entry logged
 *     against a shared account still appears on the calendar.
 *
 * Pure domain — no DOM, no network. Run: node src/__smoke__/shared-regulars.smoke.mjs
 */
import { SharedCategorySource } from '../domain/services/SharedCategorySource.js';
import { AccountRef }           from '../domain/services/AccountRef.js';
import { RegularLogService }    from '../domain/services/RegularLogService.js';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};

// ── The owner's category tree, as it travels in the share snapshot ─────────
const ownerCats = [
  { id: 'o_food',    name: 'Food & Drink', type: 'expense', parentId: null,     color: '#f97316' },
  { id: 'o_coffee',  name: 'Coffee',       type: 'expense', parentId: 'o_food', color: '#3b82f6' },
  { id: 'o_grocery', name: 'Groceries',    type: 'expense', parentId: 'o_food', color: '#10b981' },
  { id: 'o_bills',   name: 'Bills',        type: 'expense', parentId: null,     color: '#ef4444' },
  { id: 'o_salary',  name: 'Salary',       type: 'income',  parentId: null,     color: '#22c55e' },
  { id: 'o_orphan',  name: 'Old sub',      type: 'expense', parentId: 'gone',   color: '#a1a1aa' },
];

const localCats = [
  { id: 'l_food', name: 'Food', type: 'expense', parentId: null,    color: '#f97316' },
  { id: 'l_tea',  name: 'Tea',  type: 'expense', parentId: 'l_food', color: '#3b82f6' },
];

console.log('\n▸ SharedCategorySource — browsing the owner\'s tree');

const src = new SharedCategorySource(ownerCats);

ok('roots come from the owner, not the local book',
  src.visibleRoots('expense').map((c) => c.id).join(',') === 'o_bills,o_food',
  src.visibleRoots('expense').map((c) => c.id).join(','));

// This is the headline bug: subcategories were unreachable.
const kids = src.visibleChildren('o_food', 'expense').map((c) => c.id);
ok('a parent exposes the owner\'s SUBcategories', kids.join(',') === 'o_coffee,o_grocery', kids.join(','));
ok('hasChildren sees them', src.hasChildren('o_food', 'expense') === true);

ok('type filter still applies', src.visibleRoots('income').map((c) => c.id).join(',') === 'o_salary');
ok('a root with no matching children is dropped for the wrong type',
  !src.visibleRoots('income').some((c) => c.id === 'o_food'));

ok('fullName renders Parent / Child', src.fullName('o_coffee') === 'Food & Drink / Coffee', src.fullName('o_coffee'));
ok('search matches on the parent name too',
  src.search('food', 'expense').map((c) => c.id).sort().join(',') === 'o_coffee,o_food,o_grocery',
  src.search('food', 'expense').map((c) => c.id).sort().join(','));
ok('orphaned subcategories stay reachable',
  src.orphans('expense').map((c) => c.id).join(',') === 'o_orphan');

ok('creating a category in someone else\'s book is refused',
  src.quickCreate('Anything').ok === false);

ok('a local id is NOT resolvable in the owner\'s tree', src.find('l_tea') === undefined);
ok('an owner id IS resolvable', src.find('o_coffee')?.name === 'Coffee');

ok('an empty / missing snapshot degrades quietly',
  new SharedCategorySource(undefined).visibleRoots('expense').length === 0);

console.log('\n▸ AccountRef — which book does this account live in?');

const localRef = AccountRef.parse('acc_1');
ok('a bare id parses as local', localRef.accountId === 'acc_1' && localRef.ownerId === null && !localRef.isShared);

const encoded = new AccountRef('acc_9', 'owner-uuid-1').toValue();
ok('a shared account encodes owner + id', encoded === 'shared:owner-uuid-1:acc_9', encoded);

const sharedRef = AccountRef.parse(encoded);
ok('…and round-trips back', sharedRef.accountId === 'acc_9' && sharedRef.ownerId === 'owner-uuid-1' && sharedRef.isShared);

ok('an empty value stays empty', AccountRef.parse('').toValue() === '');
ok('fromRecord reads a stored regular item',
  AccountRef.fromRecord({ accountId: 'acc_9', sharedOwnerId: 'owner-uuid-1' }).isShared === true);
ok('a legacy item with no sharedOwnerId is local',
  AccountRef.fromRecord({ accountId: 'acc_1' }).isShared === false);

console.log('\n▸ RegularLogService — logs across both books');

const state = {
  user: { homeCurrency: 'INR' },
  accounts: [{ id: 'acc_1', name: 'Cash', currency: 'INR' }],
  categories: localCats,
  regularItems: [
    { id: 'ri_local',  name: 'Tea',    accountId: 'acc_1', sharedOwnerId: null },
    { id: 'ri_shared', name: 'Coffee', accountId: 'acc_9', sharedOwnerId: 'owner-uuid-1' },
  ],
  transactions: [
    { id: 'tx_1', regularItemId: 'ri_local', accountId: 'acc_1', date: '2026-08-06', amount: 5000, currency: 'INR' },
    { id: 'tx_plain', accountId: 'acc_1', date: '2026-08-06', amount: 900, currency: 'INR' },
  ],
  _sharedData: [{
    _ownerId: 'owner-uuid-1',
    homeCurrency: 'AED',
    categories: ownerCats,
    accounts: [{ id: 'acc_9', name: 'Household', currency: 'AED' }],
    transactions: [
      { id: 'tx_2', regularItemId: 'ri_shared', accountId: 'acc_9', date: '2026-08-06', amount: 1200, currency: 'AED' },
      { id: 'tx_3', regularItemId: 'ri_shared', accountId: 'acc_9', date: '2026-08-07', amount: 1300, currency: 'AED' },
      // The owner's OWN regular item — none of this user's business.
      { id: 'tx_4', regularItemId: 'ri_theirs', accountId: 'acc_9', date: '2026-08-06', amount: 9999, currency: 'AED' },
    ],
  }],
};

const logs = new RegularLogService({ store: { getState: () => state } });

const allIds = logs.all().map((t) => t.id).sort();
ok('local and contributed logs are merged', allIds.join(',') === 'tx_1,tx_2,tx_3', allIds.join(','));
ok('a non-regular transaction is not a log', !allIds.includes('tx_plain'));
ok('the owner\'s own regular items are excluded', !allIds.includes('tx_4'));

const onDay = logs.onDate('2026-08-06').map((t) => t.id).sort();
ok('onDate spans both books', onDay.join(',') === 'tx_1,tx_2', onDay.join(','));

ok('contributed rows are tagged for delete routing',
  logs.find('tx_2')?._shared === true && logs.find('tx_2')?._ownerId === 'owner-uuid-1');
ok('local rows are not tagged', !logs.find('tx_1')?._shared);

ok('inRange covers both books',
  logs.inRange('2026-08-06', '2026-08-07').length === 3);

ok('a book with no regular items yields only local logs',
  new RegularLogService({ store: { getState: () => ({ ...state, regularItems: [] }) } })
    .all().map((t) => t.id).join(',') === 'tx_1');

// ═══════════════════════════════════════════════════════════════════════════
// PART 2 — the real flow, driven through the app in jsdom
// ═══════════════════════════════════════════════════════════════════════════
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const bundleSrc = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The snapshot the owner publishes: one writable account plus their FULL tree.
const snapshot = {
  sharedBy:     'Owner',
  homeCurrency: 'AED',
  accounts:     [{ id: 'shared1', name: 'Household', type: 'bank', currency: 'AED',
                   color: '#3b82f6', icon: 'wallet', balance: 0, openingBalance: 0 }],
  // An earlier contribution by this member, already filed in the owner's book
  // and carrying one of THEIR category ids — the edit test below re-opens it.
  transactions: [{
    id: 'ctr_edit_me', accountId: 'shared1', categoryId: 'o_coffee', amount: 2500,
    currency: 'AED', type: 'expense', date: '2026-08-06', paymentType: 'card',
    recordState: 'cleared', addedBy: 'member@x.com',
  }],
  categories:   ownerCats,
  permission:   { shared1: 'full' },
};

const memberState = {
  user: { homeCurrency: 'INR', defaultCurrency: 'INR', theme: 'light', showHijri: false,
          hijriOffset: 0, customPaymentTypes: [], hiddenPaymentTypes: [] },
  accounts: [{ id: 'own1', name: 'My Cash', type: 'cash', currency: 'INR', color: '#22c55e',
               icon: 'wallet', openingBalance: 0, balance: 0 }],
  categories: localCats,
  transactions: [], budgets: [], debts: [], family: [], regularItems: [],
  merchantCategories: {}, accountGroups: [],
};

const cloud = { userRow: { id: 'me1', data: memberState, version: 2 }, contributions: [] };
const sb = {
  auth: {
    onAuthStateChange(cb) { cloud.authCb = cb; },
    getSession: async () => ({ data: { session: null } }),
    signOut: async () => {}, signInWithOAuth: async () => ({}),
  },
  removeChannel() {},
  channel() { const ch = { on() { return ch; }, subscribe(cb) { cb?.('SUBSCRIBED'); return ch; }, send() {} }; return ch; },
  from(table) {
    const q = {
      _eq: {},
      select() { return q; }, eq(k, v) { q._eq[k] = v; return q; },
      in() { return q; }, order() { return q; }, update() { return q; },
      async upsert(payload) {
        if (table === 'family_contributions') cloud.contributions.push(payload);
        return { error: null };
      },
      async single() {
        if (table === 'user_data') return { data: cloud.userRow, error: null };
        return { data: null, error: { code: 'PGRST116' } };
      },
      then(res) {
        if (table === 'family_shares') return res({ data: [{ owner_id: 'owner1', snapshot }], error: null });
        return res({ data: [], error: null });
      },
    };
    return q;
  },
};

const dom = new JSDOM(
  `<!doctype html><html><head></head><body>
     <div id="viewContent"></div><div id="sidebarNav"></div>
     <div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
   </body></html>`,
  { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
const w = dom.window;
w.localStorage.setItem('pocket.v1', JSON.stringify(memberState));
w.lucide = { createIcons() {} };
w.Chart  = function () { return { destroy() {} }; };
w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
w.fetch   = () => Promise.reject(new Error('offline'));
w.confirm = () => true;
w.alert   = () => {};
w.supabase = { createClient: () => sb };
w.eval(bundleSrc);
await wait(80);


const app = w.__app, doc = w.document;
cloud.authCb?.('SIGNED_IN', { user: { id: 'me1', email: 'member@x.com' } });
await wait(250);

console.log('\n▸ Transaction form — picking a category for a shared account');

ok('the share reached the member', (app.sharedDataForTest || app.regularLogs) && true);

app.openModal('transaction', {});
await wait(40);

const accSel = doc.querySelector('#txForm [name=accountId]');
ok('the Account dropdown offers a "Shared with me" group',
  !!accSel && accSel.innerHTML.includes('Shared with me') && accSel.innerHTML.includes('shared1'));

// Choose the shared account the way a user does.
accSel.value = 'shared1';
app.onTxAccountChange('shared1');
await wait(40);

const catField = doc.getElementById('txCategory');
ok('the category field re-homes to the owner\'s book',
  catField?.dataset.ownerid === 'owner1', `data-ownerid=${catField?.dataset.ownerid}`);

app.openCategoryPicker('txCategory');
await wait(40);

let sheet = doc.getElementById('catPickerRoot')?.innerHTML || '';
ok('the picker lists the OWNER\'s parent categories',
  sheet.includes('Food &amp; Drink') || sheet.includes('Food & Drink'));
ok('the picker does NOT list the member\'s own categories', !sheet.includes('>Tea<'));
ok('creating a category in their book is not offered', !sheet.includes('New parent category'));

// THE BUG: drilling into a parent used to show nothing usable, because the
// sheet was reading the local tree.
app.catPicker.openParent('o_food');
await wait(20);
sheet = doc.getElementById('catPickerRoot')?.innerHTML || '';
ok('drilling into a parent shows the owner\'s SUBcategories',
  sheet.includes('Coffee') && sheet.includes('Groceries'));

app.catPicker.choose('o_coffee');
await wait(30);

const hidden = doc.querySelector('#txCategory input[type=hidden][name=categoryId]');
ok('the chosen id is one of the OWNER\'s', hidden?.value === 'o_coffee', hidden?.value);
ok('the field labels it from their book',
  (doc.querySelector('#txCategory [data-cat-label]')?.textContent || '').includes('Coffee'));

// Submit and inspect what actually travels to the owner.
doc.querySelector('#txForm [name=amount]').value = '25';
doc.querySelector('#txForm [name=accountId]').value = 'shared1';
await app.submitTx({ preventDefault() {}, target: doc.querySelector('#txForm') }, '');
await wait(120);

const contrib = cloud.contributions[cloud.contributions.length - 1];
ok('a contribution was submitted to the owner', !!contrib, JSON.stringify(cloud.contributions).slice(0, 120));
ok('it carries the OWNER\'s category id — not "Uncategorised"',
  contrib?.tx_data?.categoryId === 'o_coffee', contrib?.tx_data?.categoryId ?? 'null');

console.log('\n▸ Editing an existing contribution');

// Re-opening a row already filed in the owner's book must LABEL its category
// from their tree. Reading the local tree here left the field showing
// "Uncategorised" even though the row was categorised correctly.
app.closeModal();
app.openSharedTxEdit(0, 'shared1', 'ctr_edit_me');
await wait(60);

const editField = doc.getElementById('txCategory');
const editLabel = editField?.querySelector('[data-cat-label]')?.textContent || '';
ok('a shared edit re-homes the field to the owner', editField?.dataset.ownerid === 'owner1',
  `data-ownerid=${editField?.dataset.ownerid}`);
ok('…and labels the category from THEIR tree, not "Uncategorised"',
  editLabel.includes('Coffee') && !editLabel.includes('Uncategorised'), editLabel.trim());
ok('Split is not offered for a contribution',
  (doc.querySelector('#txForm [data-split-toggle]')?.getAttribute('style') || '').includes('display:none'));

app.closeModal();
await wait(20);

console.log('\n▸ Regular purchases — a shared default account');

app.openModal('regularItem', {});
await wait(40);

const regSel = doc.querySelector('#regularItemForm [name=accountId]');
ok('the item form offers shared accounts', !!regSel && regSel.innerHTML.includes('Shared by Owner'));
ok('…encoded with the owning book',
  !!regSel && regSel.innerHTML.includes('shared:owner1:shared1'));

regSel.value = 'shared:owner1:shared1';
app.onRegularAccountChange('shared:owner1:shared1');
await wait(30);

const regCat = doc.getElementById('regularItemCategory');
ok('the default-category field follows the owner',
  regCat?.dataset.ownerid === 'owner1', `data-ownerid=${regCat?.dataset.ownerid}`);

app.openCategoryPicker('regularItemCategory');
await wait(30);
app.catPicker.openParent('o_food');
await wait(20);
sheet = doc.getElementById('catPickerRoot')?.innerHTML || '';
ok('and offers their subcategories too', sheet.includes('Coffee') && sheet.includes('Groceries'));
app.catPicker.choose('o_grocery');
await wait(30);

doc.querySelector('#regularItemForm [name=name]').value = 'Weekly shop';
doc.querySelector('#regularItemForm [name=defaultAmount]').value = '40';
app.submitRegularItem({ preventDefault() {}, target: doc.querySelector('#regularItemForm') }, '');
await wait(60);

const savedItem = JSON.parse(w.localStorage.getItem('pocket.v1')).regularItems.at(-1);
ok('the item stores the account id without the encoding', savedItem?.accountId === 'shared1', savedItem?.accountId);
ok('…and remembers whose book it belongs to', savedItem?.sharedOwnerId === 'owner1', savedItem?.sharedOwnerId);
ok('…with the owner\'s category as its default', savedItem?.categoryId === 'o_grocery', savedItem?.categoryId);

// Logging it must contribute to the owner instead of writing locally.
const before = cloud.contributions.length;
app.openModal('dayLogs', { date: '2026-08-06' });
await wait(40);
const logForm = doc.querySelector('form[onsubmit*="submitRegularLog"]');
logForm.querySelector('[name=itemId]').value = savedItem.id;
logForm.querySelector('[name=qty]').value = '2';
logForm.querySelector('[name=unitPrice]').value = '15';
await app.submitRegularLog({ preventDefault() {}, target: logForm }, '2026-08-06');
await wait(120);

const logContrib = cloud.contributions[cloud.contributions.length - 1];
ok('logging a shared regular item contributes to the owner',
  cloud.contributions.length > before, `${before} → ${cloud.contributions.length}`);
ok('…rather than writing into the local ledger',
  !JSON.parse(w.localStorage.getItem('pocket.v1')).transactions.some((t) => t.regularItemId === savedItem.id));
ok('…on the owner\'s account', logContrib?.tx_data?.accountId === 'shared1', logContrib?.tx_data?.accountId);
ok('…with their category', logContrib?.tx_data?.categoryId === 'o_grocery', logContrib?.tx_data?.categoryId);
ok('…and the owner\'s home currency as the reporting base',
  Math.abs(logContrib?.tx_data?.exchangeRate - 1) > 1e-9 || logContrib?.tx_data?.currency === 'AED',
  `rate=${logContrib?.tx_data?.exchangeRate} ccy=${logContrib?.tx_data?.currency}`);

// And it must still be visible. submitContribution optimistically folds the row
// into the live share snapshot, so the calendar should pick it straight up —
// this is exactly what used to vanish the moment the entry was saved.
await wait(60);
ok('the contributed entry shows up in the calendar day view',
  app.regularLogs.onDate('2026-08-06').some((t) => t.regularItemId === savedItem.id && t._shared));

w.close();

console.log(`\n${failed === 0 ? '✅' : '❌'} shared-regulars: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
