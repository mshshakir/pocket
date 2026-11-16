/**
 * investments.smoke.mjs — gold and silver: grams, average cost, worth, alerts.
 *
 *   G1  stats: opening + buys − sales, average cost, realised gain on a sale
 *   G2  worth at the latest price; gain and gain %; a sale at a profit
 *   G3  alert: 20% on average cost → target price; reached once; dismissed until a new target
 *   G4  account adjustment = worth − what the entries did to its balance
 *   A1  Add (I already own it): makes an "Investments" account, no entry, worth counted
 *   A2  Add (Buying now) and Buy: a transfer bank → Investments with grams on the invest leg
 *   A3  Sell: a transfer back with −grams; can't sell more than held
 *   A4  Price: updating it changes worth, Dashboard total and net worth — not the balance
 *   A5  alert reached shows on the tab and the Dashboard; Got it hides it
 *   A6  the tab is in the menu; deleting a buy from History undoes it; help explains it
 *   A7  silver works the same, with 999/925
 *   S1  shares: charges count in cost and come off a sale; dividends tracked apart from trades
 *   S2  in the app: add shares (company, code), buy with charges, dividend → income in Dividends
 *   S3  shares wording only: per share, no other investment words on the tab
 *
 * Run: node src/__smoke__/investments.smoke.mjs
 */
import { HoldingService } from '../domain/services/HoldingService.js';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nInvestments suite');

const fx = { convert: (m) => m, convertStrict: (m) => m };
{
  const state = {
    user: { homeCurrency: 'INR' },
    accounts: [{ id: 'inv', type: 'invest', currency: 'INR' }, { id: 'bank', type: 'bank', currency: 'INR' }],
    holdings: [{ id: 'g', accountId: 'inv', kind: 'gold', purity: '24k', name: '24k gold', currency: 'INR',
      openingQty: 20, openingCost: 14000000, prices: [{ date: '2026-11-01', price: 720000 }], alert: { gainPct: 20 } }],
    transactions: [
      { id: 'b1', type: 'transfer', transferDir: 'in', accountId: 'inv', amount: 7400000, currency: 'INR', date: '2026-11-02', holdingId: 'g', qty: 10, unitPrice: 740000 },
      { id: 's1', type: 'transfer', transferDir: 'out', accountId: 'inv', amount: 3900000, currency: 'INR', date: '2026-11-05', holdingId: 'g', qty: -5, unitPrice: 780000 },
    ],
  };
  const svc = new HoldingService({ state: () => state, fx });
  const h = state.holdings[0];
  let st = svc.stats(h);
  // 20 g at 7,000 + 10 g at 7,400 = 30 g, cost 2,14,000 → avg 7,133.33; sell 5 g → cost out 35,667, proceeds 39,000
  ok('G1 25 g held after 20 owned + 10 bought − 5 sold', st.qty === 25, String(st.qty));
  ok('G1 average cost ₹7,133.33/g; cost of what\'s held ₹1,78,333', st.avgCost === 713333 && st.cost === 17833333, `${st.avgCost} ${st.cost}`);
  ok('G1 realised gain on the sale ₹3,333', st.realised === 333333, String(st.realised));
  ok('G2 worth at ₹7,200/g = ₹1,80,000; gain ₹1,667 (+0.9%)', st.worth === 18000000 && st.gain === 166667 && st.gainPct === 0.9, JSON.stringify({ w: st.worth, g: st.gain, p: st.gainPct }));
  ok('G3 20% alert → target ₹8,560/g, not reached yet', st.target === 856000 && !st.reached && !st.alertNew);
  svc.setPrice(h, '2026-11-10', 860000);
  st = svc.stats(h);
  ok('G3 at ₹8,600 the alert is reached and new', st.reached && st.alertNew && svc.alerts().length === 1);
  svc.ackAlert(h);
  ok('G3 Got it: no longer new', !svc.stats(h).alertNew && svc.alerts().length === 0);
  svc.setAlert(h, { gainPct: 25 });
  ok('G3 a new goal (25%) waits again', svc.stats(h).target === 891666 && !svc.stats(h).reached);
  svc.setAlert(h, { targetPrice: 850000 });
  ok('G3 a target price works too and is reached', svc.stats(h).target === 850000 && svc.stats(h).alertNew);
  // ledgerNet = +74,000 − 39,000 = 35,000; worth 25 × 8,600 = 2,15,000 → adjustment 1,80,000
  ok('G4 account adjustment = worth − ledger effect', svc.adjustmentFor('inv') === 21500000 - 3500000, String(svc.adjustmentFor('inv')));
  ok('G4 setPrice replaces a day\'s price and keeps order', (svc.setPrice(h, '2026-11-10', 861000), h.prices.length === 2 && h.prices[1].price === 861000));
}

