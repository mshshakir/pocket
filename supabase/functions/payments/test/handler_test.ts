/**
 * PaymentHandler with fakes for sign-in, the database and Razorpay.
 * Run: deno run --import-map <map with a supabase-js stub> supabase/functions/payments/test/handler_test.ts
 */
import { PaymentHandler } from '../lib/PaymentHandler.ts';
import type { PaymentStore, Product, Quote } from '../lib/PaymentStore.ts';
import { RazorpayClient } from '../lib/RazorpayClient.ts';
import { Signature } from '../lib/Signature.ts';

let passed = 0, failed = 0;
const ok = (label: string, cond: boolean, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};

const KEY_SECRET = 'key-secret', HOOK_SECRET = 'hook-secret';
const PRODUCTS: Product[] = [
  { product: 'sync_month', name: 'Sync · 1 month', plan: 'sync', term: 'month', amountPaise: 16900 },
  { product: 'family_trial', name: 'Family · 14-day trial', plan: 'family', term: 'trial', amountPaise: 5000 },
  { product: 'ai_pack', name: 'AI pack · 1000 uses', aiCredits: 1000, amountPaise: 10000 },
];

class FakeStore {
  open = true;
  trialUsed = false;
  orders = new Map<string, { user: string; paid: boolean; product: string }>();
  fulfilled: string[] = [];
  products() { return Promise.resolve(PRODUCTS); }
  switches: Record<string, { fromPlan: string; fromName: string; creditPaise: number; days: number; lower: boolean }> = {};
  switchOptions() { return Promise.resolve(this.switches); }
  switchedTo: string[] = [];
  switchPlan(_u: string, plan: string) {
    const o = this.switches[plan];
    if (!this.open) return Promise.resolve({ ok: false, reason: 'closed' as const });
    if (!o) return Promise.resolve({ ok: false, reason: 'no_credit' as const });
    if (!o.lower) return Promise.resolve({ ok: false, reason: 'not_lower' as const });
    this.switchedTo.push(plan);
    return Promise.resolve({ ok: true, applied: true, plan, days: o.days, endsAt: '2029-02-12T00:00:00Z' });
  }
  switchDays = 0;
  quotedWith: (string | null)[] = [];
  offered = false;
  quote(_u: string, product: string, code: string | null = null): Promise<Quote> {
    this.quotedWith.push(code);
    if (!this.open) return Promise.resolve({ ok: false, reason: 'closed' });
    if (product === 'programme') {
      return Promise.resolve(this.offered
        ? { ok: true, product: 'programme', name: 'Habit programme · Batch 1', amountPaise: 500000, listPaise: 500000, applicationId: 7 }
        : { ok: false, reason: 'no_place' });
    }
    if (code === 'BAD') return Promise.resolve({ ok: false, reason: 'coupon_unknown' });
    if (code === 'OLD') return Promise.resolve({ ok: false, reason: 'coupon_expired' });
    if (code === 'AIONLY' && product !== 'ai_pack') return Promise.resolve({ ok: false, reason: 'coupon_not_for_this' });
    if (code === 'AIONLY') return Promise.resolve({ ok: true, ...PRODUCTS[2], listPaise: 10000, amountPaise: 5000, coupon: 'AIONLY', offerIds: [4] });
    if (code === 'NOPE') return Promise.resolve({ ok: false, reason: 'coupon_not_for_this' });
    if (code === 'TEN') {
      const p = PRODUCTS.find((x) => x.product === product)!;
      return Promise.resolve({ ok: true, ...p, listPaise: p.amountPaise, amountPaise: Math.round(p.amountPaise * 0.9), coupon: 'TEN', offerIds: [3] });
    }
    const p = PRODUCTS.find((x) => x.product === product);
    if (!p) return Promise.resolve({ ok: false, reason: 'unknown' });
    if (p.term === 'trial' && this.trialUsed) return Promise.resolve({ ok: false, reason: 'trial_used' });
    if (this.switchDays && p.term === 'month') return Promise.resolve({ ok: true, ...p, switchDays: this.switchDays, switchFrom: 'Family' });
    return Promise.resolve({ ok: true, ...p });
  }
  // ── auto-debit (0053) ──
  renewing = new Set<string>();
  subRefusal: string | null = null;
  rpPlans = new Map<string, string>();
  subs = new Map<string, { user: string; product: string; status: string }>();
  charges: string[] = [];
  replaced: string[] = [];
  subscriptionQuote(_u: string, product: string) {
    if (!this.renewing.has(product)) return Promise.resolve({ ok: false, renewing: false });
    if (this.subRefusal) return Promise.resolve({ ok: false, renewing: true, reason: this.subRefusal });
    return Promise.resolve({ ok: true, renewing: true, product, plan: product.split('_')[0], term: product.endsWith('_year') ? 'year' : 'month',
      amountPaise: product === 'promise_month' ? 3000 : 9900, name: 'Plan · monthly', totalCount: 120 });
  }
  razorpayPlan(product: string, amount: number) { return Promise.resolve(this.rpPlans.get(`${product}:${amount}`) ?? null); }
  saveRazorpayPlan(product: string, amount: number, id: string) { this.rpPlans.set(`${product}:${amount}`, id); return Promise.resolve(id); }
  saveSubscription(id: string, user: string, q: { product: string }) { this.subs.set(id, { user, product: q.product, status: 'created' }); return Promise.resolve(); }
  subscriptionOwner(id: string) { return Promise.resolve(this.subs.get(id)?.user ?? null); }
  charge(sub: string, payment: string) {
    const key = `${sub}:${payment}`;
    const applied = !this.charges.includes(key);
    if (applied) this.charges.push(key);
    const s = this.subs.get(sub)!; s.status = 'active';
    const cancel = applied ? this.replaced.splice(0) : [];
    return Promise.resolve({ ok: true, applied, cancel });
  }
  subscriptionStatus(id: string, status: string) { const s = this.subs.get(id); if (s) s.status = status; return Promise.resolve(); }
  currentSubscription(user: string) {
    for (const [id, s] of this.subs) if (s.user === user && ['active', 'authenticated'].includes(s.status)) return Promise.resolve({ id, product: s.product });
    return Promise.resolve(null);
  }

