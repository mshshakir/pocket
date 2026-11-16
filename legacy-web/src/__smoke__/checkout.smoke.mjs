/**
 * checkout.smoke.mjs — the app's side of payments (phase 5).
 *
 *   C1  buy(): order → Razorpay window → verify, in that order, and the app
 *       never sends an amount.
 *   C2  Closing the window ends the purchase as 'dismissed', with no verify.
 *   C3  Server refusals and network failures arrive as PaymentError.
 *   C4  RazorpayCheckout loads checkout.js once, passes the order, and maps
 *       Razorpay's answer to the three values the server checks.
 *   C5  Entitlements: paymentsOpen only when the server says true.
 *   C6  PlanCard: buy buttons only when payment is open; a used trial and an
 *       unlimited AI allowance hide their buttons; lifetime sees no plans.
 *
 * Run: node src/__smoke__/checkout.smoke.mjs
 */
import { PaymentService } from '../domain/billing/PaymentService.js';
import { PaymentError } from '../domain/billing/PaymentError.js';
import { RazorpayCheckout } from '../domain/billing/RazorpayCheckout.js';
import { Entitlements } from '../domain/billing/Entitlements.js';
import { PlanCard } from '../ui/components/PlanCard.js';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nCheckout suite');

const ORDER = { orderId: 'order_1', keyId: 'rzp_test_x', amount: 16900, currency: 'INR', name: 'Sync · 1 month' };
const server = (over = {}) => {
  const sent = [];
  const invoke = async (name, { body }) => {
    sent.push({ name, ...body });
    if (over[body.action]) return over[body.action](body);
    if (body.action === 'order') return { data: ORDER, error: null };
    if (body.action === 'verify') return { data: { ok: true, applied: true }, error: null };
    return { data: { keyId: 'rzp_test_x', products: [] }, error: null };
  };
  return { sent, invoke };
};
const refusal = (status, body) => ({ data: null, error: { message: `HTTP ${status}`, context: { json: async () => body } } });

