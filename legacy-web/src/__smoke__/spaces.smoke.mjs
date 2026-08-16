/**
 * spaces.smoke.mjs — the Space model (design doc phase 1).
 *
 * A shared account used to be a DETOUR: you stayed in your own book and
 * occasionally reached sideways into someone else's, which is why every form
 * that could target a shared account had to remember to re-point its own
 * category source. A Space makes the book itself the thing you switch.
 *
 *   SP1  A solo user sees no switcher at all and behaves exactly as before.
 *   SP2  Switching re-points accounts and transactions to the owner's snapshot.
 *   SP3  ...and categories, which is the bug the whole model exists to kill.
 *   SP4  Home-space projection is the REAL state object, so nothing that
 *        legitimately mutates through it breaks.
 *   SP5  Modals that write to the local book refuse inside a guest space.
 *   SP6  A new transaction in a guest space opens as a CONTRIBUTION.
 *   SP7  ...and is refused outright when the access is view-only.
 *   SP8  Revoking the active space says so and switches home — it must never
 *        silently relocate the user or keep rendering a snapshot that is gone.
 *   SP9  Labels: member-side override beats the owner's sharedBy; clearing it
 *        restores the owner's name.
 *   SP10 The active space is session-scoped and never written to user state,
 *        so it can't sync to another device or outlive a revocation.
 *   SP11 A hostile snapshot renders inert in the switcher too (audit H1).
 *   SP12 A space sharing SEVERAL accounts offers all the writable ones in the
 *        account dropdown — arriving via the switcher picks one arbitrarily, so
 *        pinning the form to it (which the lock did) stranded the other.
 *   SP13 Transfers are not offered in a guest space, and are refused on submit.
 *        A transfer is TWO linked rows; a contribution is one, so this path
 *        would write a single leg with no counter-leg into the owner's book.
 *   SP14 Budgets are shared individually and carry the OWNER's computed spend;
 *        debts and regulars ride on their account's permission.
 *   SP16 The Budgets view RENDERS the owner's spend rather than recomputing it —
 *        recomputing reads the member's own transactions against the owner's
 *        categories, which is meaningless rather than merely understated.
 *   SP17 Per-budget sharing is reachable from the UI, and refused in a guest
 *        space.
 *   SP18 The OWNER names the space each member sees, and sees their outbound
 *        shares as spaces — previously every space carried the owner's personal
 *        name whatever it held, and the owner had no view of it at all.
 *   SP20 Owner-created spaces: compose accounts + budgets + SEVERAL people, with
 *        permissions still DERIVED so #authoriseContribution never changes.
 *   SP21 One person cannot be in two spaces — family_shares is keyed
 *        (owner_id, member_email), so the second would overwrite the first.
 *        Refused with a reason rather than silently winning.
 *   SP22 Migrating old member-first grants must never WIDEN access.
 *   SP23 Two DIFFERENT people may hold the same account through different
 *        spaces — that is the ordinary case, not a conflict. What is forbidden
 *        is ONE person holding it twice, which would make the derived
 *        permission union order-dependent.
 *   SP24 A snapshot is addressed by owner+space, so one owner can send several
 *        spaces once the family_shares key change lands.
 *   SP19 FamilyView's hand-copied access table had drifted: it omitted 'add',
 *        so a member granted "Can add" was displayed to the owner as
 *        "View only" — told they had given LESS access than they had.
 *
 * Run:  node src/__smoke__/spaces.smoke.mjs
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

const acct = (id, name, currency = 'USD') => ({
  id, name, currency, groupId: null, type: 'bank', color: '#3b82f6',
  icon: 'landmark', openingBalance: 0, balance: 0,
});

const memberState = () => ({
  user: {
    homeCurrency: 'USD', defaultCurrency: 'USD', theme: 'light', showHijri: false,
    hijriOffset: 0, customPaymentTypes: [], hiddenPaymentTypes: [],
    defaultAccountId: '', defaultPaymentType: 'card', name: 'Me',
  },
  accounts:   [acct('mine1', 'My Cash'), acct('mine2', 'My Savings')],
  categories: [{ id: 'mycat', name: 'My Food', type: 'expense', parentId: null, color: '#f97316', icon: 'tag' }],
  transactions: [{
    id: 'mytx', accountId: 'mine1', categoryId: 'mycat', amount: 1000, currency: 'USD',
    type: 'expense', date: '2026-08-01', paymentType: 'card', recordState: 'cleared', tags: [],
  }],
  budgets: [{ id: 'mybg', categoryId: 'mycat', amount: 50000, currency: 'USD', period: 'gregorian', rollover: false }],
  debts: [], family: [], regularItems: [], merchantCategories: {}, accountGroups: [],
});

/** A snapshot as #pushFamilyShares would publish it. */
const snapshot = (over = {}) => ({
  sharedBy:     'Abbas',
  homeCurrency: 'AED',
  permission:   { own1: 'edit' },
  accounts:     [{ ...acct('own1', 'Abbas Wallet', 'AED'), color: '#10b981', icon: 'wallet' }],
  transactions: [{
    id: 'owntx', accountId: 'own1', categoryId: 'owncat', amount: 5000, currency: 'AED',
    type: 'expense', date: '2026-08-02', paymentType: 'card', recordState: 'cleared', tags: [],
  }],
  categories:   [{ id: 'owncat', name: 'Abbas Groceries', type: 'expense', parentId: null, color: '#0ea5e9', icon: 'tag' }],
  updatedAt:    '2026-08-02T00:00:00.000Z',
  ...over,
});

