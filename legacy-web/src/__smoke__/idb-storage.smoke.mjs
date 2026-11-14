/**
 * idb-storage.smoke.mjs — the sync records live in IndexedDB.
 *
 * localStorage holds about 5 MB per site and the app's working copy of a
 * large book already fills half of it, so the copy the cloud last confirmed
 * (and its load cursor) could not be saved next to it: every reload then
 * downloaded the whole book again. Those records — and the shared books —
 * now live in IndexedDB (fake-indexeddb stands in for the browser's here).
 *
 *   K1  IndexedDbStore reads back what it wrote, in write order, and removes.
 *   K2  UserRecord ignores another user's record and moves an old
 *       localStorage record over, removing it from localStorage.
 *   I1  After sign-in the copy is in IndexedDB, not in localStorage.
 *   I2  A reload asks only for changes — the cursor survived.
 *   I3  A copy left in localStorage by the previous version is moved over on
 *       first load and the load is still a delta.
 *   I4  A family member's shares survive a reload: no full share load.
 *   I5  Signing out removes both records.
 *
 * Run: node src/__smoke__/idb-storage.smoke.mjs
 */
import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { FakeCloud } from './FakeCloud.mjs';
import { IndexedDbStore } from '../core/KeyValueStore.js';
import { UserRecord } from '../core/UserRecord.js';

const bundleSrc = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('\nIndexedDB storage suite');

// ═══ K — the stores ════════════════════════════════════════════════════════
{
  console.log('\n K — key-value store');
  const kv = new IndexedDbStore();
  await kv.set('k', { a: 1 });
  ok('K1 reads back what it wrote', (await kv.get('k'))?.a === 1);
  kv.set('k', { a: 2 });
  kv.set('k', { a: 3 });
  await kv.set('k2', 'x');
  ok('K1 writes land in the order they were made', (await kv.get('k'))?.a === 3);
  await kv.remove('k');
  ok('K1 removes', (await kv.get('k')) === undefined);

  // A localStorage stand-in for the move test (node has none).
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  const rec = new UserRecord('rec.test', new IndexedDbStore());
  await rec.save({ v: 'mine' });                    // saved with no user yet → userId null
  ok('K2 another user\'s record is ignored', (await rec.load('u1')) === null);
  await new IndexedDbStore().remove('rec.test');
  mem.set('rec.test', JSON.stringify({ userId: 'u1', v: 'old' }));
  const moved = await new UserRecord('rec.test', new IndexedDbStore()).load('u1');
  ok('K2 an old localStorage record is moved over', moved?.v === 'old');
  ok('K2 …and removed from localStorage', !mem.has('rec.test'));
  ok('K2 …and is now in IndexedDB', (await new IndexedDbStore().get('rec.test'))?.v === 'old');
  delete globalThis.localStorage;
}

// ═══ I — the app ═══════════════════════════════════════════════════════════
const tx = (id, amount, over = {}) => ({
  id, accountId: 'a1', categoryId: 'c1', amount, currency: 'USD', exchangeRate: 1, refAmount: amount,
  acctMinor: amount, type: 'expense', date: '2026-11-01', paymentType: 'card', recordState: 'cleared',
  tags: [], hijriDate: { year: 1448, month: 4, day: 22, offset: 0 }, ...over,
});
const baseState = (txs = []) => ({
  user: { homeCurrency: 'USD', defaultCurrency: 'USD', theme: 'light', showHijri: false, hijriOffset: 0,
    customPaymentTypes: [], hiddenPaymentTypes: [], defaultAccountId: '', defaultPaymentType: 'card' },
  accounts: [{ id: 'a1', name: 'Cash', currency: 'USD', type: 'cash', color: '#000', icon: 'wallet',
    openingBalance: 0, balance: 0, groupId: null }],
  categories: [{ id: 'c1', name: 'Food', type: 'expense', parentId: null, color: '#f97316', icon: 'tag' }],
  transactions: txs, budgets: [], debts: [], family: [], regularItems: [], merchantCategories: {}, accountGroups: [],
});

