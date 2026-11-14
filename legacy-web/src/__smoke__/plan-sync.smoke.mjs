/**
 * plan-sync.smoke.mjs — the app follows the person's plan (migrations 0018–0020).
 *
 *   P1  Family (or any active Sync plan): syncs exactly as before.
 *   P2  Free: signed in, but the book stays on this device. The cloud copy is
 *       never asked for or written, and the sync label says so. No banner.
 *   P3  Plan ended, within the grace period: the cloud copy loads (read-only),
 *       a new entry is kept on this device and not saved up, and the banner
 *       tells them to download their data, with a working download button.
 *   P4  Renewing: the entry made while read-only reaches the cloud.
 *   P5  The server refuses a save the app thought was allowed (the plan just
 *       ended elsewhere): the app learns the plan, explains it once, and stops
 *       trying — it doesn't loop on retries.
 *   P6  A paid plan that ended long ago: the "plan has ended" notice, which
 *       can be dismissed.
 *   P7  Settings shows "Your plan" with the right status, the AI allowance and
 *       the download button.
 *
 * Run: node src/__smoke__/plan-sync.smoke.mjs
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
const USER = { id: 'u1', email: 'a@b.c' };
const DAY = 86_400_000;

const tx = (id, amount, over = {}) => ({
  id, accountId: 'a1', categoryId: 'c1', amount, currency: 'USD', exchangeRate: 1, refAmount: amount,
  acctMinor: amount, type: 'expense', date: '2026-11-01', paymentType: 'card', recordState: 'cleared',
  tags: [], hijriDate: { year: 1448, month: 4, day: 22, offset: 0 }, ...over,
});
const baseState = (txs = []) => ({
  user: { homeCurrency: 'USD', defaultCurrency: 'USD', theme: 'light', showHijri: false, hijriOffset: 0,
    customPaymentTypes: [], hiddenPaymentTypes: [], defaultAccountId: '', defaultPaymentType: 'card' },
  accounts: [{ id: 'a1', name: 'Cash', currency: 'USD', type: 'cash', color: '#000', icon: 'wallet',
    openingBalance: 0, balance: 0, groupId: null }],
  categories: [{ id: 'c1', name: 'Food', type: 'expense', parentId: null, color: '#f97316', icon: 'tag' }],
  transactions: txs, budgets: [], debts: [], family: [], regularItems: [], merchantCategories: {}, accountGroups: [],
});

/** Plans as pocket_entitlements() returns them. */
const plan = (over) => ({
  plan: 'family', planName: 'Family', paidPlan: 'family', term: 'month', source: 'manual', state: 'active',
  endsAt: new Date(Date.now() + 20 * DAY).toISOString(), graceUntil: null, autoRenew: false,
  access: { sync: 'write', telegram: 'write', sharing: 'write' },
  seats: 5, seatsUsed: 1, coveredBy: [], aiCredits: 120, aiUnlimited: false, trialAvailable: false, ...over,
});
const FREE = plan({ plan: 'free', planName: 'Free', paidPlan: null, term: null, source: null, state: 'free', endsAt: null,
  access: { sync: 'none', telegram: 'none', sharing: 'none' }, seats: 1, aiCredits: 0, trialAvailable: true });
const GRACE = plan({ state: 'grace', endsAt: new Date(Date.now() - 2 * DAY).toISOString(),
  graceUntil: new Date(Date.now() + 28 * DAY).toISOString(), access: { sync: 'read', telegram: 'read', sharing: 'read' } });
const LAPSED = plan({ plan: 'free', planName: 'Free', state: 'lapsed', endsAt: new Date(Date.now() - 40 * DAY).toISOString(),
  graceUntil: new Date(Date.now() - 10 * DAY).toISOString(), access: { sync: 'none', telegram: 'none', sharing: 'none' } });

