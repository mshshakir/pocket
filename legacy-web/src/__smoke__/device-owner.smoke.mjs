/**
 * device-owner.smoke.mjs — one browser, several people: nobody sees another
 * person's book.
 *
 * Reported 2026-11-14: signed out of one account, signed in with another (on
 * Free, which keeps its book on the device) and saw the first account's data.
 * Another open tab still signed in to the first account re-saved its book to
 * the shared browser storage after the sign-out, and nothing said whose that
 * book was.
 *
 *   O1  Signing out wipes the device; the next person (Free) sees a fresh book.
 *   O2  Another tab re-saves the first person's book after they sign out: the
 *       next person still doesn't see it…
 *   O3  …and when the first person signs in again here, it comes back to them,
 *       including an entry the cloud never received.
 *   O4  A device from before the owner was recorded (book + baseline of the
 *       first person, no owner): the next person doesn't see it.
 *   O5  A book made before signing in (a guest's) becomes theirs, as before.
 *   O6  The same person signing back in after their session lapsed keeps their book.
 *   O7  Nothing of the first person's book reaches the second person's cloud.
 *
 * Run: node src/__smoke__/device-owner.smoke.mjs
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

/** A browser tab whose Supabase session can be switched between people, like the real one. */
function tab(cloud, session, seed = null) {
  const clients = { me: cloud.client(ME)(), other: cloud.client(OTHER)() };
  const createClient = () => ({
    auth: clients.me.auth,
    removeChannel() {},
    channel: (...a) => clients[session.current.id].channel(...a),
    rpc: (fn, args) => clients[session.current.id].rpc(fn, args),
    from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }),
  });
  const dom = new JSDOM(`<!doctype html><html><body><div id="planBanner"></div><div id="spaceBar"></div>
    <div id="viewContent"></div><div id="sidebarNav"></div><div id="bottomNav"></div><div id="authPill"></div><div id="app"></div></body></html>`,
  { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  if (seed) seed(w);
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
const stored = (w) => w.localStorage.getItem('pocket.v1') || '';
const shows = (w, text) => { w.__app.navigate('transactions'); return w.document.body.textContent.includes(text) || JSON.stringify(w.__app ? JSON.parse(stored(w)) : {}).includes(text); };
const addTx = async (w, amount) => {
  w.__app.openModal('transaction', {});
  await wait(20);
  const form = w.document.querySelector('#txForm');
  form.querySelector('[name=amount]').value = String(amount);
  await w.__app.submitTx({ preventDefault() {}, target: form }, '');
};

console.log('\ndevice owner suite');

{
  console.log('\n O1–O3 — two people, one browser');
  const cloud = new FakeCloud();
  cloud.setBook('me', book([tx('m1', 100, 'MY-SECRET-PAYEE')]), ME.email);
  cloud.plans.set('other', FREE);
  const session = { current: ME };
  const w = tab(cloud, session);
  await wait(100);
  await signIn(cloud, session, ME);
  ok('O1 setup: my book is on screen', shows(w, 'MY-SECRET-PAYEE'));

  await w.__app.signOut(); await wait(300);
  ok('O1 signing out wipes the device', !stored(w).includes('MY-SECRET-PAYEE'));

  // Another tab, still holding my book in memory, saves it again after the sign-out —
  // exactly as the real app did: same book, and (with the fix) its owner beside it.
  w.localStorage.setItem('pocket.v1', JSON.stringify(book([tx('m1', 100, 'MY-SECRET-PAYEE'), tx('m2', 4242, 'MY-UNSYNCED-ENTRY')])));
  w.localStorage.setItem('pocket.v1.owner', 'me');
  w.localStorage.setItem('pocket.v1.pending', JSON.stringify({ userId: 'me', since: new Date().toISOString(), baseVersion: null }));

  await signIn(cloud, session, OTHER);
  ok('O2 the next person (Free) does not see my book', !shows(w, 'MY-SECRET-PAYEE') && !shows(w, 'MY-BANK'),
     stored(w).slice(0, 120));
  ok('O2 …the device now says the book is theirs', w.localStorage.getItem('pocket.v1.owner') === 'other');
  await addTx(w, 7);
  await wait(800);

  await w.__app.signOut(); await wait(300);
  await signIn(cloud, session, ME);
  await wait(1200);
  ok('O3 my book comes back to me', shows(w, 'MY-SECRET-PAYEE'));
  // The cloud has no record of that entry's base (the sign-out cleared it), so —
  // as the app always does then — the cloud copy wins and the device's copy is
  // kept as a backup to restore from Settings: only for me.
  const mine = w.__app.conflictBackups();
  ok('O3 …and the entry the cloud never had is kept for me as a backup',
     mine.length === 1 && JSON.stringify(w.__app.conflictBackups && JSON.parse(w.localStorage.getItem(mine[0].key))).includes('MY-UNSYNCED-ENTRY'),
     JSON.stringify(mine));
  await w.__app.signOut(); await wait(300);
  await signIn(cloud, session, OTHER);
  ok('O3 …which the other person is not shown', w.__app.conflictBackups().length === 0);
  w.__app.openModal('settings', {}); await wait(100);
  ok('O3 …not even in Settings', !/Recover a saved copy/.test(w.document.body.textContent));
  w.__app.closeModal();
  ok('O7 nothing of mine reached the other person\'s cloud', !JSON.stringify(cloud.book('other') ?? {}).includes('MY-'));
}

{
  console.log('\n O4 — a device from before the owner was recorded');
  const cloud = new FakeCloud();
  cloud.plans.set('other', FREE);
  const session = { current: OTHER };
  const w = tab(cloud, session, (win) => {
    win.localStorage.setItem('pocket.v1', JSON.stringify(book([tx('m1', 100, 'MY-SECRET-PAYEE')])));
    win.localStorage.setItem('pocket.v2.baseline', JSON.stringify({ userId: 'me', state: book([]), cursor: 'c1' }));
  });
  await wait(100);
  await signIn(cloud, session, OTHER);
  ok('O4 the next person does not see the earlier book', !shows(w, 'MY-SECRET-PAYEE'));
  ok('O4 …it is kept for its owner, out of sight', (w.localStorage.getItem('pocket.v2.parked.me') || '').includes('MY-SECRET-PAYEE'));
}

{
  console.log('\n O5 — a guest\'s book becomes theirs when they sign in');
  const cloud = new FakeCloud();
  cloud.plans.set('other', FREE);
  const session = { current: OTHER };
  const w = tab(cloud, session, (win) => win.localStorage.setItem('pocket.v1', JSON.stringify(book([tx('g1', 300, 'GUEST-ENTRY')], 'GUEST-BANK'))));
  await wait(100);
  await signIn(cloud, session, OTHER);
  ok('O5 the guest book is kept', shows(w, 'GUEST-ENTRY'));
  ok('O5 …and is now recorded as theirs', w.localStorage.getItem('pocket.v1.owner') === 'other');
}

{
  console.log('\n O6 — the same person after their session lapsed');
  const cloud = new FakeCloud();
  cloud.plans.set('other', FREE);
  const session = { current: OTHER };
  const w = tab(cloud, session, (win) => {
    win.localStorage.setItem('pocket.v1', JSON.stringify(book([tx('o1', 500, 'OTHER-OWN-ENTRY')])));
    win.localStorage.setItem('pocket.v1.owner', 'other');
  });
  await wait(100);
  await signIn(cloud, session, OTHER);
  ok('O6 their own book is kept', shows(w, 'OTHER-OWN-ENTRY'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
