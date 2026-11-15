/**
 * lock.smoke.mjs — a book that belongs to an account stays closed while
 * nobody is signed in (a lapsed sign-in), and never flashes on screen.
 *
 *   K1  owner's book, no session: lock screen, menus hidden, no entries on screen at any moment
 *   K2  only Sign in opens; other windows are refused while locked
 *   K3  signing in as the owner opens the book with everything kept
 *   K4  the sign-in lapses (not a Sign out): locked again, book still on the phone
 *   K5  another account signs in while locked: they get their own book, not this one
 *   K6  a book made without ever signing in is never locked
 *   K7  a real Sign out clears the book, so there's nothing to lock
 *
 * Run: node src/__smoke__/lock.smoke.mjs
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { FakeCloud } from './FakeCloud.mjs';

const bundleSrc = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');
let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
console.log('\nLock suite');

const tx = (id, amount, payee) => ({
  id, accountId: 'a1', categoryId: 'c1', amount, currency: 'USD', exchangeRate: 1, refAmount: amount, acctMinor: amount,
  type: 'expense', date: '2026-11-01', paymentType: 'card', recordState: 'cleared', tags: [], payee,
  hijriDate: { year: 1448, month: 4, day: 22, offset: 0 },
});
const book = (txs, accountName = 'MY-BANK') => ({
  user: { homeCurrency: 'USD', defaultCurrency: 'USD', theme: 'light', showHijri: false, hijriOffset: 0,
    customPaymentTypes: [], hiddenPaymentTypes: [], defaultAccountId: '', defaultPaymentType: 'card' },
  accounts: [{ id: 'a1', name: accountName, currency: 'USD', type: 'cash', color: '#000', icon: 'wallet', openingBalance: 0, balance: 0, groupId: null }],
  categories: [{ id: 'c1', name: 'Food', type: 'expense', parentId: null, color: '#f97316', icon: 'tag' }],
  transactions: txs, budgets: [], debts: [], family: [], regularItems: [], merchantCategories: {}, accountGroups: [],
});
const ME = { id: 'me', email: 'me@x.com' };
const OTHER = { id: 'other', email: 'other@x.com' };
const FREE = { plan: 'free', planName: 'Free', state: 'free', access: { sync: 'none', telegram: 'none', sharing: 'none' },
  seats: 1, seatsUsed: 1, coveredBy: [], aiCredits: 0 };

function tab(cloud, session, seed = null) {
  const clients = { me: cloud.client(ME)(), other: cloud.client(OTHER)() };
  const createClient = () => ({
    auth: clients.me.auth,
    removeChannel() {},
    channel: (...a) => clients[session.current.id].channel(...a),
    rpc: (fn, args) => clients[session.current.id].rpc(fn, args),
    from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }),
  });
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="planBanner"></div><div id="spaceBar"></div>
    <div id="viewContent"></div><div id="sidebarNav"></div><div id="bottomNav"></div><div id="authPill"></div><div id="app"></div></body></html>`,
  { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  if (seed) seed(w);
  // Every version of the page the person could have seen, from the very first paint.
  w.__seen = [];
  new w.MutationObserver(() => w.__seen.push(w.document.getElementById('viewContent').textContent))
    .observe(w.document.getElementById('viewContent'), { childList: true, subtree: true, characterData: true });
  w.lucide = { createIcons() {} };
  w.Chart = function () { return { destroy() {} }; };
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.fetch = () => Promise.reject(new Error('offline'));
  w.confirm = () => true; w.alert = () => {};
  w.supabase = { createClient };
  w.eval(bundleSrc);
  return w;
}
const signIn = async (cloud, session, user) => { session.current = user; cloud.authCb('SIGNED_IN', { user }); await wait(400); };
const view = (w) => w.document.getElementById('viewContent');
const lockShown = (w) => !!view(w).querySelector('.lock-screen:not(.opening)');

{
  const cloud = new FakeCloud();
  cloud.setBook('me', book([tx('m1', 100, 'MY-SECRET-PAYEE')]), ME.email);
  cloud.plans.set('other', FREE);
  const session = { current: ME };
  const w = tab(cloud, session, (win) => {
    win.localStorage.setItem('pocket.v1', JSON.stringify(book([tx('m1', 100, 'MY-SECRET-PAYEE'), tx('m2', 5, 'MY-UNSYNCED')])));
    win.localStorage.setItem('pocket.v1.owner', 'me');
  });
  await wait(200);
  ok('K1 the lock screen is shown', lockShown(w) && /Your book is locked/.test(view(w).textContent));
  ok('K1 menus are hidden', w.document.body.classList.contains('pocket-locked'));
  ok('K1 no entry or account name was on screen at any moment', !w.__seen.some((t) => /MY-SECRET-PAYEE|MY-UNSYNCED|MY-BANK/.test(t)), String(w.__seen.find((t) => /MY-/.test(t))).slice(0, 80));
  ok('K1 the book is still on the phone', (w.localStorage.getItem('pocket.v1') || '').includes('MY-UNSYNCED'));

  w.__app.closeModal?.();
  w.__app.openModal('settings', {});
  await wait(20);
  ok('K2 Settings won\'t open while locked', !/Settings/.test(w.document.querySelector('.modal, #modalRoot')?.textContent || '') && w.__app.locked);
  w.__app.navigate('transactions');
  await wait(20);
  ok('K2 navigating doesn\'t show the book either', lockShown(w) && !/MY-SECRET-PAYEE/.test(view(w).textContent));

  await signIn(cloud, session, ME);
  await wait(300);
  w.__app.navigate('transactions');
  await wait(20);
  ok('K3 signing in as the owner opens the book', !w.__app.locked && !w.document.body.classList.contains('pocket-locked') && /MY-SECRET-PAYEE/.test(view(w).textContent));

  cloud.authCb('SIGNED_OUT', null);   // the session lapsed — not a Sign out
  await wait(200);
  ok('K4 a lapsed sign-in locks it again', lockShown(w) && !/MY-SECRET-PAYEE/.test(view(w).textContent));
  ok('K4 …and keeps the book on the phone', (w.localStorage.getItem('pocket.v1') || '').includes('MY-SECRET-PAYEE'));

  await signIn(cloud, session, OTHER);
  await wait(300);
  w.__app.navigate('transactions');
  await wait(20);
  ok('K5 another account gets its own book, not this one', !w.__app.locked && !/MY-SECRET-PAYEE|MY-BANK/.test(view(w).textContent));
  ok('K5 the device now belongs to them', w.localStorage.getItem('pocket.v1.owner') === 'other');
}
{
  const cloud = new FakeCloud();
  const session = { current: ME };
  const w = tab(cloud, session, (win) => {
    win.localStorage.setItem('pocket.v1', JSON.stringify(book([tx('g1', 300, 'GUEST-ENTRY')])));
  });
  await wait(200);
  w.__app.closeModal?.();
  w.__app.navigate('transactions');
  await wait(20);
  ok('K6 a book made without signing in is never locked', !w.__app.locked && /GUEST-ENTRY/.test(view(w).textContent));
}
{
  const cloud = new FakeCloud();
  cloud.setBook('me', book([tx('m1', 100, 'MY-SECRET-PAYEE')]), ME.email);
  const session = { current: ME };
  const w = tab(cloud, session);
  await wait(100);
  await signIn(cloud, session, ME);
  await wait(300);
  await w.__app.signOut(); await wait(300);
  w.__app.closeModal?.();
  ok('K7 after a real Sign out the book is gone and nothing is locked', !w.__app.locked && !(w.localStorage.getItem('pocket.v1') || '').includes('MY-SECRET-PAYEE') && !w.localStorage.getItem('pocket.v1.owner'));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