function boot(state, { shares = [] } = {}) {
  // The cloud row mirrors local state, so adopting it is a no-op — the suite is
  // about spaces, not about sync. Returning no row at all would send #doPull
  // down the first-sign-in branch, which never pulls family shares.
  const cloud = {
    shares, contributions: [], pushedShares: [],
    row: { id: 'me1', version: 1, data: JSON.parse(JSON.stringify(state)) },
  };
  const sb = () => ({
    auth: {
      onAuthStateChange(cb) { cloud.authCb = cb; },
      getSession: async () => ({ data: { session: null } }),
      signOut: async () => {}, signInWithOAuth: async () => ({}),
    },
    removeChannel() {},
    channel() { const ch = { on() { return ch; }, subscribe() { return ch; }, send() {} }; return ch; },
    from(table) {
      const q = {
        _t: table, _eq: {},
        select() { return q; }, eq(k, v) { q._eq[k] = v; return q; },
        in() { return q; }, order() { return q; },
        async single() {
          return { data: JSON.parse(JSON.stringify(cloud.row)), error: null };
        },
        update(patch) { q._patch = patch; return q; },
        async upsert(payload) {
          if (table === 'family_contributions') cloud.contributions.push(payload);
          if (table === 'family_shares')        cloud.pushedShares.push(payload);
          if (table === 'user_data') cloud.row = { ...cloud.row, ...payload };
          return { data: [{ version: (payload?.version ?? 1) }], error: null };
        },
        delete() { return q; },
        then(res) {
          if (q._patch) {
            cloud.row = { ...cloud.row, ...q._patch };
            return res({ data: [{ version: q._patch.version }], error: null });
          }
          if (table === 'family_shares') return res({ data: cloud.shares, error: null });
          return res({ data: [], error: null });
        },
      };
      return q;
    },
  });

  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
       <div id="spaceBar"></div><div id="viewContent"></div><div id="sidebarNav"></div>
       <div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
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
  window.supabase = { createClient: sb };
  window.eval(bundleSrc);
  window.__cloud = cloud;
  return window;
}

const signIn = async (w) => {
  w.__cloud.authCb?.('SIGNED_IN', { user: { id: 'me1', email: 'me@x.com' } });
  await wait(250);
};

console.log('\nspaces suite');

// ═══ SP1 — a solo user must not see the concept at all ═════════════════════
{
  const w = boot(memberState());
  await wait(120);
  const bar = w.document.getElementById('spaceBar');
  ok('SP1 no switcher when nobody shares with you', (bar?.innerHTML || '') === '',
     bar?.innerHTML?.slice(0, 60));
  ok('SP1 the registry reports home', w.__app.spaces.isHome && !w.__app.spaces.hasGuestSpaces);
  ok('SP1 state is unscoped', w.__app.spaces.active().accounts.length === 2);
  w.close();
}

// ═══ SP2/SP3 — switching re-points the view layer ══════════════════════════
{
  const w = boot(memberState(), {
    shares: [{ owner_id: 'abbas1', snapshot: snapshot() }],
  });
  await wait(120);
  await signIn(w);
  const app = w.__app, doc = w.document;

  ok('SP2 the switcher appears once a space exists',
     (doc.getElementById('spaceBar')?.innerHTML || '').includes('Switch space'));
  ok('SP2 two spaces are offered', app.spaces.all().length === 2,
     String(app.spaces.all().length));

  app.switchSpace('abbas1');
  await wait(80);
  const space = app.spaces.active();

  ok('SP2 the active space is the guest one', space.id === 'abbas1' && !space.isHome);
  ok('SP2 accounts come from the owner snapshot',
     space.accounts.length === 1 && space.accounts[0].id === 'own1',
     JSON.stringify(space.accounts.map((a) => a.id)));
  ok('SP2 transactions come from the owner snapshot',
     space.transactions.length === 1 && space.transactions[0].id === 'owntx',
     JSON.stringify(space.transactions.map((t) => t.id)));
  ok('SP2 totals convert to the OWNER\'s home currency', space.homeCurrency === 'AED',
     space.homeCurrency);

  // SP3 is the whole reason the model exists: a contribution lands in the
  // owner's book, so a LOCAL category id there means nothing.
  ok('SP3 categories are the owner\'s, not mine',
     space.categories.length === 1 && space.categories[0].id === 'owncat',
     JSON.stringify(space.categories.map((c) => c.id)));
  ok('SP3 my own categories are NOT offered', !space.categories.some((c) => c.id === 'mycat'));

  const proj = space.project();
  ok('SP3 the projection carries the owner\'s three collections',
     proj.accounts[0].id === 'own1' && proj.categories[0].id === 'owncat'
       && proj.transactions[0].id === 'owntx');
  ok('SP3 …and hides my budgets, which are not in the snapshot',
     Array.isArray(proj.budgets) && proj.budgets.length === 0,
     JSON.stringify(proj.budgets));

  // The rendered Accounts view must follow.
  app.navigate('accounts');
  await wait(80);
  const html = doc.getElementById('viewContent').innerHTML;
  ok('SP2 the Accounts view shows the owner\'s account', html.includes('Abbas Wallet'));
  ok('SP2 …and not mine', !html.includes('My Savings'));

  // ═══ SP5 — local-book modals refuse ══════════════════════════════════════
  for (const name of ['account', 'budget', 'category', 'debt']) {
    app.openModal(name, {});
    await wait(20);
    ok(`SP5 the ${name} modal refuses inside a guest space`, !app.modalActive,
       String(app.modalActive));
    app.closeModal();
  }

  // ═══ SP6 — a new transaction becomes a contribution ══════════════════════
  app.openModal('transaction', {});
  await wait(40);
  ok('SP6 the transaction modal DOES open', app.modalActive === 'transaction',
     String(app.modalActive));
  const mode = app.txModal?.sharedTxMode;
  ok('SP6 …in shared mode, aimed at the owner', mode?.ownerId === 'abbas1',
     JSON.stringify(mode));
  ok('SP6 …on a writable account of theirs', mode?.accountId === 'own1', JSON.stringify(mode));
  const catField = doc.querySelector('[data-ownerid]');
  ok('SP6 …with the category field homed to the owner',
     catField?.getAttribute('data-ownerid') === 'abbas1',
     catField?.getAttribute('data-ownerid'));
  app.closeModal();
  await wait(20);

  // ═══ SP9 — labels ════════════════════════════════════════════════════════
  ok('SP9 the default label is the owner\'s own name', app.spaces.labelFor('abbas1') === 'Abbas',
     app.spaces.labelFor('abbas1'));
  app.spaces.setLabel('abbas1', 'Dad');
  ok('SP9 a member-side override wins', app.spaces.labelFor('abbas1') === 'Dad',
     app.spaces.labelFor('abbas1'));
  const saved = JSON.parse(w.localStorage.getItem('pocket.v1'));
  ok('SP9 …and is stored in MY book, so their next push cannot overwrite it',
     saved.user.spaceLabels?.abbas1 === 'Dad', JSON.stringify(saved.user.spaceLabels));
  app.spaces.setLabel('abbas1', '');
  ok('SP9 clearing it restores the owner\'s name', app.spaces.labelFor('abbas1') === 'Abbas',
     app.spaces.labelFor('abbas1'));

  // ═══ SP10 — session-scoped, never user data ══════════════════════════════
  ok('SP10 the active space is in sessionStorage',
     w.sessionStorage.getItem('pocket.v1.space') === 'abbas1',
     w.sessionStorage.getItem('pocket.v1.space'));
  const persisted = JSON.parse(w.localStorage.getItem('pocket.v1'));
  ok('SP10 …and NOT in the synced user state',
     persisted.user.activeSpace === undefined && persisted.activeSpace === undefined);

  // ═══ SP8 — revocation ════════════════════════════════════════════════════
  w.__cloud.shares = [];                    // the owner un-shared everything
  await app.sync.pullFamilyShares();        // emits state:changed → #reconcileSpaces
  await wait(80);
  ok('SP8 a revoked space drops the user back home', w.__app.spaces.isHome,
     String(w.__app.spaces.activeId));
  ok('SP8 …and the stale selection is cleared from session storage',
     !w.sessionStorage.getItem('pocket.v1.space'),
     w.sessionStorage.getItem('pocket.v1.space'));
  // The state reset alone is not the requirement — active() self-heals anyway.
  // What must ALSO happen is that the user is TOLD: a moment ago the screen was
  // full of someone else's money, and silently relocating them is exactly the
  // behaviour the design doc rules out.
  const toastText = w.document.getElementById('toast')?.textContent || '';
  ok('SP8 …and the user is told, by name, rather than silently relocated',
     toastText.includes('removed your access') && toastText.includes('Abbas'),
     JSON.stringify(toastText));

  w.close();
}

