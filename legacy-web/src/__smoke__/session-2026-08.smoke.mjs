/**
 * session-2026-08.smoke.mjs — regression tests for the 2026-08-15 fixes.
 *
 *   D1  Three transactions entered back-to-back then the tab is refreshed:
 *       nothing had been pushed, and the boot pull adopted the stale cloud row
 *       over all three. Cold-start recovery must now commit local first.
 *   D2  The push debounce was re-armed by every save, so a burst could
 *       postpone the only durable write indefinitely (MAX_PUSH_WAIT_MS).
 *   D3  visibilitychange → hidden must flush a pending push (the mobile case:
 *       the OS can discard a backgrounded tab without firing unload).
 *   D4  A failed localStorage write must still schedule a cloud push — the
 *       cloud is the only durable copy left in that situation.
 *   F1  resetTransferFx() returned before hiding #fxPanel, so a same-currency
 *       pair kept the panel (and the previous pair's rate) on screen until the
 *       next full re-render.
 *   F2  ...and the stale rate was still submitted on a same-currency transfer.
 *   S1  onTxSwipeEnd() never consulted the axis lock, so horizontal drift
 *       accumulated during a vertical scroll fired the delete confirm.
 *   S2  A deliberate left swipe reveals the Delete button and destroys nothing.
 *   S3  ...and tapping that button deletes, after a confirmation. Declining
 *       leaves the row revealed rather than hiding an undeleted row — the
 *       animation runs only once the delete is agreed to.
 *   P1  Settings default account / payment type drive a fresh transaction form.
 *   P2  A default pointing at a deleted or archived account falls back safely.
 *   V1  A voice reply naming several categories becomes splits that sum EXACTLY
 *       to the parent (submitTx rejects any other outcome).
 *   V2  Several items under ONE category stay a single un-split transaction.
 *
 * Run:  node src/__smoke__/session-2026-08.smoke.mjs
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

const acct = (id, name, currency, over = {}) => ({
  id, name, currency, groupId: null, type: 'bank', color: '#3b82f6',
  icon: 'landmark', openingBalance: 0, balance: 0, ...over,
});

const baseState = (over = {}) => ({
  user: {
    homeCurrency: 'USD', defaultCurrency: 'USD', theme: 'light', showHijri: false,
    hijriOffset: 0, customPaymentTypes: [], hiddenPaymentTypes: [],
    defaultAccountId: '', defaultPaymentType: 'card',
  },
  accounts: [
    acct('a1', 'Cash',        'USD'),
    acct('a2', 'Savings',     'USD'),
    acct('aed', 'Dubai Card', 'AED'),
  ],
  categories: [
    { id: 'c1', name: 'Food',     type: 'expense', parentId: null, color: '#f97316', icon: 'tag' },
    { id: 'c2', name: 'Fuel',     type: 'expense', parentId: null, color: '#0ea5e9', icon: 'tag' },
    { id: 'c3', name: 'Pharmacy', type: 'expense', parentId: null, color: '#22c55e', icon: 'tag' },
  ],
  transactions: [], budgets: [], debts: [], family: [], regularItems: [],
  merchantCategories: {}, accountGroups: [],
  ...over,
});

function boot(state, { supabase, storage, storageQuota } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
       <div id="viewContent"></div><div id="sidebarNav"></div>
       <div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
     </body></html>`,
    { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only',
      ...(storageQuota ? { storageQuota } : {}) });
  const { window } = dom;
  if (state) window.localStorage.setItem('pocket.v1', JSON.stringify(state));
  if (storage) storage(window);
  window.lucide = { createIcons() {} };
  window.Chart  = function () { return { destroy() {} }; };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.fetch   = () => Promise.reject(new Error('offline'));
  window.confirm = () => { window.__confirmCalls = (window.__confirmCalls || 0) + 1; return true; };
  window.alert   = () => {};
  if (supabase) window.supabase = supabase;
  window.eval(bundleSrc);
  return window;
}

/** Minimal Supabase stand-in with compare-and-swap semantics on user_data. */
function makeCloud() {
  const cloud = { row: null, writes: [], failNextSelect: false, blockWrites: false, authCb: null };
  cloud.sb = () => ({
    auth: {
      onAuthStateChange(cb) { cloud.authCb = cb; },
      getSession: async () => ({ data: { session: null } }),
      signOut: async () => {}, signInWithOAuth: async () => ({}),
    },
    removeChannel() {},
    channel() { const ch = { on() { return ch; }, subscribe() { return ch; }, send() {} }; return ch; },
    from() {
      const q = {
        _eq: {},
        select() { return q; }, eq(k, v) { q._eq[k] = v; return q; },
        in() { return q; }, order() { return q; },
        async single() {
          if (cloud.failNextSelect) { cloud.failNextSelect = false; throw new Error('network down'); }
          // Deep-clone, as a real HTTP response would be. replaceState() copies
          // the returned object into live state BY REFERENCE, so handing out the
          // stored row let local mutations write straight back into the fake
          // cloud — the harness would then claim a push had happened.
          const copy = cloud.row ? JSON.parse(JSON.stringify(cloud.row)) : null;
          return { data: copy, error: copy ? null : { code: 'PGRST116' } };
        },
        update(patch) { q._patch = patch; return q; },
        async upsert(payload) {
          if (cloud.blockWrites) throw new Error('network down');
          cloud.writes.push({ kind: 'upsert', payload });
          if (!cloud.row) cloud.row = { ...payload };
          return { data: [{ version: payload.version }], error: null };
        },
        then(res) {
          if (cloud.blockWrites) throw new Error('network down');
          if (q._patch) {
            const casOk = q._eq.version === undefined || q._eq.version === cloud.row?.version;
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
  return cloud;
}

const addTx = async (w, amount) => {
  const $ = (s) => w.document.querySelector(s);
  w.__app.openModal('transaction', {});
  await wait(20);
  $('#txForm [name=amount]').value = String(amount);
  await w.__app.submitTx({ preventDefault() {}, target: $('#txForm') }, '');
  await wait(30);
};

console.log('\n2026-08 session regression suite');

// ═══ D1 — three entries + refresh must not be swallowed by a stale cloud row ═
{
  console.log('\n D — durability');
  const cloud = makeCloud();
  cloud.row = { id: 'u1', version: 7, data: { ...baseState(), transactions: [] } };

  // ── Visit 1: sign in, enter three transactions, "close the tab" ──────────
  const w1 = boot(baseState(), { supabase: { createClient: cloud.sb } });
  await wait(80);
  cloud.authCb?.('SIGNED_IN', { user: { id: 'u1', email: 'a@b.c' } });
  await wait(150);

  // The tab is going to die before anything reaches the cloud. Simulating that
  // by blocking writes is deterministic, where racing the debounce is not.
  cloud.blockWrites = true;
  await addTx(w1, 11);
  await addTx(w1, 22);
  await addTx(w1, 33);
  await wait(1200);                       // let the debounce fire and fail

  const local1 = JSON.parse(w1.localStorage.getItem('pocket.v1'));
  ok('D1 all three saved locally', local1.transactions.length === 3,
     `${local1.transactions.length}`);
  ok('D1 a durable pending marker was written',
     !!w1.localStorage.getItem('pocket.v1.pending'));

  // Snapshot storage exactly as the browser would leave it, then kill the tab
  // BEFORE the debounce fires — the original failure.
  const carried = {
    'pocket.v1':         w1.localStorage.getItem('pocket.v1'),
    'pocket.v1.pending': w1.localStorage.getItem('pocket.v1.pending'),
  };
  const cloudVersionAtClose = cloud.row.version;
  w1.close();
  cloud.blockWrites = false;

  ok('D1 the cloud never received them',
     cloudVersionAtClose === 7 && (cloud.row.data.transactions || []).length === 0,
     `v${cloudVersionAtClose}/${(cloud.row.data.transactions || []).length} rows`);
  ok('D1 the pending marker survived the tab dying',
     !!carried['pocket.v1.pending']);
  ok('D1 …and it recorded the baseline the edits were made against',
     JSON.parse(carried['pocket.v1.pending'] || '{}').baseVersion === 7,
     carried['pocket.v1.pending']);

  // ── Visit 2: fresh boot over the same storage ────────────────────────────
  const w2 = boot(null, {
    supabase: { createClient: cloud.sb },
    storage: (win) => { for (const [k, v] of Object.entries(carried)) if (v) win.localStorage.setItem(k, v); },
  });
  await wait(80);
  cloud.authCb?.('SIGNED_IN', { user: { id: 'u1', email: 'a@b.c' } });
  await wait(300);

  const local2 = JSON.parse(w2.localStorage.getItem('pocket.v1'));
  ok('D1 all three survived the reload', local2.transactions.length === 3,
     `${local2.transactions.length} left`);
  ok('D1 the first one survived too',
     local2.transactions.some((t) => t.amount === 1100),
     JSON.stringify(local2.transactions.map((t) => t.amount)));
  ok('D1 local state was pushed OVER the stale cloud row',
     (cloud.row.data.transactions || []).length === 3,
     `${(cloud.row.data.transactions || []).length} rows in cloud`);
  ok('D1 the pending marker was cleared once committed',
     !w2.localStorage.getItem('pocket.v1.pending'));
  w2.close();
}

// ═══ D1b — a genuine conflict keeps a restorable backup ════════════════════
{
  const cloud = makeCloud();
  cloud.row = { id: 'u1', version: 7, data: { ...baseState(), transactions: [] } };

  const w1 = boot(baseState(), { supabase: { createClient: cloud.sb } });
  await wait(80);
  cloud.authCb?.('SIGNED_IN', { user: { id: 'u1', email: 'a@b.c' } });
  await wait(150);
  cloud.blockWrites = true;
  await addTx(w1, 44);
  await wait(1200);
  const carried = {
    'pocket.v1':         w1.localStorage.getItem('pocket.v1'),
    'pocket.v1.pending': w1.localStorage.getItem('pocket.v1.pending'),
  };
  w1.close();
  cloud.blockWrites = false;

  // Another device writes while we are away → our recorded baseline is stale.
  cloud.row = { id: 'u1', version: 12, data: { ...baseState(), transactions: [
    { id: 'other', accountId: 'a1', categoryId: 'c1', amount: 999, currency: 'USD',
      type: 'expense', date: '2026-08-01', paymentType: 'card', recordState: 'cleared', tags: [] },
  ] } };

  const w2 = boot(null, {
    supabase: { createClient: cloud.sb },
    storage: (win) => { for (const [k, v] of Object.entries(carried)) if (v) win.localStorage.setItem(k, v); },
  });
  await wait(80);
  cloud.authCb?.('SIGNED_IN', { user: { id: 'u1', email: 'a@b.c' } });
  await wait(300);

  const backups = JSON.parse(w2.localStorage.getItem('pocket.v1.conflicts') || '[]');
  ok('D1b the losing local copy was stashed, not destroyed', backups.length >= 1,
     JSON.stringify(backups));
  const stashed = backups[0] && JSON.parse(w2.localStorage.getItem(backups[0].key) || 'null');
  ok('D1b the backup actually contains the unsynced transaction',
     (stashed?.state?.transactions || []).some((t) => t.amount === 4400),
     JSON.stringify((stashed?.state?.transactions || []).map((t) => t.amount)));
  w2.close();
}

// ═══ D2 — a burst of saves cannot postpone the push indefinitely ═══════════
{
  const cloud = makeCloud();
  cloud.row = { id: 'u1', version: 3, data: { ...baseState(), transactions: [] } };
  const w = boot(baseState(), { supabase: { createClient: cloud.sb } });
  await wait(80);
  cloud.authCb?.('SIGNED_IN', { user: { id: 'u1', email: 'a@b.c' } });
  await wait(150);

  // Save every ~700ms — always inside the 1000ms debounce, so a pure
  // trailing-edge implementation would never fire.
  const startVersion = cloud.row.version;
  for (let i = 0; i < 6; i++) { await addTx(w, i + 1); await wait(670); }

  ok('D2 the push fired despite continuous saves', cloud.row.version > startVersion,
     `v${startVersion} → v${cloud.row.version}`);
  ok('D2 the cloud has the entries', (cloud.row.data.transactions || []).length >= 4,
     `${(cloud.row.data.transactions || []).length} rows`);
  w.close();
}

// ═══ D3 — hiding the page flushes a pending push ═══════════════════════════
{
  const cloud = makeCloud();
  cloud.row = { id: 'u1', version: 5, data: { ...baseState(), transactions: [] } };
  const w = boot(baseState(), { supabase: { createClient: cloud.sb } });
  await wait(80);
  cloud.authCb?.('SIGNED_IN', { user: { id: 'u1', email: 'a@b.c' } });
  await wait(150);

  await addTx(w, 77);
  const before = cloud.row.version;

  // Background the tab well inside the debounce.
  Object.defineProperty(w.document, 'visibilityState', { value: 'hidden', configurable: true });
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await wait(200);

  ok('D3 backgrounding the tab flushed the push', cloud.row.version > before,
     `v${before} → v${cloud.row.version}`);
  ok('D3 the transaction reached the cloud',
     (cloud.row.data.transactions || []).some((t) => t.amount === 7700),
     JSON.stringify((cloud.row.data.transactions || []).map((t) => t.amount)));
  w.close();
}

// ═══ D4 — a failed local write must not also suppress the cloud push ═══════
{
  const cloud = makeCloud();
  cloud.row = { id: 'u1', version: 9, data: { ...baseState(), transactions: [] } };
  // A real quota, not a stubbed setItem: jsdom's localStorage is a Proxy, so
  // assigning over setItem silently does nothing and the test would pass
  // whatever the app did.
  const w = boot(baseState(), { supabase: { createClient: cloud.sb }, storageQuota: 60000 });
  await wait(80);
  cloud.authCb?.('SIGNED_IN', { user: { id: 'u1', email: 'a@b.c' } });
  await wait(150);

  // Eat the remaining quota so every further `pocket.v1` write fails, exactly
  // as it does in a full or InPrivate browser profile.
  const snapshot = w.localStorage.getItem('pocket.v1') || '';
  // Leave less headroom than one more transaction needs, so the next real save
  // is the one that tips it over.
  w.localStorage.setItem('filler', 'x'.repeat(Math.max(0, 60000 - snapshot.length - 200)));
  let localWriteFailed = false;
  try { w.localStorage.setItem('pocket.v1', snapshot + ' '.repeat(400)); }
  catch (_) { localWriteFailed = true; }
  ok('D4 the harness really did exhaust local storage', localWriteFailed);

  const before = cloud.row.version;
  await addTx(w, 88);
  await wait(1400);

  ok('D4 the cloud push still ran when localStorage failed', cloud.row.version > before,
     `v${before} → v${cloud.row.version}`);
  ok('D4 and it carried the transaction',
     (cloud.row.data.transactions || []).some((t) => t.amount === 8800),
     JSON.stringify((cloud.row.data.transactions || []).map((t) => t.amount)));

  // submitTx also calls schedulePush() explicitly, so the assertions above pass
  // even if Store's local-change hook is suppressed. Every OTHER mutation path
  // relies on that hook alone — drive one, or the guard goes untested.
  const before2 = cloud.row.version;
  w.__app.setDefaultPaymentType('cash');
  await wait(1400);
  ok('D4 a hook-only mutation also still pushes', cloud.row.version > before2,
     `v${before2} → v${cloud.row.version}`);
  ok('D4 …and the change reached the cloud',
     cloud.row.data?.user?.defaultPaymentType === 'cash',
     String(cloud.row.data?.user?.defaultPaymentType));
  w.close();
}

// ═══ F1 / F2 — the FX panel must hide the moment the pair matches ══════════
{
  console.log('\n F — transfer FX panel');
  const w = boot(baseState());
  await wait(80);
  const app = w.__app, doc = w.document, $ = (s) => doc.querySelector(s);
  const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));

  app.openModal('transaction', {});
  await wait(20);
  app.setTxType('transfer');
  await wait(20);

  // USD → AED: cross-currency, panel shows.
  $('#txForm [name=accountId]').value = 'a1';
  app.onTransferSourceChange('a1');
  await wait(20);
  $('#txForm [name=transferToAccountId]').value = 'aed';
  app.resetTransferFx();
  await wait(20);
  ok('F1 panel visible on a cross-currency pair',
     $('#fxPanel')?.style.display !== 'none', $('#fxPanel')?.style.display);
  const crossRate = $('#fxRate')?.value;
  ok('F1 …and it quoted a rate', parseFloat(crossRate) > 0, crossRate);

  // Switch the destination to a USD account — the pair now matches.
  $('#txForm [name=transferToAccountId]').value = 'a2';
  app.resetTransferFx();
  await wait(20);
  ok('F1 panel hides immediately on the same-currency pair (no second click)',
     $('#fxPanel')?.style.display === 'none', $('#fxPanel')?.style.display);
  ok('F2 the previous pair\'s rate was cleared, not left to be submitted',
     !$('#fxRate')?.value, $('#fxRate')?.value);

  $('#txForm [name=amount]').value = '100';
  await app.submitTx({ preventDefault() {}, target: $('#txForm') }, '');
  await wait(40);
  const legs = saved().transactions;
  ok('F2 both legs booked 100.00 USD',
     legs.length === 2 && legs.every((t) => t.amount === 10000 && t.currency === 'USD'),
     JSON.stringify(legs.map((t) => [t.amount, t.currency])));
  ok('F2 no stale cross-rate was stamped on the legs',
     legs.every((t) => t.transferRate === 1 || t.transferRate === null),
     JSON.stringify(legs.map((t) => t.transferRate)));
  w.close();
}

// ═══ S — swipe reveals, it does not destroy ════════════════════════════════
{
  console.log('\n S — swipe row actions');
  const st = baseState({
    transactions: [{
      id: 't1', accountId: 'a1', categoryId: 'c1', amount: 5000, currency: 'USD',
      type: 'expense', date: '2026-08-10', paymentType: 'card', recordState: 'cleared',
      tags: [], payee: 'Shop',
    }],
  });
  const w = boot(st);
  await wait(80);
  const app = w.__app, doc = w.document;
  app.navigate?.('transactions');
  await wait(60);

  const wrapper = doc.querySelector('.tx-swipe-wrapper');
  ok('S0 the row rendered with a swipe wrapper', !!wrapper);

  const touch = (x, y) => ({ clientX: x, clientY: y });
  const ev = (touches, target) => ({
    touches, currentTarget: target, preventDefault() {},
  });

  // ── S1: a vertical scroll whose thumb drifts 70px left ──────────────────
  w.__confirmCalls = 0;
  app.onTxSwipeStart(ev([touch(300, 500)], wrapper), 't1', -1, false);
  // Vertical first — this is what locks the axis to 'y'.
  app.onTxSwipeMove(ev([touch(298, 460)], wrapper));
  // …then the natural sideways arc of a thumb over a long scroll.
  app.onTxSwipeMove(ev([touch(275, 380)], wrapper));
  app.onTxSwipeMove(ev([touch(250, 290)], wrapper));
  app.onTxSwipeMove(ev([touch(230, 200)], wrapper));
  app.onTxSwipeEnd();
  await wait(40);

  ok('S1 a drifting vertical scroll asks nothing', w.__confirmCalls === 0,
     `${w.__confirmCalls} confirm() calls`);
  ok('S1 …and deletes nothing',
     JSON.parse(w.localStorage.getItem('pocket.v1')).transactions.length === 1);
  ok('S1 …and leaves no row revealed',
     !doc.querySelector('.tx-swipe-wrapper.is-open'));

  // ── S2: a deliberate horizontal swipe reveals the button ────────────────
  app.onTxSwipeStart(ev([touch(300, 500)], wrapper), 't1', -1, false);
  app.onTxSwipeMove(ev([touch(280, 501)], wrapper));   // locks to 'x'
  app.onTxSwipeMove(ev([touch(240, 502)], wrapper));
  app.onTxSwipeMove(ev([touch(220, 503)], wrapper));   // dx = -80
  app.onTxSwipeEnd();
  await wait(40);

  ok('S2 the row is revealed', !!doc.querySelector('.tx-swipe-wrapper.is-open'));
  ok('S2 revealing destroys nothing',
     JSON.parse(w.localStorage.getItem('pocket.v1')).transactions.length === 1);
  ok('S2 no dialog was raised', w.__confirmCalls === 0, `${w.__confirmCalls}`);
  const delBtn = wrapper.querySelector('[data-swipe-delete]');
  ok('S2 a real Delete button is exposed',
     !!delBtn && delBtn.tagName === 'BUTTON', delBtn?.tagName);

  // ── S3: declining must not hide the row it did not delete ───────────────
  w.confirm = () => { w.__confirmCalls = (w.__confirmCalls || 0) + 1; return false; };
  app.commitSwipeDelete();
  await wait(60);
  ok('S3 declining keeps the transaction',
     JSON.parse(w.localStorage.getItem('pocket.v1')).transactions.length === 1,
     String(JSON.parse(w.localStorage.getItem('pocket.v1')).transactions.length));
  // Animating before asking slid the row out and dropped it to opacity 0, so a
  // cancelled delete left an invisible row in the list until the next render.
  const content = wrapper.querySelector('.tx-row-content');
  ok('S3 …and the row is still visible, not left at opacity 0',
     content.style.opacity !== '0', `opacity ${content.style.opacity || '(unset)'}`);
  ok('S3 …still revealed, so Delete is one tap away',
     !!doc.querySelector('.tx-swipe-wrapper.is-open'));

  // ── S3b: accepting deletes ──────────────────────────────────────────────
  w.confirm = () => { w.__confirmCalls = (w.__confirmCalls || 0) + 1; return true; };
  const before = w.__confirmCalls;
  app.commitSwipeDelete();
  await wait(60);
  ok('S3b tapping Delete and confirming removes the transaction',
     JSON.parse(w.localStorage.getItem('pocket.v1')).transactions.length === 0);
  ok('S3b …and asked exactly once, not twice',
     w.__confirmCalls === before + 1, `${w.__confirmCalls - before} prompts`);
  w.close();
}

// ═══ P — Settings defaults ═════════════════════════════════════════════════
{
  console.log('\n P — default account / payment type');
  const st = baseState();
  st.user.defaultAccountId   = 'a2';
  st.user.defaultPaymentType = 'cash';
  const w = boot(st);
  await wait(80);
  const app = w.__app, doc = w.document, $ = (s) => doc.querySelector(s);

  app.openModal('transaction', {});
  await wait(30);
  ok('P1 the form opened on the default account',
     $('#txForm [name=accountId]')?.value === 'a2', $('#txForm [name=accountId]')?.value);
  ok('P1 …and the default payment method',
     $('#paymentTypeInput')?.value === 'cash', $('#paymentTypeInput')?.value);
  ok('P1 the matching chip is the selected one',
     doc.querySelector('[data-pay-chip=cash]')?.className.includes('bg-zinc-900'));
  app.closeModal();
  await wait(20);

  // Archive the preferred account — the preference must degrade, not break.
  app.accountService.archive('a2', true);
  await wait(20);
  app.openModal('transaction', {});
  await wait(30);
  const fallbackAcc = $('#txForm [name=accountId]')?.value;
  ok('P2 an archived default falls back to a live account',
     fallbackAcc && fallbackAcc !== 'a2', fallbackAcc);
  app.closeModal();
  await wait(20);

  // Delete it outright — the stored preference must be cleared, not dangle.
  app.accountService.archive('a2', false);
  await wait(10);
  app.accountService.delete('a2');
  await wait(30);
  ok('P2 deleting the default account clears the preference',
     JSON.parse(w.localStorage.getItem('pocket.v1')).user.defaultAccountId === '',
     JSON.parse(w.localStorage.getItem('pocket.v1')).user.defaultAccountId);

  // Renaming the default payment method must carry the preference along.
  app.paymentTypeService.rename('cash', 'notes');
  await wait(30);
  ok('P2 renaming the default payment method migrates the preference',
     JSON.parse(w.localStorage.getItem('pocket.v1')).user.defaultPaymentType === 'notes',
     JSON.parse(w.localStorage.getItem('pocket.v1')).user.defaultPaymentType);
  w.close();
}

// ═══ V — voice entry splits across categories ══════════════════════════════
{
  console.log('\n V — voice multi-category split');
  const w = boot(baseState());
  await wait(80);
  const app = w.__app, doc = w.document, $ = (s) => doc.querySelector(s);
  const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));

  // Drive the real service through the app's scanner seam: only the network is
  // stubbed, so the prompt, the parsing and the split reconciliation are all
  // genuinely exercised.
  const reply = (obj) => Promise.resolve({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }),
  });
  const heard = async (obj) => {
    w.fetch = () => reply(obj);
    return app.receiptScanner.parseVoice({ base64: 'x', mimeType: 'audio/webm' });
  };

  // The service reads the key off state before it will call out at all.
  const st0 = app.accountService ? null : null;
  w.__app.setGeminiKey?.('test-key');
  await wait(20);

  // ── V1: two amounts, two categories → a split ──────────────────────────
  let prefill = await heard({
    type: 'expense', total: 100, currency: 'USD', date: '2026-08-12',
    payee: 'Carrefour', note: 'groceries and petrol',
    items: [
      { description: 'groceries', amount: 60, categoryId: 'c1' },
      { description: 'petrol',    amount: 40, categoryId: 'c2' },
    ],
  }).catch((e) => ({ _err: e.message }));

  ok('V1 the service produced a prefill', !prefill?._err, prefill?._err);
  ok('V1 two categories became two split legs',
     Array.isArray(prefill?.splits) && prefill.splits.length === 2,
     JSON.stringify(prefill?.splits));
  ok('V1 the legs sum EXACTLY to the parent amount',
     (prefill?.splits || []).reduce((s, x) => s + x.amount, 0) === Math.round((prefill?.amount || 0) * 100),
     `${(prefill?.splits || []).reduce((s, x) => s + x.amount, 0)} vs ${Math.round((prefill?.amount || 0) * 100)}`);
  ok('V1 the parent carries no category of its own', prefill?.categoryId === '',
     String(prefill?.categoryId));

  // The modal needs no change — it already seeds splits from a prefill.
  app.openModal('transaction', { prefill });
  await wait(40);
  ok('V1 the split editor came up pre-filled', !!doc.querySelector('#splitsContainer'));
  await app.submitTx({ preventDefault() {}, target: $('#txForm') }, '');
  await wait(40);
  const tx = saved().transactions[0];
  ok('V1 it saved — the exact-sum rule did not block it', !!tx,
     `${saved().transactions.length} rows`);
  ok('V1 the stored row carries both legs', (tx?.splits || []).length === 2,
     JSON.stringify(tx?.splits));
  ok('V1 …and no parent category', tx?.categoryId === null, String(tx?.categoryId));

  // ── V1b: a total that drifts from the parts must still be saveable ──────
  const drift = await heard({
    type: 'expense', total: 33.33, currency: 'USD', date: '2026-08-12',
    payee: 'Shop', note: 'three ways',
    items: [
      { description: 'a', amount: 11.11, categoryId: 'c1' },
      { description: 'b', amount: 11.11, categoryId: 'c2' },
      { description: 'c', amount: 11.11, categoryId: 'c3' },
    ],
  }).catch((e) => ({ _err: e.message }));
  ok('V1b rounding drift is reconciled, not left to block the save',
     (drift?.splits || []).reduce((s, x) => s + x.amount, 0) === Math.round((drift?.amount || 0) * 100),
     `${(drift?.splits || []).reduce((s, x) => s + x.amount, 0)} vs ${Math.round((drift?.amount || 0) * 100)}`);

  // ── V1c: a mis-heard total must not inflate the transaction ─────────────
  const misheard = await heard({
    type: 'expense', total: 400, currency: 'USD', date: '2026-08-12',
    payee: 'Shop', note: 'forty not four hundred',
    items: [
      { description: 'a', amount: 25, categoryId: 'c1' },
      { description: 'b', amount: 15, categoryId: 'c2' },
    ],
  }).catch((e) => ({ _err: e.message }));
  ok('V1c an implausible total defers to the itemised sum', misheard?.amount === 40,
     String(misheard?.amount));

  // ── V2: several items, ONE category → no split ─────────────────────────
  const single = await heard({
    type: 'expense', total: 50, currency: 'USD', date: '2026-08-12',
    payee: 'Shop', note: 'bread and milk',
    items: [
      { description: 'bread', amount: 20, categoryId: 'c1' },
      { description: 'milk',  amount: 30, categoryId: 'c1' },
    ],
  }).catch((e) => ({ _err: e.message }));
  ok('V2 one category stays a single un-split entry', !single?.splits,
     JSON.stringify(single?.splits));
  ok('V2 …carrying that category', single?.categoryId === 'c1', String(single?.categoryId));
  ok('V2 …and the full amount', single?.amount === 50, String(single?.amount));

  // ── V3: a plain single-item reply still works (back-compat) ────────────
  const one = await heard({
    type: 'expense', total: 40, currency: 'USD', date: '2026-08-12',
    payee: 'Carrefour', note: 'groceries',
    items: [{ description: 'groceries', amount: 40, categoryId: 'c1' }],
  }).catch((e) => ({ _err: e.message }));
  ok('V3 a single-item reply is unchanged', !one?.splits && one?.categoryId === 'c1' && one?.amount === 40,
     JSON.stringify(one));

  // ── V4: the pre-items response shape must not break ────────────────────
  const legacy = await heard({
    type: 'expense', amount: 12, currency: 'USD', date: '2026-08-12',
    payee: 'Kiosk', note: 'coffee', categoryId: 'c1',
  }).catch((e) => ({ _err: e.message }));
  ok('V4 the old flat shape is still accepted',
     !legacy?._err && !legacy?.splits && legacy?.categoryId === 'c1' && legacy?.amount === 12,
     JSON.stringify(legacy));

  w.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