// ── in the app ────────────────────────────────────────────────────────────
const bundleSrc = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function boot() {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
      <div id="viewContent"></div><div id="sidebarNav"></div><div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
    </body></html>`, { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  window.localStorage.setItem('pocket.v1', JSON.stringify({
    user: { homeCurrency: 'INR', defaultCurrency: 'INR', theme: 'light', showHijri: false, hijriOffset: 0, customPaymentTypes: [], hiddenPaymentTypes: [], defaultAccountId: 'bank' },
    accounts: [{ id: 'bank', name: 'HDFC', currency: 'INR', type: 'bank', color: '#3b82f6', icon: 'landmark', openingBalance: 50000000, balance: 50000000 }],
    categories: [], transactions: [], budgets: [], debts: [], family: [], merchantCategories: {}, accountGroups: [], regularItems: [],
  }));
  window.__charts = [];
  window.lucide = { createIcons() {} };
  window.Chart = function (ctx, cfg) { window.__charts.push(cfg); return { destroy() {} }; };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.fetch = () => Promise.reject(new Error('offline'));
  window.confirm = () => true;
  window.alert = () => {};
  window.eval(bundleSrc);
  return window;
}
const w = boot();
await wait(100);
const app = w.__app;
const st = () => app.store.getState();
const view = () => w.document.getElementById('viewContent');
const form = () => w.document.querySelector('form.investment-form, form.trade-form, form.price-form');
const fill = (f, values) => { for (const [k, v] of Object.entries(values)) { const el = f.querySelector(`[name="${k}"]`); if (el.type === 'radio') f.querySelector(`[name="${k}"][value="${v}"]`).checked = true; else if (el.type === 'checkbox') el.checked = !!v; else el.value = v; } };

{
  app.openModal('investment');
  await wait(10);
  let f = form();
  fill(f, { kind: 'gold', purity: '22k', how: 'own', grams: '20', price: '7000', paid: '130000', gainPct: '20' });
  app.submitInvestment({ preventDefault() {}, target: f }, '');
  await wait(10);
  const inv = st().accounts.find((a) => a.type === 'invest');
  const h = st().holdings?.[0];
  ok('A1 an "Investments" account was made; 22k gold, 20 g owned, ₹1,30,000 paid, price ₹7,000', inv?.name === 'Investments' && h?.purity === '22k' && h.openingQty === 20 && h.openingCost === 13000000 && h.prices[0].price === 700000 && h.name === '22k gold', JSON.stringify(h));
  ok('A1 no entry was made (nothing moved)', st().transactions.length === 0);
  ok('A1 the account is worth ₹1,40,000 (20 g × ₹7,000), its balance stays 0', app.accountWorth(inv) === 14000000 && Math.round(inv.balance) === 0);

  app.openModal('trade', { id: h.id, mode: 'buy' });
  await wait(10);
  f = form();
  fill(f, { grams: '10', price: '7200', other: 'bank', setPrice: true });
  app.submitTrade({ preventDefault() {}, target: f }, h.id, 'buy');
  await wait(10);
  const legs = st().transactions;
  const invLeg = legs.find((t) => t.accountId === inv.id);
  ok('A2 Buy: a transfer HDFC → Investments for ₹72,000', legs.length === 2 && legs.every((t) => t.type === 'transfer' && t.amount === 7200000) && invLeg?.transferDir === 'in');
  ok('A2 the Investments leg carries the grams and price', invLeg.holdingId === h.id && invLeg.qty === 10 && invLeg.unitPrice === 720000);
  ok('A2 HDFC down ₹72,000; 30 g held; price now ₹7,200', Math.round(st().accounts.find((a) => a.id === 'bank').balance) === 50000000 - 7200000 && app.holdings.stats(h).qty === 30 && app.holdings.stats(h).price === 720000);

  app.openModal('trade', { id: h.id, mode: 'sell' });
  await wait(10);
  f = form();
  fill(f, { grams: '50', price: '7300', other: 'bank' });
  app.submitTrade({ preventDefault() {}, target: f }, h.id, 'sell');
  await wait(10);
  ok('A3 can\'t sell more than held', st().transactions.length === 2);
  fill(f, { grams: '5', price: '7300', other: 'bank', setPrice: false });
  app.submitTrade({ preventDefault() {}, target: f }, h.id, 'sell');
  await wait(10);
  const sale = st().transactions.find((t) => t.accountId === inv.id && t.qty < 0);
  ok('A3 Sell: transfer Investments → HDFC ₹36,500 with −5 g', sale && sale.transferDir === 'out' && sale.amount === 3650000 && sale.qty === -5 && app.holdings.stats(h).qty === 25);

  const before = app.accountWorth(inv);
  const balBefore = Math.round(st().accounts.find((a) => a.id === inv.id).balance);
  app.openModal('holdingPrice', { id: h.id });
  await wait(10);
  f = form();
  fill(f, { price: '9000', alertBy: 'pct', gainPct: '20' });
  app.submitHoldingPrice({ preventDefault() {}, target: f }, h.id);
  await wait(10);
  ok('A4 price ₹9,000: worth up by 25 g × ₹1,800, balance unchanged', app.accountWorth(inv) - before === 25 * 180000 && Math.round(st().accounts.find((a) => a.id === inv.id).balance) === balBefore);
  app.navigate('dashboard');
  await wait(10);
  const total = 50000000 - 7200000 + 3650000 + app.accountWorth(inv);
  ok('A4 Dashboard total uses today\'s worth', view().querySelector('.text-3xl')?.textContent.replace(/[^0-9.]/g, '') === (total / 100).toFixed(2), `${total} · ${view().querySelector('.text-3xl')?.textContent}`);
  w.__charts.length = 0;
  app.navigate('reports');
  await wait(30);
  const series = w.__charts.flatMap((c) => c?.data?.datasets || []).map((d) => d.data).filter((d) => Array.isArray(d) && d.length);
  ok('A4 net worth in Reports ends at the same total', series.some((d) => Math.round(d.at(-1) * 100) === total), JSON.stringify(series.map((d) => d.at(-1))));

  app.navigate('dashboard');
  await wait(10);
  ok('A5 Dashboard: "22k gold is up …%" with Got it', /22k gold<\/b> is up/.test(view().querySelector('.inv-dash-alert')?.innerHTML || ''));
  app.navigate('investments');
  await wait(10);
  ok('A5 the tab shows the alert banner and "reached" on the card', !!view().querySelector('.inv-alert') && /reached/.test(view().querySelector('.inv-target')?.textContent || ''));
  app.ackInvestmentAlert(h.id);
  await wait(10);
  ok('A5 Got it hides it on the tab and the Dashboard', !view().querySelector('.inv-alert') && (app.navigate('dashboard'), !view().querySelector('.inv-dash-alert')));

  ok('A6 Investments is in the menu', /Investments/.test(w.document.getElementById('sidebarNav').textContent));
  app.navigate('investments');
  await wait(10);
  ok('A6 summary shows worth, invested and gain', /Worth now/.test(view().querySelector('.inv-summary')?.textContent || '') && /Invested/.test(view().querySelector('.inv-summary').textContent));
  const buyLeg = st().transactions.find((t) => t.accountId === inv.id && t.qty > 0);
  app.deleteTx(buyLeg.id, { confirm: false });
  await wait(10);
  ok('A6 deleting the buy (from History) removes both legs and the 10 g', !st().transactions.some((t) => t.id === buyLeg.id || t.id === buyLeg.transferPairId) && app.holdings.stats(h).qty === 15);
  app.openHelp('investments');
  await wait(10);
  ok('A6 help explains Add, Buy/Sell, Price and alerts', ['I already own it', 'Bought', 'Sold', 'Price', '20%'].every((k) => w.document.querySelector('.help-sheet').textContent.includes(k)));
  app.closeModal();

  app.openModal('investment');
  await wait(10);
  f = form();
  const silver = f.querySelector('[name="kind"][value="silver"]');
  silver.checked = true; app.onHoldingKindChange(silver);
  const purities = [...f.querySelectorAll('[name="purity"] option')].map((o) => o.value).join();
  ok('A7 silver offers 999 and 925', purities === '999,925', purities);
  const how = f.querySelector('[name="how"][value="buy"]');
  how.checked = true; app.onHoldingHowChange(how);
  fill(f, { purity: '999', grams: '100', price: '95', payFrom: 'bank', accountId: inv.id });
  app.submitInvestment({ preventDefault() {}, target: f }, '');
  await wait(10);
  const s = st().holdings.find((x) => x.kind === 'silver');
  ok('A7 Buying now: 999 silver, 100 g via a ₹9,500 transfer into the same account', s && s.accountId === inv.id && app.holdings.stats(s).qty === 100 && st().transactions.some((t) => t.holdingId === s.id && t.amount === 950000));
  app.navigate('investments');
  await wait(10);
  ok('A7 the tab groups Gold and Silver', !!view().querySelector('.inv-group[data-kind="gold"]') && !!view().querySelector('.inv-group[data-kind="silver"]'));
  ok('A7 no piggy-bank icon anywhere', !/piggy/.test(bundleSrc));
}

{
  // S1 — shares maths
  const state = {
    user: { homeCurrency: 'INR' },
    accounts: [{ id: 'inv', type: 'invest', currency: 'INR' }],
    holdings: [{ id: 'tcs', accountId: 'inv', kind: 'shares', code: 'TCS', name: 'Tata Consultancy Services', unit: 'shares', currency: 'INR', prices: [{ date: '2026-11-10', price: 420000 }] }],
    transactions: [
      { id: 'b', type: 'transfer', transferDir: 'in', accountId: 'inv', amount: 2000000 + 2000, currency: 'INR', date: '2026-11-01', holdingId: 'tcs', qty: 5, unitPrice: 400000 },
      { id: 's', type: 'transfer', transferDir: 'out', accountId: 'inv', amount: 860000 - 1000, currency: 'INR', date: '2026-11-08', holdingId: 'tcs', qty: -2, unitPrice: 430000 },
      { id: 'd', type: 'income', accountId: 'bank', amount: 15000, currency: 'INR', date: '2026-11-09', holdingId: 'tcs', qty: null },
    ],
  };
  const svc = new HoldingService({ state: () => state, fx });
  const st = svc.stats(state.holdings[0]);
  // cost 20,020 for 5 → avg 4,004; sell 2 → cost out 8,008; proceeds 8,590 → realised 582
  ok('S1 3 shares left; average cost ₹4,004 (charges included)', st.qty === 3 && st.avgCost === 400400, `${st.qty} ${st.avgCost}`);
  ok('S1 realised ₹582 after ₹10 charges on the sale', st.realised === 58200, String(st.realised));
  ok('S1 the dividend (qty null after sync) isn\'t a trade; ₹150 received', svc.entries('tcs').length === 2 && st.dividends === 15000);
  ok('S1 worth 3 × ₹4,200 = ₹12,600; "3 shares" / "1 share"', st.worth === 1260000 && HoldingService.qtyText(state.holdings[0], 3) === '3 shares' && HoldingService.qtyText(state.holdings[0], 1) === '1 share');
}
{
  // S2 — shares in the app
  app.openModal('investment');
  await wait(10);
  let f = form();
  const sh = f.querySelector('[name="kind"][value="shares"]');
  sh.checked = true; app.onHoldingKindChange(sh);
  ok('S2 Shares shows Company and Code, hides purity; labels say Shares and / share',
    f.querySelector('[data-kind-only="shares"]').style.display === '' && f.querySelector('[data-kind-only="metal"]').style.display === 'none'
    && f.querySelector('[data-qty-label]').textContent === 'Shares' && [...f.querySelectorAll('[data-per]')].every((e) => e.textContent === 'share'));
  const how = f.querySelector('[name="how"][value="buy"]');
  how.checked = true; app.onHoldingHowChange(how);
  fill(f, { company: '', grams: '10', price: '4000', payFrom: 'bank' });
  const n0 = st().holdings.length;
  app.submitInvestment({ preventDefault() {}, target: f }, '');
  await wait(10);
  ok('S2 a company name is needed', st().holdings.length === n0);
  fill(f, { company: 'Tata Consultancy Services', code: 'tcs', grams: '10', price: '4000', charges: '20', payFrom: 'bank' });
  app.submitInvestment({ preventDefault() {}, target: f }, '');
  await wait(10);
  const h = st().holdings.find((x) => x.kind === 'shares');
  const leg = st().transactions.find((t) => t.holdingId === h?.id && t.type === 'transfer' && t.qty > 0);
  ok('S2 TCS shares added; bought 10 for ₹40,020 (₹20 charges)', h && h.code === 'TCS' && h.name === 'Tata Consultancy Services' && h.unit === 'shares' && leg?.amount === 4002000 && leg.qty === 10);
  ok('S2 average cost ₹4,002 / share', app.holdings.stats(h).avgCost === 400200);
  app.openModal('trade', { id: h.id, mode: 'dividend' });
  await wait(10);
  f = form();
  fill(f, { amount: '250', other: 'bank' });
  app.submitTrade({ preventDefault() {}, target: f }, h.id, 'dividend');
  await wait(10);
  const div = st().transactions.find((t) => t.holdingId === h.id && t.type === 'income');
  const cat = st().categories.find((c) => c.id === div?.categoryId);
  ok('S2 dividend: ₹250 income into HDFC, category Dividends', div && div.amount === 25000 && div.accountId === 'bank' && cat?.name === 'Dividends' && cat.type === 'income');
  app.openModal('trade', { id: h.id, mode: 'sell' });
  await wait(10);
  f = form();
  fill(f, { grams: '4', price: '4500', charges: '10', other: 'bank', setPrice: true });
  app.updateTradeTotal(f);
  ok('S2 sell total: 4 shares × ₹4,500 − ₹10 charges = ₹17,990', /4 shares × .*4,500.* − .*10.* charges = .*17,990/.test(f.querySelector('.trade-total').textContent), f.querySelector('.trade-total').textContent);
  app.submitTrade({ preventDefault() {}, target: f }, h.id, 'sell');
  await wait(10);
  const hs = app.holdings.stats(h);
  ok('S2 6 shares left; realised ₹1,982; dividends ₹250', hs.qty === 6 && hs.realised === 198200 && hs.dividends === 25000, JSON.stringify({ q: hs.qty, r: hs.realised, d: hs.dividends }));
  app.navigate('investments');
  await wait(10);
  const card = view().querySelector(`[data-holding="${h.id}"]`);
  ok('S2 card: "6 shares · TCS", price / share, dividends received, a Dividend button', /6 shares · TCS/.test(card.querySelector('.inv-qty').textContent) && /\/ share/.test(card.querySelector('.inv-price').textContent) && /Dividends received/.test(card.textContent) && !!card.querySelector('.inv-dividend-btn'));
  ok('S2 History lists the dividend', /Dividend/.test(card.querySelector('details').textContent));
  const text = view().textContent;
  ok('S3 the tab says shares only — no other investment words', /Shares/.test(text) && !/stock|mutual|equity|\bindex\b|market|exchange|nifty|sensex/i.test(text));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
