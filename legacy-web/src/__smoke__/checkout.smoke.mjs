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
  const buys = [...open.matchAll(/__app\.buy\('([a-z_]+)'\)/g)].map((m) => m[1]);
  ok('C6 payment open: trial, months, years and the AI pack can be bought',
     ['family_trial', 'sync_month', 'sync_year', 'family_month', 'family_year', 'ai_pack'].every((x) => buys.includes(x)), buys.join());
  ok('C6 prices are shown in rupees', open.includes('₹169') && open.includes('₹1,499') && open.includes('Try 14 days · ₹50'));

  const used = card.html(free({ paymentsOpen: true, trialAvailable: false }), catalogue, offers(false));
  ok('C6 a used trial has no button', !used.includes("buy('family_trial')"));

  const busy = card.html(free({ paymentsOpen: true }), catalogue, offers(), 'sync_month');
  ok('C6 while paying, buttons are disabled and the one in progress says so', /disabled/.test(busy) && busy.includes('Opening…'));

  const syncing = card.html(Entitlements.from({ plan: 'sync', state: 'active', term: 'month', paymentsOpen: true }), catalogue, offers());
  ok('C6 on Sync: "Add 1 month" extends, and switching plans is explained', syncing.includes('Add 1 month') && /starts it today/.test(syncing));

  const life = card.html(Entitlements.from({ plan: 'family', state: 'active', term: 'lifetime', aiUnlimited: true, paymentsOpen: true }), catalogue, offers());
  ok('C6 for life with unlimited AI: nothing to buy', !life.includes('__app.buy('));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
