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
  saveGroup(chat: number, owner: string, space: string, title: string | null) {
    const had = this.groupsMap.get(chat);
    this.groupsMap.set(chat, { daily: true, weekly: true, names: true, last_daily: null, last_weekly: null, ...had,
      chat_id: chat, owner_id: owner, space_id: space, title, paused_notice: false });
    return Promise.resolve();
  }
  updateGroup(chat: number, patch: Partial<GroupLink>) { Object.assign(this.groupsMap.get(chat)!, patch); return Promise.resolve(); }
  removeGroup(chat: number) { return Promise.resolve(this.groupsMap.delete(chat)); }
  moveGroup(a: number, b: number) { const g = this.groupsMap.get(a)!; this.groupsMap.delete(a); this.groupsMap.set(b, { ...g, chat_id: b }); return Promise.resolve(); }
  claimSummary(chat: number, kind: 'daily' | 'weekly', day: string) {
    const g = this.groupsMap.get(chat)!;
    const key = kind === 'daily' ? 'last_daily' : 'last_weekly';
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
  sent: { chat: number; text: string }[] = [];
  gone = new Set<number>();
  send(chat: number, text: string) { this.sent.push({ chat, text }); return Promise.resolve(1); }
  reply(chat: number, text: string) { this.sent.push({ chat, text }); return Promise.resolve(); }
  post(chat: number, text: string) {
    if (this.gone.has(chat)) return Promise.resolve({ ok: false, gone: true });
    this.sent.push({ chat, text });
    return Promise.resolve({ ok: true, gone: false });
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
  return { store, tg, service, runner, say };
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
  ok('G3 the owner turns it on: tied to their one space with accounts', g?.owner_id === OWNER && g.space_id === 'sp1' && /Shakirs/.test(tg.last) && /personal accounts never are/.test(tg.last), tg.last);
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
  ok('C1 clock: hour and weekday in India time', at('2026-11-15T15:45:00Z').hour() === 21 && at('2026-11-15T15:45:00Z').weekday() === 0
     && at('2026-11-14T18:40:00Z').isoDate() === '2026-11-15' && LocalClock.shift('2026-11-01', -1) === '2026-10-31');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