// ═══ SP4 — the home projection must be the real object ═════════════════════
{
  const w = boot(memberState(), { shares: [{ owner_id: 'abbas1', snapshot: snapshot() }] });
  await wait(120);
  await signIn(w);
  const app = w.__app;
  const real = app.store ? app.store.getState() : null;
  const proj = app.spaces.active().project();
  ok('SP4 home returns the SAME state object, not a copy',
     real ? proj === real : proj.accounts.length === 2,
     'a copy would silently break anything that mutates through it');
  w.close();
}

// ═══ SP7 — view-only access ════════════════════════════════════════════════
{
  const viewOnly = snapshot({ permission: { own1: 'view' }, sharedBy: 'Read Only' });
  const w = boot(memberState(), { shares: [{ owner_id: 'ro1', snapshot: viewOnly }] });
  await wait(120);
  await signIn(w);
  const app = w.__app;
  app.switchSpace('ro1');
  await wait(60);

  ok('SP7 the space reports no writable account', !app.spaces.active().canAddAnywhere);
  app.openModal('transaction', {});
  await wait(40);
  ok('SP7 adding a transaction is refused', !app.modalActive, String(app.modalActive));
  w.close();
}

// ═══ SP11 — a hostile snapshot must render inert in the switcher ═══════════
{
  const hostile = snapshot({
    sharedBy: '<img src=x onerror="window.__pwned=1">',
    accounts: [{
      ...acct('own1', '<script>window.__pwned2=1</script>', 'AED'),
      color: '#fff;background:url(javascript:alert(1))',
      icon:  'wallet"><img src=x onerror="window.__pwned3=1">',
    }],
  });
  const w = boot(memberState(), { shares: [{ owner_id: 'evil1', snapshot: hostile }] });
  await wait(120);
  await signIn(w);
  w.__app.openSpaceSheet();
  await wait(60);

  ok('SP11 nothing executed while rendering the switcher',
     w.__pwned === undefined && w.__pwned2 === undefined && w.__pwned3 === undefined);
  const sheet = w.document.getElementById('spaceSheetRoot');
  ok('SP11 the sheet rendered', !!sheet && sheet.innerHTML.length > 0);
  ok('SP11 the hostile name is escaped, not live markup',
     !sheet.querySelector('img[onerror]') && !sheet.querySelector('script'));
  w.close();
}

