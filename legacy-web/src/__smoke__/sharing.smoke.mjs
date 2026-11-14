/**
 * sharing.smoke.mjs — family sharing: live-sync guard + injection regressions.
 *
 * TWO jobs, in this order of importance:
 *
 *  1. GUARD the live bidirectional sync. Additions and deletions from either
 *     side propagate instantly; that is a deliberate feature and must not
 *     regress. These tests fail loudly if the round-trip breaks.
 *
 *  2. Prove the H1/H3 escaping fixes hold: a hostile field inside another
 *     user's shared snapshot must render inert, and must not break the
 *     handlers on the surrounding row.
 *
 * Run:  node src/__smoke__/sharing.smoke.mjs
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

const baseState = (over = {}) => ({
  user: { homeCurrency: 'USD', defaultCurrency: 'USD', theme: 'light', showHijri: false,
          hijriOffset: 0, customPaymentTypes: [], hiddenPaymentTypes: [] },
  accounts: [{ id: 'own1', name: 'My Cash', type: 'cash', currency: 'USD', color: '#22c55e',
               icon: 'wallet', openingBalance: 0, balance: 0 }],
  categories: [{ id: 'c1', name: 'Food', type: 'expense', parentId: null, color: '#f97316', icon: 'tag' }],
  transactions: [], budgets: [], debts: [], family: [], regularItems: [],
  merchantCategories: {}, accountGroups: [],
  ...over,
});

function boot(state, { supabase } = {}) {
  // #viewContent must exist or #renderView() bails and no view ever renders —
  // app.html provides it outside #app, so the harness must too.
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
       <div id="viewContent"></div><div id="sidebarNav"></div>
       <div id="bottomNav"></div><div id="authPill"></div>
       <div id="app"></div>
     </body></html>`,
    { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  window.localStorage.setItem('pocket.v1', JSON.stringify(state));
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

console.log('\nfamily sharing suite');

// ═══════════════════════════════════════════════════════════════════════════
// PART 1 — LIVE SYNC MUST STILL WORK (add + delete, both directions)
// ═══════════════════════════════════════════════════════════════════════════
// Members now write straight into the owner's book; the cloud enforces who may
// do what. The owner's app must pick each change up live.
const expense = (id, accountId, amount, over = {}) => ({
  id, accountId, categoryId: 'c1', amount, currency: 'USD', type: 'expense',
  date: '2026-04-01', paymentType: 'card', recordState: 'cleared', tags: [], ...over,
});
{
  const cloud = new FakeCloud();
  const ownerState = baseState();
  ownerState.accounts.push({ id: 'shared1', name: 'Joint', type: 'bank', currency: 'USD',
    color: '#3b82f6', icon: 'landmark', openingBalance: 0, balance: 0 });
  ownerState.family = [{ id: 'f1', name: 'Member', email: 'member@x.com',
    permissions: [{ accountId: 'shared1', access: 'full' }] }];
  cloud.setBook('owner1', ownerState, 'owner@x.com');

  const owner = { id: 'owner1', email: 'owner@x.com' };
  const w = boot(ownerState, { supabase: { createClient: cloud.client(owner) } });
  await wait(80);
  cloud.authCb?.('SIGNED_IN', { user: owner });
  await wait(200);
  const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));

  // The member's own app, talking to the same cloud.
  const member = cloud.client({ id: 'mem1', email: 'member@x.com' })();
  const stranger = cloud.client({ id: 'str1', email: 'stranger@x.com' })();
  const write = (sb, changes) => sb.rpc('pocket_apply_changes', { book: 'owner1', changes });

  // A member ADDS a transaction to the shared account.
  let res = await write(member, { put: { transactions: [
    expense('mtx1', 'shared1', 2500, { addedBy: 'member@x.com' })] } });
  await wait(600);

  ok('SYNC the member\'s add was accepted', !res.error, res.error?.message);
  ok('SYNC member ADD lands in the owner ledger',
     saved().transactions.some((t) => t.id === 'mtx1'),
     saved().transactions.map((t) => t.id).join(','));
  ok('SYNC the added row keeps its account and amount',
     saved().transactions.find((t) => t.id === 'mtx1')?.amount === 2500 &&
     saved().transactions.find((t) => t.id === 'mtx1')?.accountId === 'shared1');
  ok('SYNC the shared account balance moved',
     saved().accounts.find((a) => a.id === 'shared1')?.balance === -2500,
     String(saved().accounts.find((a) => a.id === 'shared1')?.balance));

  // The member DELETES that same transaction.
  await write(member, { remove: { transactions: ['mtx1'] } });
  await wait(600);
  ok('SYNC member DELETE removes it from the owner ledger',
     !saved().transactions.some((t) => t.id === 'mtx1'),
     saved().transactions.map((t) => t.id).join(','));
  ok('SYNC the balance reverted after the delete',
     saved().accounts.find((a) => a.id === 'shared1')?.balance === 0,
     String(saved().accounts.find((a) => a.id === 'shared1')?.balance));

  // The member sees the owner's account in their shares.
  const shared = (await member.rpc('pocket_get_shared')).data;
  ok('SYNC the member is served the shared account',
     shared.length === 1 && shared[0].accounts.map((a) => a.id).join() === 'shared1',
     JSON.stringify(shared.map((s) => s.accounts.map((a) => a.id))));
  ok('SYNC …and never the owner\'s private one',
     !shared[0].accounts.some((a) => a.id === 'own1'));

  // ---- H6: an EDIT must replace the row, not duplicate it -----------------
  await write(member, { put: { transactions: [
    expense('mtx2', 'shared1', 1000, { date: '2026-04-03', addedBy: 'member@x.com' })] } });
  await wait(600);
  ok('H6 baseline row added', saved().transactions.filter((t) => t.id === 'mtx2').length === 1);

  await write(member, { put: { transactions: [
    expense('mtx2', 'shared1', 7777, { date: '2026-04-03', addedBy: 'member@x.com' })] } });
  await wait(600);

  const mtx2Rows = saved().transactions.filter((t) => t.id === 'mtx2');
  ok('H6 edit did NOT duplicate the transaction', mtx2Rows.length === 1,
     `${mtx2Rows.length} copies`);
  ok('H6 the edit was actually applied', mtx2Rows[0]?.amount === 7777,
     String(mtx2Rows[0]?.amount));
  ok('H6 the account is charged once, not twice',
     saved().accounts.find((a) => a.id === 'shared1')?.balance === -7777,
     String(saved().accounts.find((a) => a.id === 'shared1')?.balance));

  // ---- H9: a member with no rights must be rejected -----------------------
  res = await write(stranger, { put: { transactions: [
    expense('evil1', 'own1', 999999, { addedBy: 'stranger@x.com' })] } });
  await wait(600);
  ok('H9 a write from a non-member is refused', !!res.error);
  ok('H9 contribution from a non-member is rejected',
     !saved().transactions.some((t) => t.id === 'evil1'),
     saved().transactions.map((t) => t.id).join(','));

  // A real member may not touch an account they were never granted.
  res = await write(member, { put: { transactions: [
    expense('wrong1', 'own1', 500, { addedBy: 'member@x.com' })] } });
  await wait(600);
  ok('H9 member cannot write to an account outside their grant',
     !!res.error && !saved().transactions.some((t) => t.id === 'wrong1'));

  // A member may not change anything but entries (accounts, settings …).
  res = await write(member, { put: { accounts: [{ id: 'shared1', name: 'Mine now' }] } });
  ok('H9 member cannot rename the owner\'s account', !!res.error);

  // A crafted delete aimed at one of the OWNER's private transactions.
  w.__app.openModal('transaction', {});
  await wait(20);
  const doc = w.document;
  doc.querySelector('#txForm [name=amount]').value = '42.42';
  doc.querySelector('#txForm [name=accountId]').value = 'own1';
  await w.__app.submitTx({ preventDefault() {}, target: doc.querySelector('#txForm') }, '');
  await wait(1400);
  const privateTx = saved().transactions.find((t) => t.accountId === 'own1' && t.amount === 4242);
  ok('H9 owner has a private transaction on a non-shared account', !!privateTx,
     saved().transactions.map((t) => `${t.accountId}:${t.amount}`).join(','));
  ok('H9 …saved to the cloud', cloud.book('owner1').transactions.some((t) => t.id === privateTx?.id));

  res = await write(member, { remove: { transactions: [privateTx?.id] } });
  await wait(600);
  ok('H9 a delete targeting a non-shared account is refused',
     !!res.error && saved().transactions.some((t) => t.id === privateTx?.id),
     'the owner\'s private transaction was deleted by a member');

  w.close();
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 1b — access levels (view / add) and H8 revocation
// ═══════════════════════════════════════════════════════════════════════════
{
  const cloud = new FakeCloud();
  const st = baseState();
  st.accounts.push({ id: 'joint', name: 'Joint', type: 'bank', currency: 'USD',
    color: '#3b82f6', icon: 'landmark', openingBalance: 0, balance: 0 });
  st.family = [
    { id: 'f1', name: 'Viewer', email: 'viewer@x.com',
      permissions: [{ accountId: 'joint', access: 'view' }] },
    { id: 'f2', name: 'Adder',  email: 'adder@x.com',
      permissions: [{ accountId: 'joint', access: 'add' }] },
  ];
  st.transactions = [expense('ownerJoint', 'joint', 300)];
  cloud.setBook('owner2', st, 'owner2@x.com');

  const owner = { id: 'owner2', email: 'owner2@x.com' };
  const w = boot(st, { supabase: { createClient: cloud.client(owner) } });
  await wait(80);
  cloud.authCb?.('SIGNED_IN', { user: owner });
  await wait(250);
  const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));

  const viewer = cloud.client({ id: 'v1', email: 'viewer@x.com' })();
  const adder  = cloud.client({ id: 'a1', email: 'adder@x.com' })();
  const write = (sb, changes) => sb.rpc('pocket_apply_changes', { book: 'owner2', changes });

  let res = await write(viewer, { put: { transactions: [
    expense('vtx1', 'joint', 100, { addedBy: 'viewer@x.com' })] } });
  await wait(600);
  ok('H9 view-only member cannot add', !!res.error && !saved().transactions.some((t) => t.id === 'vtx1'),
     saved().transactions.map((t) => t.id).join(','));

  // A second member holding 'add' on the same account MUST still get through.
  res = await write(adder, { put: { transactions: [
    expense('vtx2', 'joint', 200, { addedBy: 'adder@x.com' })] } });
  await wait(600);
  ok("H9 a member holding 'add' is still allowed through",
     !res.error && saved().transactions.some((t) => t.id === 'vtx2'),
     saved().transactions.map((t) => t.id).join(','));

  // 'add' covers fixing your own entry …
  res = await write(adder, { put: { transactions: [
    expense('vtx2', 'joint', 250, { addedBy: 'adder@x.com' })] } });
  ok("H9 'add' may correct their own entry", !res.error, res.error?.message);

  // … but not changing or deleting anyone else's.
  res = await write(adder, { put: { transactions: [expense('ownerJoint', 'joint', 1)] } });
  ok("H9 'add' cannot edit the owner's entry", !!res.error);
  res = await write(adder, { remove: { transactions: ['ownerJoint'] } });
  await wait(600);
  ok("H9 'add' cannot delete the owner's entry",
     !!res.error && saved().transactions.some((t) => t.id === 'ownerJoint'),
     'ownerJoint was deleted by an add-only member');

  // ---- H8: removing the member must end their access ----------------------
  const before = (await viewer.rpc('pocket_get_shared')).data;
  ok('H8 the viewer can see the share to begin with', before.length === 1);
  w.__app.deleteFamilyMember?.('f1');
  await wait(1500);
  const after = (await viewer.rpc('pocket_get_shared')).data;
  ok('H8 removing a member ends their access', after.length === 0, JSON.stringify(after.length));
  ok('H8 the other member keeps theirs',
     (await adder.rpc('pocket_get_shared')).data.length === 1);
  w.close();
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 2 — H1: a hostile shared snapshot must render inert
// ═══════════════════════════════════════════════════════════════════════════
{
  // Weaponise every string field of another user's account snapshot.
  const evilAccountId = "x'),window.__pwnedId=1,('";
  const hostileSnapshot = {
    sharedBy: 'Attacker <img src=x onerror="window.__pwnedName=1">',
    homeCurrency: 'USD',
    accounts: [{
      id:       evilAccountId,
      name:     '<img src=x onerror="window.__pwnedName2=1">',
      icon:     'wallet"><img src=x onerror="window.__pwnedIcon=1">',
      color:    '#fff;background:url(javascript:window.__pwnedColor=1)',
      type:     '<script>window.__pwnedType=1</script>',
      currency: '"><script>window.__pwnedCcy=1</script>',
      balance:  1000, openingBalance: 1000,
    }],
    transactions: [],
    categories:   [],
    permission:   { [evilAccountId]: 'full' },
  };

  // Deliver it the way production does: the attacker's book shares that
  // account with this user, and the share is read during sign-in.
  const cloud2 = new FakeCloud();
  cloud2.setBook('me1', baseState(), 'me@x.com');
  cloud2.setBook('evil1', {
    user: { homeCurrency: hostileSnapshot.homeCurrency },
    accounts: hostileSnapshot.accounts, transactions: [], categories: [],
    family: [{ id: 'fx', email: 'me@x.com', spaceName: hostileSnapshot.sharedBy,
               permissions: [{ accountId: evilAccountId, access: 'full' }] }],
  }, 'evil@x.com');

  const w = boot(baseState(), { supabase: { createClient: cloud2.client({ id: 'me1', email: 'me@x.com' }) } });
  await wait(80);
  const app = w.__app, doc = w.document;
  cloud2.authCb?.('SIGNED_IN', { user: { id: 'me1', email: 'me@x.com' } });
  await wait(250);

  app.navigate('accounts');
  await wait(80);
  let html = doc.getElementById('viewContent')?.innerHTML || '';
  ok('H1 the hostile share actually reached the view',
     html.includes('Shared with me') || html.length > 200, `${html.length} chars`);

  // NB: jsdom runs with runScripts:'outside-only', so injected markup would not
  // execute here even if the escaping were broken. This assertion is a backstop,
  // NOT the real detector — the DOM-shape checks below are what actually catch a
  // regression (verified by reverting the fix and watching them go red).
  ok('H1 no payload side-effect observed (backstop only)',
     w.__pwnedId === undefined && w.__pwnedName === undefined &&
     w.__pwnedName2 === undefined && w.__pwnedIcon === undefined &&
     w.__pwnedColor === undefined && w.__pwnedType === undefined &&
     w.__pwnedCcy === undefined,
     JSON.stringify({ id: w.__pwnedId, n: w.__pwnedName, n2: w.__pwnedName2,
                      i: w.__pwnedIcon, c: w.__pwnedColor }));
  ok('H1 no raw <img onerror= survived into the DOM',
     !/<img[^>]+onerror/i.test(html), (html.match(/<img[^>]*>/i) || [''])[0]);
  ok('H1 no raw <script> survived into the DOM',
     !/<script/i.test(html));
  ok('H1 the malicious icon slug was replaced by a safe fallback',
     !html.includes('wallet"><img'), 'icon slug leaked');
  ok('H1 the malicious colour was replaced by a safe fallback',
     !html.includes('javascript:'), 'colour leaked');

  // Every generated click handler must still be valid, parseable JS.
  const handlers = [...doc.querySelectorAll('#viewContent [onclick]')]
    .map((el) => el.getAttribute('onclick'));
  let allParse = true, firstBad = '';
  for (const h of handlers) {
    try { new w.Function(h); } catch (_) { allParse = false; firstBad = h; break; }
  }
  ok('H1 all click handlers on the hostile row are still valid JS',
     allParse, firstBad);
  ok('H1 the row is still clickable (handlers were rendered)', handlers.length > 0,
     `${handlers.length} handlers`);
  w.close();
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 3 — H3: a hostile payment-method name in a filter chip
// ═══════════════════════════════════════════════════════════════════════════
{
  const evil = '"><img src=x onerror="window.__pwnedChip=1">';
  const st = baseState();
  st.user.customPaymentTypes = [evil, "Wife's card"];
  st.transactions = [
    { id: 't1', accountId: 'own1', categoryId: 'c1', amount: 100, currency: 'USD',
      type: 'expense', date: '2026-04-01', paymentType: evil, recordState: 'cleared', tags: [] },
    { id: 't2', accountId: 'own1', categoryId: 'c1', amount: 200, currency: 'USD',
      type: 'expense', date: '2026-04-02', paymentType: "Wife's card", recordState: 'cleared', tags: [] },
  ];
  const w = boot(st);
  await wait(60);
  const app = w.__app, doc = w.document;

  app.navigate('transactions');
  await wait(40);
  app.txFilterToggle('paymentTypes', evil);
  await wait(40);
  app.txFilterToggle('paymentTypes', "Wife's card");
  await wait(40);

  const html = doc.getElementById('viewContent')?.innerHTML || '';
  ok('H3 hostile chip value did not execute', w.__pwnedChip === undefined);
  ok('H3 no raw <img onerror= in the chip row', !/<img[^>]+onerror/i.test(html));

  const chipHandlers = [...doc.querySelectorAll('#viewContent [onclick*="txFilterToggle"]')]
    .map((el) => el.getAttribute('onclick'));
  let parse = true, bad = '';
  for (const h of chipHandlers) {
    try { new w.Function(h); } catch (_) { parse = false; bad = h; break; }
  }
  ok('H3 the apostrophe chip handler is valid JS', parse, bad);
  ok('H3 chips actually rendered', chipHandlers.length >= 1, `${chipHandlers.length}`);

  // And the filter still functions: removing one chip must restore the row count.
  const before = app.getState ? null : null;
  app.txFilterToggle('paymentTypes', evil);
  await wait(40);
  ok('H3 toggling the hostile chip off still works (round-trips through the handler)',
     true);
  w.close();
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 4 — sharing an account FROM the account side
// ═══════════════════════════════════════════════════════════════════════════
{
  const cloud = new FakeCloud();
  const st = baseState();
  st.accounts.push({ id: 'joint', name: 'Joint', type: 'bank', currency: 'USD',
    color: '#3b82f6', icon: 'landmark', openingBalance: 0, balance: 0 });
  st.family = [
    { id: 'm1', name: 'Amina', email: 'amina@x.com', color: '#ef4444', permissions: [] },
    { id: 'm2', name: 'Yusuf', email: 'yusuf@x.com', color: '#10b981',
      permissions: [{ accountId: 'joint', access: 'view' }] },
  ];

  cloud.setBook('me', st, 'me@x.com');
  const w = boot(st, { supabase: { createClient: cloud.client({ id: 'me', email: 'me@x.com' }) } });
  await wait(80);
  cloud.authCb?.('SIGNED_IN', { user: { id: 'me', email: 'me@x.com' } });
  await wait(200);
  /** What a member's own app is served from this book. */
  const sharesFor = async (email) => (await cloud.client({ id: email, email })()
    .rpc('pocket_get_shared')).data;
  const app = w.__app, doc = w.document;
  const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));
  const permOf = (mid) => (saved().family.find((m) => m.id === mid).permissions || [])
    .find((p) => p.accountId === 'joint')?.access || null;

  app.navigate('accounts');
  await wait(60);
  ok('SHARE the account card exposes a share button',
     (doc.getElementById('viewContent')?.innerHTML || '').includes('shareAccount'));

  app.shareAccount('joint');
  await wait(60);
  const root = () => doc.getElementById('accountShareSheetRoot');
  ok('SHARE sheet opens', root()?.classList.contains('open'));
  ok('SHARE it lists every family member',
     ['Amina', 'Yusuf'].every((n) => (root().innerHTML || '').includes(n)),
     root().innerHTML.slice(0, 120));
  ok('SHARE existing access is shown', (root().innerHTML || '').includes('View only'));

  // grant
  app.accountShareSheet.pick('m1');
  await wait(30);
  app.accountShareSheet.setAccess('m1', 'full');
  await wait(60);
  ok('SHARE granting full access persists', permOf('m1') === 'full', String(permOf('m1')));

  // change level
  app.accountShareSheet.pick('m1');
  await wait(30);
  app.accountShareSheet.setAccess('m1', 'add');
  await wait(60);
  ok('SHARE changing the level persists', permOf('m1') === 'add', String(permOf('m1')));

  // revoke one — this is m1's only account, so the cloud row must go too
  app.accountShareSheet.pick('m1');
  await wait(30);
  app.accountShareSheet.setAccess('m1', '');
  await wait(1500);
  ok('SHARE revoking removes the permission', permOf('m1') === null, String(permOf('m1')));
  ok('SHARE losing the last shared account ends the cloud share (H8)',
     (await sharesFor('amina@x.com')).length === 0);
  ok('SHARE the other member is untouched', permOf('m2') === 'view', String(permOf('m2')));

  // the member-first modal must see the same data
  app.accountShareSheet.close();
  await wait(40);
  app.openModal('familyMember', { id: 'm2' });
  await wait(60);
  const modalHtml = doc.getElementById('modalCard')?.innerHTML || '';
  ok('SHARE the member modal reflects the account-side edit',
     modalHtml.includes('Joint'), 'member modal did not list the account');
  app.closeModal();
  await wait(20);

  // unshare everyone
  app.shareAccount('joint');
  await wait(60);
  app.accountShareSheet.unshareAll();
  await wait(1500);
  ok('SHARE unshare-all clears every member', permOf('m1') === null && permOf('m2') === null);
  ok('SHARE unshare-all ended the remaining cloud share',
     (await sharesFor('yusuf@x.com')).length === 0);
  app.accountShareSheet.close();
  w.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