function boot({ supabase, storage } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
       <div id="planBanner"></div><div id="spaceBar"></div>
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
  window.URL.createObjectURL = () => 'blob:x';
  if (supabase) window.supabase = supabase;
  window.eval(bundleSrc);
  return window;
}
const signIn = async (cloud, ms = 200) => { cloud.authCb?.('SIGNED_IN', { user: USER }); await wait(ms); };
const addTx = async (w, amount) => {
  w.__app.openModal('transaction', {});
  await wait(20);
  const form = w.document.querySelector('#txForm');
  form.querySelector('[name=amount]').value = String(amount);
  await w.__app.submitTx({ preventDefault() {}, target: form }, '');
};
const cloudAmounts = (cloud) => (cloud.book('u1')?.transactions || []).map((t) => t.amount);
const localAmounts = (w) => JSON.parse(w.localStorage.getItem('pocket.v1')).transactions.map((t) => t.amount);
const calls = (cloud, fn) => cloud.calls.filter((c) => c.fn === fn);
const syncLabel = (w) => w.document.getElementById('syncIndicator')?.textContent.trim() ?? '';
const banner = (w) => w.document.getElementById('planBanner').textContent.replace(/\s+/g, ' ').trim();
const toasts = (w) => [...w.document.querySelectorAll('.toast, [role=status], #toast, .toast-item')].map((e) => e.textContent).join(' | ');

console.log('\nplan sync suite');

{
  console.log('\n P1 — an active plan syncs as before');
  const cloud = new FakeCloud();
  cloud.setBook('u1', baseState([tx('t1', 100)]));
  const w = boot({ supabase: { createClient: cloud.client(USER) } });
  await wait(80);
  await signIn(cloud);
  await addTx(w, 42);
  await wait(1400);
  ok('P1 the new entry reached the cloud', cloudAmounts(cloud).includes(4200), JSON.stringify(cloudAmounts(cloud)));
  ok('P1 the app asked for the plan', calls(cloud, 'pocket_entitlements').length >= 1);
  ok('P1 no banner', banner(w) === '');
}

{
  console.log('\n P2 — Free: the book stays on this device');
  const cloud = new FakeCloud();
  cloud.setBook('u1', baseState([tx('t1', 100)]));
  cloud.plans.set('u1', FREE);
  const w = boot({ supabase: { createClient: cloud.client(USER) }, storage: (win) => win.localStorage.setItem('pocket.v1', JSON.stringify(baseState([tx('L1', 555)]))) });
  await wait(80);
  await signIn(cloud);
  await addTx(w, 66);
  await wait(1400);
  ok('P2 the cloud copy was never asked for', calls(cloud, 'pocket_get_changes').length === 0 && calls(cloud, 'pocket_get_book').length === 0);
  ok('P2 nothing was saved to the cloud', cloud.saves === 0, `${cloud.saves} saves`);
  ok('P2 the device keeps its own book and the new entry', localAmounts(w).includes(555) && localAmounts(w).includes(6600),
     JSON.stringify(localAmounts(w)));
  ok('P2 the sync label says "On this device"', /On this device/.test(syncLabel(w)), syncLabel(w));
  ok('P2 no banner for Free', banner(w) === '');
}

let graceCarry = null;
{
  console.log('\n P3 — plan ended: read-only, and download your data');
  const cloud = new FakeCloud();
  cloud.setBook('u1', baseState([tx('t1', 100), tx('t2', 200)]));
  cloud.plans.set('u1', GRACE);
  const w = boot({ supabase: { createClient: cloud.client(USER) } });
  await wait(80);
  await signIn(cloud);
  ok('P3 the cloud copy loaded', localAmounts(w).includes(100) && localAmounts(w).includes(200));
  await addTx(w, 77);
  await wait(1400);
  ok('P3 the new entry is on this device', localAmounts(w).includes(7700));
  ok('P3 …but not saved to the cloud', !cloudAmounts(cloud).includes(7700) && cloud.saves === 0, `${cloud.saves} saves`);
  ok('P3 the sync label says the cloud is read-only', /read-only/i.test(syncLabel(w)), syncLabel(w));
  const b = banner(w);
  ok('P3 the banner says to download within the days left', /Download your data within 28 days/.test(b), b);
  ok('P3 …and when the cloud copy closes', /read-only until/.test(b), b);
  // Inline onclick handlers don't run in this test browser: check the button's
  // wiring, then run the action it calls.
  const button = w.document.querySelector('#planBanner button.btn-primary');
  ok('P3 the banner\'s button is "Download my data"', /Download my data/.test(button?.textContent || '')
     && button.getAttribute('onclick') === 'window.__app.downloadMyData()');
  let downloaded = null;
  const realClick = w.HTMLAnchorElement.prototype.click;
  w.HTMLAnchorElement.prototype.click = function () { downloaded = this.download; };
  w.__app.downloadMyData();
  w.HTMLAnchorElement.prototype.click = realClick;
  ok('P3 "Download my data" downloads the whole book as JSON', /^pocket-export-.*\.json$/.test(downloaded || ''), String(downloaded));
  graceCarry = { cloud, w };
}

