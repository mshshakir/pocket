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
  const cloud = { shares, row: { id: 'me1', version: 1, data: JSON.parse(JSON.stringify(state)) } };
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
        update() { return q; },
        async upsert() { return { data: [{ version: 1 }], error: null }; },
        delete() { return q; },
        then(res) {
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

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