// ═══ SP12 — every writable account in the space must be offered ════════════
{
  // Three accounts: two the member can write to, one view-only.
  const multi = snapshot({
    sharedBy: 'Abbas',
    permission: { own1: 'edit', own2: 'add', own3: 'view' },
    accounts: [
      { ...acct('own1', 'Abbas Wallet',  'AED'), icon: 'wallet' },
      { ...acct('own2', 'Abbas Savings', 'AED'), icon: 'landmark' },
      { ...acct('own3', 'Abbas Locked',  'AED'), icon: 'lock' },
    ],
  });
  const w = boot(memberState(), { shares: [{ owner_id: 'abbas1', snapshot: multi }] });
  await wait(120);
  await signIn(w);
  const app = w.__app, doc = w.document;
  app.switchSpace('abbas1');
  await wait(60);

  app.openModal('transaction', {});
  await wait(60);
  ok('SP12 the form opened as a contribution', app.modalActive === 'transaction'
     && !!app.txModal?.sharedTxMode, String(app.modalActive));

  const sel = doc.querySelector('#txForm [name=accountId]');
  ok('SP12 the account control is a real dropdown, not a locked label',
     sel?.tagName === 'SELECT', sel?.tagName);
  const opts = [...(sel?.options || [])].map((o) => o.value);
  ok('SP12 both writable accounts are offered',
     opts.includes('own1') && opts.includes('own2'), JSON.stringify(opts));
  ok('SP12 …and the view-only one is not', !opts.includes('own3'), JSON.stringify(opts));

  // Switching must actually re-point the contribution.
  app.onSharedTxAccountChange('own2');
  await wait(60);
  ok('SP12 picking another account re-points the contribution',
     app.txModal?.sharedTxMode?.accountId === 'own2',
     JSON.stringify(app.txModal?.sharedTxMode));
  ok('SP12 …and the owner is unchanged, so the category list stays valid',
     app.txModal?.sharedTxMode?.ownerId === 'abbas1');
  const catField = doc.querySelector('[data-ownerid]');
  ok('SP12 …with the category field still homed to the owner',
     catField?.getAttribute('data-ownerid') === 'abbas1',
     catField?.getAttribute('data-ownerid'));
  app.closeModal();
  await wait(20);

  // A single writable account has nothing to choose, so it stays locked.
  const one = snapshot({ permission: { own1: 'edit' } });
  const w2 = boot(memberState(), { shares: [{ owner_id: 'solo1', snapshot: one }] });
  await wait(120);
  await signIn(w2);
  w2.__app.switchSpace('solo1');
  await wait(60);
  w2.__app.openModal('transaction', {});
  await wait(60);
  ok('SP12 one writable account stays locked — nothing to choose',
     w2.document.querySelector('#txForm [name=accountId]')?.tagName === 'INPUT',
     w2.document.querySelector('#txForm [name=accountId]')?.tagName);
  w2.close();
  w.close();
}

// ═══ SP13 — transfers must not reach a contribution ════════════════════════
{
  const w = boot(memberState(), { shares: [{ owner_id: 'abbas1', snapshot: snapshot() }] });
  await wait(120);
  await signIn(w);
  const app = w.__app, doc = w.document;
  app.switchSpace('abbas1');
  await wait(60);
  app.openModal('transaction', {});
  await wait(60);

  // Scope to the TYPE toggle. Matching on button text alone also catches the
  // payment-method chip labelled "Transfer" (BASE_TYPES includes it), which is
  // a different control entirely — the first version of this test failed on it.
  const typeButtons = [...doc.querySelectorAll('#txForm button')]
    .filter((b) => (b.getAttribute('onclick') || '').includes('setTxType'))
    .map((b) => b.textContent.trim());
  ok('SP13 only Expense and Income are offered',
     typeButtons.includes('Expense') && typeButtons.includes('Income')
       && !typeButtons.includes('Transfer'), JSON.stringify(typeButtons));

  // Defence in depth: a voice prefill can carry type 'transfer', so the submit
  // path — the one that actually reaches the owner's ledger — must refuse too.
  const form = doc.querySelector('#txForm');
  form.querySelector('[name=type]').value = 'transfer';
  form.querySelector('[name=amount]').value = '50';
  const before = (w.__cloud.contributions || []).length;
  await app.submitTx({ preventDefault() {}, target: form }, '');
  await wait(60);
  ok('SP13 submitting a transfer contribution is refused',
     (w.__cloud.contributions || []).length === before,
     `${(w.__cloud.contributions || []).length} contributions`);
  ok('SP13 …and nothing landed in my own book either',
     JSON.parse(w.localStorage.getItem('pocket.v1')).transactions.length === 1,
     String(JSON.parse(w.localStorage.getItem('pocket.v1')).transactions.length));
  w.close();
}

// ═══ SP14 — budgets, debts and regulars in a guest space ═══════════════════
{
  const withExtras = snapshot({
    permission: { own1: 'edit' },
    budgets: [{
      id: 'ownbg', categoryId: 'owncat', amount: 100000, currency: 'AED',
      period: 'gregorian', rollover: false,
      // Computed by the OWNER over ALL their transactions — the member holds
      // only the shared ones and would understate it.
      spent: 73500,
    }],
    budgetPermission: { ownbg: 'view' },
    debts: [{ id: 'owndebt', accountId: 'own1', name: 'Car loan', amount: 500000, currency: 'AED' }],
    regularItems: [{ id: 'ownreg', accountId: 'own1', name: 'Rent', defaultAmount: 300000, currency: 'AED' }],
  });
  const w = boot(memberState(), { shares: [{ owner_id: 'abbas1', snapshot: withExtras }] });
  await wait(120);
  await signIn(w);
  const app = w.__app;
  app.switchSpace('abbas1');
  await wait(60);
  const space = app.spaces.active();

  ok('SP14 a granted budget appears in the space',
     space.budgets.length === 1 && space.budgets[0].id === 'ownbg',
     JSON.stringify(space.budgets.map((b) => b.id)));
  ok('SP14 …carrying the OWNER\'s spend, not a locally-computed one',
     space.budgets[0].spent === 73500, String(space.budgets[0].spent));
  ok('SP14 …at the access level they granted',
     space.budgetPermissionFor('ownbg') === 'view', space.budgetPermissionFor('ownbg'));
  ok('SP14 debts on a shared account come through',
     space.debts.length === 1 && space.debts[0].id === 'owndebt');
  ok('SP14 regular items too', space.regularItems.length === 1);

  const proj = space.project();
  ok('SP14 the projection carries all three', proj.budgets.length === 1
     && proj.debts.length === 1 && proj.regularItems.length === 1);
  ok('SP14 my OWN budget is not visible while I stand in their book',
     !proj.budgets.some((b) => b.id === 'mybg'), JSON.stringify(proj.budgets.map((b) => b.id)));

  // Derived figures cover a subset, so the UI has to say so.
  ok('SP14 the space reports itself as a partial view', space.isPartialView);
  ok('SP14 …with a caveat naming how much it covers',
     /1 account shared with you/.test(space.scopeNote), space.scopeNote);
  w.close();
}

