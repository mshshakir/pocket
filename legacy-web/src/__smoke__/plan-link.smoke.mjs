/**
 * plan-link.smoke.mjs — the website's pricing buttons open the app at the
 * plan chooser.
 *
 *   L1  app.html#plans=family_year: the hash is cleared, the choice is kept
 *       for after sign-in, and (signed out) the sign-in window opens.
 *   L2  A page without the link opens nothing and keeps nothing.
 *   L3  Signed in (or back from signing in): the plan chooser opens on the
 *       plan and Razorpay opens straight away for it; an item that can't be
 *       bought now (e.g. a used trial) just leaves the chooser open.
 *
 * Run: node src/__smoke__/plan-link.smoke.mjs
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

function boot(hash, supabase = null, razorpay = null) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
       <div id="viewContent"></div><div id="sidebarNav"></div>
       <div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
     </body></html>`,
    { url: `https://local.test/app.html${hash}`, pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  window.lucide = { createIcons() {} };
  window.Chart  = function () { return { destroy() {} }; };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.fetch   = () => Promise.reject(new Error('offline'));
  window.confirm = () => true;
  window.alert   = () => {};
  if (supabase) window.supabase = supabase;
  if (razorpay) window.Razorpay = razorpay;
  window.eval(bundleSrc);
  return window;
}

console.log('\nPlan link suite');
{
  const w = boot('#plans=family_year');
  await wait(1000);
  ok('L1 the link is taken off the address', w.location.hash === '');
  ok('L1 the chosen plan is kept for after sign-in', w.sessionStorage.getItem('pocket.pendingPlans') === 'family_year');
  const g = boot('#plans=group_year');
  await wait(1000);
  ok('L1 the Pocket Pro Group link is kept the same way', g.sessionStorage.getItem('pocket.pendingPlans') === 'group_year');
  ok('L1 signed out: the sign-in window opens', w.__app && /sign in|email/i.test(w.document.body.textContent));
}
{
  const w = boot('');
  await wait(1000);
  ok('L2 no link: nothing kept', w.sessionStorage.getItem('pocket.pendingPlans') === null);
}
{
  // L3 — signed in, payments open: straight to Razorpay for the linked item.
  const USER = { id: 'u1', email: 'a@b.c' };
  const run = async (hash, available) => {
    const cloud = new FakeCloud();
    cloud.plans.set(USER.id, { plan: 'free', planName: 'Free', paidPlan: null, term: null, source: null, state: 'free',
      endsAt: null, graceUntil: null, autoRenew: false, access: { sync: 'none', telegram: 'none', sharing: 'none' },
      seats: 1, seatsUsed: 1, coveredBy: [], aiCredits: 0, aiUnlimited: false, trialAvailable: true, paymentsOpen: true });
    const base = cloud.client(USER, { session: true });
    const invoked = [];
    const createClient = () => {
      const sb = base();
      sb.functions = { invoke: async (_name, { body }) => {
        invoked.push(body);
        if (body.action === 'products') return { data: { keyId: 'rzp_x', products: [
          { product: 'family_year', plan: 'family', term: 'year', amountPaise: 99900, available },
          { product: 'family_trial', plan: 'family', term: 'trial', amountPaise: 14900, available: false, reason: 'trial_used' },
        ] }, error: null };
        if (body.action === 'order') return { data: { orderId: 'order_1', keyId: 'rzp_x', amount: 99900, currency: 'INR', name: 'Pocket Pro · 1 year' }, error: null };
        if (body.action === 'verify') return { data: { ok: true, applied: true }, error: null };
        return { data: null, error: { message: 'no' } };
      } };
      return sb;
    };
    const opened = [];
    function Razorpay(opts) { this.on = () => {}; this.open = () => { opened.push(opts); opts.handler({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig' }); }; }
    const w = boot(hash, { createClient }, Razorpay);
    await wait(3000);
    return { w, invoked, opened };
  };
  const a = await run('#plans=family_year', true);
  ok('L3 the plan chooser opens and Razorpay opens for that plan', a.opened.length === 1 && a.opened[0].order_id === 'order_1'
     && a.invoked.some((b) => b.action === 'order' && b.product === 'family_year'), JSON.stringify(a.invoked.map((b) => b.action)));
  ok('L3 the payment is checked and applied', a.invoked.some((b) => b.action === 'verify' && b.paymentId === 'pay_1'));
  ok('L3 the link is used once', a.w.sessionStorage.getItem('pocket.pendingPlans') === null);
  const b = await run('#plans=family_trial', true);
  ok('L3 something that can\'t be bought now: no payment, the chooser stays open', b.opened.length === 0 && !b.invoked.some((x) => x.action === 'order'));
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