  saved: Quote[] = [];
  charged: ({ currency: string; minor: number } | undefined)[] = [];
  saveOrder(id: string, user: string, q: Quote, charged?: { currency: string; minor: number }) {
    this.saved.push(q); this.charged.push(charged);
    this.orders.set(id, { user, paid: false, product: q.product! }); return Promise.resolve();
  }
  // ── dollars (0059) ──
  usd: Record<string, number> = { family_trial: 399, ai_pack: 200, promise_month: 100, programme: 9900 };
  usdPrices() { return Promise.resolve(this.usd); }
  productOf(id: string) { return Promise.resolve(this.orders.get(id)?.product ?? null); }
  promised: string[] = [];
  promiseCredits(user: string, payment: string) { this.promised.push(`${user}:${payment}`); return Promise.resolve(); }
  ownerOf(id: string) { return Promise.resolve(this.orders.get(id)?.user ?? null); }
  fulfil(id: string, payment: string) {
    const o = this.orders.get(id)!;
    const applied = !o.paid;
    o.paid = true;
    if (applied) this.fulfilled.push(`${id}:${payment}`);
    return Promise.resolve({ ok: true, applied });
  }
}

let rzpCalls: { auth: string; body: Record<string, unknown> }[] = [];
const razorpay = (status = 200) => new RazorpayClient('rzp_test_abc', KEY_SECRET, ((_u: unknown, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body));
  rzpCalls.push({ auth: (init?.headers as Record<string, string>).Authorization, body });
  return Promise.resolve(new Response(JSON.stringify(status === 200
    ? { id: `order_${rzpCalls.length}`, amount: body.amount, currency: body.currency ?? 'INR' }
    : { error: { description: 'bad' } }), { status }));
}) as typeof fetch);

