/**
 * programme-batches.smoke.mjs — programme batches with application dates.
 *
 *   B1  messages: open (places left, closing date), full, opening soon, closed, running, none
 *   B2  the open batch is talked about first; "Next: …" names the batch after a full one
 *   B3  the programme page shows the banner, and says "Apply now" or "Join the waitlist"
 *   B4  admin: the dates and "Website: …" per batch; Close now / Reopen; dates saved
 *   B5  admin's state rules match the database's (upcoming → open → full / closed → running → done)
 *
 * Run: node src/__smoke__/programme-batches.smoke.mjs
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://pocket.test/programme.html' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.FormData = dom.window.FormData;
globalThis.confirm = () => true;

const { ProgrammeBatches } = await import('../web/ProgrammeBatches.js');
const { ProgrammePage } = await import('../web/ProgrammePage.js');
const { ProgrammeView } = await import('../admin/views/ProgrammeView.js');

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nProgramme batches suite');

const y = new Date().getFullYear();
const b3 = { name: 'Batch 3', startsOn: `${y}-12-01`, opensOn: `${y}-11-20`, closesOn: `${y}-11-28`, capacity: 10, placesLeft: 4, pricePaise: 500000 };
const b4 = { name: 'Batch 4', startsOn: `${y}-12-20`, opensOn: `${y}-12-10`, closesOn: null, capacity: 10, placesLeft: 10, pricePaise: 500000, state: 'upcoming' };

{
  const m = new ProgrammeBatches([{ ...b3, state: 'open' }]).message();
  ok('B1 open: name, start, places left, closing date, Apply now', m.title === 'Batch 3 is open' && m.detail === 'Starts 1 Dec · 4 of 10 places left · applications close 28 Nov' && m.action === 'Apply now', JSON.stringify(m));
  const f = new ProgrammeBatches([{ ...b3, state: 'full', placesLeft: 0 }, b4]).message();
  ok('B1/B2 full: join the waitlist, and when the next one starts', f.title === 'Batch 3 is full' && /Next: Batch 4, starts 20 Dec \(applications open 10 Dec\)/.test(f.detail) && f.action === 'Join the waitlist', JSON.stringify(f));
  const u = new ProgrammeBatches([{ ...b3, state: 'upcoming' }]).message();
  ok('B1 opening soon: start date and when applications open', u.title === 'Next batch starts 1 Dec' && /Applications open 20 Nov/.test(u.detail));
  ok('B1 closed and running invite to the waitlist', /are closed/.test(new ProgrammeBatches([{ ...b3, state: 'closed' }]).message().title)
     && /running now/.test(new ProgrammeBatches([{ ...b3, state: 'running' }]).message().title));
  ok('B1 no batches: just the waitlist', new ProgrammeBatches([]).message().state === 'none');
  const both = new ProgrammeBatches([b4, { ...b3, state: 'open' }]);
  ok('B2 an open batch comes before an upcoming one', both.headline.name === 'Batch 3' && both.open);
  ok('B1 dates in another year carry the year', ProgrammeBatches.day(`${y + 1}-01-05`) === `5 Jan ${y + 1}`);
}

{
  const root = document.createElement('div');
  const session = { user: async () => ({ id: 'u', email: 'me@x.com', user_metadata: { full_name: 'Me' } }), onChange: () => {}, rpc: async () => null, invoker: () => null, signIn: async () => {}, signOut: async () => {} };
  const page = new ProgrammePage(session, root, { open: async () => ({}) }, async () => new ProgrammeBatches([{ ...b3, state: 'open' }]));
  await page.start();
  ok('B3 the banner says the batch is open with places left', /Batch 3 is open/.test(root.querySelector('.programme-batch')?.textContent || '') && root.querySelector('.programme-batch').dataset.state === 'open');
  ok('B3 the button says Apply now, and the place is offered on WhatsApp', /Apply now/.test(root.querySelector('#programmeForm button[type=submit]').textContent) && /offer you a place in Batch 3/.test(root.textContent));
  const root2 = document.createElement('div');
  await new ProgrammePage(session, root2, { open: async () => ({}) }, async () => new ProgrammeBatches([{ ...b3, state: 'full', placesLeft: 0 }])).start();
  ok('B3 when full: Join the waitlist', /Join the waitlist/.test(root2.querySelector('#programmeForm button[type=submit]').textContent) && /is full/.test(root2.textContent));
  const root3 = document.createElement('div');
  await new ProgrammePage(session, root3, { open: async () => ({}) }, async () => { throw new Error('offline'); }).start();
  ok('B3 if batches can\'t load, the page still works (no banner)', !root3.querySelector('.programme-batch') && !!root3.querySelector('#programmeForm'));
}

{
  const calls = [];
  const data = { batches: [{ id: 5, name: 'Batch 1', starts_on: '2099-12-07', opens_on: '2000-01-01', closes_on: '2099-12-01', capacity: 10, price_paise: 500000, status: 'open', confirmed: 3, offered: 1, closed_now: false }], applications: [] };
  const fake = new Proxy({}, { get: (_t, name) => async (...args) => { calls.push([name, ...args]); return data; } });
  const v = new ProgrammeView(fake, { toast: () => {}, refresh: async () => {} });
  await v.load();
  const part = document.createElement('button'); part.dataset.part = 'batches';
  await v.act('part', part, null);
  const h = v.html();
  ok('B4 each batch has open / close dates and says what the website shows', /Applications open/.test(h) && /Applications close/.test(h) && /Website: open — taking applications/.test(h), h.slice(0, 300));
  const box = document.createElement('div'); box.innerHTML = h;
  const close = box.querySelector('[data-action="batch-close"]');
  close.dataset.id = '5';
  await v.act('batch-close', close, null);
  ok('B4 Close now saves closed_now', calls.some((c) => c[0] === 'saveBatch' && c[1].closed_now === true));
  const form = box.querySelector('form[data-form="batch"][data-id="5"]');
  form.querySelector('[name=opens_on]').value = '2099-11-20';
  await v.act('batch', form, new FormData(form));
  ok('B4 Save sends the dates', calls.some((c) => c[0] === 'saveBatch' && c[1].opens_on === '2099-11-20' && c[1].closes_on === '2099-12-01'));
}

{
  const s = (b, taken, today) => ProgrammeView.publicState({ capacity: 10, status: 'open', closed_now: false, ...b }, taken, today);
  const b = { opens_on: '2026-11-20', closes_on: '2026-11-28', starts_on: '2026-12-01' };
  ok('B5 before opening: upcoming; then open; full when taken', s(b, 0, '2026-11-19') === 'upcoming' && s(b, 9, '2026-11-20') === 'open' && s(b, 10, '2026-11-21') === 'full');
  ok('B5 after the close date, or Close now: closed', s(b, 0, '2026-11-29') === 'closed' && s({ ...b, closed_now: true }, 0, '2026-11-22') === 'closed');
  ok('B5 no close date: closes the day before it starts', s({ ...b, closes_on: null }, 0, '2026-11-30') === 'open' && s({ ...b, closes_on: null }, 0, '2026-12-01') === 'running');
  ok('B5 six weeks after the start, or marked done: finished', s(b, 0, '2027-01-12') === 'done' && s({ ...b, status: 'done' }, 0, '2026-11-22') === 'done');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
