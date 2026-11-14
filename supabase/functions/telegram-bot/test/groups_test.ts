/**
 * Group summaries with a fake database and a fake Telegram.
 * Run: deno run --import-map <map with a supabase-js stub> supabase/functions/telegram-bot/test/groups_test.ts
 */
import { GroupService } from '../lib/GroupService.ts';
import { GroupSummaries } from '../lib/GroupSummaries.ts';
import { LocalClock } from '../lib/LocalClock.ts';
import type { GroupLink, PocketStore, SharedSpace, SpaceSummary, TelegramLink } from '../lib/PocketStore.ts';
import { SummaryReport } from '../lib/SummaryReport.ts';
import { SummaryRunner } from '../lib/SummaryRunner.ts';
import type { TelegramClient } from '../lib/TelegramClient.ts';

let passed = 0, failed = 0;
const ok = (label: string, cond: boolean, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};

const OWNER = 'owner-1', MEMBER = 'member-2';
const summary = (over: Partial<SpaceSummary> = {}): SpaceSummary => ({
  space: 'Shakirs', currency: 'INR', accounts: 3, spent: 234_050, received: 460_000, entries: 6,
  categories: [{ name: 'Groceries', amount: 115_000 }, { name: 'Restaurant', amount: 77_050 }, { name: 'Travel', amount: 42_000 }],
  people: [{ name: 'Mufaddal', entries: 4 }, { name: 'Sakina', entries: 2 }], ...over,
});

class FakeStore {
  links = new Map<number, TelegramLink>();
  groupsMap = new Map<number, GroupLink>();
  spaces: SharedSpace[] = [{ id: 'sp1', name: 'Shakirs', accounts: 3 }, { id: 'sp2', name: 'Empty', accounts: 0 }];
  plans = new Map<string, unknown>([[OWNER, { access: { sharing: 'write' } }], [MEMBER, { access: { sharing: 'none' } }]]);
  asked: string[] = [];
  data: (from: string, to: string) => SpaceSummary | null = () => summary();
  findLink(id: number) { return Promise.resolve(this.links.get(id) ?? null); }
  entitlements(user: string) { return Promise.resolve(this.plans.get(user) ?? null); }
  spacesOf(owner: string) { return Promise.resolve(owner === OWNER ? this.spaces : []); }
  findGroup(id: number) { return Promise.resolve(this.groupsMap.get(id) ?? null); }
  groups() { return Promise.resolve([...this.groupsMap.values()].map((g) => ({ ...g }))); }
  saveGroup(chat: number, owner: string, space: string, title: string | null, thread: number | null = null) {
    const had = this.groupsMap.get(chat);
    this.groupsMap.set(chat, { daily: true, weekly: true, names: true, last_daily: null, last_weekly: null, time_zone: 'Asia/Kolkata', monthly: true, calendar: 'gregorian', last_monthly: null, ...had,
      chat_id: chat, owner_id: owner, space_id: space, title, thread_id: thread, paused_notice: false });
    return Promise.resolve();
  }
  updateGroup(chat: number, patch: Partial<GroupLink>) { Object.assign(this.groupsMap.get(chat)!, patch); return Promise.resolve(); }
  removeGroup(chat: number) { return Promise.resolve(this.groupsMap.delete(chat)); }
  moveGroup(a: number, b: number) { const g = this.groupsMap.get(a)!; this.groupsMap.delete(a); this.groupsMap.set(b, { ...g, chat_id: b }); return Promise.resolve(); }
  hijri = 0;
  hijriOffset() { return Promise.resolve(this.hijri); }
  claimSummary(chat: number, kind: 'daily' | 'weekly' | 'monthly', day: string) {
    const g = this.groupsMap.get(chat)!;
    const key = kind === 'daily' ? 'last_daily' : kind === 'weekly' ? 'last_weekly' : 'last_monthly';
    if (!g[kind] || (g[key] ?? '') >= day) return Promise.resolve(false);
    g[key] = day;
    return Promise.resolve(true);
  }
  spaceSummary(_o: string, space: string, from: string, to: string) {
    this.asked.push(`${space}:${from}..${to}`);
    return Promise.resolve(space === 'gone' ? null : this.data(from, to));
  }
}