const userOf = (a: string) => Promise.resolve(a === 'Bearer alice' ? 'alice' : a === 'Bearer bob' ? 'bob' : null);
const make = (store: FakeStore, rzp: RazorpayClient | null = razorpay()) =>
  new PaymentHandler(userOf, store as unknown as PaymentStore, rzp, KEY_SECRET, HOOK_SECRET);
const app = (b: unknown, who = 'alice') => new Request('https://x/functions/v1/payments', {
  method: 'POST', headers: { Authorization: `Bearer ${who}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b),
});
const hook = async (event: unknown, secret = HOOK_SECRET) => {
  const raw = JSON.stringify(event);
  return new Request('https://x/payments/webhook', {
    method: 'POST', headers: { 'X-Razorpay-Signature': await new Signature(secret).sign(raw) }, body: raw,
  });
};
const checkoutSig = (order: string, payment: string, secret = KEY_SECRET) => new Signature(secret).sign(`${order}|${payment}`);

console.log('\npayments function');
{
  // Razorpay's documented sample: HMAC-SHA256 hex of a known message.
  const sig = await new Signature('key').sign('The quick brown fox jumps over the lazy dog');
  ok('P0 HMAC-SHA256 matches the standard test vector', sig === 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8', sig);
}
{
  const s = new FakeStore(); s.trialUsed = true;
  const j = await (await make(s).handle(app({ action: 'products' }))).json();
  const trial = j.products.find((p: { product: string }) => p.product === 'family_trial');
  ok('P1 products list prices from the database, the key id, and what this person can buy',
    j.keyId === 'rzp_test_abc' && j.products.length === 3 && trial.available === false && trial.reason === 'trial_used' && !('sort' in j.products[0] && j.products[0].sort !== undefined), JSON.stringify(j));
}
{
  const s = new FakeStore(); rzpCalls = [];
  const res = await make(s).handle(app({ action: 'order', product: 'sync_month' }));
  const j = await res.json();
  ok('P2 an order is created at Razorpay for the database price and saved for this user',
    res.status === 200 && j.orderId === 'order_1' && j.amount === 16900 && rzpCalls[0].body.amount === 16900 && s.orders.get('order_1')?.user === 'alice', JSON.stringify(j));
  ok('P3 Razorpay gets basic auth with the key pair', rzpCalls[0].auth === `Basic ${btoa(`rzp_test_abc:${KEY_SECRET}`)}`);
  ok('P4 the app never sees the key secret', !JSON.stringify(j).includes(KEY_SECRET));
}
{
  const s = new FakeStore(); rzpCalls = [];
  const res = await make(s).handle(app({ action: 'order', product: 'sync_month', amountPaise: 1 }));
  ok('P5 the app cannot set its own price', (await res.json()).amount === 16900 && rzpCalls[0].body.amount === 16900);
}
{
  const s = new FakeStore(); s.open = false;
  const res = await make(s).handle(app({ action: 'order', product: 'sync_month' }));
  ok('P6 payments switched off: refused before Razorpay', res.status === 503 && (await res.json()).code === 'closed');
}
{
  const s = new FakeStore(); s.trialUsed = true;
  const res = await make(s).handle(app({ action: 'order', product: 'family_trial' }));
  const j = await res.json();
  ok('P7 trial already used: refused with a reason', res.status === 409 && /already used/.test(j.error), JSON.stringify(j));
}
{
  const res = await make(new FakeStore(), null).handle(app({ action: 'order', product: 'sync_month' }));
  ok('P8 no Razorpay keys yet: "not set up"', res.status === 503 && (await res.json()).code === 'not_set_up');
}
{
  const res = await make(new FakeStore(), razorpay(400)).handle(app({ action: 'order', product: 'sync_month' }));
  const j = await res.json();
  ok('P9 Razorpay refuses the order: nothing charged, said plainly', res.status === 502 && /weren't charged/.test(j.error), JSON.stringify(j));
}
{
  const res = await make(new FakeStore()).handle(app({ action: 'products' }, 'nobody'));
  ok('P10 not signed in: refused', res.status === 401 && (await res.json()).code === 'signed_out');
}
{
  const s = new FakeStore(); rzpCalls = [];
  const h = make(s);
  await h.handle(app({ action: 'order', product: 'ai_pack' }));
  const bad = await h.handle(app({ action: 'verify', orderId: 'order_1', paymentId: 'pay_1', signature: 'deadbeef' }));
  ok('P11 a forged Checkout result is refused and nothing applied', bad.status === 400 && (await bad.json()).code === 'bad_signature' && !s.fulfilled.length);
  const bob = await h.handle(app({ action: 'verify', orderId: 'order_1', paymentId: 'pay_1', signature: await checkoutSig('order_1', 'pay_1') }, 'bob'));
  ok('P12 someone else cannot claim my payment', bob.status === 403 && !s.fulfilled.length);
  const good = await h.handle(app({ action: 'verify', orderId: 'order_1', paymentId: 'pay_1', signature: await checkoutSig('order_1', 'pay_1') }));
  const j = await good.json();
  ok('P13 a genuine payment is applied', good.status === 200 && j.applied === true && s.fulfilled[0] === 'order_1:pay_1', JSON.stringify(j));

  const event = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', status: 'captured' } } } };
  const again = await (await h.handle(await hook(event))).json();
  ok('P14 the webhook for the same payment changes nothing', again.applied === false && s.fulfilled.length === 1, JSON.stringify(again));
}
{
  const s = new FakeStore(); rzpCalls = [];
  const h = make(s);
  await h.handle(app({ action: 'order', product: 'sync_month' }));
  const event = { event: 'order.paid', payload: { order: { entity: { id: 'order_1' } }, payment: { entity: { id: 'pay_9', order_id: 'order_1', status: 'captured' } } } };
  const forged = await h.handle(await hook(event, 'wrong-secret'));
  ok('P15 a webhook with a wrong signature is refused', forged.status === 401 && !s.fulfilled.length);
  const res = await h.handle(await hook(event));
  ok('P16 the app never came back: the webhook applies the payment', (await res.json()).applied === true && s.fulfilled[0] === 'order_1:pay_9');
}
{
  const s = new FakeStore();
  const h = make(s);
  const other = await (await h.handle(await hook({ event: 'order.paid', payload: { order: { entity: { id: 'order_xyz' } }, payment: { entity: { id: 'pay_x' } } } }))).json();
  const failedPay = await (await h.handle(await hook({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_f', order_id: 'order_1', status: 'failed' } } } }))).json();
  ok('P17 other orders and other events are acknowledged and ignored', other.ignored === true && failedPay.ignored === true && !s.fulfilled.length);
}

{
  const s = new FakeStore(); rzpCalls = [];
  const res = await make(s).handle(app({ action: 'order', product: 'sync_month', code: ' ten ' }));
  const j = await res.json();
  ok('P18 a coupon is passed to the price check, tidied; the order is for the discounted amount',
    s.quotedWith.at(-1) === 'TEN' && rzpCalls[0].body.amount === 15210 && j.amount === 15210 && j.listAmount === 16900 && j.coupon === 'TEN'
    && (rzpCalls[0].body.notes as Record<string, string>).coupon === 'TEN' && s.saved[0].offerIds?.[0] === 3, JSON.stringify(j));
}
{
  const s = new FakeStore(); rzpCalls = [];
  const res = await make(s).handle(app({ action: 'order', product: 'sync_month', code: 'BAD' }));
  const j = await res.json();
  ok('P19 a bad code: refused with a reason, no Razorpay order', res.status === 409 && j.code === 'bad_coupon' && /isn't valid/.test(j.error) && !rzpCalls.length, JSON.stringify(j));
  const odd = await make(new FakeStore()).handle(app({ action: 'order', product: 'sync_month', code: 'no spaces allowed!' }));
  ok('P20 a code with odd characters never reaches the database as typed', (await odd.json()).code === 'bad_coupon');
}
{
  const s = new FakeStore(); rzpCalls = [];
  const before = await (await make(s).handle(app({ action: 'order', product: 'programme' }))).json();
  ok('P21 programme before a place is offered: refused', before.code === 'not_allowed' && /no programme place/.test(before.error), JSON.stringify(before));
  s.offered = true;
  const j = await (await make(s).handle(app({ action: 'order', product: 'programme' }))).json();
  ok('P22 programme once offered: ₹5,000 order tied to the application', j.amount === 500000 && s.saved.at(-1)?.applicationId === 7 && /Habit programme/.test(j.name), JSON.stringify(j));
}

{
  const s = new FakeStore(); s.trialUsed = true;
  const j = await (await make(s).handle(app({ action: 'products', code: ' ten ' }))).json();
  const sync = j.products.find((p: { product: string }) => p.product === 'sync_month');
  const trial = j.products.find((p: { product: string }) => p.product === 'family_trial');
  ok('P23 a code in the price list: each item it applies to shows the final amount and the list price',
    sync.amountPaise === 15210 && sync.listPaise === 16900 && sync.coupon === 'TEN' && j.coupon.code === 'TEN' && j.coupon.products.includes('ai_pack'), JSON.stringify(j));
  ok('P24 items this person can\'t buy aren\'t priced with the code', trial.available === false && !trial.coupon && s.quotedWith.filter((c) => c === 'TEN').length === 2);
  const ai = await (await make(new FakeStore()).handle(app({ action: 'products', code: 'aionly' }))).json();
  ok('P25 a code for some items only: those get it, the rest stay at their price',
    ai.coupon.products.join() === 'ai_pack' && ai.products.find((p: { product: string }) => p.product === 'ai_pack').amountPaise === 5000
    && ai.products.find((p: { product: string }) => p.product === 'sync_month').amountPaise === 16900, JSON.stringify(ai));
  for (const [code, re] of [['BAD', /isn't valid/], ['OLD', /expired/], ['NOPE', /can't be used/], ['a b', /isn't valid/]] as [string, RegExp][]) {
    const res = await make(new FakeStore()).handle(app({ action: 'products', code }));
    const e = await res.json();
    ok(`P26 code ${code}: refused with the reason`, res.status === 409 && e.code === 'bad_coupon' && re.test(e.error), JSON.stringify(e));
  }
  const plain = await (await make(new FakeStore()).handle(app({ action: 'products', code: '' }))).json();
  ok('P27 an empty code is just the price list', !plain.coupon && plain.products.length === 3);
}

{
  const s = new FakeStore(); rzpCalls = [];
  s.switches = { sync: { fromPlan: 'family', fromName: 'Family', creditPaise: 74900, days: 273, lower: true },
                 big: { fromPlan: 'family', fromName: 'Family', creditPaise: 74900, days: 120, lower: false } };
  s.switchDays = 90;
  const j = await (await make(s).handle(app({ action: 'products' }))).json();
  ok('P28 the price list says what a switch brings: extra days on a bigger plan, free moves down',
    j.products.find((p: { product: string }) => p.product === 'sync_month').switchDays === 90 && j.switches.sync.days === 273 && j.switches.sync.lower === true, JSON.stringify(j));
  const done = await (await make(s).handle(app({ action: 'switch', plan: 'sync' }))).json();
  ok('P29 moving down: no Razorpay, the plan changes with the days', done.ok && done.days === 273 && s.switchedTo.join() === 'sync' && !rzpCalls.length, JSON.stringify(done));
  const up = await make(s).handle(app({ action: 'switch', plan: 'big' }));
  const upj = await up.json();
  ok('P30 moving up for free is refused, and says to pay', up.status === 409 && /needs a payment/.test(upj.error), JSON.stringify(upj));
  const none = await (await make(new FakeStore()).handle(app({ action: 'switch', plan: 'sync' }))).json();
  ok('P31 nothing paid to move: refused', /no paid time/.test(none.error));
  const odd = await make(s).handle(app({ action: 'switch', plan: "x'; drop" }));
  ok('P32 an odd plan name never reaches the database', odd.status === 400 && s.switchedTo.length === 1);
}

// ── Auto-debit ────────────────────────────────────────────────────
let subCalls: { url: string; body: Record<string, unknown> }[] = [];
const subRazorpay = (status = 200) => new RazorpayClient('rzp_test_abc', KEY_SECRET, ((u: unknown, init?: RequestInit) => {
  const url = String(u), body = JSON.parse(String(init?.body));
  subCalls.push({ url, body });
  const id = url.endsWith('/plans') ? `plan_${subCalls.length}` : url.includes('/cancel') ? url.split('/').at(-2) : `sub_${subCalls.length}`;
  return Promise.resolve(new Response(JSON.stringify(status === 200 ? { id, status: url.includes('/cancel') ? 'cancelled' : 'created' } : { error: {} }), { status }));
}) as typeof fetch);
const subSig = (payment: string, sub: string, secret = KEY_SECRET) => new Signature(secret).sign(`${payment}|${sub}`);
{
  const s = new FakeStore(); s.renewing.add('promise_month'); subCalls = [];
  const h = make(s, subRazorpay());
  const res = await h.handle(app({ action: 'order', product: 'promise_month', code: 'TEN' }));
  const j = await res.json();
  ok('S1 a renewing plan starts auto-debit: a Razorpay plan, then a subscription, saved for this user',
    j.kind === 'subscription' && j.subscriptionId === 'sub_2' && j.amount === 3000 && subCalls[0].url.endsWith('/plans')
    && (subCalls[0].body.item as { amount: number }).amount === 3000 && subCalls[0].body.period === 'monthly'
    && subCalls[1].body.plan_id === 'plan_1' && s.subs.get('sub_2')?.user === 'alice', JSON.stringify(j));
  ok('S1 no one-time order is made, and the coupon is not used', !s.saved.length && !s.quotedWith.includes('TEN'));
  await h.handle(app({ action: 'order', product: 'promise_month' }, 'bob'));
  ok('S2 the Razorpay plan is made once and reused', subCalls.filter((c) => c.url.endsWith('/plans')).length === 1);

  const forged = await h.handle(app({ action: 'verify', subscriptionId: 'sub_2', paymentId: 'pay_9', signature: 'beef' }));
  ok('S3 a forged first payment is refused', forged.status === 400 && !s.charges.length);
  const bobs = await h.handle(app({ action: 'verify', subscriptionId: 'sub_2', paymentId: 'pay_9', signature: await subSig('pay_9', 'sub_2') }, 'bob'));
  ok('S4 someone else cannot claim my subscription', bobs.status === 403 && !s.charges.length);
  const good = await h.handle(app({ action: 'verify', subscriptionId: 'sub_2', paymentId: 'pay_9', signature: await subSig('pay_9', 'sub_2') }));
  ok('S5 the first payment is checked (payment|subscription) and applied', (await good.json()).applied === true && s.charges[0] === 'sub_2:pay_9');

  const charged = await h.handle(await hook({ event: 'subscription.charged',
    payload: { subscription: { entity: { id: 'sub_2', status: 'active' } }, payment: { entity: { id: 'pay_9', amount: 3000 } } } }));
  ok('S6 the webhook for the same charge changes nothing', (await charged.json()).applied === false && s.charges.length === 1);
  await h.handle(await hook({ event: 'subscription.charged',
    payload: { subscription: { entity: { id: 'sub_2', status: 'active' } }, payment: { entity: { id: 'pay_10', amount: 3000 } } } }));
  ok('S7 next month\'s charge from the webhook is applied', s.charges.includes('sub_2:pay_10'));
  const stranger = await h.handle(await hook({ event: 'subscription.charged',
    payload: { subscription: { entity: { id: 'sub_other' } }, payment: { entity: { id: 'pay_x' } } } }));
  ok('S8 another product\'s subscription is ignored', (await stranger.json()).ignored === true);
  await h.handle(await hook({ event: 'subscription.halted', payload: { subscription: { entity: { id: 'sub_2', status: 'halted' } } } }));
  ok('S9 a halted subscription is recorded', s.subs.get('sub_2')?.status === 'halted');
  const badHook = await h.handle(await hook({ event: 'subscription.charged', payload: {} }, 'wrong'));
  ok('S10 a webhook with a bad signature is refused', badHook.status === 401);
}
{
  const s = new FakeStore(); s.renewing.add('family_month'); subCalls = [];
  const h = make(s, subRazorpay());
  await h.handle(app({ action: 'order', product: 'family_month' }));
  s.replaced.push('sub_old');
  await h.handle(app({ action: 'verify', subscriptionId: 'sub_2', paymentId: 'pay_1', signature: await subSig('pay_1', 'sub_2') }));
  ok('S11 moving to another renewing plan cancels the old one at Razorpay', subCalls.some((c) => c.url.endsWith('/subscriptions/sub_old/cancel')));
  const res = await h.handle(app({ action: 'cancel' }));
  ok('S12 cancel stops auto-debit at Razorpay and records it', (await res.json()).cancelled === true
    && subCalls.some((c) => c.url.endsWith('/subscriptions/sub_2/cancel') && c.body.cancel_at_cycle_end === 0) && s.subs.get('sub_2')?.status === 'cancelled');
  const again = await h.handle(app({ action: 'cancel' }));
  ok('S13 nothing to cancel: said plainly', again.status === 409);
}
{
  const s = new FakeStore(); s.renewing.add('promise_month'); s.subRefusal = 'has_plan';
  const res = await make(s, subRazorpay()).handle(app({ action: 'order', product: 'promise_month' }));
  ok('S14 the promise isn\'t needed on a plan that already allows entries', res.status === 409 && /isn't needed/.test((await res.json()).error));
  s.subRefusal = 'has_subscription';
  const dup = await make(s, subRazorpay()).handle(app({ action: 'order', product: 'promise_month' }));
  ok('S15 auto-debit already on: refused', /already on/.test((await dup.json()).error));
  s.subRefusal = null; subCalls = [];
  const fail = await make(s, subRazorpay(400)).handle(app({ action: 'order', product: 'promise_month' }));
  ok('S16 Razorpay refuses: nothing charged, said plainly', fail.status === 502 && /weren't charged/.test((await fail.json()).error));
}
{
  const s = new FakeStore();
  const j = await (await make(s).handle(app({ action: 'products' }))).json();
  ok('S17 auto-debit off: nothing is marked as renewing', !j.products.some((p: { renews?: boolean }) => p.renews));
  s.renewing.add('sync_month');
  const k = await (await make(s).handle(app({ action: 'products' }))).json();
  ok('S17 monthly and yearly products are marked as renewing', k.products.find((p: { product: string }) => p.product === 'sync_month').renews === true
    && !('renews' in k.products.find((p: { product: string }) => p.product === 'ai_pack')));
  subCalls = [];
  const once = await (await make(s, subRazorpay()).handle(app({ action: 'order', product: 'sync_month', once: true }))).json();
  ok('S19 "pay once": a renewing plan is sold as a one-time order instead', !once.kind && once.orderId && !subCalls.some((c) => c.url.includes('/subscriptions')), JSON.stringify(once));
  s.renewing.add('promise_month');
  const promiseOnce = await (await make(s, subRazorpay()).handle(app({ action: 'order', product: 'promise_month', once: true }))).json();
  ok('S19 the promise has no one-time form', promiseOnce.kind === 'subscription');
  s.subRefusal = 'auto_debit_off';
  const off = await make(s, subRazorpay()).handle(app({ action: 'order', product: 'sync_month' }));
  ok('S18 the promise while auto-debit is off: said plainly', /isn't available yet/.test((await off.json()).error));
}

{
  // Dollars (0059)
  const s = new FakeStore(); s.renewing.add('sync_month');
  const j = await (await make(s).handle(app({ action: 'products', currency: 'USD' }))).json();
  const pack = j.products.find((p: { product: string }) => p.product === 'ai_pack');
  ok('U1 dollar list: priced in cents, marked USD', j.currency === 'USD' && pack.amountPaise === 200 && pack.currency === 'USD', JSON.stringify(pack));
  ok('U2 items with no dollar price are left out', !j.products.some((p: { product: string }) => p.product === 'sync_month'));
  const c = await (await make(s).handle(app({ action: 'products', currency: 'USD', code: 'AIONLY' }))).json();
  const cp = c.products.find((p: { product: string }) => p.product === 'ai_pack');
  ok('U3 a code takes the same share off in dollars', cp.amountPaise === 100 && cp.listPaise === 200 && c.coupon.products.join() === 'ai_pack', JSON.stringify(cp));
  rzpCalls = [];
  const o = await (await make(s).handle(app({ action: 'order', product: 'ai_pack', currency: 'USD', code: 'AIONLY' }))).json();
  ok('U4 the order goes to Razorpay in USD cents', rzpCalls[0]?.body.currency === 'USD' && rzpCalls[0]?.body.amount === 100 && o.currency === 'USD' && o.amount === 100 && o.listAmount === 200, JSON.stringify(o));
  ok('U5 the order keeps the rupee quote and records the dollar charge', s.saved[0].amountPaise === 5000 && s.charged[0]?.currency === 'USD' && s.charged[0]?.minor === 100);
  const no = await make(s).handle(app({ action: 'order', product: 'sync_month', currency: 'USD' }));
  ok('U6 something with no dollar price isn\'t sold in dollars', no.status === 409);
  rzpCalls = [];
  const r = await (await make(s).handle(app({ action: 'order', product: 'family_trial' }))).json();
  ok('U7 rupee orders are unchanged', rzpCalls[0]?.body.currency === 'INR' && r.amount === 5000);
}
{
  const s = new FakeStore(); s.renewing.add('promise_month'); subCalls = []; rzpCalls = [];
  const h = make(s, razorpay());
  const o = await (await h.handle(app({ action: 'order', product: 'promise_month', currency: 'USD' }))).json();
  ok('U8 the promise in dollars: a one-time $1 order, no auto-debit', o.orderId && o.amount === 100 && o.currency === 'USD' && !o.kind, JSON.stringify(o));
  const res = await (await h.handle(app({ action: 'verify', orderId: o.orderId, paymentId: 'pay_u', signature: await checkoutSig(o.orderId, 'pay_u') }))).json();
  ok('U9 paying it applies the month and adds the promise\'s AI credits once', res.applied === true && s.promised.join() === 'alice:pay_u');
  await h.handle(await hook({ event: 'order.paid', payload: { order: { entity: { id: o.orderId } }, payment: { entity: { id: 'pay_u', status: 'captured', order_id: o.orderId } } } }));
  ok('U10 the webhook for the same payment adds nothing more', s.promised.length === 1);
  s.subRefusal = 'has_plan';
  const not = await make(s).handle(app({ action: 'order', product: 'promise_month', currency: 'USD' }));
  ok('U11 the promise in dollars isn\'t sold to someone whose plan already allows entries', not.status === 409 && /isn't needed/.test((await not.json()).error));
}
{
  const s = new FakeStore(); s.offered = true; rzpCalls = [];
  const o = await (await make(s).handle(app({ action: 'order', product: 'programme', currency: 'USD' }))).json();
  ok('U12 the programme place in dollars', rzpCalls[0]?.body.amount === 9900 && rzpCalls[0]?.body.currency === 'USD', JSON.stringify(o));
  const ai = await (await make(s).handle(app({ action: 'order', product: 'ai_pack', currency: 'USD' }))).json();
  const hv = await (await make(s).handle(app({ action: 'verify', orderId: ai.orderId, paymentId: 'pay_a', signature: await checkoutSig(ai.orderId, 'pay_a') }))).json();
  ok('U13 an ordinary dollar purchase adds no promise credits', hv.applied === true && !s.promised.length);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
