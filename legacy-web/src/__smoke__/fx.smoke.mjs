/**
 * fx.smoke.mjs — cross-currency correctness for transfers and foreign-currency
 * transactions (audit findings H4 and H5).
 *
 *  H4  The FX panel quoted a source-account → destination-account rate while
 *      the amount was read in whatever the currency dropdown held (the user's
 *      default). A 10,000 INR transfer debited ₹831,200 and credited AED 441.89
 *      — legs roughly $9,880 apart.
 *  H5  autoRate.toFixed(6) was written into the rate field and then booked
 *      verbatim. On high-magnitude pairs the truncation is material:
 *      100,000,000 LBP → USD booked $1,100.00 against an exact $1,117.32.
 *
 * Run:  node src/__smoke__/fx.smoke.mjs
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

// Units per 1 USD, matching data/constants.js.
const RATE = { USD: 1, INR: 83.12, AED: 3.673, LBP: 89500, EUR: 0.92, JPY: 151 };

const acct = (id, name, currency) => ({
  id, name, currency, groupId: null, type: 'bank', color: '#3b82f6',
  icon: 'landmark', openingBalance: 0, balance: 0,
});

const baseState = () => ({
  // Home/default currency is USD while the accounts are NOT — this mismatch is
  // precisely what H4 needed to surface.
  user: { homeCurrency: 'USD', defaultCurrency: 'USD', theme: 'light', showHijri: false,
          hijriOffset: 0, customPaymentTypes: [], hiddenPaymentTypes: [] },
  accounts: [
    acct('inr', 'India Savings', 'INR'),
    acct('aed', 'Dubai Card',    'AED'),
    acct('lbp', 'Beirut Cash',   'LBP'),
    acct('usd', 'US Checking',   'USD'),
  ],
  categories: [{ id: 'c1', name: 'Food', type: 'expense', parentId: null, color: '#f97316', icon: 'tag' }],
  transactions: [], budgets: [], debts: [], family: [], regularItems: [],
  merchantCategories: {}, accountGroups: [],
});

function boot(state) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
       <div id="viewContent"></div><div id="sidebarNav"></div>
       <div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
     </body></html>`,
    { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  window.localStorage.setItem('pocket.v1', JSON.stringify(state));
  window.lucide = { createIcons() {} };
  window.Chart  = function () { return { destroy() {} }; };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.fetch   = () => Promise.reject(new Error('offline'));
  window.confirm = () => true;
  window.alert   = () => {};
  window.eval(bundleSrc);
  return window;
}

console.log('\nFX correctness suite');

// ═══ H4 — the two legs of a cross-currency transfer must reconcile ══════════
{
  const w = boot(baseState());
  await wait(80);
  const app = w.__app, doc = w.document, $ = (s) => doc.querySelector(s);
  const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));

  app.openModal('transaction', {});
  await wait(20);
  app.setTxType('transfer');
  await wait(30);

  ok('H4 the currency field is locked on a transfer',
     !!$('#txCurrencyLocked') && !$('#txForm select[name=currency]'),
     'currency dropdown still editable');

  // Pick INR → AED. The source select drives the locked currency.
  $('#txForm [name=accountId]').value = 'inr';
  app.onTransferSourceChange('inr');
  await wait(20);
  $('#txForm [name=transferToAccountId]').value = 'aed';
  app.updateTransferFxPanel(false);
  await wait(20);

  ok('H4 the locked currency follows the source account',
     $('#txCurrencyLocked')?.value === 'INR', $('#txCurrencyLocked')?.value);

  $('#txForm [name=amount]').value = '10000';   // ₹10,000
  app.updateTransferFxPanel(false);
  await wait(20);
  await app.submitTx({ preventDefault() {}, target: $('#txForm') }, '');
  await wait(60);

  const txs  = saved().transactions;
  const out  = txs.find((t) => t.transferDir === 'out');
  const into = txs.find((t) => t.transferDir === 'in');
  ok('H4 both legs written', !!out && !!into, `${txs.length} rows`);
  ok('H4 the source leg is denominated in the SOURCE account currency',
     out?.currency === 'INR', out?.currency);
  ok('H4 the source leg debits exactly what was typed',
     out?.amount === 1000000, String(out?.amount));   // ₹10,000.00 in minor units
  ok('H4 the destination leg is in the destination currency',
     into?.currency === 'AED', into?.currency);

  // The two legs must be worth the same in USD, within rounding.
  const usdOut = (out.amount / 100) / RATE.INR;
  const usdIn  = (into.amount / 100) / RATE.AED;
  ok('H4 the legs reconcile in USD (the ~$9,880 gap is gone)',
     Math.abs(usdOut - usdIn) < 0.02,
     `out $${usdOut.toFixed(2)} vs in $${usdIn.toFixed(2)}`);

  const expectedAed = (10000 / RATE.INR) * RATE.AED;
  ok('H4 the credited amount matches the quoted rate',
     Math.abs(into.amount / 100 - expectedAed) < 0.02,
     `${(into.amount / 100).toFixed(2)} vs ${expectedAed.toFixed(2)} AED`);
  w.close();
}

// ═══ H5 — an untouched auto rate must book at full precision ════════════════
{
  const w = boot(baseState());
  await wait(80);
  const app = w.__app, doc = w.document, $ = (s) => doc.querySelector(s);
  const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));

  app.openModal('transaction', {});
  await wait(20);
  app.setTxType('transfer');
  await wait(30);
  $('#txForm [name=accountId]').value = 'lbp';
  app.onTransferSourceChange('lbp');
  await wait(20);
  $('#txForm [name=transferToAccountId]').value = 'usd';
  // Drive it as the markup does: the To <select> fires resetTransferFx(), which
  // re-quotes the rate for the NEW pair. Calling updateTransferFxPanel() here
  // instead left the field holding the PREVIOUS pair's rate — that panel
  // deliberately preserves a non-empty rate so editing the amount can't wipe a
  // hand-typed one — so the leg booked LBP→INR on an LBP→USD transfer and the
  // assertion below failed against the app rather than against a real defect.
  app.resetTransferFx();
  await wait(20);
  $('#txForm [name=amount]').value = '100000000';   // 100,000,000 LBP
  app.updateTransferFxPanel(false);
  await wait(20);

  const shown = parseFloat($('#fxRate')?.value);
  ok('H5 the panel displays a 6dp rate', Number.isFinite(shown), String(shown));

  await app.submitTx({ preventDefault() {}, target: $('#txForm') }, '');
  await wait(60);

  const into  = saved().transactions.find((t) => t.transferDir === 'in');
  const exact = 100000000 / RATE.LBP;                 // $1,117.318...
  const trunc = 100000000 * Number((1 / RATE.LBP).toFixed(6)); // $1,100.00
  const got   = into.amount / 100;

  ok('H5 booked at the exact rate, not the 6dp rendering',
     Math.abs(got - exact) < 0.02, `booked $${got.toFixed(2)}, exact $${exact.toFixed(2)}`);
  ok('H5 the old truncated value is NOT what was booked',
     Math.abs(got - trunc) > 1, `booked $${got.toFixed(2)}, truncated would be $${trunc.toFixed(2)}`);
  w.close();
}

// ═══ A user-entered rate must still win ═════════════════════════════════════
{
  const w = boot(baseState());
  await wait(80);
  const app = w.__app, doc = w.document, $ = (s) => doc.querySelector(s);
  const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));

  app.openModal('transaction', {});
  await wait(20);
  app.setTxType('transfer');
  await wait(30);
  $('#txForm [name=accountId]').value = 'usd';
  app.onTransferSourceChange('usd');
  await wait(20);
  $('#txForm [name=transferToAccountId]').value = 'aed';
  app.updateTransferFxPanel(false);
  await wait(20);
  $('#txForm [name=amount]').value = '100';
  // Override the auto rate with a bank rate.
  $('#fxRate').value = '3.5';
  app.updateTransferFxPanel(true);
  await wait(20);
  await app.submitTx({ preventDefault() {}, target: $('#txForm') }, '');
  await wait(60);

  const into = saved().transactions.find((t) => t.transferDir === 'in');
  ok('a manually entered rate is still honoured',
     into?.amount === 35000, `${into?.amount} (expected 35000 = AED 350.00)`);
  w.close();
}

// ═══ Same-currency transfer stays exact ═════════════════════════════════════
{
  const st = baseState();
  st.accounts.push(acct('usd2', 'US Savings', 'USD'));
  const w = boot(st);
  await wait(80);
  const app = w.__app, doc = w.document, $ = (s) => doc.querySelector(s);
  const saved = () => JSON.parse(w.localStorage.getItem('pocket.v1'));

  app.openModal('transaction', {});
  await wait(20);
  app.setTxType('transfer');
  await wait(30);
  $('#txForm [name=accountId]').value = 'usd';
  app.onTransferSourceChange('usd');
  await wait(20);
  $('#txForm [name=transferToAccountId]').value = 'usd2';
  app.updateTransferFxPanel(false);
  await wait(20);
  $('#txForm [name=amount]').value = '250.55';
  await app.submitTx({ preventDefault() {}, target: $('#txForm') }, '');
  await wait(60);

  const txs = saved().transactions;
  ok('same-currency transfer moves the exact amount',
     txs.every((t) => t.amount === 25055) && txs.length === 2,
     JSON.stringify(txs.map((t) => t.amount)));
  const accs = saved().accounts;
  ok('same-currency transfer nets to zero across the two accounts',
     accs.find((a) => a.id === 'usd').balance === -25055 &&
     accs.find((a) => a.id === 'usd2').balance === 25055,
     JSON.stringify(accs.filter((a) => a.currency === 'USD').map((a) => `${a.id}:${a.balance}`)));
  w.close();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
