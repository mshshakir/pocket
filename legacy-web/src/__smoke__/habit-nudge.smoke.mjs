/**
 * habit-nudge.smoke.mjs — help when recording slips, and the programme paid in two halves.
 *
 *   N1  nothing in the first 14 days, or with no entries
 *   N2  3+ days with no entries → the catch-up offer (WhatsApp)
 *   N3  on and off (under 15 of 30 days) → the programme; daily recorders hear nothing
 *   N4  stopped for over a month → the programme ("start again")
 *   N5  no programme offer for people in it (catch-up still shown)
 *   N6  the second half, once the 6 weeks are over
 *   N7  "Not now" hides it for 21 days, then it comes back; no way to hide it for good;
 *       putting the catch-up away doesn't bring on the programme
 *   N8  programme page: two ways to pay (₹4,500 in full; ₹2,500 now) and the second-half box
 *   N9  direct places: someone on the waitlist who opens the page gets a free place (claim);
 *       a held place shows until when it is held
 *
 * Run: node src/__smoke__/habit-nudge.smoke.mjs
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><div id="nudge"></div><div id="root"></div>', { url: 'https://pocket.test/app.html' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.FormData = dom.window.FormData;

const { RecordingGaps } = await import('../domain/services/RecordingGaps.js');
const { HabitNudge } = await import('../ui/components/HabitNudge.js');
const { ProgrammePage } = await import('../web/ProgrammePage.js');

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nHabit nudge suite');

const today = '2026-11-17';
const day = (n) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const at = (n) => `${day(n)}T09:00:00`;
const entry = (n) => ({ date: day(n), createdAt: at(n) });
const daysAgo = (list) => list.map(entry);

// N1
ok('N1 no entries: nothing', RecordingGaps.suggestion([], today) === null);
ok('N1 first 14 days: nothing, even with a gap', RecordingGaps.suggestion(daysAgo([10, 9]), today) === null);

// N2
const gap = RecordingGaps.suggestion(daysAgo([40, 30, 20, 10, 5]), today);
ok('N2 five days with no entry: catch-up', gap?.kind === 'catchUp' && gap.days === 5, JSON.stringify(gap));
ok('N2 two days: not yet', RecordingGaps.suggestion(daysAgo([40, 2]), today)?.kind !== 'catchUp');
ok('N2 bills added by the app don\'t count', RecordingGaps.suggestion([...daysAgo([40, 5]), { date: day(0), createdAt: at(0), recurringSourceId: 'r1' }], today)?.kind === 'catchUp');

// N3
const onOff = RecordingGaps.suggestion(daysAgo([60, 28, 25, 20, 14, 9, 4, 1]), today);
ok('N3 on and off: the programme', onOff?.kind === 'programme' && onOff.recordedDays === 7 && !onOff.stopped, JSON.stringify(onOff));
const daily = Array.from({ length: 40 }, (_, i) => entry(i));
ok('N3 recording daily: nothing', RecordingGaps.suggestion(daily, today) === null);
const backfilled = Array.from({ length: 30 }, (_, i) => ({ date: day(i), createdAt: at(i % 3 === 0 ? i : i - (i % 3)) }));
ok('N3 counted by when it was recorded, not the date it is for', RecordingGaps.suggestion([entry(60), ...backfilled], today)?.kind === 'programme');

// N4
ok('N4 stopped for 40 days: the programme, start again', (() => { const s = RecordingGaps.suggestion(daysAgo([90, 60, 40]), today); return s?.kind === 'programme' && s.stopped; })());

// N5
ok('N5 in the programme: no programme offer', RecordingGaps.suggestion(daysAgo([60, 28, 20, 1]), today, { status: 'confirmed', payPlan: 'full' }) === null);
ok('N5 in the programme: catch-up still offered', RecordingGaps.suggestion(daysAgo([60, 5]), today, { status: 'confirmed', payPlan: 'full' })?.kind === 'catchUp');

// N6
const split = { status: 'confirmed', payPlan: 'split', restPaid: false, batch: { endsOn: day(1) } };
ok('N6 6 weeks over, second half unpaid: asked for', RecordingGaps.suggestion(daily, today, split)?.kind === 'restDue');
ok('N6 not before the end', RecordingGaps.suggestion(daily, today, { ...split, batch: { endsOn: day(-3) } }) === null);
ok('N6 not once paid', RecordingGaps.suggestion(daily, today, { ...split, restPaid: true }) === null);

// N7
const store = new Map();
const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
let now = new Date(`${today}T10:00:00`);
const el = document.getElementById('nudge');
const nudge = new HabitNudge(el, { storage, now: () => now });
nudge.show({ kind: 'catchUp', days: 5 });
ok('N7 catch-up box with a WhatsApp link', /No entries for the last 5 days/.test(el.textContent) && /wa\.me\/919687318953/.test(el.innerHTML));
ok('N7 only "Not now", no way to hide it for good', !!el.querySelector('[data-nudge=later]') && !/don.t show|never/i.test(el.textContent));
nudge.later();
nudge.show({ kind: 'catchUp', days: 6 });
ok('N7 after Not now: hidden', el.innerHTML === '');
nudge.show({ kind: 'programme', recordedDays: 7, window: 30, stopped: false });
ok('N7 the programme doesn\'t take its place', el.innerHTML === '');
nudge.show({ kind: 'restDue' });
ok('N7 a payment due still shows', /Second half/.test(el.textContent));
now = new Date(now.getTime() + 22 * 86400000);
nudge.show({ kind: 'programme', recordedDays: 7, window: 30, stopped: false });
ok('N7 back after 21 days', /recorded on 7 of the last 30 days/.test(el.textContent) && /programme\.html/.test(el.innerHTML));

// N8
const page = async (app) => {
  const root = document.getElementById('root');
  const session = { user: async () => ({ id: 'u', email: 'me@x.com', user_metadata: { full_name: 'Me' } }), onChange: () => {}, rpc: async () => app, invoker: () => null, signIn: async () => {}, signOut: async () => {} };
  await new ProgrammePage(session, root, { open: async () => ({}) }, async () => { throw new Error('offline'); }).start();
  return root;
};
const batch = { name: 'Batch 3', startsOn: '2026-12-01', endsOn: '2027-01-12', pricePaise: 500000, fullPaise: 500000, upfrontPaise: 450000, halfPaise: 250000, restPaise: 250000 };
const offered = await page({ status: 'offered', fullName: 'Me', whatsapp: '1', paymentsOpen: true, batch });
ok('N8 offered: pay ₹4,500 in full (save ₹500)', !!offered.querySelector('[data-product=programme]') && /₹4,500/.test(offered.textContent) && /Save ₹500/.test(offered.textContent));
ok('N8 offered: or ₹2,500 now, ₹2,500 at the end', /₹2,500/.test(offered.querySelector('[data-product=programme_half]')?.textContent || '') && /when the 6 weeks end/.test(offered.textContent));
const owed = await page({ status: 'confirmed', fullName: 'Me', whatsapp: '1', paymentsOpen: true, payPlan: 'split', restPaid: false, batch: { ...batch, endsOn: '2026-11-01' } });
ok('N8 split, 6 weeks over: second half due, Pay ₹2,500', owed.querySelector('.programme-rest')?.dataset.due === 'true' && !!owed.querySelector('[data-product=programme_rest]'));
const paid = await page({ status: 'confirmed', fullName: 'Me', whatsapp: '1', paymentsOpen: true, payPlan: 'split', restPaid: true, batch });
ok('N8 both halves paid: no box', !paid.querySelector('.programme-rest'));

// N9
{
  const root = document.getElementById('root');
  const calls = [];
  const held = { status: 'offered', fullName: 'Me', whatsapp: '1', paymentsOpen: true, batch, holdUntil: '2026-11-19T06:00:00Z' };
  const session = {
    user: async () => ({ id: 'u', email: 'me@x.com', user_metadata: { full_name: 'Me' } }), onChange: () => {},
    rpc: async (fn) => { calls.push(fn); return fn === 'pocket_programme_claim' ? held : { status: 'waitlisted', fullName: 'Me', whatsapp: '1' }; },
    invoker: () => null, signIn: async () => {}, signOut: async () => {},
  };
  await new ProgrammePage(session, root, { open: async () => ({}) }, async () => { throw new Error('offline'); }).start();
  ok('N9 on the waitlist: the page asks for a free place', calls.includes('pocket_programme_claim'), calls.join());
  ok('N9 a place found: pay now, held until a date', !!root.querySelector('[data-product=programme_half]') && /holding it for you until/.test(root.querySelector('.programme-hold')?.textContent || ''));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