class FakeTelegram {
  sent: { chat: number; text: string; thread: number | null; keyboard?: { text: string; callback_data: string }[][] }[] = [];
  gone = new Set<number>();
  deletedTopics = new Set<number>();
  answers: string[] = [];
  edits: string[] = [];
  send(chat: number, text: string, opts: { threadId?: number | null; keyboard?: { text: string; callback_data: string }[][] } = {}) {
    this.sent.push({ chat, text, thread: opts.threadId ?? null, keyboard: opts.keyboard }); return Promise.resolve(1);
  }
  answer(_id: string, text = '') { this.answers.push(text); return Promise.resolve(); }
  edit(_c: number, _m: number, text: string) { this.edits.push(text); return Promise.resolve(); }
  reply(chat: number, text: string) { this.sent.push({ chat, text, thread: null }); return Promise.resolve(); }
  post(chat: number, text: string, _html = false, thread: number | null = null) {
    if (this.gone.has(chat)) return Promise.resolve({ ok: false, gone: true, topicGone: false });
    if (thread != null && this.deletedTopics.has(thread)) return Promise.resolve({ ok: false, gone: false, topicGone: true });
    this.sent.push({ chat, text, thread });
    return Promise.resolve({ ok: true, gone: false, topicGone: false });
  }
  get last() { return this.sent.at(-1)?.text ?? ''; }
}

// India is UTC+5:30. 2026-11-15 is a Sunday.
const at = (iso: string) => new LocalClock('Asia/Kolkata', () => Date.parse(iso));
const GROUP = -100123;
const setup = (clock = at('2026-11-14T16:00:00Z')) => {
  const store = new FakeStore();
  const tg = new FakeTelegram();
  const summaries = new GroupSummaries(store as unknown as PocketStore, new SummaryReport());
  const service = new GroupService(store as unknown as PocketStore, tg as unknown as TelegramClient, summaries, clock);
  const runner = new SummaryRunner(store as unknown as PocketStore, tg as unknown as TelegramClient, summaries, clock);
  store.links.set(11, { chat_id: 11, user_id: OWNER, email: 'o@x.com', default_owner_id: null, default_account_id: null });
  store.links.set(22, { chat_id: 22, user_id: MEMBER, email: 'm@x.com', default_owner_id: null, default_account_id: null });
  const say = (text: string, from = 11) => service.handle({ message_id: 1, chat: { id: GROUP, type: 'group', title: 'Family' }, from: { id: from }, text });
  const sayIn = (thread: number, topic: boolean, text: string, from = 11) => service.handle({
    message_id: 2, chat: { id: GROUP, type: 'supergroup', title: 'Family' }, from: { id: from }, text,
    message_thread_id: thread, is_topic_message: topic,
  });
  return { store, tg, service, runner, say, sayIn };
};

