/**
 * admin.smoke.mjs — the admin dashboard and the programme page, with a fake
 * server (no network).
 *
 *   A1  Overview shows people, plans, money and programme numbers, and warns
 *       when payment is off.
 *   A2  Users: listed with plan state; Manage opens the actions; giving a plan
 *       and credits call the server with the right arguments; search reloads.
 *   A3  Pricing: settings and plan prices are sent in paise; a coupon and a
 *       fixed-price sale are built correctly; impossible offers are refused here.
 *   A4  Programme: the waitlist in order with profile and WhatsApp link; offering
 *       a place; batches; the tracker cycles ✓ → ✗ → blank and counts weeks.
 *   A5  The programme page: signed out → sign in; the form needs consent and
 *       sends the profile; an offered place shows Pay and pays with a code.
 *   A6  The dashboard refuses a signed-in non-admin.
 *
 * Run: node src/__smoke__/admin.smoke.mjs
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://pocket.test/admin.html' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.FormData = dom.window.FormData;
globalThis.confirm = () => true;

const { OverviewView } = await import('../admin/views/OverviewView.js');
const { UsersView } = await import('../admin/views/UsersView.js');
const { PricingView } = await import('../admin/views/PricingView.js');
const { ProgrammeView } = await import('../admin/views/ProgrammeView.js');
const { AdminApp } = await import('../admin/AdminApp.js');
const { ProgrammePage } = await import('../web/ProgrammePage.js');

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nAdmin suite');

const calls = [];
const toasts = [];
const host = { toast: (m) => toasts.push(m), refresh: async () => {} };
const fake = (over = {}) => new Proxy({}, {
  get: (_t, name) => async (...args) => { calls.push([name, ...args]); return over[name] ? over[name](...args) : null; },
});
const formOf = (html, selector) => {
  const host = document.createElement('div');
  host.innerHTML = html;
  const form = host.querySelector(selector);
  return { form, data: () => new FormData(form) };
};

// A1
{
  const v = new OverviewView(fake({ stats: () => ({
    users: 8, new7: 2, new30: 5, active7: 4, loggedEntries7: 3, telegramLinked: 3, groups: 1, lifetime: 4, trials: 1,
    expiring7: 0, revenue30: 499900, revenueTotal: 899900, aiUses30: 42, paymentsOpen: false,
    plans: { free: 3, 'family:active': 5 }, programme: { waitlisted: 2, confirmed: 1 },
    signupsByWeek: [{ week: '2026-11-02', count: 1 }, { week: '2026-11-09', count: 2 }],
    revenueByMonth: [{ month: '2026-10-01', paise: 0 }, { month: '2026-11-01', paise: 499900 }],
  }) }), host);
  await v.load();
  const h = v.html();
  ok('A1 overview: people, paid plans, revenue, programme, charts', h.includes('>8<') && /On a paid plan<\/div><div class="tile-value">5/.test(h)
     && h.includes('₹4,999') && /Waitlist<\/div><div class="tile-value">2/.test(h) && (h.match(/<svg/g) ?? []).length === 2);
  ok('A1 payment off is pointed out', /Online payment is <b>off<\/b>/.test(h));
}

// A2
{
  calls.length = 0;
  const people = [
    { email: 'a@x.com', name: 'Asha', signedUp: '2026-11-01', plan: 'family', term: 'month', state: 'active', endsAt: '2026-12-01', aiCredits: 120, telegram: true, family: 2, paidPaise: 19900 },
    { email: 'b@x.com', name: null, signedUp: '2026-11-10', plan: 'free', term: null, state: 'free', aiCredits: 0, paidPaise: 0 },
  ];
  const v = new UsersView(fake({ users: () => people }), host);
  await v.load();
  let h = v.html();
  ok('A2 users listed with plan state', h.includes('Asha') && h.includes('family · active') && h.includes('until') && h.includes('₹199') && h.includes('b@x.com'));
  const toggle = document.createElement('button'); toggle.dataset.email = 'b@x.com';
  await v.act('toggle', toggle, null);
  h = v.html();
  ok('A2 Manage opens the actions for that person', h.includes('data-form="set_plan" data-email="b@x.com"') && h.includes('Give plan'));
  const f = formOf(h, 'form[data-form="set_plan"]');
  f.form.querySelector('[name=plan]').value = 'sync'; f.form.querySelector('[name=term]').value = 'year';
  await v.act('set_plan', f.form, f.data());
  ok('A2 giving a plan calls the server', JSON.stringify(calls.find((c) => c[0] === 'userAction')) === JSON.stringify(['userAction', 'b@x.com', 'set_plan', { plan: 'sync', term: 'year', note: '' }]), JSON.stringify(calls));
  const g = formOf(v.html(), 'form[data-form="grant_ai"]');
  g.form.querySelector('[name=credits]').value = '500';
  await v.act('grant_ai', g.form, g.data());
  ok('A2 credits granted as a number', calls.some((c) => c[0] === 'userAction' && c[2] === 'grant_ai' && c[3].credits === 500));
  const s = formOf('<form data-form="search"><input name="q" value="asha"></form>', 'form');
  await v.act('search', s.form, s.data());
  ok('A2 search reloads with the words', calls.some((c) => c[0] === 'users' && c[1] === 'asha'));
}

// A3
{
  calls.length = 0;
  const pricing = {
    settings: { payments_enabled: false, grace_days: 30, ai_credit_paise: 10, ai_pack_paise: 10000, ai_credit_days: 365 },
    plans: [{ code: 'free', name: 'Free', seats: 1, active: true }, { code: 'sync', name: 'Sync', seats: 1, monthly_paise: 16900, yearly_paise: 99900, trial_paise: null, trial_days: null, active: true }],
    offers: [{ id: 1, kind: 'coupon', code: 'LAUNCH20', name: 'Launch', percent_off: 20, products: null, starts_at: '2026-01-01', ends_at: null, uses: 3, max_uses: 10, active: true }],
  };
  const v = new PricingView(fake({ pricing: () => pricing, updateSettings: () => pricing, updatePlan: () => pricing, saveOffer: () => pricing }), host);
  await v.load();
  const h = v.html();
  ok('A3 settings, plans and offers shown in rupees', h.includes('value="169"') && h.includes('value="999"') && h.includes('LAUNCH20') && h.includes('3 / 10') && h.includes('running'));
  const st = formOf(h, 'form[data-form="settings"]');
  st.form.querySelector('[name=payments_enabled]').checked = true;
  st.form.querySelector('[name=ai_pack]').value = '150';
  await v.act('settings', st.form, st.data());
  const sent = calls.find((c) => c[0] === 'updateSettings')?.[1];
  ok('A3 settings sent in paise, payment switched on', sent?.payments_enabled === true && sent.ai_pack_paise === 15000 && sent.ai_credit_paise === 10, JSON.stringify(sent));
  const pl = formOf(h, 'form[data-form="plan"]');
  pl.form.querySelector('[name=monthly]').value = '179';
  pl.form.querySelector('[name=yearly]').value = '';
  await v.act('plan', pl.form, pl.data());
  const plan = calls.find((c) => c[0] === 'updatePlan');
  ok('A3 a plan price in paise; an emptied price stops selling it', plan[1] === 'sync' && plan[2].monthly_paise === 17900 && plan[2].yearly_paise === null);
  const of = formOf(h, 'form[data-form="offer"]');
  const set = (n, val) => { of.form.querySelector(`[name=${n}]`).value = val; };
  set('kind', 'coupon'); set('code', 'friends'); set('name', 'Friends'); set('how', 'percent'); set('value', '15');
  of.form.querySelector('[value=family_year]').checked = true;
  await v.act('offer', of.form, of.data());
  const coupon = calls.find((c) => c[0] === 'saveOffer')?.[1];
  ok('A3 a coupon: upper-case code, %, products', coupon?.code === 'FRIENDS' && coupon.percent_off === 15 && coupon.products.join() === 'family_year', JSON.stringify(coupon));
  set('kind', 'sale'); set('how', 'price'); set('value', '1199');
  calls.length = 0;
  await v.act('offer', of.form, of.data());
  ok('A3 a fixed-price sale on one product, in paise', calls[0]?.[1]?.sale_price_paise === 119900 && calls[0][1].kind === 'sale');
  of.form.querySelector('[value=sync_year]').checked = true;
  const err = await v.act('offer', of.form, of.data()).catch((e) => e);
  ok('A3 a fixed price on two products is refused before sending', err instanceof Error && /exactly one product/.test(err.message));
}

// A4
{
  calls.length = 0;
  const data = {
    batches: [{ id: 5, name: 'Batch 1', starts_on: '2026-12-07', capacity: 10, price_paise: 500000, status: 'open', confirmed: 1, offered: 0 }],
    applications: [
      { id: 1, full_name: 'First', email: 'f@x.com', whatsapp: '+91 98200 00000', status: 'waitlisted', created_at: '2026-11-01T10:00:00Z', goal: 'log daily', baseline_days: 2 },
      { id: 2, full_name: 'Second', email: 's@x.com', whatsapp: '+254 700 000000', status: 'waitlisted', created_at: '2026-11-02T10:00:00Z' },
      { id: 3, full_name: 'Third', email: 't@x.com', whatsapp: '+91 90000 00000', status: 'confirmed', batch_id: 5, created_at: '2026-10-01T10:00:00Z' },
    ],
  };
  let tracker = { days: [{ applicationId: 3, day: '2026-12-07', recorded: true }, { applicationId: 3, day: '2026-12-08', recorded: false }], calls: [] };
  const v = new ProgrammeView(fake({ programme: () => data, application: () => data, tracker: () => tracker, setDay: () => null, saveBatch: () => data }), host);
  await v.load();
  let h = v.html();
  ok('A4 waitlist in order, with profile and a WhatsApp link', h.indexOf('First') < h.indexOf('Second') && h.includes('#1') && h.includes('href="https://wa.me/919820000000"') && h.includes('log daily') && !h.includes('Third'));
  const o = formOf(h, 'form[data-form="offer"][data-id="1"]');
  await v.act('offer', o.form, o.data());
  ok('A4 offering a place sends the batch', JSON.stringify(calls.find((c) => c[0] === 'application')) === JSON.stringify(['application', 1, 'offer', { batchId: 5 }]));
  const part = document.createElement('button'); part.dataset.part = 'tracker';
  await v.act('part', part, null);
  h = v.html();
  ok('A4 tracker: 6 weeks of days for confirmed people, week totals', h.includes('W1') && h.includes('W6') && h.includes('Third') && h.includes('W1 1/7')
     && (h.match(/data-action="tick"/g) ?? []).length === 42);
  const box = document.createElement('div'); box.innerHTML = h;
  const yes = box.querySelector('td[data-day="2026-12-07"]'), no = box.querySelector('td[data-day="2026-12-08"]'), blank = box.querySelector('td[data-day="2026-12-09"]');
  ok('A4 a tap cycles ✓ → ✗ → blank', yes.dataset.next === 'false' && no.dataset.next === 'null' && blank.dataset.next === 'true' && yes.textContent === '✓' && no.textContent === '✗');
  await v.act('tick', blank, null);
  ok('A4 tapping saves that day', calls.some((c) => c[0] === 'setDay' && c[1] === 3 && c[2] === '2026-12-09' && c[3] === true));
  const nb = formOf(new ProgrammeView(fake(), host).html() || '', 'form');
  void nb;
}

// A5
{
  calls.length = 0;
  const root = document.createElement('div');
  let user = null, mine = null;
  const session = {
    user: async () => user, onChange: () => {}, signIn: async () => { calls.push(['signIn']); },
    rpc: async (name, args) => { calls.push([name, args]); if (name === 'pocket_programme_apply') { mine = { id: 9, status: 'waitlisted', fullName: args.p.fullName, whatsapp: args.p.whatsapp }; } return mine; },
    invoker: () => async (fn, opts) => { calls.push(['invoke', fn, opts.body]); return { data: opts.body.action === 'order' ? { orderId: 'o1', amount: 450000 } : { ok: true, applied: true }, error: null }; },
    signOut: async () => {},
  };
  const checkout = { open: async (o) => ({ orderId: o.orderId, paymentId: 'pay_9', signature: 's' }) };
  const page = new ProgrammePage(session, root, checkout);
  await page.start();
  ok('A5 signed out: a sign-in button', root.innerHTML.includes('data-action="sign-in"'));
  user = { id: 'u1', email: 'me@x.com', user_metadata: { full_name: 'Me Myself' } };
  await page.start();
  ok('A5 signed in, no application: the form, name filled from Google, consent required', root.querySelector('#programmeForm') && root.querySelector('[name=fullName]').value === 'Me Myself' && root.querySelector('[name=consent]').required);
  root.querySelector('[name=whatsapp]').value = '+91 98200 11111';
  root.querySelector('[name=consent]').checked = true;
  root.querySelector('#programmeForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 10));
  const applied = calls.find((c) => c[0] === 'pocket_programme_apply')?.[1]?.p;
  ok('A5 the profile and consent are sent; the page shows the waitlist', applied?.fullName === 'Me Myself' && applied.whatsapp === '+91 98200 11111' && applied.consent === true && root.innerHTML.includes('on the waitlist'), JSON.stringify(applied));
  mine = { id: 9, status: 'offered', fullName: 'Me Myself', whatsapp: '+91 98200 11111', paymentsOpen: true, batch: { name: 'Batch 1', startsOn: '2026-12-07', pricePaise: 500000 } };
  await page.start();
  ok('A5 an offered place shows the batch, the date and Pay ₹5,000', root.innerHTML.includes('Batch 1') && root.innerHTML.includes('7 December 2026') && root.innerHTML.includes('Pay ₹5,000'));
  root.querySelector('#programmeCode').value = 'friends';
  root.querySelector('[data-action="pay"]').click();
  await new Promise((r) => setTimeout(r, 20));
  const order = calls.find((c) => c[0] === 'invoke' && c[2].action === 'order');
  ok('A5 paying orders the programme with the code, then verifies', order?.[2].product === 'programme' && order[2].code === 'friends' && calls.some((c) => c[0] === 'invoke' && c[2].action === 'verify'));
}

// A6
{
  const root = document.createElement('div');
  const session = { user: async () => ({ id: 'x', email: 'someone@x.com' }), rpc: async (n) => (n === 'pocket_is_admin' ? false : null), signIn: async () => {}, signOut: async () => {} };
  await new AdminApp(session, root).start();
  ok('A6 a non-admin is told so and sees nothing else', root.innerHTML.includes("isn't an admin") && !root.innerHTML.includes('nav-item'));
  const root2 = document.createElement('div');
  const s2 = { user: async () => ({ id: 'a', email: 'admin@x.com' }), rpc: async (n) => (n === 'pocket_is_admin' ? true : n === 'pocket_adm_stats' ? { plans: {}, programme: {}, signupsByWeek: [], revenueByMonth: [] } : []), signIn: async () => {}, signOut: async () => {} };
  await new AdminApp(s2, root2).start();
  ok('A6 an admin gets the six tabs and the overview', (root2.innerHTML.match(/class="nav-item/g) ?? []).length === 6 && root2.innerHTML.includes('Signed up'));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