// ═══ SP15 — the owner's push: what a member is actually sent ═══════════════
{
  // Two accounts, only ONE shared. A budget spans a category that is spent on
  // BOTH, which is exactly the case a member cannot compute for themselves.
  const ownerState = memberState();
  ownerState.user.name = 'Abbas';
  ownerState.accounts = [acct('shared1', 'Shared Wallet'), acct('private1', 'Private Card')];
  ownerState.categories = [{ id: 'cFood', name: 'Food', type: 'expense', parentId: null, color: '#f97316', icon: 'tag' }];
  ownerState.transactions = [
    { id: 'tA', accountId: 'shared1', categoryId: 'cFood', amount: 3000, currency: 'USD',
      type: 'expense', date: '2026-08-05', paymentType: 'card', recordState: 'cleared', tags: [] },
    { id: 'tB', accountId: 'private1', categoryId: 'cFood', amount: 4500, currency: 'USD',
      type: 'expense', date: '2026-08-06', paymentType: 'card', recordState: 'cleared', tags: [] },
  ];
  ownerState.budgets = [{ id: 'bFood', categoryId: 'cFood', amount: 100000, currency: 'USD',
                          period: 'gregorian', rollover: false }];
  ownerState.debts = [
    { id: 'dShared',  accountId: 'shared1',  name: 'Loan A', amount: 1000, currency: 'USD' },
    { id: 'dPrivate', accountId: 'private1', name: 'Loan B', amount: 2000, currency: 'USD' },
  ];
  ownerState.regularItems = [
    { id: 'rShared',  accountId: 'shared1',  name: 'Rent',   defaultAmount: 500, currency: 'USD' },
    { id: 'rPrivate', accountId: 'private1', name: 'Gym',    defaultAmount: 100, currency: 'USD' },
  ];
  ownerState.family = [
    {
      id: 'm1', name: 'Zahra', email: 'zahra@x.com', initials: 'Z', color: '#8b5cf6',
      permissions:       [{ accountId: 'shared1', access: 'edit' }],
      budgetPermissions: [{ budgetId: 'bFood', access: 'view' }],
    },
    {
      // Granted a budget and NOTHING else. They still need a space to stand in,
      // so "no accounts shared" must not be read as a full revocation.
      id: 'm2', name: 'Husain', email: 'husain@x.com', initials: 'H', color: '#10b981',
      permissions:       [],
      budgetPermissions: [{ budgetId: 'bFood', access: 'view' }],
    },
  ];

  const w = boot(ownerState);
  await wait(120);
  await signIn(w);
  const app = w.__app;

  await app.sync.push();
  await wait(120);

  const forMember = (email) => w.__cloud.pushedShares
    .filter((r) => r.member_email === email).at(-1)?.snapshot;
  const pushed = forMember('zahra@x.com');
  ok('SP15 a snapshot was published for the member', !!pushed,
     JSON.stringify(w.__cloud.pushedShares.length));
  ok('SP15 only the shared account travels',
     pushed.accounts.length === 1 && pushed.accounts[0].id === 'shared1',
     JSON.stringify(pushed.accounts.map((a) => a.id)));
  ok('SP15 only its transactions travel',
     pushed.transactions.length === 1 && pushed.transactions[0].id === 'tA',
     JSON.stringify(pushed.transactions.map((t) => t.id)));

  ok('SP15 the granted budget travels', pushed.budgets?.length === 1
     && pushed.budgets[0].id === 'bFood', JSON.stringify(pushed.budgets));
  // The load-bearing assertion. Spend covers BOTH accounts (3000 + 4500), while
  // the member only receives the 3000 row — so a locally-computed figure would
  // read 30.00 against a true 75.00. Sending every transaction to fix that is
  // the leak the account filter exists to prevent; granting the budget is the
  // consent to disclose the total.
  ok('SP15 …carrying spend computed over ALL the owner\'s accounts',
     pushed.budgets[0].spent === 7500, String(pushed.budgets[0].spent));
  ok('SP15 …which is MORE than the member could compute themselves',
     pushed.budgets[0].spent > pushed.transactions.reduce((n, t) => n + t.amount, 0),
     `${pushed.budgets[0].spent} vs ${pushed.transactions.reduce((n, t) => n + t.amount, 0)}`);
  ok('SP15 the budget access level travels',
     pushed.budgetPermission?.bFood === 'view', JSON.stringify(pushed.budgetPermission));

  ok('SP15 debts are filtered by their account',
     pushed.debts?.length === 1 && pushed.debts[0].id === 'dShared',
     JSON.stringify((pushed.debts || []).map((d) => d.id)));
  ok('SP15 regular items too',
     pushed.regularItems?.length === 1 && pushed.regularItems[0].id === 'rShared',
     JSON.stringify((pushed.regularItems || []).map((r) => r.id)));

  // A budget-only member must still receive a snapshot. Treating "no accounts"
  // as a full revocation would silently delete their space.
  const budgetOnly = forMember('husain@x.com');
  ok('SP15 a budget-only member still gets a space', !!budgetOnly,
     JSON.stringify(w.__cloud.pushedShares.map((r) => r.member_email)));
  ok('SP15 …with no accounts', (budgetOnly?.accounts || []).length === 0,
     JSON.stringify(budgetOnly?.accounts));
  ok('SP15 …but the budget they were granted',
     budgetOnly?.budgets?.length === 1 && budgetOnly.budgets[0].id === 'bFood',
     JSON.stringify(budgetOnly?.budgets));

  // `wasLast` is what tells a caller to revoke the member's cloud row. Reading
  // it off account grants alone would destroy the space of a member who still
  // holds a budget — the same failure as above, reached from the other side.
  const shares = app.familyShares;
  const r1 = shares.setAccess('m1', 'shared1', null);
  ok('SP15 revoking the last ACCOUNT is not "last" while a budget remains',
     r1.ok && r1.wasLast === false, JSON.stringify(r1));
  const r2 = shares.setBudgetAccess('m1', 'bFood', null);
  ok('SP15 …and revoking the budget too finally is', r2.ok && r2.wasLast === true,
     JSON.stringify(r2));

  // The budget ladder is its own — 'add' is meaningless for a limit.
  const bad = shares.setBudgetAccess('m2', 'bFood', 'add');
  ok('SP15 a budget rejects the account ladder\'s "add" level', bad.ok === false,
     JSON.stringify(bad));
  ok('SP15 the budget levels are view/edit/full',
     JSON.stringify(shares.constructor.budgetLevels.map((l) => l.id)) === '["view","edit","full"]',
     JSON.stringify(shares.constructor.budgetLevels.map((l) => l.id)));
  w.close();
}

