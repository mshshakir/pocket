/**
 * groups.smoke.mjs — account groups + the central local-change push hook.
 *
 *  PART 1  Account grouping: create, rename, delete, bulk-assign, and the
 *          one-shot "group by currency" action.
 *  PART 2  H7: every LOCAL mutation schedules a cloud push, while applying
 *          REMOTE state does not (which would ping-pong versions).
 *
 * Run:  node src/__smoke__/groups.smoke.mjs
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

const acct = (id, name, currency, groupId = null) => ({
  id, name, currency, groupId, type: 'bank', color: '#3b82f6', icon: 'landmark',
  openingBalance: 0, balance: 0,
});

const baseState = (over = {}) => ({
  user: { homeCurrency: 'USD', defaultCurrency: 'USD', theme: 'light', showHijri: false,
          hijriOffset: 0, customPaymentTypes: [], hiddenPaymentTypes: [],
          collapsedAccountGroups: [] },
  accounts: [
    acct('a1', 'Cash USD',   'USD'),
    acct('a2', 'Bank USD',   'USD'),
    acct('a3', 'Bank EUR',   'EUR'),
    acct('a4', 'Wallet JPY', 'JPY'),
  ],
  categories: [{ id: 'c1', name: 'Food', type: 'expense', parentId: null, color: '#f97316', icon: 'tag' }],
  transactions: [], budgets: [], debts: [], family: [], regularItems: [],
  merchantCategories: {}, accountGroups: [],
  ...over,
});

function boot(state, { supabase } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
       <div id="viewContent"></div><div id="sidebarNav"></div>
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
  if (supabase) window.supabase = supabase;
  window.eval(bundleSrc);
  return window;
}

console.log('\naccount groups suite');

// ═══ PART 1 — grouping ══════════════════════════════════════════════════════
{
  const w = boot(baseState());
  await wait(80);
  const app = w.__app, doc = w.document;
  const saved  = () => JSON.parse(w.localStorage.getItem('pocket.v1'));
  const sheet  = () => app.accountGroupSheet;
  const rowNames = () => [...doc.querySelectorAll('#accountGroupSheetRoot .sheet-row-name')]
    .map((r) => r.textContent.trim());

  app.navigate('accounts');
  await wait(50);
  ok('Accounts page offers a Groups button',
     (doc.getElementById('viewContent')?.innerHTML || '').includes('openAccountGroups'));

  app.openAccountGroups();
  await wait(50);
  ok('group sheet opens', doc.getElementById('accountGroupSheetRoot')?.classList.contains('open'));
  ok('all four accounts start ungrouped',
     rowNames().filter((n) => n.startsWith('Cash') || n.startsWith('Bank') || n.startsWith('Wallet')).length === 4,
     rowNames().join(' | '));

  // ---- create ------------------------------------------------------------
  sheet().startAdd();
  await wait(30);
  doc.querySelector('#accountGroupSheetRoot [data-grp-input]').value = 'Everyday';
  sheet().submit();
  await wait(50);
  const g1 = saved().accountGroups.find((g) => g.name === 'Everyday');
  ok('group created', !!g1, JSON.stringify(saved().accountGroups));
  ok('creating a group drops straight into its member list',
     (doc.getElementById('accountGroupSheetRoot')?.innerHTML || '').includes('Tick the accounts'));

  // ---- bulk assign -------------------------------------------------------
  sheet().toggleAccount('a1');
  sheet().toggleAccount('a2');
  await wait(20);
  sheet().applyMembers();
  await wait(60);
  const after = saved().accounts;
  ok('bulk assign moved both ticked accounts',
     after.find((a) => a.id === 'a1').groupId === g1.id &&
     after.find((a) => a.id === 'a2').groupId === g1.id,
     JSON.stringify(after.map((a) => `${a.id}:${a.groupId}`)));
  ok('untouched accounts stay ungrouped',
     !after.find((a) => a.id === 'a3').groupId && !after.find((a) => a.id === 'a4').groupId);

  // Unticking must REMOVE from the group, not just skip it.
  sheet().openGroup(g1.id);
  await wait(30);
  sheet().toggleAccount('a2');   // untick
  sheet().applyMembers();
  await wait(60);
  ok('unticking removes the account from the group',
     !saved().accounts.find((a) => a.id === 'a2').groupId,
     String(saved().accounts.find((a) => a.id === 'a2').groupId));
  ok('the still-ticked account stayed put',
     saved().accounts.find((a) => a.id === 'a1').groupId === g1.id);

  // ---- rename ------------------------------------------------------------
  sheet().edit(g1.id);
  await wait(30);
  doc.querySelector('#accountGroupSheetRoot [data-grp-input]').value = 'Daily spending';
  sheet().submit();
  await wait(50);
  ok('group renamed', saved().accountGroups.some((g) => g.name === 'Daily spending'),
     JSON.stringify(saved().accountGroups.map((g) => g.name)));
  ok('rename kept the id, so members follow automatically',
     saved().accounts.find((a) => a.id === 'a1').groupId === g1.id);

  // duplicate name rejected
  sheet().startAdd();
  await wait(30);
  doc.querySelector('#accountGroupSheetRoot [data-grp-input]').value = 'Savings';
  sheet().submit();
  await wait(50);
  const g2 = saved().accountGroups.find((g) => g.name === 'Savings');
  sheet().back();
  await wait(20);
  sheet().edit(g2.id);
  await wait(30);
  doc.querySelector('#accountGroupSheetRoot [data-grp-input]').value = 'daily SPENDING';
  sheet().submit();
  await wait(40);
  ok('duplicate rename rejected',
     (doc.querySelector('#accountGroupSheetRoot .text-rose-500')?.textContent || '')
       .includes('already exists'));
  ok('the group kept its old name after the rejection',
     saved().accountGroups.find((g) => g.id === g2.id).name === 'Savings');
  sheet().cancel();
  await wait(20);

  // ---- group by currency -------------------------------------------------
  sheet().groupByCurrency();
  await wait(60);
  const st = saved();
  const nameOf = (accId) => {
    const a = st.accounts.find((x) => x.id === accId);
    return st.accountGroups.find((g) => g.id === a.groupId)?.name;
  };
  ok('group by currency created one group per currency',
     new Set(st.accountGroups.map((g) => g.name)).size === 3 &&
     ['USD', 'EUR', 'JPY'].every((c) => st.accountGroups.some((g) => g.name === c)),
     st.accountGroups.map((g) => g.name).join(','));
  ok('every account landed in its currency group',
     nameOf('a1') === 'USD' && nameOf('a2') === 'USD' &&
     nameOf('a3') === 'EUR' && nameOf('a4') === 'JPY',
     [nameOf('a1'), nameOf('a2'), nameOf('a3'), nameOf('a4')].join(','));
  ok('the previous hand-made groups were cleaned up',
     !st.accountGroups.some((g) => g.name === 'Daily spending' || g.name === 'Savings'),
     st.accountGroups.map((g) => g.name).join(','));

  // Running it twice must be idempotent, not duplicate every group.
  sheet().groupByCurrency();
  await wait(60);
  ok('running group-by-currency twice does not duplicate groups',
     saved().accountGroups.length === 3,
     saved().accountGroups.map((g) => g.name).join(','));

  // ---- delete ------------------------------------------------------------
  const usd = saved().accountGroups.find((g) => g.name === 'USD');
  sheet().remove(usd.id);
  await wait(60);
  ok('group deleted', !saved().accountGroups.some((g) => g.id === usd.id));
  ok('its accounts survived, just ungrouped',
     saved().accounts.filter((a) => a.id === 'a1' || a.id === 'a2')
       .every((a) => !a.groupId) && saved().accounts.length === 4,
     JSON.stringify(saved().accounts.map((a) => `${a.id}:${a.groupId}`)));

  sheet().close();
  await wait(30);
  ok('sheet closed', !doc.getElementById('accountGroupSheetRoot').classList.contains('open'));
  w.close();
}

// ═══ PART 2 — H7: the central push hook ═════════════════════════════════════
{
  const cloud = { row: { id: 'u1', data: null, version: 5 }, writes: [] };
  const makeSb = () => ({
    auth: { onAuthStateChange(cb) { cloud.authCb = cb; },
            getSession: async () => ({ data: { session: null } }),
            signOut: async () => {}, signInWithOAuth: async () => ({}) },
    removeChannel() {},
    channel() { const c = { on() { return c; }, subscribe(cb) { cb?.('SUBSCRIBED'); return c; }, send() {} }; return c; },
    from(table) {
      const q = {
        _eq: {}, _patch: null,
        select() { return q; }, eq(k, v) { q._eq[k] = v; return q; },
        in() { return q; }, order() { return q; }, delete() { return q; },
        update(p) { q._patch = p; return q; },
        async upsert() { return { error: null }; },
        async single() {
          return table === 'user_data' ? { data: cloud.row, error: null }
                                       : { data: null, error: { code: 'PGRST116' } };
        },
        then(res) {
          if (q._patch && table === 'user_data') {
            const casOk = q._eq.version === undefined || q._eq.version === cloud.row.version;
            if (casOk) {
              cloud.writes.push(q._patch.version);
              cloud.row = { ...cloud.row, ...q._patch };
              return res({ data: [{ version: q._patch.version }], error: null });
            }
            return res({ data: [], error: null });
          }
          return res({ data: [], error: null });
        },
      };
      return q;
    },
  });

  const st = baseState();
  cloud.row.data = st;
  const w = boot(st, { supabase: { createClient: () => makeSb() } });
  await wait(80);
  cloud.authCb?.('SIGNED_IN', { user: { id: 'u1', email: 'a@b.c' } });
  await wait(250);

  const app = w.__app;
  const writesBefore = cloud.writes.length;

  // A settings mutation that previously did NOT call schedulePush.
  app.toggleHijri();
  await wait(1400);
  ok('H7 a settings mutation now schedules a push',
     cloud.writes.length > writesBefore,
     `${writesBefore} → ${cloud.writes.length}`);

  // Group changes go through the same hook.
  const n2 = cloud.writes.length;
  app.openAccountGroups();
  await wait(30);
  app.accountGroupSheet.groupByCurrency();
  await wait(1400);
  ok('H7 a grouping change is pushed too', cloud.writes.length > n2,
     `${n2} → ${cloud.writes.length}`);
  app.accountGroupSheet.close();

  // Once things settle, the hook must go quiet — an FX refresh or a pull
  // scheduling pushes of its own would ping-pong versions between devices.
  await wait(1400);
  const n3 = cloud.writes.length;
  await wait(1600);
  ok('H7 the hook goes quiet when nothing is being edited',
     cloud.writes.length === n3, `${cloud.writes.length - n3} unexpected writes`);
  w.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