{
  console.log('\n P4 — renewing sends what was kept on the device');
  const { cloud, w } = graceCarry;
  cloud.plans.set('u1', plan({}));
  await w.__app.openModal('settings', {});           // Settings asks for the plan again
  await wait(100);
  w.__app.closeModal();
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await addTx(w, 88);
  await wait(1600);
  ok('P4 the entry made while read-only reached the cloud', cloudAmounts(cloud).includes(7700), JSON.stringify(cloudAmounts(cloud)));
  ok('P4 …and so did the new one', cloudAmounts(cloud).includes(8800));
  ok('P4 the banner is gone', banner(w) === '', banner(w));
}

{
  console.log('\n P5 — the server refuses: learn, explain, stop');
  const cloud = new FakeCloud();
  cloud.setBook('u1', baseState([tx('t1', 100)]));
  const w = boot({ supabase: { createClient: cloud.client(USER) } });
  await wait(80);
  await signIn(cloud);                       // plan: everything
  cloud.plans.set('u1', GRACE);              // ended elsewhere, the app doesn't know yet
  await addTx(w, 99);
  await wait(1400);
  const tries = calls(cloud, 'pocket_apply_changes').length;
  await wait(2500);
  ok('P5 the refused save was not retried in a loop', calls(cloud, 'pocket_apply_changes').length === tries,
     `${tries} then ${calls(cloud, 'pocket_apply_changes').length}`);
  ok('P5 the entry is kept on this device', localAmounts(w).includes(9900));
  ok('P5 the app now knows the plan ended (banner shown)', /Download your data/.test(banner(w)), banner(w));
  ok('P5 the label shows read-only', /read-only/i.test(syncLabel(w)), syncLabel(w));
}

{
  console.log('\n P6 — a plan that ended long ago');
  const cloud = new FakeCloud();
  cloud.setBook('u1', baseState([tx('t1', 100)]));
  cloud.plans.set('u1', LAPSED);
  const w = boot({ supabase: { createClient: cloud.client(USER) } });
  await wait(80);
  await signIn(cloud);
  ok('P6 "Your plan has ended" notice', /Your plan has ended/.test(banner(w)), banner(w));
  ok('P6 the cloud copy was not loaded', calls(cloud, 'pocket_get_changes').length === 0);
  w.__app.dismissPlanBanner();
  ok('P6 the notice can be dismissed', banner(w) === '');
}

{
  console.log('\n P7 — Settings: Your plan');
  const cloud = new FakeCloud();
  cloud.setBook('u1', baseState([]));
  cloud.plans.set('u1', GRACE);
  const w = boot({ supabase: { createClient: cloud.client(USER) } });
  await wait(80);
  await signIn(cloud);
  w.__app.openModal('settings', {});
  await wait(150);
  const card = w.document.getElementById('planCard')?.textContent.replace(/\s+/g, ' ') ?? '';
  ok('P7 the card shows the plan and that it ended', /Your plan/.test(card) && /Family · ended/.test(card), card.slice(0, 160));
  ok('P7 …the read-only date and the download button', /read-only until/.test(card) && /Download my data/.test(card));
  ok('P7 …the AI allowance (no pool while the plan has ended)', /120 credits/.test(card) && !/family pool/.test(card), card.match(/AI.*?credits[^D]*/)?.[0]);
  cloud.plans.set('u1', plan({ term: 'lifetime', endsAt: null, aiUnlimited: true }));
  await w.__app.openModal('settings', {});
  await wait(150);
  const card2 = w.document.getElementById('planCard')?.textContent.replace(/\s+/g, ' ') ?? '';
  ok('P7 family for life: "for life", unlimited AI, no price list', /Family · for life/.test(card2) && /Unlimited/.test(card2) && !/Plans/.test(card2), card2.slice(0, 200));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