{
  const s = server();
  const opened = [];
  const checkout = { open: async (o) => { opened.push(o); return { orderId: o.orderId, paymentId: 'pay_1', signature: 'sig' }; } };
  const r = await new PaymentService(() => s.invoke, checkout).buy('sync_month', { email: 'a@b.c' });
  ok('C1 order → window → verify, and the payment is applied', r.applied === true
     && s.sent.map((x) => x.action).join() === 'order,verify' && s.sent.every((x) => x.name === 'payments'));
  ok('C1 the window gets the server\'s order and the email', opened[0].orderId === 'order_1' && opened[0].amount === 16900 && opened[0].email === 'a@b.c');
  ok('C1 verify carries Razorpay\'s three values', s.sent[1].orderId === 'order_1' && s.sent[1].paymentId === 'pay_1' && s.sent[1].signature === 'sig');
  ok('C1 the app never sends an amount', s.sent.every((x) => !('amount' in x) && !('amountPaise' in x)));
}
{
  const s = server();
  const checkout = { open: async () => { throw new PaymentError('Payment cancelled.', 'dismissed'); } };
  const e = await new PaymentService(() => s.invoke, checkout).buy('ai_pack').catch((x) => x);
  ok('C2 closing the window: dismissed, nothing verified', e instanceof PaymentError && e.code === 'dismissed' && s.sent.length === 1);
}
{
  const s = server({ order: () => refusal(409, { error: 'You\'ve already used your trial.', code: 'not_allowed' }) });
  let opened = false;
  const e = await new PaymentService(() => s.invoke, { open: async () => { opened = true; } }).buy('family_trial').catch((x) => x);
  ok('C3 a server refusal keeps its sentence and code, no window', e.code === 'not_allowed' && /already used/.test(e.message) && !opened);
  const e2 = await new PaymentService(() => async () => { throw new TypeError('fetch'); }, {}).offers().catch((x) => x);
  ok('C3 network failure is named', e2 instanceof PaymentError && e2.code === 'network');
  const e3 = await new PaymentService(() => null, {}).offers().catch((x) => x);
  ok('C3 signed out: refused before anything is sent', e3.code === 'signed_out');
}
{
  // A fake browser: a document that "loads" the script by defining Razorpay.
  let instances = [], scripts = 0, answer = 'pay';
  const win = {
    document: {
      createElement: () => ({}),
      head: { appendChild: (el) => { scripts++; win.Razorpay = class {
        constructor(opts) { this.opts = opts; instances.push(this); }
        on() {}
        open() { queueMicrotask(() => answer === 'pay'
          ? this.opts.handler({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_7', razorpay_signature: 'sg' })
          : this.opts.modal.ondismiss()); }
      }; queueMicrotask(el.onload); } },
    },
  };
  const c = new RazorpayCheckout(win);
  const r = await c.open(ORDER);
  ok('C4 checkout.js is loaded and the window gets the order', scripts === 1 && instances[0].opts.order_id === 'order_1'
     && instances[0].opts.key === 'rzp_test_x' && instances[0].opts.amount === 16900);
  ok('C4 Razorpay\'s answer becomes orderId / paymentId / signature', r.orderId === 'order_1' && r.paymentId === 'pay_7' && r.signature === 'sg');
  answer = 'close';
  const e = await c.open(ORDER).catch((x) => x);
  ok('C4 second purchase reuses the script; closing rejects as dismissed', scripts === 1 && e.code === 'dismissed');
}
{
  ok('C5 paymentsOpen: true only when the server says so',
     Entitlements.from({ paymentsOpen: true }).paymentsOpen === true && Entitlements.from({ paymentsOpen: 'yes' }).paymentsOpen === false
     && Entitlements.from(null).paymentsOpen === false && Entitlements.free().paymentsOpen === false);
}
{
  const catalogue = [
    { code: 'free', name: 'Free' },
    { code: 'sync', name: 'Sync', sync: true, telegram: true, seats: 1, monthly_paise: 16900, yearly_paise: 99900 },
    { code: 'family', name: 'Family', sync: true, telegram: true, sharing: true, seats: 5, monthly_paise: 19900, yearly_paise: 149900, trial_paise: 5000, trial_days: 14 },
  ];
  const p = (product, plan, term, amountPaise, available = true, reason) => ({ product, plan, term, amountPaise, available, reason, name: product });
  const offers = (trialOk = true) => ({ products: [
    p('family_trial', 'family', 'trial', 5000, trialOk, trialOk ? undefined : 'trial_used'),
    p('sync_month', 'sync', 'month', 16900), p('sync_year', 'sync', 'year', 99900),
    p('family_month', 'family', 'month', 19900), p('family_year', 'family', 'year', 149900),
    { product: 'ai_pack', name: 'AI pack', aiCredits: 1000, amountPaise: 10000, available: true },
  ] });
  const card = new PlanCard();
  const free = (extra = {}) => Entitlements.from({ plan: 'free', state: 'free', ...extra });

  const closed = card.html(free(), catalogue, offers());
  ok('C6 payment off: no buy buttons, "coming soon"', !closed.includes('__app.buy(') && /coming soon/.test(closed));

  const open = card.html(free({ paymentsOpen: true }), catalogue, offers());
  const openMonth = card.html(free({ paymentsOpen: true }), catalogue, offers(), null, '', { term: 'month' });
  const buys = [...(open + openMonth).matchAll(/__app\.buy\('([a-z_]+)'\)/g)].map((m) => m[1]);
  ok('C6 one term at a time: yearly by default, monthly when switched',
     open.includes("buy('family_year')") && !open.includes("buy('family_month')") && openMonth.includes("buy('family_month')") && !openMonth.includes("buy('family_year')"));
  ok('C6 the switch shows how much yearly saves, and each plan its own saving',
     /plan-term on"[^>]*setPlanTerm\('year'\)/.test(open) && /save 51%/.test(open) && /save 37% vs monthly/.test(open) && /about ₹125 a month/.test(open));
  ok('C6 each plan lists what it includes', /Share with up to 4 family members/.test(open) && /Cloud sync on all your devices/.test(open));
  ok('C6 a plan can be pointed out (website link)', /plan-highlight[^"]*" id="plan-family"/.test(card.html(free({ paymentsOpen: true }), catalogue, offers(), null, '', { highlight: 'family' })));
  ok('C6 payment open: trial, months, years and the AI pack can be bought',
     ['family_trial', 'sync_month', 'sync_year', 'family_month', 'family_year', 'ai_pack'].every((x) => buys.includes(x)), buys.join());
  ok('C6 prices are shown in rupees', openMonth.includes('Get Sync · ₹169') && open.includes('Get Family · ₹1,499') && open.includes('or start with the first 14 days for ₹50'));

  const used = card.html(free({ paymentsOpen: true, trialAvailable: false }), catalogue, offers(false));
  ok('C6 a used trial has no button', !used.includes("buy('family_trial')"));

  const busy = card.html(free({ paymentsOpen: true }), catalogue, offers(), 'sync_month', '', { term: 'month' });
  ok('C6 while paying, buttons are disabled and the one in progress says so', /disabled/.test(busy) && busy.includes('Opening…'));

  const syncing = card.html(Entitlements.from({ plan: 'sync', state: 'active', term: 'month', paymentsOpen: true }), catalogue, offers(), null, '', { term: 'month' });
  ok('C6 on Sync: "Add 1 month" extends, other plans say Switch, and switching is explained',
     syncing.includes('Add 1 month') && syncing.includes('Switch to Family') && /Your plan/.test(syncing) && /time left over as extra days/.test(syncing) && !syncing.includes('try it for'));

  const withPlus = (o) => ({ products: [...o.products, { product: 'drive_backup', name: 'Pocket Plus', addon: 'drive_backup', amountPaise: 19900, available: true }] });
  const plusFree = card.html(free({ paymentsOpen: true }), catalogue, withPlus(offers()));
  const plusHave = card.html(free({ paymentsOpen: true, backup: true }), catalogue, withPlus(offers()));
  ok('C6 Pocket Plus: on sale for ₹199 to someone without it; hidden once they have it (or a plan includes it)',
     plusFree.includes('id="plan-plus"') && plusFree.includes("buy('drive_backup')") && plusFree.includes('₹199') && !plusHave.includes("buy('drive_backup')"));
  const intro = card.html(free({ paymentsOpen: true }), [catalogue[0], { ...catalogue[2], trial_days: 90, trial_paise: 14900 }],
    { products: [p('family_trial', 'family', 'trial', 14900), p('family_month', 'family', 'month', 9900), p('family_year', 'family', 'year', 99900)] });
  ok('C6 a 90-day offer reads "the first 3 months"', intro.includes('or start with the first 3 months for ₹149'));
  const life = card.html(Entitlements.from({ plan: 'family', state: 'active', term: 'lifetime', aiUnlimited: true, paymentsOpen: true }), catalogue, offers());
  ok('C6 for life with unlimited AI: nothing to buy', !life.includes('__app.buy('));
}

{
  const s = server();
  const checkout = { open: async (o) => ({ orderId: o.orderId, paymentId: 'pay_1', signature: 'sig' }) };
  await new PaymentService(() => s.invoke, checkout).buy('sync_month', { code: ' launch20 ' });
  await new PaymentService(() => s.invoke, checkout).buy('sync_month', { code: '' });
  ok('C7 a typed coupon code goes with the order; an empty one is left out', s.sent[0].code === 'launch20' && !('code' in s.sent[2]));
}
{
  const card = new PlanCard();
  const catalogue = [{ code: 'family', name: 'Family', sync: true, telegram: true, sharing: true, seats: 5, monthly_paise: 19900, yearly_paise: 149900 }];
  const offers = { products: [
    { product: 'family_year', plan: 'family', term: 'year', amountPaise: 119920, listPaise: 149900, sale: 'Launch sale', available: true },
    { product: 'family_month', plan: 'family', term: 'month', amountPaise: 19900, listPaise: 19900, available: true },
  ] };
  const html = card.html(Entitlements.from({ plan: 'free', state: 'free', paymentsOpen: true }), catalogue, offers, null, 'LAUNCH20');
  const htmlMonth = card.html(Entitlements.from({ plan: 'free', state: 'free', paymentsOpen: true }), catalogue, offers, null, '', { term: 'month' });
  ok('C8 a sale shows the old price struck through, named; others stay plain', /<s class="plan-was" title="Launch sale">₹1,499<\/s> ₹1,199\.20/.test(html) && /Get Family · ₹199</.test(htmlMonth));
  ok('C9 a code box keeps what was typed', /placeholder="Code"[^>]*value="LAUNCH20"/.test(html.replace(/\s+/g, ' ')));
  ok('C9 without a code, only a "Have a code?" link; it opens the box', htmlMonth.includes('openCoupon()') && !htmlMonth.includes('placeholder="Code"') && card.html(Entitlements.from({ plan: 'free', state: 'free', paymentsOpen: true }), catalogue, offers, null, '', { couponOpen: true }).includes('placeholder="Code"'));
  const esc = card.html(Entitlements.from({ plan: 'free', state: 'free', paymentsOpen: true }), catalogue, offers, null, '"><script>');
  ok('C10 the code box escapes what was typed', !esc.includes('"><script>'));
}

{
  // C11–C13: applying a code in Settings
  const s = server({ products: (b) => !b.code ? { data: { keyId: 'k', products: [] }, error: null } : b.code === 'TEN'
    ? { data: { keyId: 'k', coupon: { code: 'TEN', products: ['family_year'] }, products: [{ product: 'family_year', plan: 'family', term: 'year', amountPaise: 134910, listPaise: 149900, coupon: 'TEN', available: true }] }, error: null }
    : refusal(409, { error: 'That code has expired.', code: 'bad_coupon' }) });
  const svc = new PaymentService(() => s.invoke, {});
  const got = await svc.offers(' TEN ');
  ok('C11 a code goes with the price list request, tidied; the reply says what it applies to',
     s.sent[0].code === 'TEN' && got.coupon.code === 'TEN' && got.products[0].amountPaise === 134910);
  const bad = await svc.offers('OLD').catch((x) => x);
  ok('C11 a refused code keeps the server\'s reason', bad.code === 'bad_coupon' && /expired/.test(bad.message));
  await svc.offers('');
  ok('C11 no code: none sent', !('code' in s.sent.at(-1)));

  const card = new PlanCard();
  const catalogue = [{ code: 'family', name: 'Family', sync: true, telegram: true, sharing: true, seats: 5, monthly_paise: 19900, yearly_paise: 149900 }];
  const ent = Entitlements.from({ plan: 'free', state: 'free', paymentsOpen: true });
  const html = card.html(ent, catalogue, got, null, 'TEN', { term: 'year', couponApplied: 'TEN' });
  ok('C12 an applied code: a chip with Remove, no box', /TEN<\/b> applied/.test(html) && html.includes('removeCoupon()') && !html.includes('placeholder="Code"'));
  ok('C12 the plan shows the final amount, the saving, and the button charges it',
     /₹1,499<\/s> ₹1,349\.10/.test(html) && /You save ₹149\.90 with TEN/.test(html) && /Get Family · ₹1,349\.10</.test(html) && /about ₹112 a month/.test(html), html.replace(/\s+/g, ' ').match(/plan-price.{0,300}/)?.[0]);
  const err = card.html(ent, catalogue, got, null, 'OLD', { term: 'year', couponError: 'That code has expired.' });
  ok('C13 a refused code: the box stays with the reason under it', err.includes('placeholder="Code"') && /That code has expired\./.test(err) && err.includes('applyCoupon()'));
  const checking = card.html(ent, catalogue, got, null, 'TEN', { term: 'year', couponChecking: true });
  ok('C13 while checking, Apply says so and is disabled', /disabled[^>]*onclick="window.__app.applyCoupon\(\)">Checking…/.test(checking.replace(/\s+/g, ' ')));
}

{
  // C14–C16: switching plans with the time left
  const card = new PlanCard();
  const catalogue = [
    { code: 'sync', name: 'Sync', sync: true, telegram: true, seats: 1, monthly_paise: 16900, yearly_paise: 99900 },
    { code: 'family', name: 'Family', sync: true, telegram: true, sharing: true, seats: 5, monthly_paise: 19900, yearly_paise: 149900 },
  ];
  const onSync = Entitlements.from({ plan: 'sync', state: 'active', term: 'year', paymentsOpen: true });
  const up = { switches: {}, products: [
    { product: 'sync_year', plan: 'sync', term: 'year', amountPaise: 99900, available: true },
    { product: 'family_year', plan: 'family', term: 'year', amountPaise: 149900, available: true, switchDays: 182, switchFrom: 'Sync' } ] };
  const h = card.html(onSync, catalogue, up, null, '', { term: 'year' });
  ok('C14 moving up: full price, and the time left shown as extra days', /Switch to Family · ₹1,499</.test(h) && /\+ about 6 months extra from the time left on your Sync/.test(h));
  const onFamily = Entitlements.from({ plan: 'family', state: 'active', term: 'year', paymentsOpen: true });
  const down = { switches: { sync: { fromPlan: 'family', fromName: 'Family', creditPaise: 74900, days: 273, lower: true } }, products: [
    { product: 'sync_year', plan: 'sync', term: 'year', amountPaise: 99900, available: true },
    { product: 'family_year', plan: 'family', term: 'year', amountPaise: 149900, available: true } ] };
  const d = card.html(onFamily, catalogue, down, null, '', { term: 'year' });
  ok('C15 moving down: a free switch, no payment button for that plan', d.includes("__app.switchPlan('sync')") && /Switch to Sync · free/.test(d) && !d.includes("buy('sync_year')")
     && /becomes about 9 months of Sync/.test(d) && /Add 1 year · ₹1,499/.test(d));
  ok('C16 how long, in words', PlanCard.span(20) === '20 days' && PlanCard.span(273) === 'about 9 months' && PlanCard.span(820) === 'about 2 years 3 months' && PlanCard.span(365) === 'about 12 months');
  const s = server({ switch: () => ({ data: { ok: true, applied: true, plan: 'sync', days: 273, endsAt: '2027-08-15' }, error: null }) });
  const r = await new PaymentService(() => s.invoke, {}).switchPlan('sync');
  ok('C16 a switch is one call, no Razorpay window', s.sent.length === 1 && s.sent[0].action === 'switch' && s.sent[0].plan === 'sync' && r.days === 273);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
