/**
 * dollars.smoke.mjs — prices in US dollars outside India's time zone (0059).
 *
 *   D1  Money: India's time zone (or none) is rupees, anywhere else dollars;
 *       amounts are written in their own currency.
 *   D2  PaymentService asks for dollars outside India, nothing extra in India.
 *   D3  PlanCard: dollar offers show as dollars, with the dollar fine print;
 *       before offers load, the dollar list prices show.
 *   D4  The promise reads "$1" outside India, "₹30" in India.
 *   D5  WebPrices: the homepage and programme page switch every marked price
 *       to dollars outside India and leave India alone; no rupee price is
 *       left in the pricing or programme sections.
 *
 * Run: node src/__smoke__/dollars.smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { Money } from '../core/Money.js';
import { PaymentService } from '../domain/billing/PaymentService.js';
import { Entitlements } from '../domain/billing/Entitlements.js';
import { EntryAccess } from '../domain/billing/EntryAccess.js';
import { PlanCard } from '../ui/components/PlanCard.js';
import { WebPrices } from '../web/WebPrices.js';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nDollars suite');

// D1
ok('D1 India\'s time zones are rupees', Money.currency('Asia/Kolkata') === 'INR' && Money.currency('Asia/Calcutta') === 'INR');
ok('D1 an unreadable time zone counts as India', Money.currency('') === 'INR');
ok('D1 anywhere else is dollars', Money.currency('America/New_York') === 'USD' && Money.currency('Asia/Dubai') === 'USD' && Money.currency('Europe/London') === 'USD');
ok('D1 written in their own currency', Money.format(2499, 'USD') === '$24.99' && Money.format(200, 'USD') === '$2' && Money.format(99900, 'INR') === '₹999');

Money.zoneOverride = 'America/Chicago';
{
  const sent = [];
  const invoke = async (_n, { body }) => {
    sent.push(body);
    if (body.action === 'order') return { data: { orderId: 'o', amount: 299, currency: 'USD', keyId: 'k', name: 'x' }, error: null };
    if (body.action === 'verify') return { data: { ok: true, applied: true }, error: null };
    return { data: { keyId: 'k', currency: 'USD', products: [] }, error: null };
  };
  const pay = new PaymentService(() => invoke, { open: async (o) => ({ orderId: o.orderId, paymentId: 'p', signature: 's' }) });
  const offers = await pay.offers();
  await pay.buy('family_month');
  ok('D2 outside India: products and order ask for dollars', sent[0].currency === 'USD' && sent[1].currency === 'USD' && offers.currency === 'USD');
  Money.zoneOverride = 'Asia/Kolkata';
  sent.length = 0;
  await pay.offers();
  ok('D2 in India nothing extra is sent', !('currency' in sent[0]));
  Money.zoneOverride = 'America/Chicago';
}

// D3
{
  const catalogue = [
    { code: 'free', name: 'Free', sort: 0 },
    { code: 'family', name: 'Pocket Pro', seats: 5, sync: true, telegram: true, sharing: true, monthly_paise: 9900, yearly_paise: 99900, trial_paise: 14900, trial_days: 90, sort: 2 },
    { code: 'group', name: 'Pocket Pro Group', seats: 5, sync: true, telegram: true, sharing: true, monthly_paise: null, yearly_paise: 199900, group_size: 3, sort: 3 },
  ];
  const usdOffers = { keyId: 'k', currency: 'USD', switches: {}, coupon: null, products: [
    { product: 'family_trial', plan: 'family', term: 'trial', amountPaise: 399, currency: 'USD', available: true },
    { product: 'family_month', plan: 'family', term: 'month', amountPaise: 299, currency: 'USD', available: true },
    { product: 'family_year', plan: 'family', term: 'year', amountPaise: 2499, currency: 'USD', available: true },
    { product: 'group_year', plan: 'group', term: 'year', amountPaise: 4999, currency: 'USD', available: true },
    { product: 'drive_backup', addon: 'drive_backup', amountPaise: 499, currency: 'USD', available: true },
    { product: 'ai_pack', aiCredits: 500, amountPaise: 200, currency: 'USD', available: true },
  ] };
  const card = new PlanCard();
  const free = Entitlements.from({ plan: 'free', state: 'free', paymentsOpen: true });
  const year = card.html(free, catalogue, usdOffers);
  const month = card.html(free, catalogue, usdOffers, null, '', { term: 'month' });
  ok('D3 plans in dollars', year.includes('Get Pocket Pro · $24.99') && year.includes('Get Pocket Pro Group · $49.99') && month.includes('Get Pocket Pro · $2.99'), year.match(/Get Pocket Pro[^<]*/g)?.join(' | '));
  ok('D3 about … a month in dollars', /about \$2\.08 a month/.test(year));
  ok('D3 the trial, Pocket Plus and AI pack in dollars', year.includes('first 3 months for $3.99') && year.includes('>$4.99<') && year.includes('$2'));
  ok('D3 the fine print says US dollars and one-time', /in US dollars/.test(year) && !/auto-debit through Razorpay \(UPI/.test(year));
  ok('D3 no rupees anywhere in the dollar plan card', !year.includes('₹') && !month.includes('₹'), (year + month).match(/.{30}₹.{20}/)?.[0]);
  const loading = card.html(free, catalogue, null);
  ok('D3 before offers load: the dollar list prices', loading.includes('$24.99') && !loading.includes('₹'), loading.match(/.{20}₹.{20}/)?.[0]);
  ok('D3 the yearly saving works out from dollar prices', /save 30% vs monthly/.test(card.html(free, catalogue, null)));
}

// D4
{
  const a = EntryAccess.from({ required: true, why: 'none', promisePaise: 3000, promiseCredits: 150 });
  ok('D4 the promise is $1 outside India', a.promisePrice === '$1');
  const { PromiseModal } = await import('../ui/modals/PromiseModal.js');
  ok('D4 the dollar wording has no "₹1 a day" line', !/a day/.test(PromiseModal.why('$1', 150, null)) && /Each month your \$1 returns/.test(PromiseModal.why('$1', 150, null)));
  Money.zoneOverride = 'Asia/Kolkata';
  ok('D4 and ₹30 in India', a.promisePrice === '₹30');
  Money.zoneOverride = 'America/Chicago';
}

// D5
for (const page of ['index.html', 'programme.html']) {
  const html = readFileSync(new URL(`../../${page}`, import.meta.url), 'utf8');
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const marked = doc.querySelectorAll('[data-usd]').length;
  const india = new WebPrices(doc).apply('INR');
  ok(`D5 ${page}: India is left as written`, !india && doc.querySelector('[data-usd]').textContent.includes('₹'));
  ok(`D5 ${page}: every marked price switches to dollars`, new WebPrices(doc).apply('USD') && marked > 0
     && [...doc.querySelectorAll('[data-usd]')].every((el) => !el.textContent.includes('₹') && /\$|US dollars/.test(el.textContent)));
  const sections = page === 'index.html' ? ['#pricing', '#programme'] : ['body'];
  const left = sections.flatMap((sel) => [...doc.querySelectorAll(`${sel} *`)]
    .filter((el) => !el.children.length && el.textContent.includes('₹') && !el.closest('[data-promise-price]') && !el.closest('[data-promise-why]') && !el.closest('script')))
    .map((el) => el.textContent.trim().slice(0, 60));
  ok(`D5 ${page}: no rupee price left in the pricing and programme sections`, !left.length, left.join(' | '));
}

Money.zoneOverride = null;
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