console.log('\ngroup summaries');
{
  const r = new SummaryReport();
  const d = r.daily('2026-11-14', summary(), true);
  ok('R1 daily: space and day, total, entries, categories, received, names',
    d.includes('Shakirs · Sat 14 Nov') && d.includes('Spent <b>₹2,341</b> in 6 entries') && d.includes('• Groceries ₹1,150')
    && d.includes('Received ₹4,600') && d.includes('✍️ Mufaddal 4 · Sakina 2'), d);
  ok('R2 names off: nobody is named', !r.daily('2026-11-14', summary(), false).includes('Mufaddal'));
  const quiet = r.daily('2026-11-14', summary({ entries: 0, spent: 0, received: 0, categories: [], people: [] }), true);
  ok('R3 nothing logged: says so and where to send entries', /Nothing logged/.test(quiet) && /private chat/.test(quiet), quiet);
  const many = summary({ categories: ['A', 'B', 'C', 'D', 'E', 'F'].map((name, i) => ({ name, amount: (6 - i) * 10_000 })) });
  const m = r.daily('2026-11-14', many, true);
  ok('R4 top four categories, the rest as Other', m.includes('• D ₹300') && !m.includes('• E') && m.includes('• Other ₹300'), m);
  const w = r.weekly('2026-11-09', '2026-11-15', summary({ spent: 1_860_000 }), summary({ spent: 1_520_000 }), true);
  ok('R5 weekly: range and comparison with last week', w.includes('week of 9–15 Nov') && w.includes('last week ₹15,200, up 22%'), w);
  const x = r.daily('2026-11-14', summary({ space: '<b>Me</b>', people: [{ name: 'A&B', entries: 1 }] }), true);
  ok('R6 names and space names are escaped', x.includes('&lt;b&gt;Me&lt;/b&gt;') && x.includes('A&amp;B'));
}
{
  const { store, tg, say } = setup();
  await say('/summary on', 33);
  ok('G1 someone not linked: told to /link privately first', /\/link/.test(tg.last) && !store.groupsMap.size);
  await say('/summary on', 22);
  ok('G2 no Family plan: refused', /Family plan/.test(tg.last) && !store.groupsMap.size, tg.last);
  await say('/summary@PocketBot on');
  const g = store.groupsMap.get(GROUP);
  ok('G3 the owner turns it on: tied to their one space with accounts', g?.owner_id === OWNER && g.space_id === 'sp1' && tg.sent.some((m) => /will get summaries of <b>Shakirs/.test(m.text) && /personal accounts never are/.test(m.text)));
  await say('/summary off', 22);
  ok('G4 someone else cannot change or stop it', store.groupsMap.has(GROUP) && /Only the person/.test(tg.last));
  await say('/summary on', 22);
  ok('G5 nor take the group over', store.groupsMap.get(GROUP)?.owner_id === OWNER && /another Pocket account/.test(tg.last));
  await say('/summary names off');
  ok('G6 the owner can switch names off', store.groupsMap.get(GROUP)?.names === false && /Names: off/.test(tg.last), tg.last);
  await say('/summary now', 22);
  ok('G7 anyone can ask for today so far', /Spent/.test(tg.last) && !/Mufaddal/.test(tg.last) && store.asked.at(-1) === 'sp1:2026-11-14..2026-11-14', tg.last);
  await say('/summary off');
  ok('G8 the owner turns it off', !store.groupsMap.has(GROUP));
}
{
  const { store, tg, say } = setup();
  store.spaces = [{ id: 'sp1', name: 'Shakirs', accounts: 3 }, { id: 'sp3', name: 'Parents', accounts: 2 }];
  await say('/summary on');
  ok('G9 two spaces: asks which, lists them', !store.groupsMap.size && /Which shared space/.test(tg.last) && /Parents/.test(tg.last), tg.last);
  await say('/summary on par');
  ok('G10 by name', store.groupsMap.get(GROUP)?.space_id === 'sp3');
  await say('250 lunch @food');
  const before = tg.sent.length;
  ok('G11 ordinary text in a group is ignored, never recorded', tg.sent.length === before);
  await say('/accounts');
  ok('G12 other commands in a group: entries go to a private chat', /private chat/.test(tg.last));
}
{
  // Runner timing and once-only.
  const early = setup(at('2026-11-14T15:00:00Z')); // 8:30 pm IST
  await early.store.saveGroup(GROUP, OWNER, 'sp1', 'Family');
  ok('S1 before 9 pm: nothing posted', (await early.runner.run()).posted === 0 && !early.tg.sent.length);

  const { store, tg, runner } = setup(at('2026-11-14T16:00:00Z')); // Sat 9:30 pm IST
  await store.saveGroup(GROUP, OWNER, 'sp1', 'Family');
  const first = await runner.run();
  ok('S2 after 9 pm on a Saturday: one daily summary for today', first.posted === 1 && /Sat 14 Nov/.test(tg.last) && store.asked.at(-1) === 'sp1:2026-11-14..2026-11-14', JSON.stringify(first));
  const again = await runner.run();
  ok('S3 run again the same evening: nothing more', again.posted === 0 && tg.sent.length === 1);

  const sun = setup(at('2026-11-15T15:45:00Z')); // Sun 9:15 pm IST
  await sun.store.saveGroup(GROUP, OWNER, 'sp1', 'Family');
  sun.store.data = (from) => summary({ spent: from === '2026-11-09' ? 1_860_000 : 1_520_000 });
  const s = await sun.runner.run();
  ok('S4 Sunday: the daily and the weekly (Mon–Sun) with last week', s.posted === 2 && /week of 9–15 Nov/.test(sun.tg.last)
     && sun.store.asked.includes('sp1:2026-11-09..2026-11-15') && sun.store.asked.includes('sp1:2026-11-02..2026-11-08'), sun.tg.last);
  sun.store.updateGroup(GROUP, { weekly: false, last_daily: null });
  const sun2 = setup(at('2026-11-15T15:45:00Z'));
  await sun2.store.saveGroup(GROUP, OWNER, 'sp1', 'Family');
  await sun2.store.updateGroup(GROUP, { weekly: false });
  ok('S5 weekly switched off: only the daily', (await sun2.runner.run()).posted === 1);
}
{
  const { store, tg, runner } = setup();
  await store.saveGroup(GROUP, OWNER, 'sp1', 'Family');
  store.plans.set(OWNER, { access: { sharing: 'read' } });
  const r1 = await runner.run();
  const r2 = await runner.run();
  ok('S6 Family plan ended: the group is told once, no figures posted', r1.paused === 1 && r2.paused === 0 && tg.sent.length === 1 && /paused/.test(tg.last) && !/Spent/.test(tg.last));
  store.plans.set(OWNER, { access: { sharing: 'write' } });
  const r3 = await runner.run();
  ok('S7 renewed: summaries resume', r3.posted === 1 && store.groupsMap.get(GROUP)?.paused_notice === false);
}
{
  const { store, tg, runner } = setup();
  await store.saveGroup(GROUP, OWNER, 'sp1', 'Family');
  tg.gone.add(GROUP);
  const r = await runner.run();
  ok('S8 bot removed from the group: the group is forgotten', r.removed === 1 && !store.groupsMap.has(GROUP));
}
{
  const { store, tg, runner, sayIn } = setup();
  await sayIn(77, true, '/summary on');
  ok('T1 /summary on in a topic: that topic is remembered, and the answer goes there',
    store.groupsMap.get(GROUP)?.thread_id === 77 && tg.sent.slice(-3).every((m) => m.thread === 77) && tg.sent.some((m) => /This topic will get/.test(m.text)));
  await runner.run();
  ok('T2 the summary is posted in that topic', tg.sent.at(-1)?.thread === 77 && /Spent/.test(tg.last));
  await sayIn(77, true, '/summary');
  ok('T3 status says so', /Posted in this topic/.test(tg.last) && tg.sent.at(-1)?.thread === 77, tg.last);
  await sayIn(88, true, '/summary on');
  ok('T4 /summary on from another topic moves them there', store.groupsMap.get(GROUP)?.thread_id === 88);
  await sayIn(88, false, '/summary on');
  ok('T5 an ordinary group\'s reply thread is not a topic: the group itself', store.groupsMap.get(GROUP)?.thread_id === null && tg.sent.at(-1)?.thread === null);
}
{
  const { store, tg, runner } = setup();
  await store.saveGroup(GROUP, OWNER, 'sp1', 'Family', 77);
  tg.deletedTopics.add(77);
  const r = await runner.run();
  ok('T6 the topic was deleted: posted in General instead, and General from then on',
    r.posted === 1 && tg.sent.at(-1)?.thread === null && store.groupsMap.get(GROUP)?.thread_id === null && store.groupsMap.has(GROUP), JSON.stringify(r));
}
{
  const { store, tg, service, say } = setup();
  await say('/summary on');
  const ask = tg.sent.find((m) => /Which time zone/.test(m.text))!;
  const zones = (ask.keyboard ?? []).flat().map((b) => b.callback_data);
  ok('Z1 turning on asks for the time zone with buttons (India for now)',
    /Which time zone/.test(ask.text) && /India/.test(ask.text) && zones.includes('tz:Africa/Nairobi') && zones.includes('tz:Asia/Kolkata'), ask.text);
  const tap = (from: number, data: string) => service.handleCallback({ id: 'c', from: { id: from }, data, message: { message_id: 9, chat: { id: GROUP } } });
  await tap(22, 'tz:Africa/Nairobi');
  ok('Z2 someone else tapping a button changes nothing', store.groupsMap.get(GROUP)?.time_zone === 'Asia/Kolkata' && /Only the person/.test(tg.answers.at(-1) ?? ''));
  await tap(11, 'tz:Africa/Nairobi');
  ok('Z3 the owner taps Kenya: saved, and the question becomes the answer',
    store.groupsMap.get(GROUP)?.time_zone === 'Africa/Nairobi' && /9 pm Kenya \(Africa\/Nairobi\)/.test(tg.edits.at(-1) ?? ''), tg.edits.at(-1));
  await tap(11, 'tz:Mars/Base');
  ok('Z4 a made-up zone is refused', store.groupsMap.get(GROUP)?.time_zone === 'Africa/Nairobi');
  await say('/summary time dubai');
  ok('Z5 typed: "dubai" → Asia/Dubai, shown in the status', store.groupsMap.get(GROUP)?.time_zone === 'Asia/Dubai' && /Time zone: UAE/.test(tg.last), tg.last);
  await say('/summary time Dar es Salaam');
  ok('Z6 typed city with spaces', store.groupsMap.get(GROUP)?.time_zone === 'Africa/Dar_es_Salaam');
  await say('/summary time atlantis');
  ok('Z7 unknown place: asks again with buttons', store.groupsMap.get(GROUP)?.time_zone === 'Africa/Dar_es_Salaam' && /don't know/.test(tg.last) && !!tg.sent.at(-1)?.keyboard);
  await say('/summary time UTC', 22);
  ok('Z8 only the owner can change it by typing', store.groupsMap.get(GROUP)?.time_zone === 'Africa/Dar_es_Salaam');
}
{
  // 16:00 UTC = 21:30 India, 19:00 Kenya.
  const { store, tg, runner } = setup(at('2026-11-14T16:00:00Z'));
  await store.saveGroup(-1, OWNER, 'sp1', 'India family');
  await store.saveGroup(-2, OWNER, 'sp1', 'Kenya family');
  await store.updateGroup(-2, { time_zone: 'Africa/Nairobi' });
  await runner.run();
  ok('Z9 each group at its own 9 pm: India posts, Kenya (7 pm) waits', tg.sent.some((m) => m.chat === -1) && !tg.sent.some((m) => m.chat === -2));
  const later = setup(at('2026-11-14T18:10:00Z')); // 21:10 Kenya
  await later.store.saveGroup(-2, OWNER, 'sp1', 'Kenya family');
  await later.store.updateGroup(-2, { time_zone: 'Africa/Nairobi' });
  ok('Z10 Kenya posts at its 9 pm', (await later.runner.run()).posted === 1);
  // 02:30 UTC Sunday = 21:30 Saturday in New York: Saturday's daily, no weekly yet.
  const ny = setup(at('2026-11-15T02:30:00Z'));
  await ny.store.saveGroup(-3, OWNER, 'sp1', 'US family');
  await ny.store.updateGroup(-3, { time_zone: 'America/New_York' });
  const r = await ny.runner.run();
  ok('Z11 days are counted in the group\'s zone (Saturday in New York, though Sunday in India)',
    r.posted === 1 && ny.store.asked.at(-1) === 'sp1:2026-11-14..2026-11-14' && /Sat 14 Nov/.test(ny.tg.last), ny.tg.last);
}
{
  ok('Z12 India time posts just after 9 with the :07/:37 schedule', at('2026-11-14T15:37:00Z').hour() === 21 && at('2026-11-14T15:07:00Z').hour() === 20);
}
{
  const r = new SummaryReport();
  const now = summary({ spent: 6_240_000, categories: [{ name: 'Groceries', amount: 1_820_000 }, { name: 'Travel', amount: 980_000 }, { name: 'Gifts', amount: 50_000 }] });
  const before = summary({ spent: 5_510_000, categories: [{ name: 'Groceries', amount: 1_670_000 }, { name: 'Travel', amount: 1_020_000 }] });
  const m = r.monthly('October 2026', 'September', now, before, true);
  ok('M1 monthly: total compared with last month, and each category\'s change',
    m.includes('Shakirs · October 2026') && m.includes('(September ₹55,100, up 13%)') && m.includes('• Groceries ₹18,200 (up 9%)')
    && m.includes('• Travel ₹9,800 (down 4%)') && m.includes('• Gifts ₹500 (new)'), m);
}
{
  // Gregorian months.
  const { SummaryMonths } = await import('../lib/SummaryMonths.ts');
  const g = SummaryMonths.for('gregorian');
  const oct = g.month('2026-10-15');
  ok('M2 regular month: 1–31 October, last day known, previous is September',
    oct.from === '2026-10-01' && oct.to === '2026-10-31' && oct.label === 'October 2026' && g.isLastDay('2026-10-31') && !g.isLastDay('2026-10-30')
    && g.previous(oct).from === '2026-09-01' && g.previous(oct).to === '2026-09-30' && g.previous(oct).short === 'September');
  ok('M3 February in a leap year ends on the 29th', g.isLastDay('2028-02-29') && !g.isLastDay('2028-02-28'));
  // Hijri months: every day of a Hijri month maps to the same range, and ranges join up.
  const h = SummaryMonths.for('hijri', 0);
  const a = h.month('2026-11-14');
  const days: string[] = [];
  for (let d = a.from; d <= a.to; d = LocalClock.shift(d, 1)) days.push(d);
  const len = days.length;
  ok('M4 Hijri month: 29 or 30 days, the same range from any day in it, last day known',
    (len === 29 || len === 30) && days.every((d) => h.month(d).from === a.from && h.month(d).to === a.to) && h.isLastDay(a.to) && !h.isLastDay(a.from), `${a.from}..${a.to} ${a.label}`);
  const prev = h.previous(a);
  ok('M5 the previous Hijri month ends the day before this one starts', LocalClock.shift(prev.to, 1) === a.from && prev.label !== a.label, `${prev.label} ${prev.from}..${prev.to}`);
  const shifted = SummaryMonths.for('hijri', 1).month('2026-11-14');
  ok('M6 the owner\'s Hijri offset moves the month by a day', shifted.from === LocalClock.shift(a.from, -1), `${shifted.from} vs ${a.from}`);
}
{
  // Runner: regular month ends on Sat 31 Oct 2026 → at 9:30 pm India, daily + monthly.
  const { store, tg, runner } = setup(at('2026-10-31T16:00:00Z'));
  await store.saveGroup(GROUP, OWNER, 'sp1', 'Family');
  const r1 = await runner.run();
  ok('M7 last day of the month: the daily and the monthly (whole month vs September)',
    r1.posted === 2 && /October 2026/.test(tg.last) && store.asked.includes('sp1:2026-10-01..2026-10-31') && store.asked.includes('sp1:2026-09-01..2026-09-30'), tg.last);
  ok('M8 not twice', (await runner.run()).posted === 0);
  const mid = setup(at('2026-10-30T16:00:00Z'));
  await mid.store.saveGroup(GROUP, OWNER, 'sp1', 'Family');
  ok('M9 any other day: no monthly', (await mid.runner.run()).posted === 1 && !/October 2026/.test(mid.tg.last));
  const off = setup(at('2026-10-31T16:00:00Z'));
  await off.store.saveGroup(GROUP, OWNER, 'sp1', 'Family');
  await off.store.updateGroup(GROUP, { monthly: false });
  ok('M10 monthly off: only the daily', (await off.runner.run()).posted === 1);
}
{
  // Runner, Hijri group: on the Hijri month's last day.
  const { SummaryMonths } = await import('../lib/SummaryMonths.ts');
  const last = SummaryMonths.for('hijri', 0).month('2026-11-14').to;
  const { store, tg, runner } = setup(at(`${last}T16:00:00Z`));
  await store.saveGroup(GROUP, OWNER, 'sp1', 'Family');
  await store.updateGroup(GROUP, { calendar: 'hijri' });
  await runner.run();
  const hm = SummaryMonths.for('hijri', 0).month(last);
  ok('M11 Hijri group: monthly on the Hijri month\'s last day, named by the Hijri month',
    tg.last.includes(hm.label) && store.asked.includes(`sp1:${hm.from}..${hm.to}`), `${tg.last.split('\n')[0]} / ${hm.label}`);
}
{
  const { store, tg, service, say } = setup();
  await say('/summary on');
  const calAsk = tg.sent.at(-1)!;
  ok('M12 turning on also asks which calendar, with buttons', /which calendar/.test(calAsk.text) && (calAsk.keyboard ?? []).flat().some((b) => b.callback_data === 'cal:hijri'));
  await service.handleCallback({ id: 'c', from: { id: 22 }, data: 'cal:hijri', message: { message_id: 9, chat: { id: GROUP } } });
  ok('M13 only the owner can choose', store.groupsMap.get(GROUP)?.calendar === 'gregorian');
  await service.handleCallback({ id: 'c', from: { id: 11 }, data: 'cal:hijri', message: { message_id: 9, chat: { id: GROUP } } });
  ok('M14 the owner taps Hijri', store.groupsMap.get(GROUP)?.calendar === 'hijri' && /Hijri months/.test(tg.edits.at(-1) ?? ''));
  await say('/summary calendar regular');
  ok('M15 typed: back to regular months, shown in the status', store.groupsMap.get(GROUP)?.calendar === 'gregorian' && /Monthly: on, by regular months/.test(tg.last), tg.last);
  await say('/summary monthly off');
  ok('M16 monthly can be switched off', store.groupsMap.get(GROUP)?.monthly === false && /Monthly: off/.test(tg.last));
}
{
  ok('C1 clock: hour and weekday in India time', at('2026-11-15T15:45:00Z').hour() === 21 && at('2026-11-15T15:45:00Z').weekday() === 0
     && at('2026-11-14T18:40:00Z').isoDate() === '2026-11-15' && LocalClock.shift('2026-11-01', -1) === '2026-10-31');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