// ═══ SP16 — the Budgets view must not recompute a guest space's spend ══════
{
  const st = memberState();
  // The member has their OWN spending in a category id that happens to collide
  // with nothing — the point is that any locally-computed figure is wrong here.
  st.transactions.push({
    id: 'mine2tx', accountId: 'mine1', categoryId: 'mycat', amount: 999900,
    currency: 'USD', type: 'expense', date: '2026-08-03', paymentType: 'card',
    recordState: 'cleared', tags: [],
  });
  const withBudget = snapshot({
    budgets: [{ id: 'ownbg', categoryId: 'owncat', amount: 100000, currency: 'AED',
                period: 'gregorian', rollover: false, spent: 73500 }],
    budgetPermission: { ownbg: 'view' },
  });
  const w = boot(st, { shares: [{ owner_id: 'abbas1', snapshot: withBudget }] });
  await wait(120);
  await signIn(w);
  const app = w.__app, doc = w.document;
  app.switchSpace('abbas1');
  await wait(60);
  app.navigate('budgets');
  await wait(80);

  const html = doc.getElementById('viewContent').innerHTML;
  ok('SP16 the owner\'s published spend is what renders', html.includes('735.00'),
     html.slice(0, 0) || 'no 735.00 in the rendered budgets view');
  ok('SP16 …and the member\'s own 9,999.00 does not leak in',
     !html.includes('9,999.00'), 'member spending appeared in a guest budget');
  ok('SP16 creating a budget is not offered here', !html.includes('New budget'));
  w.close();
}

// ═══ SP17 — per-budget sharing is reachable, and home-only ═════════════════
{
  const owner = memberState();
  owner.family = [{ id: 'm1', name: 'Zahra', email: 'z@x.com', initials: 'Z',
                    color: '#8b5cf6', permissions: [], budgetPermissions: [] }];
  const w = boot(owner, { shares: [{ owner_id: 'abbas1', snapshot: snapshot() }] });
  await wait(120);
  await signIn(w);
  const app = w.__app, doc = w.document;

  app.shareBudget('mybg');
  await wait(60);
  const sheet = doc.getElementById('budgetShareSheetRoot');
  ok('SP17 the budget share sheet opens at home', !!sheet && sheet.innerHTML.includes('Share budget'));
  // The level choices only render once a member row is expanded.
  app.budgetShareSheet.pick('m1');
  await wait(40);
  const expanded = doc.getElementById('budgetShareSheetRoot').innerHTML;
  ok('SP17 …offering the BUDGET ladder, not the account one',
     expanded.includes('Change the amount, period and categories')
       && !expanded.includes('View + add new transactions'),
     'the account ladder\'s "add" is meaningless on a budget');
  ok('SP17 …and warning that spend covers every account',
     /counted[\s\S]*all[\s\S]*your accounts/.test(sheet.innerHTML));

  app.budgetShareSheet.setAccess('m1', 'edit');
  await wait(40);
  ok('SP17 granting works', app.familyShares.budgetAccessFor('m1', 'mybg') === 'edit',
     String(app.familyShares.budgetAccessFor('m1', 'mybg')));
  app.budgetShareSheet.close();
  await wait(20);

  // You cannot re-share someone else's budget from inside their space.
  app.switchSpace('abbas1');
  await wait(60);
  app.shareBudget('mybg');
  await wait(40);
  ok('SP17 sharing is refused inside a guest space',
     !doc.getElementById('budgetShareSheetRoot')?.classList.contains('open')
       && !(doc.querySelector('#budgetShareSheetRoot .sheet-backdrop.open')),
     'sheet opened in a guest space');
  w.close();
}