function boot({ supabase, storage } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
       <div id="spaceBar"></div><div id="viewContent"></div><div id="sidebarNav"></div>
       <div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
     </body></html>`,
    { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  window.indexedDB = globalThis.indexedDB;          // one browser profile across reloads
  if (storage) storage(window);
  window.lucide = { createIcons() {} };
  window.Chart  = function () { return { destroy() {} }; };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.fetch   = () => Promise.reject(new Error('offline'));
  window.confirm = () => true;
  window.alert   = () => {};
  if (supabase) window.supabase = supabase;
  window.eval(bundleSrc);
  return window;
}
const carryLocal = (w) => {
  const out = {};
  for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); out[k] = w.localStorage.getItem(k); }
  return out;
};
const restore = (carried) => (win) => { for (const [k, v] of Object.entries(carried)) win.localStorage.setItem(k, v); };
const idb = new IndexedDbStore();

{
  console.log('\n I — the app on IndexedDB');
  const USER = { id: 'u1', email: 'a@b.c' };
  const cloud = new FakeCloud();
  cloud.setBook('u1', baseState([tx('t1', 100), tx('t2', 200)]));

  const w1 = boot({ supabase: { createClient: cloud.client(USER) } });
  await wait(80);
  cloud.authCb?.('SIGNED_IN', { user: USER });
  await wait(300);
  const stored = await idb.get('pocket.v2.baseline');
  ok('I1 the copy and its cursor are in IndexedDB', stored?.userId === 'u1' && stored.state?.transactions?.length === 2
     && typeof stored.cursor === 'string', JSON.stringify(stored && { u: stored.userId, c: stored.cursor }));
  ok('I1 …and not in localStorage', w1.localStorage.getItem('pocket.v2.baseline') === null);

  const carried = carryLocal(w1);
  w1.close();
  cloud.book('u1').transactions.push(tx('t3', 300));
  const full1 = cloud.fullLoads;
  const w2 = boot({ supabase: { createClient: cloud.client(USER) }, storage: restore(carried) });
  await wait(80);
  cloud.authCb?.('SIGNED_IN', { user: USER });
  await wait(300);
  const local = JSON.parse(w2.localStorage.getItem('pocket.v1')).transactions.map((t) => t.id).sort().join(',');
  ok('I2 a reload asks only for changes', cloud.fullLoads === full1, `${cloud.fullLoads - full1} full loads`);
  ok('I2 …and has the new entry', local === 't1,t2,t3', local);
  const carried2 = carryLocal(w2);
  w2.close();

  // I3 — what the previous version left: the copy in localStorage, nothing in IndexedDB.
  const legacy = await idb.get('pocket.v2.baseline');
  await idb.remove('pocket.v2.baseline');
  const full2 = cloud.fullLoads;
  const w3 = boot({ supabase: { createClient: cloud.client(USER) },
    storage: restore({ ...carried2, 'pocket.v2.baseline': JSON.stringify(legacy) }) });
  await wait(80);
  cloud.authCb?.('SIGNED_IN', { user: USER });
  await wait(300);
  ok('I3 an old localStorage copy is moved to IndexedDB', (await idb.get('pocket.v2.baseline'))?.userId === 'u1');
  ok('I3 …and removed from localStorage', w3.localStorage.getItem('pocket.v2.baseline') === null);
  ok('I3 …and the load was still a delta', cloud.fullLoads === full2, `${cloud.fullLoads - full2} full loads`);

  // I5 — sign-out removes both records
  await w3.__app.signOut();
  await wait(150);
  ok('I5 signing out removes the copy', (await idb.get('pocket.v2.baseline')) === undefined);
  w3.close();
}

{
  const cloud = new FakeCloud();
  const owner = baseState([tx('j1', 100, { accountId: 'joint', note: 'joint-one' })]);
  owner.accounts.push({ id: 'joint', name: 'Joint', currency: 'USD', type: 'bank', color: '#000', icon: 'landmark',
    openingBalance: 0, balance: 0, groupId: null });
  owner.family = [{ id: 'f1', name: 'Wife', email: 'wife@x.com', permissions: [{ accountId: 'joint', access: 'add' }] }];
  cloud.setBook('owner1', owner, 'owner@x.com');
  cloud.setBook('wife1', baseState(), 'wife@x.com');
  const WIFE = { id: 'wife1', email: 'wife@x.com' };

  const w1 = boot({ supabase: { createClient: cloud.client(WIFE) } });
  await wait(80);
  cloud.authCb?.('SIGNED_IN', { user: WIFE });
  await wait(300);
  ok('I4 the shares are kept in IndexedDB', (await idb.get('pocket.v2.shares'))?.shares?.length === 1);
  const carried = carryLocal(w1);
  w1.close();

  cloud.book('owner1').transactions.push(tx('j2', 200, { accountId: 'joint', note: 'joint-two' }));
  const before = cloud.fullShareLoads;
  const w2 = boot({ supabase: { createClient: cloud.client(WIFE) }, storage: restore(carried) });
  await wait(80);
  cloud.authCb?.('SIGNED_IN', { user: WIFE });
  await wait(300);
  w2.__app.switchSpace('owner1');
  const notes = (w2.__app.spaces.active().transactions || []).map((t) => t.note).join(',');
  ok('I4 after a reload the shares load as a delta', cloud.fullShareLoads === before, `${cloud.fullShareLoads - before} full`);
  ok('I4 …with the owner\'s new entry', notes.includes('joint-two') && notes.includes('joint-one'), notes);

  await w2.__app.signOut();
  await wait(150);
  ok('I5 signing out removes the shares', (await idb.get('pocket.v2.shares')) === undefined);
  w2.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
