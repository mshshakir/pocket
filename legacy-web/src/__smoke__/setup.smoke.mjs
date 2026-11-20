/**
 * setup.smoke.mjs — setting up a new book, and the Hijri add-on.
 *
 *   S1  Starting from the sample: "Set up my own book" removes it and walks
 *       accounts → names → about you → categories → calendar.
 *   S2  Accounts by count: 5 banks and a card become 6 named accounts; a
 *       blank name gets the kind's name; a balance becomes an Opening balance
 *       entry (a minus for a card is money owed).
 *   S3  Categories are ticked from the answers (children → Education,
 *       car → Vehicle, rent → Rent under Home); unticked mains are left out;
 *       "add your own" works; every saved main has subcategories.
 *   S4  "Anything else" asks the AI; its suggestions arrive ticked (✨) and are
 *       saved. Without anything written, the AI isn't asked.
 *   S5  Hijri: "No thanks" leaves it uninstalled (Gregorian calendar).
 *   S6  Keeping the sample skips to the calendar and changes nothing else.
 *   S7  Settings → Add-ons: Install / Remove; removing keeps the offset and
 *       the entries' Hijri dates; the budget form offers Hijri month only
 *       when installed.
 *
 * Run: node src/__smoke__/setup.smoke.mjs
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { SeedFactory } from '../data/seed.js';
import { StarterCategories } from '../data/StarterCategories.js';

const bundleSrc = readFileSync(new URL('../../bundle.js', import.meta.url), 'utf8');

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

console.log('\nsetup suite');

// ── S1–S5 ─────────────────────────────────────────────────────────────────
{
  const w = boot(SeedFactory.create());
  await wait(100);
  const app = w.__app;
  const text = () => w.document.body.textContent.replace(/\s+/g, ' ');
  app.openModal('currencySetup');
  await wait(30);
  ok('S1 opens on the currency', /Welcome to Pocket/.test(text()));
  app.setupAction('next');
  ok('S1 then: set up my own book?', /Set up my own book/.test(text()));
  app.setupAction('clean');
  ok('S1 the sample is gone', !app.store.getState().transactions.length, String(app.store.getState().transactions.length));
  ok('S1 then: how many accounts', /Where does your money sit/.test(text()));

  // 5 banks, 1 card, no cash
  for (let i = 0; i < 4; i++) app.setupAction('count', 'bank', 1);
  app.setupAction('count', 'card', 1);
  app.setupAction('count', 'cash', -1);
  const counts = [...w.document.querySelectorAll('.setup-count')].map((e) => e.textContent).join(',');
  ok('S2 counts change', counts === '5,1,0,0,0', counts);
  app.setupAction('next');
  const nameBoxes = w.document.querySelectorAll('.setup-name');
  ok('S2 a name box for each', nameBoxes.length === 6, String(nameBoxes.length));
  ['HDFC', 'SBI', 'ICICI', 'Axis', ''].forEach((n, i) => app.setupAction('name', i, n));
  app.setupAction('balance', 0, '25,000');
  app.setupAction('name', 5, 'Amex');
  app.setupAction('balance', 5, '-5000');
  app.setupAction('next');
  ok('S3 then: about you', /A little about you/.test(text()));

  app.setupAction('life', 'children');
  app.setupAction('life', 'vehicle');
  app.setupAction('life', 'rent');
  app.setupAction('next'); // nothing written: no AI
  await wait(20);
  ok('S3 categories screen', /Your categories/.test(text()));
  const shown = text();
  ok('S3 ticked from the answers', shown.includes('Education') && shown.includes('Vehicle') && shown.includes('✓ Rent'), shown.slice(0, 200));
  const boxes = [...w.document.querySelectorAll('.setup-main input[type=checkbox]')];
  const giving = StarterCategories.LIST.findIndex((m) => m.key === 'giving');
  ok('S3 mains not asked for start unticked', boxes[giving] && !boxes[giving].checked);
  const food = StarterCategories.LIST.findIndex((m) => m.key === 'food');
  app.setupAction('addsub', food, 'Tiffin');
  ok('S3 add your own', text().includes('✓ Tiffin'));
  app.setupAction('next');

  ok('S5 then: the Hijri question', /Do you use the Hijri calendar/.test(text()));
  app.setupAction('hijri', false);
  app.setupAction('finish');
  await wait(30);
  const s = app.store.getState();
  const names = s.accounts.map((a) => a.name);
  ok('S2 six accounts, a blank one named after its kind', names.join('|') === 'HDFC|SBI|ICICI|Axis|Bank|Amex', names.join('|'));
  const opening = s.transactions.filter((t) => (t.tags || []).includes('opening-balance'));
  ok('S2 balances as Opening balance entries', opening.length === 2
    && opening.some((t) => t.type === 'income' && t.amount === 2500000)
    && opening.some((t) => t.type === 'expense' && t.amount === 500000), JSON.stringify(opening.map((t) => [t.type, t.amount])));
  ok('S2 the card is a card', s.accounts.find((a) => a.name === 'Amex')?.type === 'card');
  ok('S2 default account is the first bank', s.user.defaultAccountId === s.accounts[0].id);
  const mains = s.categories.filter((c) => !c.parentId);
  const subsOf = (name) => s.categories.filter((c) => c.parentId === mains.find((m) => m.name === name)?.id).map((c) => c.name);
  ok('S3 saved: Education, Vehicle; Rent under Home; Tiffin under Food',
    subsOf('Education').includes('School fees') && subsOf('Vehicle').includes('Fuel') === false && subsOf('Vehicle').includes('Service')
    && subsOf('Home').includes('Rent') && subsOf('Food').includes('Tiffin'), JSON.stringify({ home: subsOf('Home'), food: subsOf('Food') }));
  ok('S3 unticked mains left out', !mains.some((m) => m.name === 'Giving' || m.name === 'Pets'));
  ok('S3 every main has subcategories', mains.filter((m) => m.type !== 'transfer').every((m) => s.categories.some((c) => c.parentId === m.id)));
  ok('S3 no sample categories left', !s.categories.some((c) => c.sample));
  ok('S5 Hijri not installed', s.user.showHijri === false && s.user.calendarMode === 'gregorian');
  ok('S1 closes with a summary', /Your book is ready: 6 accounts/.test(w.document.getElementById('toast')?.textContent || ''), w.document.getElementById('toast')?.textContent);
  w.close();
}

// ── S4 AI suggestions ─────────────────────────────────────────────────────
{
  const { BookSetupModal } = await import('../ui/modals/BookSetupModal.js');
  const state = { user: { homeCurrency: 'INR' }, accounts: [], categories: [], transactions: [], budgets: [] };
  let asked = '', finished = null;
  const modal = new BookSetupModal({
    store: { getState: () => state, persist() {} },
    hooks: {
      clearSample() {},
      suggest: async (p) => { asked = p; return '```json\n{"add":[{"main":"Food","sub":"Tiffin service","type":"expense"},{"main":"Maid","sub":"Salary","type":"expense"},{"main":"Food","sub":"<b>x</b>","type":"expense"}]}\n```'; },
      finish(p) { finished = p; },
    },
  });
  globalThis.window = { __app: {} };
  modal.onOpen();
  modal.act('next'); modal.act('next'); modal.act('next');           // currency → accounts → names → about you
  modal.act('notes', 'tiffin and a maid');
  await modal.act('next');
  ok('S4 the AI was asked with what they wrote', asked.includes('tiffin and a maid') && asked.includes('Groceries'));
  const html = modal.render();
  ok('S4 suggestions arrive ticked and marked', html.includes('✨ Tiffin service') && html.includes('Maid'), html.slice(0, 100));
  modal.act('next');
  modal.act('hijri', true);
  modal.act('finish');
  const food = finished?.categories.find((c) => c.name === 'Food');
  ok('S4 saved with the rest', food?.subs.includes('Tiffin service') && finished.categories.some((c) => c.name === 'Maid') && finished.hijri === true);
  ok('S4 markup in a suggestion is stripped', !JSON.stringify(finished).includes('<b>'));

  let calls = 0;
  const quiet = new BookSetupModal({ store: { getState: () => state, persist() {} }, hooks: { clearSample() {}, suggest: async () => { calls++; return ''; }, finish() {} } });
  quiet.onOpen();
  quiet.act('next'); quiet.act('next'); quiet.act('next');
  await quiet.act('next');
  ok('S4 nothing written: the AI isn\'t asked', calls === 0);
}

// ── S6 keep the sample ────────────────────────────────────────────────────
{
  const w = boot(SeedFactory.create());
  await wait(100);
  const app = w.__app;
  const before = app.store.getState().accounts.length;
  app.openModal('currencySetup');
  app.setupAction('next');
  app.setupAction('keep');
  app.setupAction('hijri', true);
  app.setupAction('finish');
  await wait(20);
  const s = app.store.getState();
  ok('S6 keeping the sample changes nothing else', s.accounts.length === before && s.transactions.length > 0 && s.user.showHijri === true);
  w.close();
}

// ── S7 the Hijri add-on ───────────────────────────────────────────────────
{
  const s = SeedFactory.create();
  s.user.showHijri = true; s.user.hijriOffset = 1;
  const w = boot(s);
  await wait(100);
  const app = w.__app;
  app.openModal('settings');
  app.setSettingsTab('addons');
  await wait(20);
  const panel = () => w.document.querySelector('[data-settings-tab="addons"]');
  ok('S7 an Add-ons tab with the Hijri calendar installed', panel() && /Hijri calendar/.test(panel().textContent) && !!panel().querySelector('.addon-installed'));
  app.setHijriAddon(false);
  await wait(20);
  const st = app.store.getState();
  ok('S7 Remove hides it and keeps the offset', st.user.showHijri === false && st.user.hijriOffset === 1 && !!panel()?.querySelector('.addon-install'));
  ok('S7 entries keep their Hijri dates', st.transactions.some((t) => t.hijriDate));
  app.closeModal();
  app.openModal('budget', {});
  await wait(20);
  const periods = [...w.document.querySelectorAll('input[name=period]')].map((i) => i.value);
  ok('S7 no Hijri month for a new budget when removed', !periods.includes('hijri') && periods.includes('gregorian'), periods.join(','));
  app.closeModal();
  app.setHijriAddon(true);
  app.openModal('budget', {});
  await wait(20);
  ok('S7 Install brings it back', [...w.document.querySelectorAll('input[name=period]')].some((i) => i.value === 'hijri') && app.store.getState().user.calendarMode !== 'gregorian');
  w.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