// ═══ SP18 / SP19 — the owner's side ════════════════════════════════════════
{
  const owner = memberState();
  owner.user.name = 'Abbas';
  owner.accounts  = [acct('a1', 'Joint Account'), acct('a2', 'Business')];
  owner.budgets   = [{ id: 'bg1', categoryId: 'mycat', amount: 50000, currency: 'USD',
                       period: 'gregorian', rollover: false }];
  owner.family = [
    { id: 'm1', name: 'Zahra', email: 'z@x.com', initials: 'Z', color: '#8b5cf6',
      // 'add' is the level the old hand-copied table omitted entirely.
      permissions: [{ accountId: 'a1', access: 'add' }],
      budgetPermissions: [{ budgetId: 'bg1', access: 'view' }] },
    { id: 'm2', name: 'Husain', email: 'h@x.com', initials: 'H', color: '#10b981',
      permissions: [{ accountId: 'a2', access: 'view' }], budgetPermissions: [] },
  ];
  const w = boot(owner);
  await wait(120);
  await signIn(w);
  const app = w.__app, doc = w.document;
  app.navigate('family');
  await wait(80);
  let html = doc.getElementById('viewContent').innerHTML;

  ok('SP19 an "add" grant is shown as Can add, not View only',
     html.includes('Can add') && !/Zahra[\s\S]{0,600}View only/.test(html),
     'the owner would be told they gave less access than they did');
  ok('SP18 budgets shared with a member are listed too', html.includes('Budget ·'),
     'the owner could not see which budgets a member holds');
  ok('SP18 an unnamed space is flagged as carrying the owner\'s own name',
     html.includes('They see this as your name'));

  // Naming is per-member, which the (owner_id, member_email) key already allows.
  app.familyShares.setSpaceName('m1', 'Household');
  app.familyShares.setSpaceName('m2', 'Business');
  app.navigate('family');
  await wait(80);
  html = doc.getElementById('viewContent').innerHTML;
  ok('SP18 each member\'s space carries its own name',
     html.includes('Household') && html.includes('Business'),
     'two different shares from one owner were indistinguishable');

  // And the name must travel to the member, replacing the owner's own name.
  await app.sync.push();
  await wait(120);
  const forZahra = w.__cloud.pushedShares.filter((r) => r.member_email === 'z@x.com').at(-1)?.snapshot;
  ok('SP18 the chosen name is what the member receives',
     forZahra?.sharedBy === 'Household', String(forZahra?.sharedBy));
  ok('SP18 …with the owner\'s real name still available alongside it',
     forZahra?.ownerName === 'Abbas', String(forZahra?.ownerName));

  app.familyShares.setSpaceName('m1', '');
  await app.sync.push();
  await wait(120);
  const cleared = w.__cloud.pushedShares.filter((r) => r.member_email === 'z@x.com').at(-1)?.snapshot;
  ok('SP18 clearing it falls back to the owner\'s name',
     cleared?.sharedBy === 'Abbas', String(cleared?.sharedBy));
  w.close();
}

// ═══ SP20-22 — owner-created spaces ════════════════════════════════════════
{
  console.log('\n SP20+ — owner-created spaces');
  const owner = memberState();
  owner.user.name = 'Abbas';
  owner.accounts  = [acct('a1', 'Joint'), acct('a2', 'Business'), acct('a3', 'Savings')];
  owner.budgets   = [{ id: 'bg1', categoryId: 'mycat', amount: 50000, currency: 'USD',
                       period: 'gregorian', rollover: false }];
  owner.family = [
    { id: 'm1', name: 'Zahra',  email: 'z@x.com', initials: 'Z', color: '#8b5cf6', permissions: [], budgetPermissions: [] },
    { id: 'm2', name: 'Husain', email: 'h@x.com', initials: 'H', color: '#10b981', permissions: [], budgetPermissions: [] },
    { id: 'm3', name: 'NoEmail', initials: 'N', color: '#f59e0b', permissions: [], budgetPermissions: [] },
  ];
  const w = boot(owner);
  await wait(120);
  await signIn(w);
  const app = w.__app;
  const spaces = app.ownerSpaces;

  const made = spaces.create('Household');
  ok('SP20 a space can be created', made.ok && !!made.space.id, JSON.stringify(made));
  const spId = made.space.id;

  spaces.setAccount(spId, 'a1', true);
  spaces.setAccount(spId, 'a3', true);
  spaces.setBudget(spId, 'bg1', true);

  // THE question that started this: more than one email in one space.
  const r1 = spaces.addMember(spId, 'm1', 'edit', 'view');
  const r2 = spaces.addMember(spId, 'm2', 'add', 'view');
  ok('SP20 several people can be in one space', r1.ok && r2.ok,
     JSON.stringify([r1, r2]));

  // The whole safety argument: permissions keep the exact shape
  // #authoriseContribution already reads, so it never had to change.
  const fam = () => JSON.parse(w.localStorage.getItem('pocket.v1')).family;
  const zahra = fam().find((m) => m.id === 'm1');
  ok('SP20 permissions are DERIVED for each member',
     zahra.permissions.length === 2
       && zahra.permissions.every((p) => p.access === 'edit')
       && zahra.permissions.map((p) => p.accountId).sort().join() === 'a1,a3',
     JSON.stringify(zahra.permissions));
  ok('SP20 …at that member\'s own level, not the space\'s',
     fam().find((m) => m.id === 'm2').permissions.every((p) => p.access === 'add'),
     JSON.stringify(fam().find((m) => m.id === 'm2').permissions));
  ok('SP20 budget grants derive too',
     zahra.budgetPermissions.length === 1 && zahra.budgetPermissions[0].budgetId === 'bg1',
     JSON.stringify(zahra.budgetPermissions));
  ok('SP20 the space name is what both members see',
     fam().filter((m) => ['m1', 'm2'].includes(m.id)).every((m) => m.spaceName === 'Household'),
     JSON.stringify(fam().map((m) => m.spaceName)));
  ok('SP20 an account NOT in the space is not granted',
     !zahra.permissions.some((p) => p.accountId === 'a2'));

  // Adding an account to the space reaches everyone at once — the N×M fix.
  spaces.setAccount(spId, 'a2', true);
  ok('SP20 adding an account reaches every member at once',
     fam().filter((m) => ['m1', 'm2'].includes(m.id)).every((m) => m.permissions.length === 3),
     JSON.stringify(fam().map((m) => m.permissions.length)));

  // SP21 — the limit the storage genuinely has, surfaced not hidden.
  const other = spaces.create('Business');
  const clash = spaces.addMember(other.space.id, 'm1', 'view', 'view');
  ok('SP21 one person cannot be in two spaces', !clash.ok, JSON.stringify(clash));
  ok('SP21 …and the reason names the space they are already in',
     /Household/.test(clash.reason || ''), clash.reason);
  ok('SP21 the first space is untouched',
     fam().find((m) => m.id === 'm1').permissions.length === 3);

  // A share is delivered by email, so a member without one cannot be added.
  const noMail = spaces.addMember(other.space.id, 'm3', 'view', 'view');
  ok('SP21 a member with no email is refused, with the reason', !noMail.ok
     && /email/i.test(noMail.reason || ''), JSON.stringify(noMail));

  // Removing everything leaves the member orphaned, which the caller must act on.
  const gone = spaces.removeMember(spId, 'm2');
  ok('SP20 removing someone clears their grants',
     fam().find((m) => m.id === 'm2').permissions.length === 0);
  ok('SP20 …and reports them as orphaned so the cloud row can be dropped',
     (gone.orphaned || []).some((m) => m.id === 'm2'),
     JSON.stringify((gone.orphaned || []).map((m) => m.id)));
  w.close();
}

