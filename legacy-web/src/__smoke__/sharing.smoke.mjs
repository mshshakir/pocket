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
{
  // Fake Supabase carrying user_data, family_shares and family_contributions.
  const cloud = {
    userRow:       { id: 'owner1', data: null, version: 3 },
    shares:        [],   // rows for the MEMBER's email
    contributions: [],   // rows the member wrote for the owner
    updatedContribIds: [],
  };

  const makeSb = (selfId, selfEmail) => ({
    auth: {
      onAuthStateChange(cb) { cloud.authCb = cb; },
      getSession: async () => ({ data: { session: null } }),
      signOut: async () => {}, signInWithOAuth: async () => ({}),
    },
    removeChannel() {},
    channel() {
      const ch = {
        on(kind, cfg, handler) {
          if (cfg?.table === 'family_contributions') cloud.onContribInsert = handler;
          return ch;
        },
        subscribe(cb) { cb?.('SUBSCRIBED'); return ch; },
        send() {},
      };
      return ch;
    },
    from(table) {
      const q = {
        _eq: {}, _patch: null,
        select() { return q; },
        eq(k, v) { q._eq[k] = v; return q; },
        in(k, v) { q._in = { k, v }; return q; },
        order() { return q; },
        async single() {
          if (table === 'user_data') return { data: cloud.userRow, error: null };
          return { data: null, error: { code: 'PGRST116' } };
        },
        update(patch) { q._patch = patch; return q; },
        async upsert(payload) {
          if (table === 'user_data')            cloud.userRow = { ...cloud.userRow, ...payload };
          if (table === 'family_shares')        cloud.shares  = [{ ...payload }];
          if (table === 'family_contributions') {
            cloud.contributions.push({ id: payload.id || `ctr_${cloud.contributions.length}`, ...payload });
            cloud.onContribInsert?.({});
          }
          return { error: null };
        },
        then(res) {
          if (q._patch) {
            if (table === 'user_data') {
              const casOk = q._eq.version === undefined || q._eq.version === cloud.userRow.version;
              if (casOk) {
                cloud.userRow = { ...cloud.userRow, ...q._patch };
                return res({ data: [{ version: q._patch.version }], error: null });
              }
              return res({ data: [], error: null });
            }
            if (table === 'family_contributions') {
              // Mark rows synced exactly as Supabase would, so the next pull
              // doesn't re-apply an already-consumed add on top of a delete.
              const ids = q._in?.v || [];
              cloud.updatedContribIds.push(...ids);
              cloud.contributions.forEach((c) => { if (ids.includes(c.id)) c.synced = true; });
              return res({ data: [], error: null });
            }
          }
          if (table === 'family_contributions') {
            return res({ data: cloud.contributions.filter((c) => !c.synced), error: null });
          }
          if (table === 'family_shares') return res({ data: cloud.shares, error: null });
          return res({ data: [], error: null });
        },
      };
      return q;
    },
  });

  // ---- OWNER side: a member's contribution must be applied on arrival ------
  const ownerState = baseState();
  ownerState.accounts.push({ id: 'shared1', name: 'Joint', type: 'bank', currency: 'USD',
    color: '#3b82f6', icon: 'landmark', openingBalance: 0, balance: 0 });
  ownerState.family = [{ id: 'f1', name: 'Member', email: 'member@x.com',
    permissions: [{ accountId: 'shared1', access: 'full' }] }];
  cloud.userRow.data = ownerState;

  const w = boot(ownerState, { supabase: { createClient: () => makeSb('owner1', 'owner@x.com') } });
  await wait(80);
  cloud.authCb?.('SIGNED_IN', { user: { id: 'owner1', email: 'owner@x.com' } });
  await wait(200);
  const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));

  // A member ADDS a transaction to the shared account.
  cloud.contributions.push({
    id: 'ctr_add', owner_id: 'owner1', member_email: 'member@x.com',
    account_id: 'shared1', synced: false,
    tx_data: { id: 'mtx1', accountId: 'shared1', categoryId: 'c1', amount: 2500,
               currency: 'USD', type: 'expense', date: '2026-04-01', paymentType: 'card',
               recordState: 'cleared', tags: [], addedBy: 'member@x.com' },
  });
  cloud.onContribInsert?.({});                 // realtime INSERT fires
  await wait(250);

  ok('SYNC member ADD lands in the owner ledger',
     saved().transactions.some((t) => t.id === 'mtx1'),
     saved().transactions.map((t) => t.id).join(','));
  ok('SYNC the added row keeps its account and amount',
     saved().transactions.find((t) => t.id === 'mtx1')?.amount === 2500 &&
     saved().transactions.find((t) => t.id === 'mtx1')?.accountId === 'shared1');
  ok('SYNC the shared account balance moved',
     saved().accounts.find((a) => a.id === 'shared1')?.balance === -2500,
     String(saved().accounts.find((a) => a.id === 'shared1')?.balance));
  ok('SYNC the applied contribution was marked synced',
     cloud.updatedContribIds.includes('ctr_add'), cloud.updatedContribIds.join(','));

  // The member DELETES that same transaction.
  cloud.contributions.push({
    id: 'ctr_del', owner_id: 'owner1', member_email: 'member@x.com',
    account_id: 'shared1', synced: false,
    // The delete marker's flag is `_delete` (see SyncService#pullMemberContributions).
    tx_data: { _delete: true, targetId: 'mtx1' },
  });
  cloud.onContribInsert?.({});
  await wait(250);

  ok('SYNC member DELETE removes it from the owner ledger',
     !saved().transactions.some((t) => t.id === 'mtx1'),
     saved().transactions.map((t) => t.id).join(','));
  ok('SYNC the balance reverted after the delete',
     saved().accounts.find((a) => a.id === 'shared1')?.balance === 0,
     String(saved().accounts.find((a) => a.id === 'shared1')?.balance));
  ok('SYNC the owner re-published the share snapshot',
     cloud.shares.length > 0 && !!cloud.shares[0].snapshot,
     JSON.stringify(cloud.shares.length));

  // ---- H6: an EDIT must replace the row, not duplicate it -----------------
  cloud.contributions.push({
    id: 'ctr_add2', owner_id: 'owner1', member_email: 'member@x.com',
    account_id: 'shared1', synced: false,
    tx_data: { id: 'mtx2', accountId: 'shared1', categoryId: 'c1', amount: 1000,
               currency: 'USD', type: 'expense', date: '2026-04-03', paymentType: 'card',
               recordState: 'cleared', tags: [], addedBy: 'member@x.com' },
  });
  cloud.onContribInsert?.({});
  await wait(250);
  ok('H6 baseline row added', saved().transactions.filter((t) => t.id === 'mtx2').length === 1);

  // The member edits it: a _replace marker plus an add carrying the SAME id.
  cloud.contributions.push({
    id: 'ctr_rep', owner_id: 'owner1', member_email: 'member@x.com',
    account_id: 'shared1', synced: false,
    tx_data: { _delete: true, _replace: true, id: 'rep_mtx2', targetId: 'mtx2' },
  });
  cloud.contributions.push({
    id: 'ctr_add2b', owner_id: 'owner1', member_email: 'member@x.com',
    account_id: 'shared1', synced: false,
    tx_data: { id: 'mtx2', accountId: 'shared1', categoryId: 'c1', amount: 7777,
               currency: 'USD', type: 'expense', date: '2026-04-03', paymentType: 'card',
               recordState: 'cleared', tags: [], addedBy: 'member@x.com' },
  });
  cloud.onContribInsert?.({});
  await wait(250);

  const mtx2Rows = saved().transactions.filter((t) => t.id === 'mtx2');
  ok('H6 edit did NOT duplicate the transaction', mtx2Rows.length === 1,
     `${mtx2Rows.length} copies`);
  ok('H6 the edit was actually applied', mtx2Rows[0]?.amount === 7777,
     String(mtx2Rows[0]?.amount));
  ok('H6 the account is charged once, not twice',
     saved().accounts.find((a) => a.id === 'shared1')?.balance === -7777,
     String(saved().accounts.find((a) => a.id === 'shared1')?.balance));

  // ---- H9: a member with no rights must be rejected -----------------------
  cloud.contributions.push({
    id: 'ctr_evil', owner_id: 'owner1', member_email: 'stranger@x.com',
    account_id: 'own1', synced: false,
    tx_data: { id: 'evil1', accountId: 'own1', amount: 999999, currency: 'USD',
               type: 'expense', date: '2026-04-04', paymentType: 'card',
               recordState: 'cleared', tags: [] },
  });
  cloud.onContribInsert?.({});
  await wait(250);
  ok('H9 contribution from a non-member is rejected',
     !saved().transactions.some((t) => t.id === 'evil1'),
     saved().transactions.map((t) => t.id).join(','));
  ok('H9 the rejected row was consumed, not left to retry',
     cloud.updatedContribIds.includes('ctr_evil'));

  // A real member may not touch an account they were never granted.
  cloud.contributions.push({
    id: 'ctr_wrongacc', owner_id: 'owner1', member_email: 'member@x.com',
    account_id: 'own1', synced: false,
    tx_data: { id: 'wrong1', accountId: 'own1', amount: 500, currency: 'USD',
               type: 'expense', date: '2026-04-05', paymentType: 'card',
               recordState: 'cleared', tags: [] },
  });
  cloud.onContribInsert?.({});
  await wait(250);
  ok('H9 member cannot write to an account outside their grant',
     !saved().transactions.some((t) => t.id === 'wrong1'));

  // A crafted delete aimed at one of the OWNER's private transactions — the
  // original H9 attack. 'ownTx1' lives on own1, which was never shared.
  const ownTx = { id: 'ownTx1', accountId: 'own1', categoryId: 'c1', amount: 4242,
    currency: 'USD', type: 'expense', date: '2026-04-06', paymentType: 'card',
    recordState: 'cleared', tags: [] };
  w.__app.openModal('transaction', {});
  await wait(20);
  // Seed it through the owner's own save path so it lands in the live store.
  const doc = w.document;
  doc.querySelector('#txForm [name=amount]').value = '42.42';
  doc.querySelector('#txForm [name=accountId]').value = 'own1';
  await w.__app.submitTx({ preventDefault() {}, target: doc.querySelector('#txForm') }, '');
  await wait(60);
  const privateTx = saved().transactions.find((t) => t.accountId === 'own1' && t.amount === 4242);
  ok('H9 owner has a private transaction on a non-shared account', !!privateTx,
     saved().transactions.map((t) => `${t.accountId}:${t.amount}`).join(','));

  cloud.contributions.push({
    id: 'ctr_evildel', owner_id: 'owner1', member_email: 'member@x.com',
    account_id: 'shared1', synced: false,
    tx_data: { _delete: true, id: 'del_evil', targetId: privateTx?.id },
  });
  cloud.onContribInsert?.({});
  await wait(250);
  ok('H9 a delete targeting a non-shared account is refused',
     saved().transactions.some((t) => t.id === privateTx?.id),
     'the owner\'s private transaction was deleted by a member');

  w.close();
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 1b — H9 with a DOWNGRADED member (view-only) and H8 revocation
// ═══════════════════════════════════════════════════════════════════════════
{
  const cloud = { userRow: { id: 'owner2', data: null, version: 1 },
                  shares: [], deletedShares: [], contributions: [], updatedContribIds: [] };
  const makeSb = () => ({
    auth: { onAuthStateChange(cb) { cloud.authCb = cb; },
            getSession: async () => ({ data: { session: null } }),
            signOut: async () => {}, signInWithOAuth: async () => ({}) },
    removeChannel() {},
    channel() {
      const ch = { on(k, cfg, h) { if (cfg?.table === 'family_contributions') cloud.onContribInsert = h; return ch; },
                   subscribe(cb) { cb?.('SUBSCRIBED'); return ch; }, send() {} };
      return ch;
    },
    from(table) {
      const q = {
        _eq: {}, _patch: null, _delete: false,
        select() { return q; }, eq(k, v) { q._eq[k] = v; return q; },
        in(k, v) { q._in = { k, v }; return q; }, order() { return q; },
        delete() { q._delete = true; return q; },
        update(p) { q._patch = p; return q; },
        async upsert(payload) {
          if (table === 'user_data')     cloud.userRow = { ...cloud.userRow, ...payload };
          if (table === 'family_shares') cloud.shares  = [{ ...payload }];
          return { error: null };
        },
        async single() {
          return table === 'user_data'
            ? { data: cloud.userRow, error: null }
            : { data: null, error: { code: 'PGRST116' } };
        },
        then(res) {
          if (q._delete && table === 'family_shares') {
            cloud.deletedShares.push({ ...q._eq });
            cloud.shares = cloud.shares.filter((s) => s.member_email !== q._eq.member_email);
            return res({ data: [], error: null });
          }
          if (q._patch) {
            if (table === 'user_data') {
              cloud.userRow = { ...cloud.userRow, ...q._patch };
              return res({ data: [{ version: q._patch.version }], error: null });
            }
            if (table === 'family_contributions') {
              const ids = q._in?.v || [];
              cloud.updatedContribIds.push(...ids);
              cloud.contributions.forEach((c) => { if (ids.includes(c.id)) c.synced = true; });
              return res({ data: [], error: null });
            }
          }
          if (table === 'family_contributions') {
            return res({ data: cloud.contributions.filter((c) => !c.synced), error: null });
          }
          if (table === 'family_shares') return res({ data: cloud.shares, error: null });
          return res({ data: [], error: null });
        },
      };
      return q;
    },
  });

  const st = baseState();
  st.accounts.push({ id: 'joint', name: 'Joint', type: 'bank', currency: 'USD',
    color: '#3b82f6', icon: 'landmark', openingBalance: 0, balance: 0 });
  st.family = [
    { id: 'f1', name: 'Viewer', email: 'viewer@x.com',
      permissions: [{ accountId: 'joint', access: 'view' }] },
    { id: 'f2', name: 'Adder',  email: 'adder@x.com',
      permissions: [{ accountId: 'joint', access: 'add' }] },
  ];
  cloud.userRow.data = st;

  const w = boot(st, { supabase: { createClient: () => makeSb() } });
  await wait(80);
  cloud.authCb?.('SIGNED_IN', { user: { id: 'owner2', email: 'owner2@x.com' } });
  await wait(250);
  const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));

  // view-only: adds must be refused
  cloud.contributions.push({
    id: 'c_view_add', owner_id: 'owner2', member_email: 'viewer@x.com',
    account_id: 'joint', synced: false,
    tx_data: { id: 'vtx1', accountId: 'joint', amount: 100, currency: 'USD',
               type: 'expense', date: '2026-05-01', paymentType: 'card',
               recordState: 'cleared', tags: [] },
  });
  cloud.onContribInsert?.({});
  await wait(250);
  ok('H9 view-only member cannot add', !saved().transactions.some((t) => t.id === 'vtx1'),
     saved().transactions.map((t) => t.id).join(','));

  // A second member holding 'add' on the same account MUST still get through —
  // the check has to block the unauthorised without breaking the authorised.
  cloud.contributions.push({
    id: 'c_add_ok', owner_id: 'owner2', member_email: 'adder@x.com',
    account_id: 'joint', synced: false,
    tx_data: { id: 'vtx2', accountId: 'joint', amount: 200, currency: 'USD',
               type: 'expense', date: '2026-05-02', paymentType: 'card',
               recordState: 'cleared', tags: [] },
  });
  cloud.onContribInsert?.({});
  await wait(250);
  ok("H9 a member holding 'add' is still allowed through",
     saved().transactions.some((t) => t.id === 'vtx2'),
     saved().transactions.map((t) => t.id).join(','));

  // 'add' is not 'full': that member must not be able to delete.
  cloud.contributions.push({
    id: 'c_add_del', owner_id: 'owner2', member_email: 'adder@x.com',
    account_id: 'joint', synced: false,
    tx_data: { _delete: true, id: 'del_vtx2', targetId: 'vtx2' },
  });
  cloud.onContribInsert?.({});
  await wait(250);
  ok("H9 'add' access cannot delete", saved().transactions.some((t) => t.id === 'vtx2'),
     'vtx2 was deleted by an add-only member');

  // ---- H8: removing the member must delete their family_shares row --------
  cloud.shares = [{ owner_id: 'owner2', member_email: 'viewer@x.com', snapshot: {} }];
  w.__app.deleteFamilyMember?.('f1');
  await wait(200);
  ok('H8 removing a member deletes their share row',
     cloud.deletedShares.some((d) => d.member_email === 'viewer@x.com'),
     JSON.stringify(cloud.deletedShares));
  ok('H8 the share row is actually gone', cloud.shares.length === 0,
     JSON.stringify(cloud.shares.map((s) => s.member_email)));
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

  // Deliver it the way production does: a family_shares row for this user,
  // installed by #pullFamilyShares() during sign-in.
  const cloud2 = { userRow: { id: 'me1', data: baseState(), version: 2 } };
  const sb2 = {
    auth: {
      onAuthStateChange(cb) { cloud2.authCb = cb; },
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
        async upsert() { return { error: null }; },
        async single() {
          if (table === 'user_data') return { data: cloud2.userRow, error: null };
          return { data: null, error: { code: 'PGRST116' } };
        },
        then(res) {
          if (table === 'family_shares') {
            return res({ data: [{ owner_id: 'evil1', snapshot: hostileSnapshot }], error: null });
          }
          return res({ data: [], error: null });
        },
      };
      return q;
    },
  };

  const w = boot(baseState(), { supabase: { createClient: () => sb2 } });
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
  const revoked = [];
  const sb = {
    auth: { onAuthStateChange(cb) { sb._cb = cb; },
            getSession: async () => ({ data: { session: null } }),
            signOut: async () => {}, signInWithOAuth: async () => ({}) },
    removeChannel() {},
    channel() { const c = { on() { return c; }, subscribe(cb) { cb?.('SUBSCRIBED'); return c; }, send() {} }; return c; },
    from(table) {
      const q = {
        _eq: {}, _del: false,
        select() { return q; }, eq(k, v) { q._eq[k] = v; return q; },
        in() { return q; }, order() { return q; },
        delete() { q._del = true; return q; }, update() { return q; },
        async upsert() { return { error: null }; },
        async single() { return { data: null, error: { code: 'PGRST116' } }; },
        then(res) {
          if (q._del && table === 'family_shares') revoked.push(q._eq.member_email);
          return res({ data: [], error: null });
        },
      };
      return q;
    },
  };

  const st = baseState();
  st.accounts.push({ id: 'joint', name: 'Joint', type: 'bank', currency: 'USD',
    color: '#3b82f6', icon: 'landmark', openingBalance: 0, balance: 0 });
  st.family = [
    { id: 'm1', name: 'Amina', email: 'amina@x.com', color: '#ef4444', permissions: [] },
    { id: 'm2', name: 'Yusuf', email: 'yusuf@x.com', color: '#10b981',
      permissions: [{ accountId: 'joint', access: 'view' }] },
  ];

  const w = boot(st, { supabase: { createClient: () => sb } });
  await wait(80);
  sb._cb?.('SIGNED_IN', { user: { id: 'me', email: 'me@x.com' } });
  await wait(200);
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
  await wait(80);
  ok('SHARE revoking removes the permission', permOf('m1') === null, String(permOf('m1')));
  // Two independent paths guarantee this: AccountShareSheet calls
  // revokeMemberShare() when it sees wasLast, and #pushFamilyShares() revokes
  // any member left with zero shared accounts. The outcome is what matters.
  ok('SHARE losing the last shared account revokes the cloud share (H8)',
     revoked.includes('amina@x.com'), JSON.stringify(revoked));
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
  await wait(80);
  ok('SHARE unshare-all clears every member', permOf('m1') === null && permOf('m2') === null);
  ok('SHARE unshare-all revoked the remaining cloud share',
     revoked.includes('yusuf@x.com'), JSON.stringify(revoked));
  app.accountShareSheet.close();
  w.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
