/**
 * audit-fixes.smoke.mjs — regression tests for the July 2026 audit criticals.
 *
 * One test per finding in AUDIT-2026-07.md, each reproducing the original
 * failure so a regression is caught rather than re-discovered:
 *
 *   C1  account currency change fabricated a balance adjustment
 *   C2  CSV import re-denominated existing accounts
 *   C3  transfer → expense orphaned the paired leg (money created)
 *   C4  expense → transfer produced a leg-less, zero-impact row (money lost)
 *   C5  a failed pull let the next push overwrite the cloud from version 0
 *   C6  a pull inside the push debounce discarded the local edit
 *   C7  an involuntary sign-out wiped local storage
 *   C8  importJson dropped every key the file omitted
 *   H2  HTML-escaped names broke inline handler arguments
 *
 * Run:  node src/__smoke__/audit-fixes.smoke.mjs
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

/** Boot a fresh app instance over the given state. */
function boot(state, { supabase } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="app"></div></body></html>`,
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

const baseAccounts = [
  { id: 'a1', name: 'Cash',    type: 'cash', currency: 'USD', openingBalance: 0, balance: 0 },
  { id: 'a2', name: 'Savings', type: 'bank', currency: 'USD', openingBalance: 0, balance: 0 },
];
const baseState = (over = {}) => ({
  user: { homeCurrency: 'USD', defaultCurrency: 'USD', theme: 'light', showHijri: false, hijriOffset: 0 },
  accounts: JSON.parse(JSON.stringify(baseAccounts)),
  categories: [{ id: 'c1', name: 'Food', type: 'expense', parentId: null, color: '#f97316', icon: 'tag' }],
  transactions: [], budgets: [], debts: [], family: [], regularItems: [],
  merchantCategories: {}, accountGroups: [],
  ...over,
});

console.log('\naudit regression suite');

// ═══ C3 — transfer → expense must not leave the counter-leg alive ══════════
{
  const w = boot(baseState());
  await wait(60);
  const app = w.__app, doc = w.document, $ = (s) => doc.querySelector(s);
  const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));

  app.openModal('transaction', {});
  await wait(20);
  app.setTxType('transfer');
  await wait(20);
  $('#txForm [name=amount]').value = '100';
  $('#txForm [name=accountId]').value = 'a1';
  $('#txForm [name=transferToAccountId]').value = 'a2';
  await app.submitTx({ preventDefault() {}, target: $('#txForm') }, '');
  await wait(40);

  let txs = saved().transactions;
  ok('C3 transfer creates exactly two legs', txs.length === 2, String(txs.length));
  const out = txs.find((t) => t.transferDir === 'out');

  app.openModal('transaction', { id: out.id });
  await wait(20);
  app.setTxType('expense');
  await wait(20);
  $('#txForm [name=amount]').value = '100';
  // The inline onsubmit passes the edited row's id — do the same.
  await app.submitTx({ preventDefault() {}, target: $('#txForm') }, out.id);
  await wait(40);

  txs = saved().transactions;
  ok('C3 counter-leg deleted on switch to expense', txs.length === 1, `${txs.length} rows left`);
  ok('C3 no orphan transferPairId remains',
     !txs.some((t) => t.transferPairId), JSON.stringify(txs.map((t) => t.transferPairId)));
  ok('C3 row is now a plain expense',
     txs[0]?.type === 'expense' && !txs[0]?.transferDir, `${txs[0]?.type}/${txs[0]?.transferDir}`);

  const accs = saved().accounts;
  const a1 = accs.find((a) => a.id === 'a1'), a2 = accs.find((a) => a.id === 'a2');
  ok('C3 destination no longer credited (no money invented)', a2.balance === 0, String(a2.balance));
  ok('C3 source debited exactly once', a1.balance === -10000, String(a1.balance));
  w.close();
}

// ═══ C4 — expense → transfer must build both legs ══════════════════════════
{
  const w = boot(baseState());
  await wait(60);
  const app = w.__app, doc = w.document, $ = (s) => doc.querySelector(s);
  const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));

  app.openModal('transaction', {});
  await wait(20);
  $('#txForm [name=amount]').value = '500';
  $('#txForm [name=accountId]').value = 'a1';
  await app.submitTx({ preventDefault() {}, target: $('#txForm') }, '');
  await wait(40);
  const exp = saved().transactions[0];
  ok('C4 expense created', exp?.type === 'expense');

  app.openModal('transaction', { id: exp.id });
  await wait(20);
  app.setTxType('transfer');
  await wait(20);
  $('#txForm [name=amount]').value = '500';
  $('#txForm [name=accountId]').value = 'a1';
  $('#txForm [name=transferToAccountId]').value = 'a2';
  await app.submitTx({ preventDefault() {}, target: $('#txForm') }, exp.id);
  await wait(40);

  const txs = saved().transactions;
  ok('C4 switch to transfer yields two legs', txs.length === 2, `${txs.length} rows`);
  ok('C4 both legs are paired',
     txs.length === 2 && txs[0].transferPairId === txs[1].id && txs[1].transferPairId === txs[0].id);
  ok('C4 legs carry a direction each',
     new Set(txs.map((t) => t.transferDir)).size === 2,
     JSON.stringify(txs.map((t) => t.transferDir)));

  const accs = saved().accounts;
  const a1 = accs.find((a) => a.id === 'a1'), a2 = accs.find((a) => a.id === 'a2');
  ok('C4 source debited (row is no longer zero-impact)', a1.balance === -50000, String(a1.balance));
  ok('C4 destination credited', a2.balance === 50000, String(a2.balance));
  w.close();
}

// ═══ C1 — changing an account's currency must not log an adjustment ════════
{
  const st = baseState();
  st.accounts = [{ id: 'a1', name: 'Tokyo', type: 'cash', currency: 'JPY', openingBalance: 500000, balance: 500000 }];
  const w = boot(st);
  await wait(60);
  const app = w.__app, doc = w.document, $ = (s) => doc.querySelector(s);
  const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));

  app.openModal('account', { id: 'a1' });
  await wait(20);
  const form = doc.querySelector('#app form');
  ok('C1 balance field prefilled in the old currency',
     form.elements.balance?.value === '500000', form.elements.balance?.value);

  form.elements.currency.value = 'USD';            // change ONLY the currency
  await app.submitAccount({ preventDefault() {}, target: form }, 'a1');
  await wait(40);

  const txs = saved().transactions;
  ok('C1 no phantom balance-adjustment transaction', txs.length === 0,
     JSON.stringify(txs.map((t) => `${t.payee}:${t.amount}`)));
  ok('C1 account re-denominated', saved().accounts[0].currency === 'USD');
  w.close();
}

// ═══ C1b — a genuine balance edit still logs an adjustment ═════════════════
{
  const st = baseState();
  st.accounts = [{ id: 'a1', name: 'Cash', type: 'cash', currency: 'USD', openingBalance: 10000, balance: 10000 }];
  const w = boot(st);
  await wait(60);
  const app = w.__app, doc = w.document;
  const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));

  app.openModal('account', { id: 'a1' });
  await wait(20);
  const form = doc.querySelector('#app form');
  form.elements.balance.value = '150';             // 100.00 → 150.00, same currency
  await app.submitAccount({ preventDefault() {}, target: form }, 'a1');
  await wait(40);

  const adj = saved().transactions.find((t) => t.payee === 'Balance adjustment');
  ok('C1b real balance change still logs an adjustment', !!adj);
  ok('C1b adjustment has the right sign and size',
     adj?.type === 'income' && adj?.amount === 5000, `${adj?.type}/${adj?.amount}`);
  w.close();
}

// ═══ C8 — importJson must migrate and must not drop omitted keys ═══════════
{
  const w = boot(baseState());
  await wait(60);
  const app = w.__app;
  const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));

  // A minimal/legacy export: only the two keys importJson validates.
  const partial = {
    accounts: [{ id: 'x1', name: 'Imported', type: 'cash', currency: 'USD', balance: 0 }],
    transactions: [],
  };
  // Drive the FileReader path the real UI uses.
  class FakeReader {
    readAsText() { this.result = JSON.stringify(partial); this.onload(); }
  }
  const RealReader = w.FileReader;
  w.FileReader = FakeReader;
  globalThis.FileReader = FakeReader;
  app.importJson({ files: [{ name: 'x.json' }] });
  await wait(60);
  w.FileReader = RealReader;

  const s = saved();
  ok('C8 import applied', s.accounts?.[0]?.name === 'Imported', JSON.stringify(s.accounts?.[0]?.name));
  ok('C8 user settings survived an omitting import', !!s.user && !!s.user.homeCurrency,
     JSON.stringify(s.user));
  ok('C8 omitted collections back-filled, not deleted',
     Array.isArray(s.categories) && Array.isArray(s.budgets) && Array.isArray(s.debts) &&
     Array.isArray(s.regularItems) && Array.isArray(s.family),
     Object.keys(s).join(','));
  ok('C8 openingBalance back-filled by the migrator',
     s.accounts[0].openingBalance !== undefined, String(s.accounts[0].openingBalance));
  w.close();
}

// ═══ C2 — CSV import must not re-denominate an existing account ════════════
{
  const st = baseState();
  st.accounts = [{ id: 'a1', name: 'Cash', type: 'cash', currency: 'JPY', openingBalance: 500000, balance: 500000 }];
  const w = boot(st);
  await wait(60);
  const app = w.__app, doc = w.document;
  const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));

  const csv = [
    'Date,Type,Account,ToAccount,ToAmount,ToCurrency,Category,Subcategory,Payee,Note,Amount,Currency,PaymentType,Tags,DueDate,DebtRef,SplitOf',
    '2026-02-01,expense,Cash,,,,Food,,Shop,,12.00,USD,card,,,,',
    '2026-02-02,expense,Brand New,,,,Food,,Shop,,20.00,EUR,card,,,,',
  ].join('\n');

  // Drive the real entry point: startImport() parses + builds the plan,
  // commitImport() applies it.
  class FakeReader { readAsText() { this.result = csv; this.onload(); } }
  const RealReader = w.FileReader;
  w.FileReader = FakeReader; globalThis.FileReader = FakeReader;
  app.startImport({ files: [{ name: 'x.csv' }], value: '' });
  await wait(60);
  w.FileReader = RealReader;

  ok('C2 import plan built from the CSV', !!doc.getElementById('importReplace') ||
     !!doc.querySelector('#modalCard'), 'preview did not open');
  app.commitImport();
  await wait(80);

  const accs = saved().accounts;
  const existing = accs.find((a) => a.id === 'a1');
  const created  = accs.find((a) => a.name === 'Brand New');
  ok('C2 existing JPY account was NOT re-denominated by a USD row',
     existing?.currency === 'JPY', existing?.currency);
  ok('C2 the import did create the new account', !!created, accs.map((a) => a.name).join(','));
  ok('C2 the NEW account still gets its currency inferred',
     created?.currency === 'EUR', created?.currency);
  ok('C2 existing account balance not reinterpreted',
     existing?.currency === 'JPY' && Number.isFinite(existing?.balance), String(existing?.balance));
  w.close();
}

// ═══ H2 — inline handler arguments survive an apostrophe ═══════════════════
{
  const st = baseState();
  st.user.customPaymentTypes = ["Wife's card"];
  st.user.hiddenPaymentTypes = [];
  const w = boot(st);
  await wait(60);
  const app = w.__app, doc = w.document;

  app.openModal('transaction', {});
  await wait(20);
  app.openPaymentTypeManager(doc.querySelector('#txForm select[name=paymentType]'));
  await wait(40);

  const row = [...doc.querySelectorAll('#paymentSheetRoot .sheet-row-static')]
    .find((r) => r.querySelector('.sheet-row-name')?.textContent.includes("Wife's card"));
  ok('H2 apostrophe row rendered', !!row);
  const handler = row?.querySelector('button[title=Rename]')?.getAttribute('onclick') || '';
  let parses = false;
  try { new w.Function(handler); parses = true; } catch (_) { parses = false; }
  ok('H2 rename handler is valid JS despite the apostrophe', parses, handler);
  ok('H2 the quote is JS-escaped, not HTML-escaped',
     handler.includes("\\u0027") || handler.includes("\\'"), handler);

  // The nastier variant: a breakout attempt must stay inert.
  app.paymentSheet.close();
  await wait(20);
  app.paymentTypeService.addCustom("x');window.__pwned=1;//");
  app.openPaymentTypeManager(null);
  await wait(40);
  const evil = [...doc.querySelectorAll('#paymentSheetRoot .sheet-row-static')]
    .map((r) => r.querySelector('button[title=Rename]')?.getAttribute('onclick') || '')
    .find((h) => h.includes('pwned'));
  ok('H2 breakout string is neutralised, not executable',
     !!evil && !evil.includes("');window"), evil);
  ok('H2 nothing executed during render', w.__pwned === undefined);
  w.close();
}

// ═══ C5 / C6 / C7 — sync guards, driven through a fake Supabase ════════════
{
  // Minimal Supabase stand-in: a single user_data row with CAS semantics.
  const cloud = { row: { id: 'u1', data: { marker: 'CLOUD' }, version: 7 }, failNextSelect: false, writes: [] };
  const makeSb = () => ({
    auth: {
      onAuthStateChange(cb) { cloud.authCb = cb; },
      getSession: async () => ({ data: { session: null } }),
      signOut: async () => {},
      signInWithOAuth: async () => ({}),
    },
    removeChannel() {},
    channel(name) {
      const ch = {
        on(kind, cfg, handler) {
          // Capture the user_data UPDATE handler so a test can simulate another
          // device advancing the row.
          if (cfg?.table === 'user_data') cloud.onUserDataUpdate = handler;
          return ch;
        },
        subscribe() { return ch; },
      };
      return ch;
    },
    from(table) {
      const q = {
        _table: table, _eq: {},
        select() { return q; },
        eq(k, v) { q._eq[k] = v; return q; },
        in() { return q; },
        order() { return q; },
        async single() {
          if (cloud.failNextSelect) { cloud.failNextSelect = false; throw new Error('network down'); }
          return { data: cloud.row, error: null };
        },
        update(patch) { q._patch = patch; return q; },
        async upsert(payload) { cloud.writes.push({ kind: 'upsert', payload }); cloud.row = { ...payload }; return { error: null }; },
        then(res) { // awaited without .single()
          if (q._patch) {
            const casOk = q._eq.version === undefined || q._eq.version === cloud.row.version;
            if (casOk && q._patch.version !== undefined) {
              cloud.writes.push({ kind: 'update', payload: q._patch });
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

  const signIn = async (w) => {
    cloud.authCb?.('SIGNED_IN', { user: { id: 'u1', email: 'a@b.c' } });
    await wait(150);
  };

  // ---- C5: a failed pull must block the next push -------------------------
  {
    cloud.row = { id: 'u1', data: { marker: 'CLOUD' }, version: 7 };
    cloud.writes = [];
    cloud.failNextSelect = true;
    const w = boot(baseState(), { supabase: { createClient: () => makeSb() } });
    await wait(80);
    await signIn(w);                        // pull runs and throws

    // Use a mutation that genuinely calls schedulePush(). NB: many settings
    // mutations do not — that is audit finding H7, deliberately out of scope
    // here, but it makes them useless as a trigger for this test.
    const doc = w.document, $ = (s) => doc.querySelector(s);
    w.__app.openModal('transaction', {});
    await wait(20);
    $('#txForm [name=amount]').value = '55';
    await w.__app.submitTx({ preventDefault() {}, target: $('#txForm') }, '');
    await wait(1400);                       // past the 1s debounce

    const upserts = cloud.writes.filter((x) => x.kind === 'upsert');
    ok('C5 no blind upsert after a failed pull', upserts.length === 0,
       JSON.stringify(upserts.map((x) => x.payload?.version)));
    ok('C5 cloud row left untouched at version 7',
       cloud.row.version === 7 && cloud.row.data?.marker === 'CLOUD',
       JSON.stringify({ v: cloud.row.version, m: cloud.row.data?.marker }));
    w.close();
  }

  // ---- C6: a pull inside the debounce must not discard the local edit -----
  {
    cloud.row = {
      id: 'u1', version: 7,
      data: { ...baseState(), transactions: [] },
    };
    cloud.writes = [];
    cloud.failNextSelect = false;
    const w = boot(baseState(), { supabase: { createClient: () => makeSb() } });
    await wait(80);
    await signIn(w);                        // pull succeeds → version 7

    const app = w.__app, doc = w.document, $ = (s) => doc.querySelector(s);
    const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));

    // Save a transaction — schedulePush queues a push for +1000 ms.
    app.openModal('transaction', {});
    await wait(20);
    $('#txForm [name=amount]').value = '77';
    await app.submitTx({ preventDefault() {}, target: $('#txForm') }, '');
    await wait(40);
    ok('C6 transaction saved locally', saved().transactions.length === 1,
       String(saved().transactions.length));

    // 300 ms in — well inside the debounce — another device's UPDATE arrives.
    cloud.onUserDataUpdate?.({ new: { version: 99 } });
    await wait(400);

    ok('C6 local transaction survived the mid-debounce pull',
       saved().transactions.length === 1, `${saved().transactions.length} rows`);
    ok('C6 it was flushed to the cloud rather than dropped',
       (cloud.row.data?.transactions || []).length === 1,
       `${(cloud.row.data?.transactions || []).length} rows in cloud`);
    ok('C6 the cloud version advanced', cloud.row.version > 7, String(cloud.row.version));
    w.close();
  }

  // ---- C7: an involuntary sign-out must not wipe local data ---------------
  {
    cloud.row = { id: 'u1', version: 7, data: { ...baseState(), transactions: [] } };
    cloud.writes = [];
    const st = baseState();
    st.transactions = [{ id: 't1', accountId: 'a1', categoryId: 'c1', amount: 4200,
      currency: 'USD', type: 'expense', date: '2026-03-01', paymentType: 'card',
      recordState: 'cleared', tags: [] }];
    const w = boot(st, { supabase: { createClient: () => makeSb() } });
    await wait(80);
    const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));

    cloud.authCb?.('SIGNED_IN', { user: { id: 'u1', email: 'a@b.c' } });
    await wait(150);

    // Put a local-only edit in place, then let the token refresh fail.
    w.__app.openModal('transaction', {});
    await wait(20);
    w.document.querySelector('#txForm [name=amount]').value = '9';
    await w.__app.submitTx({ preventDefault() {},
      target: w.document.querySelector('#txForm') }, '');
    await wait(40);
    const beforeCount = saved().transactions.length;

    cloud.authCb?.('SIGNED_OUT', null);     // NOT app.signOut() — a lapsed session
    await wait(120);

    // NB: the sign-in pull legitimately replaced the pre-existing guest data
    // with the cloud snapshot — that is normal sync behaviour. What must NOT
    // happen is the lapsed session destroying the edit made while signed in.
    ok('C7 local transactions survive a lapsed session',
       saved().transactions.length === beforeCount && beforeCount > 0,
       `${saved().transactions.length} vs ${beforeCount}`);
    ok('C7 the un-pushed edit is still on disk',
       saved().transactions.some((t) => t.amount === 900),
       JSON.stringify(saved().transactions.map((t) => t.amount)));

    // ...but a deliberate sign-out still clears the device.
    cloud.authCb?.('SIGNED_IN', { user: { id: 'u1', email: 'a@b.c' } });
    await wait(150);
    await w.__app.signOut?.();
    await wait(150);
    ok('C7 an explicit sign-out still wipes local data',
       !saved().transactions.some((t) => t.amount === 900),
       JSON.stringify(saved().transactions.map((t) => t.amount)));
    w.close();
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
