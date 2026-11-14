/**
 * delta-sync.smoke.mjs — loading only what changed.
 *
 * The app used to download the whole book on every load and after every
 * change made elsewhere (a Telegram entry, a family member, another device).
 * It now asks `pocket_get_changes` for what changed since its last load and
 * merges that onto the copy it keeps (BookDelta + SyncBaseline).
 *
 *   B1–B6  BookDelta: full load, replay of changes and deletions, the count
 *          check that rejects an untrustworthy result, no mutation of inputs.
 *   E1     A device's first load reads the whole book and keeps a cursor.
 *   E2     After a reload the next load is a delta, not the whole book.
 *   E3     A change made elsewhere arrives as a delta: new, edited and deleted
 *          entries all land, with no full reload.
 *   E4     A local copy that no longer matches the cloud (count check fails)
 *          falls back to one full load and ends up exactly like the cloud.
 *   E5     An edit made here, unsaved when the tab closed, still survives a
 *          delta load and reaches the cloud.
 *   S1–S4  ShareDelta: shares merge per owner/space, newest first; a share
 *          whose count doesn't add up (an account shared or unshared) or that
 *          has no previous copy rejects the whole result.
 *   M1–M3  A family member's app follows the owner's changes (added,
 *          deleted, moved to an account they can't see) through deltas, after
 *          one full load.
 *
 * Run: node src/__smoke__/delta-sync.smoke.mjs
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { FakeCloud } from './FakeCloud.mjs';
import { BookDelta } from '../core/BookDelta.js';
import { ShareDelta } from '../core/ShareDelta.js';

const bundleSrc = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = (list) => (list || []).map((t) => t.id).sort().join(',');

const tx = (id, amount, over = {}) => ({
  id, accountId: 'a1', categoryId: 'c1', amount, currency: 'USD', exchangeRate: 1, refAmount: amount,
  acctMinor: amount, type: 'expense', date: '2026-11-01', paymentType: 'card', recordState: 'cleared',
  tags: [], hijriDate: { year: 1448, month: 4, day: 22, offset: 0 }, ...over,
});

console.log('\ndelta sync suite');

// ═══ B — BookDelta ═════════════════════════════════════════════════════════
{
  console.log('\n B — merging a change set');
  const head = { user: { homeCurrency: 'USD' }, accounts: [{ id: 'a1' }], categories: [{ id: 'c1' }] };
  const full = { ...head, _delta: { cursor: 'k1', full: true, count: 2, put: [tx('t1', 100), tx('t2', 200)], remove: [] } };

  const r1 = BookDelta.merge(null, full);
  ok('B1 a full response is the whole book', ids(r1?.book.transactions) === 't1,t2' && r1.cursor === 'k1');
  ok('B1 …with the head and without the _delta wrapper', r1.book.accounts.length === 1 && !('_delta' in r1.book));

  const prev = r1.book;
  const prevJson = JSON.stringify(prev);
  const delta = { ...head, accounts: [{ id: 'a1' }, { id: 'a2' }],
    _delta: { cursor: 'k2', full: false, count: 2, put: [tx('t2', 250), tx('t3', 300)], remove: ['t1'] } };
  const r2 = BookDelta.merge(prev, delta);
  ok('B2 changed entry replaced, new one added, deleted one dropped', ids(r2?.book.transactions) === 't2,t3');
  ok('B2 the edit is the new version', r2.book.transactions.find((t) => t.id === 't2').amount === 250);
  ok('B3 head lists come from the response in full', r2.book.accounts.length === 2 && r2.cursor === 'k2');
  ok('B4 the previous copy is not mutated', JSON.stringify(prev) === prevJson);

  const wrongCount = { ...head, _delta: { ...delta._delta, count: 3 } };
  ok('B5 a count that doesn\'t add up is rejected', BookDelta.merge(prev, wrongCount) === null);
  ok('B6 a delta with no previous copy is rejected', BookDelta.merge(null, delta) === null);
  ok('B6 …and so is a response without _delta', BookDelta.merge(prev, head) === null);
  const resent = { ...head, _delta: { cursor: 'k3', full: false, count: 2, put: [tx('t2', 200)], remove: ['gone-already'] } };
  ok('B6 re-sent rows and unknown removals are harmless', ids(BookDelta.merge(prev, resent)?.book.transactions) === 't1,t2');
}


// ═══ S — ShareDelta ════════════════════════════════════════════════════════
{
  console.log('\n S — merging shared books');
  const head = (owner, space = 'default') => ({ _ownerId: owner, _spaceId: space, accounts: [{ id: 'j1' }], permission: { j1: 'add' } });
  const full = { cursor: 'c1', shares: [
    { ...head('o1'), _delta: { full: true, count: 2, put: [tx('s2', 20, { date: '2026-11-02' }), tx('s1', 10, { date: '2026-11-01' })], remove: [] } },
    { ...head('o2'), _delta: { full: true, count: 0, put: [], remove: [] } },
  ] };
  const r1 = ShareDelta.merge(null, full);
  ok('S1 a full response gives every share', r1?.shares.length === 2 && ids(r1.shares[0].transactions) === 's1,s2' && r1.cursor === 'c1');
  ok('S1 …without the _delta wrapper', !('_delta' in r1.shares[0]));

  const delta = { cursor: 'c2', shares: [
    { ...head('o1'), _delta: { full: false, count: 3, put: [tx('s3', 30, { date: '2026-11-01' }), tx('s4', 40, { date: '2026-11-03' }), tx('s2', 22, { date: '2026-11-02' })], remove: ['s1'] } },
    { ...head('o2'), _delta: { full: false, count: 0, put: [], remove: [] } },
  ] };
  const r2 = ShareDelta.merge(r1.shares, delta);
  ok('S2 entries added, edited and removed per share', ids(r2?.shares[0].transactions) === 's2,s3,s4'
     && r2.shares[0].transactions.find((t) => t.id === 's2').amount === 22);
  ok('S2 kept newest first', r2.shares[0].transactions.map((t) => t.id).join(',') === 's4,s2,s3',
     r2.shares[0].transactions.map((t) => t.id).join(','));
  ok('S3 a share whose count doesn\'t add up rejects the result',
     ShareDelta.merge(r1.shares, { ...delta, shares: [{ ...delta.shares[0], _delta: { ...delta.shares[0]._delta, count: 9 } }, delta.shares[1]] }) === null);
  ok('S4 a delta for a share with no previous copy rejects the result',
     ShareDelta.merge([r1.shares[1]], delta) === null);
}

// ═══ E — the app against the cloud ═════════════════════════════════════════
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
       <div id="viewContent"></div><div id="sidebarNav"></div>
       <div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
     </body></html>`,
    { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
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

const USER = { id: 'u1', email: 'a@b.c' };
const signIn = async (cloud, ms = 200) => { cloud.authCb?.('SIGNED_IN', { user: USER }); await wait(ms); };
const KEYS = ['pocket.v1', 'pocket.v1.pending', 'pocket.v2.baseline'];
const carry = (w) => Object.fromEntries(KEYS.map((k) => [k, w.localStorage.getItem(k)]));
const restore = (carried, edit = (x) => x) => (win) => {
  for (const [k, v] of Object.entries(edit({ ...carried }))) if (v) win.localStorage.setItem(k, v);
};
const localTxs = (w) => JSON.parse(w.localStorage.getItem('pocket.v1')).transactions;
const loads = (cloud) => cloud.calls.filter((c) => c.fn === 'pocket_get_changes');
const book = (cloud) => cloud.book('u1').transactions;

{
  console.log('\n E — loading through the app');
  const cloud = new FakeCloud();
  cloud.setBook('u1', baseState([tx('t1', 100), tx('t2', 200), tx('t3', 300)]));

  // E1 — first load on this device
  const w1 = boot({ supabase: { createClient: cloud.client(USER) } });
  await wait(80);
  await signIn(cloud);
  ok('E1 first load reads the whole book', cloud.fullLoads === 1 && loads(cloud).length === 1,
     `${cloud.fullLoads} full of ${loads(cloud).length}`);
  ok('E1 …and has every entry', ids(localTxs(w1)) === 't1,t2,t3');
  const baseline = JSON.parse(w1.localStorage.getItem('pocket.v2.baseline'));
  ok('E1 a cursor is kept for next time', typeof baseline?.cursor === 'string' && baseline.cursor.length > 0);

  // E3 — another device adds, edits and deletes; the live feed fires
  const before = loads(cloud).length;
  const cb = cloud.book('u1');
  cb.transactions = cb.transactions.filter((t) => t.id !== 't1');            // deleted elsewhere
  Object.assign(cb.transactions.find((t) => t.id === 't2'), { amount: 222, refAmount: 222, acctMinor: 222 }); // edited elsewhere
  cb.transactions.push(tx('t4', 400, { addedBy: 'wife@x.com' }));             // e.g. a Telegram entry
  cloud.emit('transactions', 'u1', { id: 't4' });
  await wait(800);
  const after = loads(cloud).slice(before);
  ok('E3 the change arrives as a delta, not a full load',
     after.length >= 1 && after.every((c) => c.args.since != null), JSON.stringify(after.map((c) => c.args)));
  ok('E3 new, edited and deleted entries all land', ids(localTxs(w1)) === 't2,t3,t4'
     && localTxs(w1).find((t) => t.id === 't2').amount === 222, JSON.stringify(localTxs(w1).map((t) => [t.id, t.amount])));
  const txSaves = cloud.calls.filter((c) => c.fn === 'pocket_apply_changes' && c.args.changes.put?.transactions);
  ok('E3 none of the other device\'s entries was saved back', txSaves.length === 0, JSON.stringify(txSaves.map((c) => c.args.changes.put.transactions.map((t) => t.id))));

  // E2 — reload: the next load is a delta
  const carried = carry(w1);
  w1.close();
  const fullBefore = cloud.fullLoads;
  const w2 = boot({ supabase: { createClient: cloud.client(USER) }, storage: restore(carried) });
  await wait(80);
  await signIn(cloud);
  ok('E2 after a reload no full load is needed', cloud.fullLoads === fullBefore, `${cloud.fullLoads - fullBefore} full loads`);
  ok('E2 …and the book is the cloud\'s', ids(localTxs(w2)) === ids(book(cloud)));

  // E5 — an unsaved local edit survives a delta load
  cloud.offline = true;
  w2.__app.openModal('transaction', {});
  await wait(20);
  const $ = (s) => w2.document.querySelector(s);
  $('#txForm [name=amount]').value = '77';
  await w2.__app.submitTx({ preventDefault() {}, target: $('#txForm') }, '');
  await wait(1300);
  const carried2 = carry(w2);
  w2.close();
  cloud.offline = false;
  cloud.book('u1').transactions.push(tx('t5', 500));   // meanwhile, elsewhere

  const fullBefore2 = cloud.fullLoads;
  const w3 = boot({ supabase: { createClient: cloud.client(USER) }, storage: restore(carried2) });
  await wait(80);
  await signIn(cloud, 400);
  const amounts = book(cloud).map((t) => t.amount).sort((a, b) => a - b);
  ok('E5 the unsaved entry reached the cloud alongside the other device\'s', amounts.includes(7700) && amounts.includes(500),
     JSON.stringify(amounts));
  ok('E5 …without a full load', cloud.fullLoads === fullBefore2, `${cloud.fullLoads - fullBefore2} full loads`);
  ok('E5 this device matches the cloud', ids(localTxs(w3)) === ids(book(cloud)));
  const carried3 = carry(w3);
  w3.close();

  // E4 — a stored copy that is out of step: count check → one full load
  const tampered = restore(carried3, (c) => {
    const rec = JSON.parse(c['pocket.v2.baseline']);
    rec.state.transactions = rec.state.transactions.filter((t) => t.id !== 't3'); // lose a row the cloud still has
    return { ...c, 'pocket.v2.baseline': JSON.stringify(rec) };
  });
  const fullBefore3 = cloud.fullLoads;
  const w4 = boot({ supabase: { createClient: cloud.client(USER) }, storage: tampered });
  await wait(80);
  await signIn(cloud, 400);
  ok('E4 an out-of-step copy falls back to exactly one full load', cloud.fullLoads === fullBefore3 + 1,
     `${cloud.fullLoads - fullBefore3} full loads`);
  ok('E4 …and ends up exactly like the cloud', ids(localTxs(w4)) === ids(book(cloud)),
     `${ids(localTxs(w4))} vs ${ids(book(cloud))}`);
  w4.close();
}

// ═══ M — a family member following the owner's changes ═════════════════════
{
  console.log('\n M — a member\'s shared view');
  const cloud = new FakeCloud();
  const owner = baseState([
    tx('j1', 100, { accountId: 'joint', note: 'joint-one', date: '2026-11-01' }),
    tx('j2', 200, { accountId: 'joint', note: 'joint-two', date: '2026-11-02' }),
    tx('p1', 300, { accountId: 'a1', note: 'private-one' }),
  ]);
  owner.accounts.push({ id: 'joint', name: 'Joint', currency: 'USD', type: 'bank', color: '#000', icon: 'landmark',
    openingBalance: 0, balance: 0, groupId: null });
  owner.family = [{ id: 'f1', name: 'Wife', email: 'wife@x.com', permissions: [{ accountId: 'joint', access: 'add' }] }];
  cloud.setBook('owner1', owner, 'owner@x.com');
  const WIFE = { id: 'wife1', email: 'wife@x.com' };
  cloud.setBook('wife1', baseState(), 'wife@x.com');

  const w = boot({ supabase: { createClient: cloud.client(WIFE) } });
  await wait(80);
  cloud.authCb?.('SIGNED_IN', { user: WIFE });
  await wait(300);
  const shareCalls = () => cloud.calls.filter((c) => c.fn === 'pocket_get_shared_changes');
  const seen = () => {
    w.__app.switchSpace('owner1');
    return (w.__app.spaces.active().transactions || []).map((t) => t.note).join(' | ');
  };
  ok('M1 first load reads the shares in full', cloud.fullShareLoads === 1, `${cloud.fullShareLoads} full of ${shareCalls().length}`);
  let text = seen();
  ok('M1 the member sees the joint entries, not the private one',
     text.includes('joint-one') && text.includes('joint-two') && !text.includes('private-one'), text);

  // The owner (or the bot) adds one, deletes one and moves one off the joint account.
  const book = cloud.book('owner1');
  book.transactions.push(tx('j3', 300, { accountId: 'joint', note: 'joint-three', date: '2026-11-03', addedBy: 'owner@x.com' }));
  book.transactions = book.transactions.filter((t) => t.id !== 'j1');
  Object.assign(book.transactions.find((t) => t.id === 'j2'), { accountId: 'a1' });
  const before = cloud.fullShareLoads;
  cloud.emit('transactions', 'owner1', { id: 'j3' });
  await wait(900);
  text = seen();
  ok('M2 the new entry arrives', text.includes('joint-three'), text);
  ok('M2 the deleted one and the one moved to a private account are gone',
     !text.includes('joint-one') && !text.includes('joint-two'));
  ok('M3 …all through a delta, with no full reload of the share', cloud.fullShareLoads === before
     && shareCalls().slice(-1)[0]?.args.since != null, `${cloud.fullShareLoads - before} full loads`);
  w.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
