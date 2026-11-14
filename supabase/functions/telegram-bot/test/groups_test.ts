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
    this.groupsMap.set(chat, { daily: true, weekly: true, names: true, last_daily: null, last_weekly: null, time_zone: 'Asia/Kolkata', monthly: true, calendar: 'gregorian', last_monthly: null, post_minute: 1260, weekly_day: 0, yearly: true, year_end_month: 12, year_end_day: 31, yearly_calendar: null, last_yearly: null, ...had,
      chat_id: chat, owner_id: owner, space_id: space, title, thread_id: thread, paused_notice: false });
    return Promise.resolve();
  }
  updateGroup(chat: number, patch: Partial<GroupLink>) { Object.assign(this.groupsMap.get(chat)!, patch); return Promise.resolve(); }
  removeGroup(chat: number) { return Promise.resolve(this.groupsMap.delete(chat)); }
  moveGroup(a: number, b: number) { const g = this.groupsMap.get(a)!; this.groupsMap.delete(a); this.groupsMap.set(b, { ...g, chat_id: b }); return Promise.resolve(); }
  hijri = 0;
  hijriOffset() { return Promise.resolve(this.hijri); }
  claimSummary(chat: number, kind: 'daily' | 'weekly' | 'monthly' | 'yearly', day: string) {
    const g = this.groupsMap.get(chat)!;
    const key = kind === 'daily' ? 'last_daily' : kind === 'weekly' ? 'last_weekly' : kind === 'monthly' ? 'last_monthly' : 'last_yearly';
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
  menus: string[] = [];
  setCommands(_c: unknown, scope = 'default') { this.menus.push(scope); return Promise.resolve(); }
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
    store.groupsMap.get(GROUP)?.time_zone === 'Africa/Nairobi' && /9 pm, Kenya \(Africa\/Nairobi\)/.test(tg.edits.at(-1) ?? ''), tg.edits.at(-1));
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
  const { SummarySchedule: S } = await import('../lib/SummarySchedule.ts');
  ok('W1 times people type', S.parseTime('9pm') === 1260 && S.parseTime('9 PM') === 1260 && S.parseTime('21:00') === 1260
     && S.parseTime('8:30 pm') === 1230 && S.parseTime('2130') === 1290 && S.parseTime('7.45am') === 465 && S.parseTime('12am') === 0
     && S.parseTime('12pm') === 720 && S.parseTime('25:00') === null && S.parseTime('dubai') === null && S.parseTime('13pm') === null);
  ok('W2 shown back plainly', S.formatTime(1260) === '9 pm' && S.formatTime(1230) === '8:30 pm' && S.formatTime(465) === '7:45 am' && S.formatTime(0) === '12 am');
  ok('W3 days', S.parseDay('fri') === 5 && S.parseDay('Friday') === 5 && S.parseDay('jumuah') === 5 && S.parseDay('sun') === 0 && S.parseDay('on') === null);
}
{
  const { store, tg, say } = setup();
  await say('/summary on');
  await say('/summary time 8:30pm');
  ok('W4 /summary time 8:30pm: saved and shown', store.groupsMap.get(GROUP)?.post_minute === 1230 && /Time: 8:30 pm/.test(tg.last), tg.last);
  await say('/summary weekly friday');
  ok('W5 /summary weekly friday: saved and shown', store.groupsMap.get(GROUP)?.weekly_day === 5 && /Weekly on Fridays: on/.test(tg.last), tg.last);
  await say('/summary time 7am');
  ok('W6 a morning time says it covers the day before', /7 am, about the day before/.test(tg.last), tg.last);
  await say('/summary time 9pm', 22);
  ok('W7 only the owner changes the time', store.groupsMap.get(GROUP)?.post_minute === 420);
  await say('/summary zone dubai');
  ok('W8 /summary zone still sets the time zone', store.groupsMap.get(GROUP)?.time_zone === 'Asia/Dubai');
}
{
  // 8:30 pm India = 15:00 UTC.
  const before = setup(at('2026-11-12T14:55:00Z'));
  await before.store.saveGroup(GROUP, OWNER, 'sp1', 'Family');
  await before.store.updateGroup(GROUP, { post_minute: 1230 });
  ok('W9 before the chosen time: nothing', (await before.runner.run()).posted === 0);
  const after = setup(at('2026-11-12T15:05:00Z'));
  await after.store.saveGroup(GROUP, OWNER, 'sp1', 'Family');
  await after.store.updateGroup(GROUP, { post_minute: 1230 });
  ok('W10 just after it: posted', (await after.runner.run()).posted === 1);
}
{
  // 7 am India on Sat 14 Nov = 01:30 UTC: the summary is about Friday 13 Nov.
  const { store, tg, runner } = setup(at('2026-11-14T01:45:00Z'));
  await store.saveGroup(GROUP, OWNER, 'sp1', 'Family');
  await store.updateGroup(GROUP, { post_minute: 420 });
  const r = await runner.run();
  ok('W11 a morning summary is about yesterday', r.posted === 1 && store.asked.at(-1) === 'sp1:2026-11-13..2026-11-13' && /Fri 13 Nov/.test(tg.last), tg.last);
}
{
  // Weekly on Fridays: Fri 13 Nov at 9:30 pm India.
  const fri = setup(at('2026-11-13T16:00:00Z'));
  await fri.store.saveGroup(GROUP, OWNER, 'sp1', 'Family');
  await fri.store.updateGroup(GROUP, { weekly_day: 5 });
  const r = await fri.runner.run();
  ok('W12 weekly on its chosen day, about the 7 days ending then', r.posted === 2 && fri.store.asked.includes('sp1:2026-11-07..2026-11-13') && /week of 7–13 Nov/.test(fri.tg.last), fri.tg.last);
  const sun = setup(at('2026-11-15T16:00:00Z'));
  await sun.store.saveGroup(GROUP, OWNER, 'sp1', 'Family');
  await sun.store.updateGroup(GROUP, { weekly_day: 5 });
  ok('W13 and no longer on Sunday', (await sun.runner.run()).posted === 1);
}
{
  // Morning time: the month that ended yesterday goes out on the 1st.
  const { store, tg, runner } = setup(at('2026-11-01T01:45:00Z')); // 7:15 am India, Sun 1 Nov
  await store.saveGroup(GROUP, OWNER, 'sp1', 'Family');
  await store.updateGroup(GROUP, { post_minute: 420 });
  const r = await runner.run();
  ok('W14 with a morning time, October\'s monthly arrives on the morning of 1 November',
    store.asked.includes('sp1:2026-10-01..2026-10-31') && tg.sent.some((m) => /October 2026/.test(m.text)) && r.posted === 3, JSON.stringify(r));
}
{
  const { tg, say } = setup();
  await say('/help');
  ok('H1 /help in a group: the summary guide, and the group menu shows /summary', /\/summary time 8:30pm/.test(tg.last) && tg.menus.includes('all_group_chats'));
  const { HelpMenu } = await import('../lib/HelpMenu.ts');
  ok('H2 the private /help explains group summaries and their commands',
    /Family group summaries/.test(HelpMenu.GUIDE) && /summary time 8:30pm/.test(HelpMenu.GUIDE) && /summary calendar hijri/.test(HelpMenu.GUIDE) && /never personal/.test(HelpMenu.GUIDE));
}
{
  const { SummaryYears: Y } = await import('../lib/SummaryYears.ts');
  const { SummaryMonths: SM } = await import('../lib/SummaryMonths.ts');
  const p = (t: string) => JSON.stringify(Y.parse(t));
  ok('Y1 year ends people type', p('31 march') === '{"month":3,"day":31,"calendar":"gregorian"}' && p('March 31st') === p('31 march')
     && p('31/3') === '{"month":3,"day":31,"calendar":null}' && p('last day of march') === p('31 march') && p('march') === p('31 march')
     && p('29 zilhaj') === '{"month":12,"day":29,"calendar":"hijri"}' && p('end zilhaj') === '{"month":12,"day":31,"calendar":"hijri"}'
     && p('30 ramadaan') === '{"month":9,"day":30,"calendar":"hijri"}' && Y.parse('tomorrow') === null && Y.parse('32 march') === null, p('29 zilhaj'));
  const cal = new Y(SM.for('gregorian'));
  const y = cal.period('2026-12-31');
  ok('Y2 default: the calendar year, labelled "2026", the year before is 2025',
    cal.isYearEnd('2026-12-31') && !cal.isYearEnd('2026-12-30') && y.from === '2026-01-01' && y.label === '2026' && cal.previous(y).from === '2025-01-01' && cal.previous(y).to === '2025-12-31');
  const fy = new Y(SM.for('gregorian'), { month: 3, day: 31 });
  const f = fy.period('2027-03-31');
  ok('Y3 financial year to 31 March: April–March, labelled with both ends', f.from === '2026-04-01' && f.label === 'April 2026 – March 2027' && fy.isYearEnd('2027-03-31'), f.label);
  const feb = new Y(SM.for('gregorian'), { month: 2, day: 31 });
  ok('Y4 a day past the month\'s end means its last day', feb.isYearEnd('2027-02-28') && feb.isYearEnd('2028-02-29') && !feb.isYearEnd('2028-02-28'));
  const hy = new Y(SM.for('hijri', 0));
  let end = '2026-11-14';
  while (!hy.isYearEnd(end)) end = LocalClock.shift(end, 1);
  const h = hy.period(end);
  const len = Math.round((Date.parse(h.to) - Date.parse(h.from)) / 86400000) + 1;
  ok('Y5 Hijri year: ends on the last day of Zilhaj, 354–355 days, labelled "… H"', (len === 354 || len === 355) && / H$/.test(h.label)
     && SM.for('hijri', 0).position(h.from).month === 1 && SM.for('hijri', 0).position(h.from).day === 1, `${h.from}..${h.to} ${h.label} (${len})`);
  ok('Y6 described for people', fy.describe() === 'the last day of March' && new Y(SM.for('gregorian'), { month: 3, day: 15 }).describe() === '15 March' && /Zilhaj/.test(hy.describe()));
  const r = new SummaryReport();
  const yt = r.yearly('2026', summary({ spent: 72_000_000 }), summary({ spent: 60_000_000 }), 12, true);
  ok('Y7 yearly text: label, monthly average, compared with last year', yt.includes('Shakirs · 2026') && yt.includes('On average ₹60,000 a month') && yt.includes('(last year ₹6,00,000, up 20%)'), yt);
}
{
  // 31 Dec 2026 at 9:30 pm India: daily, monthly and yearly.
  const { store, tg, runner } = setup(at('2026-12-31T16:00:00Z'));
  await store.saveGroup(GROUP, OWNER, 'sp1', 'Family');
  const r = await runner.run();
  ok('Y8 31 December: the yearly summary too, the whole year vs last year',
    r.posted === 3 && store.asked.includes('sp1:2026-01-01..2026-12-31') && store.asked.includes('sp1:2025-01-01..2025-12-31') && /🎉/.test(tg.last), JSON.stringify(r));
  ok('Y9 not twice', (await runner.run()).posted === 0);
  const fy = setup(at('2027-03-31T16:00:00Z'));
  await fy.store.saveGroup(GROUP, OWNER, 'sp1', 'Family');
  await fy.store.updateGroup(GROUP, { year_end_month: 3, year_end_day: 31, yearly_calendar: 'gregorian' });
  await fy.runner.run();
  ok('Y10 financial year: on 31 March, April–March', fy.store.asked.includes('sp1:2026-04-01..2027-03-31') && /April 2026 – March 2027/.test(fy.tg.last), fy.tg.last);
  const dec = setup(at('2026-12-31T16:00:00Z'));
  await dec.store.saveGroup(GROUP, OWNER, 'sp1', 'Family');
  await dec.store.updateGroup(GROUP, { year_end_month: 3, year_end_day: 31, yearly_calendar: 'gregorian' });
  ok('Y11 and then not on 31 December', !(await dec.runner.run(), dec.tg.sent.some((m) => /🎉/.test(m.text))));
}
{
  const { store, tg, say } = setup();
  await say('/summary on');
  await say('/summary yearly 31 march');
  const g = store.groupsMap.get(GROUP)!;
  ok('Y12 /summary yearly 31 march: saved and shown', g.year_end_month === 3 && g.year_end_day === 31 && g.yearly_calendar === 'gregorian' && /Yearly: on, on the last day of March/.test(tg.last), tg.last);
  await say('/summary yearly 29 zilhaj');
  ok('Y13 a Hijri date sets a Hijri year', store.groupsMap.get(GROUP)!.yearly_calendar === 'hijri' && store.groupsMap.get(GROUP)!.year_end_month === 12);
  await say('/summary yearly off');
  ok('Y14 yearly off', store.groupsMap.get(GROUP)!.yearly === false && /Yearly: off/.test(tg.last));
  await say('/summary yearly someday');
  ok('Y15 a date it can\'t read: shows examples', /31 march/.test(tg.last));
  await say('/summary yearly 31/12', 22);
  ok('Y16 only the owner sets it', store.groupsMap.get(GROUP)!.year_end_month === 12 && store.groupsMap.get(GROUP)!.yearly_calendar === 'hijri');
}
{
  ok('C1 clock: hour and weekday in India time', at('2026-11-15T15:45:00Z').hour() === 21 && at('2026-11-15T15:45:00Z').weekday() === 0
     && at('2026-11-14T18:40:00Z').isoDate() === '2026-11-15' && LocalClock.shift('2026-11-01', -1) === '2026-10-31');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