// ═══ SP22 — migrating old grants must never widen access ═══════════════════
{
  const legacy = memberState();
  legacy.accounts = [acct('a1', 'One'), acct('a2', 'Two')];
  legacy.family = [{
    id: 'm1', name: 'Zahra', email: 'z@x.com', initials: 'Z', color: '#8b5cf6',
    // Mixed levels — the old model allowed per-account granularity.
    permissions: [{ accountId: 'a1', access: 'full' }, { accountId: 'a2', access: 'view' }],
    budgetPermissions: [],
  }];
  const w = boot(legacy);
  await wait(150);
  const app = w.__app;
  const spaces = app.ownerSpaces.spaces();

  ok('SP22 a space is synthesised from the old grants', spaces.length === 1,
     JSON.stringify(spaces.map((s) => s.name)));
  ok('SP22 …holding both accounts',
     (spaces[0].accountIds || []).sort().join() === 'a1,a2',
     JSON.stringify(spaces[0].accountIds));
  // A space carries ONE level per member. Taking the strongest would silently
  // promote 'view' on a2 to 'full'; taking the weakest can only under-grant,
  // which the owner can correct deliberately.
  ok('SP22 the WEAKEST level is kept, so migration cannot widen access',
     spaces[0].members[0].access === 'view', spaces[0].members[0].access);
  w.close();
}

// ═══ SP23 — the overlap rule must not forbid ordinary sharing ══════════════
{
  console.log('\n SP23+ — overlap and addressing');
  const owner = memberState();
  owner.accounts = [acct('joint', 'Joint'), acct('solo', 'Solo')];
  owner.family = [
    { id: 'm1', name: 'Zahra',  email: 'z@x.com', initials: 'Z', color: '#8b5cf6', permissions: [], budgetPermissions: [] },
    { id: 'm2', name: 'Husain', email: 'h@x.com', initials: 'H', color: '#10b981', permissions: [], budgetPermissions: [] },
  ];
  const w = boot(owner);
  await wait(120);
  await signIn(w);
  const spaces = w.__app.ownerSpaces;

  const A = spaces.create('Household').space;
  const B = spaces.create('Business').space;
  spaces.addMember(A.id, 'm1', 'edit', 'view');
  spaces.addMember(B.id, 'm2', 'view', 'view');

  // The ordinary case: the SAME account in two spaces, held by two DIFFERENT
  // people. An earlier version of the rule forbade this outright and broke the
  // most common thing anyone does with sharing.
  const r1 = spaces.setAccount(A.id, 'joint', true);
  const r2 = spaces.setAccount(B.id, 'joint', true);
  ok('SP23 two different people may hold the same account', r1.ok && r2.ok,
     JSON.stringify([r1, r2]));

  const fam = () => JSON.parse(w.localStorage.getItem('pocket.v1')).family;
  ok('SP23 …each at their own space\'s level',
     fam().find((m) => m.id === 'm1').permissions[0].access === 'edit'
       && fam().find((m) => m.id === 'm2').permissions[0].access === 'view',
     JSON.stringify(fam().map((m) => m.permissions)));

  // What IS forbidden: one person ending up with the account twice. Putting m1
  // into Business — which already holds 'joint' that m1 holds via Household —
  // would make their derived union order-dependent.
  const clash = spaces.addMember(B.id, 'm1', 'view', 'view');
  ok('SP23 one person cannot hold the same account through two spaces', !clash.ok,
     JSON.stringify(clash));
  w.close();
}

// ═══ SP24 — a snapshot is addressed by owner + space ═══════════════════════
{
  // Two spaces from ONE owner. The storage cannot deliver this until phase C of
  // the migration, but the client must already address them distinctly or they
  // collapse into one the moment it can.
  const twoFromOne = [
    { owner_id: 'abbas1', space_id: 'sp_home', snapshot: snapshot({ sharedBy: 'Household' }) },
    { owner_id: 'abbas1', space_id: 'sp_biz',  snapshot: snapshot({
        sharedBy: 'Business',
        accounts: [{ ...acct('own2', 'Biz Wallet', 'AED') }],
        permission: { own2: 'view' },
      }) },
  ];
  const w = boot(memberState(), { shares: twoFromOne });
  await wait(120);
  await signIn(w);
  const app = w.__app;

  const guests = app.spaces.all().filter((s) => !s.isHome);
  ok('SP24 both spaces from one owner are offered', guests.length === 2,
     JSON.stringify(guests.map((s) => s.label)));
  ok('SP24 …with distinct ids', guests[0].id !== guests[1].id,
     JSON.stringify(guests.map((s) => s.id)));
  ok('SP24 …but the same owner, which is what routes a contribution',
     guests.every((s) => s.ownerId === 'abbas1'),
     JSON.stringify(guests.map((s) => s.ownerId)));

  const biz = guests.find((s) => s.label === 'Business');
  app.switchSpace(biz.id);
  await wait(60);
  ok('SP24 switching picks the right one of the two',
     app.spaces.active().label === 'Business'
       && app.spaces.active().accounts[0].id === 'own2',
     JSON.stringify({ l: app.spaces.active().label, a: app.spaces.active().accounts.map((a) => a.id) }));
  w.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
