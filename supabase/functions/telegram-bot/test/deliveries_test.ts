/**
 * Deliveries and bills on Telegram, with a fake database and a fake Telegram.
 * Run: deno run --import-map <map with a supabase-js stub> supabase/functions/telegram-bot/test/deliveries_test.ts
 *
 *   T1  DeliveryDay matches the app's rules (usual days, marks, pauses, prices, paid days, dues)
 *   T2  the check-in goes out in each slot's own zone and time, to the chosen people, once
 *   T3  − / + change the day through the access check; ✓ is first-answer-wins; every copy redrawn
 *   T4  typed changes ("no milk", "milk x2", "milk 2 L"); "milk 2" stays an entry
 *   T5  /dues and ✓ Paid: one expense per item, paid up to the day, never twice
 *   T6  bill reminders: before and on the day, once; ✓ Paid / Skip; "paid electricity 1950"
 */
import { BillDates } from '../lib/BillDates.ts';
import { BillReminderRunner } from '../lib/BillReminderRunner.ts';
import { CheckinMessage } from '../lib/CheckinMessage.ts';
import { CheckinRunner } from '../lib/CheckinRunner.ts';
import { DeliveryBot } from '../lib/DeliveryBot.ts';
import { DeliveryDay, type DeliveryItem } from '../lib/DeliveryDay.ts';
import type { BillTemplate, Checkin, DeliveryChange, DeliveryStore, NotifyPerson } from '../lib/DeliveryStore.ts';
import { LocalClock } from '../lib/LocalClock.ts';
import { PocketBook } from '../lib/PocketBook.ts';
import type { PocketStore, TelegramLink } from '../lib/PocketStore.ts';
import type { TelegramClient } from '../lib/TelegramClient.ts';

let passed = 0, failed = 0;
const ok = (label: string, cond: boolean, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};

const OWNER = 'owner-1', WIFE = 'wife-2', STRANGER = 'stranger-3';
const ME = 101, HER = 202, OTHER = 303, GROUP = -500;
const links = new Map<number, TelegramLink>([
  [ME, { chat_id: ME, user_id: OWNER, email: 'me@x.com', default_owner_id: OWNER, default_account_id: 'a1' }],
  [HER, { chat_id: HER, user_id: WIFE, email: 'asha@x.com', default_owner_id: OWNER, default_account_id: 'a1' }],
  [OTHER, { chat_id: OTHER, user_id: STRANGER, email: 'z@x.com', default_owner_id: STRANGER, default_account_id: null }],
]);

const milk = (): DeliveryItem => ({
  ownerId: OWNER, id: 'ri_milk', name: 'Milk', vendor: 'Doodhwala', unit: 'L', accountId: 'a1', categoryId: 'c1', currency: 'INR',
  defaultAmount: 6400, payLater: true, usualQty: 1, usualDays: [1, 2, 3, 4, 5, 6], trackFrom: '2026-11-01', marks: {}, pauses: [],
  checkinTo: 'all', checkinMinute: 540, checkinTz: 'Asia/Kolkata',
});
const paper = (): DeliveryItem => ({
  ownerId: OWNER, id: 'ri_paper', name: 'Newspaper', accountId: 'a1', categoryId: 'c2', currency: 'INR', defaultAmount: 800,
  payLater: true, usualQty: 1, trackFrom: '2026-11-01', marks: {}, pauses: [], checkinTo: 'all',
});

class FakeDeliveries {
  items: DeliveryItem[] = [milk(), paper()];
  acc = new Map<string, number>([[OWNER, 4], [WIFE, 1]]);
  checkins: (Checkin & { msgs: { chat_id: number; message_id: number }[] })[] = [];
  changes: { actor: string; item: string; change: DeliveryChange }[] = [];
  bills: BillTemplate[] = [];
  reminders: { id: number; owner_id: string; template_id: string; occurrence: string; kind: 'before' | 'due' }[] = [];
  skipped: string[] = [];
  groupsOn = false;
  checkinItems() { return Promise.resolve(this.items.filter((i) => i.checkinTo !== 'off').map((i) => structuredClone(i))); }
  itemsOf(owner: string) { return Promise.resolve(this.items.filter((i) => i.ownerId === owner).map((i) => structuredClone(i))); }
  change(actor: string, owner: string, itemId: string, change: DeliveryChange) {
    if ((this.acc.get(actor) ?? -1) < 1) return Promise.reject(new Error("You don't have permission to change that item"));
    const it = this.items.find((i) => i.id === itemId && i.ownerId === owner)!;
    if ('set' in change) { if (it.paidTo && change.set.date <= it.paidTo) return Promise.reject(new Error('That day is already paid')); it.marks = { ...it.marks, [change.set.date]: change.set.qty }; }
    if ('clear' in change) { const m = { ...it.marks }; delete m[change.clear]; it.marks = m; }
    if ('paidTo' in change && (!it.paidTo || change.paidTo > it.paidTo)) it.paidTo = change.paidTo;
    if ('paidTo' in change && change.tx) it.adjustments = (it.adjustments ?? []).map((a) => (a.settledIn ? a : { ...a, settledIn: change.tx! }));
    this.changes.push({ actor, item: itemId, change });
    return Promise.resolve();
  }
  access(actor: string) { return Promise.resolve(this.acc.get(actor) ?? -1); }
  people(): Promise<NotifyPerson[]> {
    return Promise.resolve([{ email: 'me@x.com', name: 'Mufaddal', chats: [ME] }, { email: 'asha@x.com', name: 'Asha', chats: [HER] }]);
  }
  groups() { return Promise.resolve(this.groupsOn ? [{ chatId: GROUP, threadId: 7 }] : []); }
  ownersFor(user: string) { return Promise.resolve(user === STRANGER ? [STRANGER] : [...new Set([user, OWNER])]); }
  claimCheckin(owner: string, day: string, slot: string, items: string[]) {
    if (this.checkins.some((c) => c.owner_id === owner && c.day === day && c.slot === slot)) return Promise.resolve(null);
    const id = this.checkins.length + 1;
    this.checkins.push({ id, owner_id: owner, day, slot, items, answered_by: null, msgs: [] });
    return Promise.resolve(id);
  }
  checkin(id: number) { const c = this.checkins.find((x) => x.id === id); return Promise.resolve(c ? { ...c } : null); }
  latestCheckin(owner: string, day: string) { return Promise.resolve([...this.checkins].reverse().find((c) => c.owner_id === owner && c.day === day) ?? null); }
  saveMessage(id: number, chat: number, mid: number) { this.checkins.find((c) => c.id === id)!.msgs.push({ chat_id: chat, message_id: mid }); return Promise.resolve(); }
  messages(id: number) { return Promise.resolve(this.checkins.find((c) => c.id === id)!.msgs); }
  answer(id: number, name: string) {
    const c = this.checkins.find((x) => x.id === id)!;
    if (c.answered_by) return Promise.resolve(false);
    c.answered_by = name;
    return Promise.resolve(true);
  }
  billTemplates() { return Promise.resolve(structuredClone(this.bills)); }
  claimReminder(owner: string, tid: string, occ: string, kind: 'before' | 'due') {
    if (this.reminders.some((r) => r.owner_id === owner && r.template_id === tid && r.occurrence === occ && r.kind === kind)) return Promise.resolve(null);
    const id = this.reminders.length + 1;
    this.reminders.push({ id, owner_id: owner, template_id: tid, occurrence: occ, kind });
    return Promise.resolve(id);
  }
  reminder(id: number) { return Promise.resolve(this.reminders.find((r) => r.id === id) ?? null); }
  skipBill(owner: string, tid: string, occ: string) { this.skipped.push(`${tid}@${occ}`); this.bills.find((b) => b.id === tid)!.skipped.push(occ); return Promise.resolve(); }
}

class FakeStore {
  written: { owner: string; email: string; tx: Record<string, unknown> }[] = [];
  plans = new Map<string, unknown>([
    [OWNER, { state: 'active', access: { telegram: 'write' } }],
    [WIFE, { state: 'free', access: { telegram: 'none' }, coveredBy: [{ ownerId: OWNER, access: 'write' }] }],
  ]);
  findLink(id: number) { return Promise.resolve(links.get(id) ?? null); }
  entitlements(user: string) { return Promise.resolve(this.plans.get(user) ?? null); }
  loadBook() { return Promise.resolve(new PocketBook({ user: { homeCurrency: 'INR', hijriOffset: 0, defaultPaymentType: 'cash' }, fxRates: { INR: 1 }, accounts: [], categories: [] })); }
  writerFor(owner: string, email: string) {
    return {
      add: (txs: Record<string, unknown>[]) => {
        if (this.written.some((w) => w.tx.id === txs[0].id)) return Promise.resolve('duplicate' as const);
        for (const tx of txs) this.written.push({ owner, email, tx });
        return Promise.resolve('saved' as const);
      },
    };
  }
}

class FakeTelegram {
  sent: { chat: number; text: string; keyboard?: unknown; thread?: number | null; id: number }[] = [];
  edits: { chat: number; id: number; text: string; keyboard?: unknown }[] = [];
  answers: (string | undefined)[] = [];
  #next = 1000;
  send(chat: number, text: string, opts: { keyboard?: unknown; threadId?: number | null } = {}) {
    const id = this.#next++;
    this.sent.push({ chat, text, keyboard: opts.keyboard, thread: opts.threadId, id });
    return Promise.resolve(id);
  }
  reply(chat: number, text: string) { return this.send(chat, text).then(() => undefined); }
  edit(chat: number, id: number, text: string, keyboard?: unknown) { this.edits.push({ chat, id, text, keyboard }); return Promise.resolve(); }
  answer(_id: string, text?: string) { this.answers.push(text); return Promise.resolve(); }
}

/** 15 Nov 2026 (Sunday) at a given India time, as ms. */
const at = (day: string, hhmm: string) => Date.parse(`${day}T${hhmm}:00+05:30`);
const clockAt = (day: string, hhmm: string) => new LocalClock('Asia/Kolkata', () => at(day, hhmm));
const rates = { current: () => Promise.resolve({ INR: 1 }) };

// ── T1 ─────────────────────────────────────────────────────────────────
{
  const it = { ...milk(), marks: { '2026-11-03': 2, '2026-11-04': 0 }, pauses: [{ from: '2026-11-10', to: '2026-11-12' }] };
  const d = new DeliveryDay(it);
  ok('T1 Mon–Sat, Sunday off; a changed day wins; a pause brings nothing', d.qtyOn('2026-11-01') === 0 && d.qtyOn('2026-11-02') === 1 && d.qtyOn('2026-11-03') === 2 && d.qtyOn('2026-11-04') === 0 && d.qtyOn('2026-11-11') === 0);
  const due = d.due('2026-11-07');
  ok('T1 owed for 1–7 Nov: 6 L = ₹384 (same as the app)', due!.qty === 6 && due!.days === 5 && due!.amount === 38400, JSON.stringify(due));
  ok('T1 marking the usual again is "clear"', d.markFor('2026-11-05', 1) === null && d.markFor('2026-11-05', 2) === 2 && d.markFor('2026-11-11', 0) === null);
  const paid = new DeliveryDay({ ...it, paidTo: '2026-11-07', prices: [{ from: '2000-01-01', unit: 6400 }, { from: '2026-11-09', unit: 6800 }] });
  ok('T1 owed starts after paid-up-to; new price from its day', paid.due('2026-11-09')!.from === '2026-11-08' && paid.due('2026-11-09')!.amount === 6800 && paid.isPaid('2026-11-07'));
  ok('T1 bill dates keep the day, clamped to short months', BillDates.step('2026-01-31', 'monthly', 1, 31) === '2026-02-28' && BillDates.step('2026-02-28', 'monthly', 1, 31) === '2026-03-31');
}

// ── T2 ─────────────────────────────────────────────────────────────────
{
  const dl = new FakeDeliveries(), st = new FakeStore(), tg = new FakeTelegram();
  const early = new CheckinRunner(st as unknown as PocketStore, dl as unknown as DeliveryStore, tg as unknown as TelegramClient, clockAt('2026-11-16', '08:55'));
  await early.run();
  ok('T2 before 9:00 nothing is sent', tg.sent.length === 0);
  const runner = new CheckinRunner(st as unknown as PocketStore, dl as unknown as DeliveryStore, tg as unknown as TelegramClient, clockAt('2026-11-16', '09:05'));
  await runner.run();
  ok('T2 at 9:05 on Monday: one message to each linked person, milk and paper in one slot', tg.sent.length === 2 && tg.sent.every((s) => /Milk: <b>1 L<\/b>/.test(s.text) && /Newspaper: <b>1<\/b>/.test(s.text)) && tg.sent.map((s) => s.chat).sort().join() === `${ME},${HER}`);
  await runner.run();
  ok('T2 a second run sends nothing more', tg.sent.length === 2);
  const late = new FakeTelegram();
  await new CheckinRunner(st as unknown as PocketStore, new FakeDeliveries() as unknown as DeliveryStore, late as unknown as TelegramClient, clockAt('2026-11-16', '12:30')).run();
  ok('T2 three hours after its time it waits for tomorrow', late.sent.length === 0);

  const one = new FakeDeliveries(); one.items = [{ ...milk(), checkinTo: 'one', checkinEmail: 'asha@x.com', checkinMinute: 420 }];
  const tg1 = new FakeTelegram();
  await new CheckinRunner(st as unknown as PocketStore, one as unknown as DeliveryStore, tg1 as unknown as TelegramClient, clockAt('2026-11-16', '07:10')).run();
  ok('T2 "one person" at 7:00 reaches only her', tg1.sent.length === 1 && tg1.sent[0].chat === HER);

  const grp = new FakeDeliveries(); grp.groupsOn = true; grp.items = [{ ...milk(), checkinTo: 'group' }];
  const tg2 = new FakeTelegram();
  await new CheckinRunner(st as unknown as PocketStore, grp as unknown as DeliveryStore, tg2 as unknown as TelegramClient, clockAt('2026-11-16', '09:00')).run();
  ok('T2 "family group" goes to the group\'s topic', tg2.sent.length === 1 && tg2.sent[0].chat === GROUP && tg2.sent[0].thread === 7);

  const dubai = new FakeDeliveries(); dubai.items = [{ ...milk(), checkinTz: 'Asia/Dubai' }];
  const tg3 = new FakeTelegram();
  await new CheckinRunner(st as unknown as PocketStore, dubai as unknown as DeliveryStore, tg3 as unknown as TelegramClient, clockAt('2026-11-16', '09:05')).run();
  ok('T2 an item in Dubai time waits for 9:00 there (10:30 in India)', tg3.sent.length === 0);
  await new CheckinRunner(st as unknown as PocketStore, dubai as unknown as DeliveryStore, tg3 as unknown as TelegramClient, clockAt('2026-11-16', '10:35')).run();
  ok('T2 … and goes then', tg3.sent.length === 2);

  const sunday = new FakeDeliveries(); sunday.items = [milk()];
  const tg4 = new FakeTelegram();
  await new CheckinRunner(st as unknown as PocketStore, sunday as unknown as DeliveryStore, tg4 as unknown as TelegramClient, clockAt('2026-11-15', '09:05')).run();
  ok('T2 nothing on a day off (Sunday)', tg4.sent.length === 0);
  const noPlan = new FakeStore(); noPlan.plans.set(OWNER, { state: 'lapsed', endsAt: '2026-11-10T00:00:00Z', access: { telegram: 'none' } });
  const tg5 = new FakeTelegram(), dl5 = new FakeDeliveries();
  await new CheckinRunner(noPlan as unknown as PocketStore, dl5 as unknown as DeliveryStore, tg5 as unknown as TelegramClient, clockAt('2026-11-16', '09:05')).run();
  ok('T2 owner\'s plan without Telegram: no check-in, one "paused" note to each person', tg5.sent.length === 2 && tg5.sent.every((m) => /paused/.test(m.text) && !/Deliveries/.test(m.text)));
  await new CheckinRunner(noPlan as unknown as PocketStore, dl5 as unknown as DeliveryStore, tg5 as unknown as TelegramClient, clockAt('2026-11-17', '09:05')).run();
  ok('T2 … only once for that plan end', tg5.sent.length === 2);
}

// ── T3 ─────────────────────────────────────────────────────────────────
{
  const dl = new FakeDeliveries(), st = new FakeStore(), tg = new FakeTelegram();
  const clock = clockAt('2026-11-16', '09:05');
  await new CheckinRunner(st as unknown as PocketStore, dl as unknown as DeliveryStore, tg as unknown as TelegramClient, clock).run();
  const bot = new DeliveryBot(st as unknown as PocketStore, dl as unknown as DeliveryStore, tg as unknown as TelegramClient, clock, rates as never);
  const tap = (from: number, data: string) => bot.handleCallback({ id: 'cb', from: { id: from }, data, message: { message_id: 1, chat: { id: from, type: 'private' } } });
  await tap(HER, 'dv:1:0:+');
  ok('T3 her + makes milk 2 L, saved as her', dl.items[0].marks!['2026-11-16'] === 2 && dl.changes[0].actor === WIFE);
  ok('T3 both copies redrawn with 2 L', tg.edits.length === 2 && tg.edits.every((e) => /Milk: <b>2 L<\/b> \(usual 1 L\)/.test(e.text)));
  await tap(ME, 'dv:1:0:-');
  ok('T3 my − takes it back to the usual (mark cleared)', !('2026-11-16' in dl.items[0].marks!));
  await tap(OTHER, 'dv:1:1:-');
  ok('T3 a stranger is refused', /permission|view|plan/i.test(tg.answers.at(-1) ?? '') && dl.items[1].marks!['2026-11-16'] === undefined, String(tg.answers.at(-1)));
  await tap(999, 'dv:1:ok');
  ok('T3 someone not linked is told to /link', /\/link/.test(tg.answers.at(-1) ?? ''));
  const before = tg.edits.length;
  await tap(HER, 'dv:1:ok');
  ok('T3 ✓ by Asha: every copy says so and loses its buttons', tg.edits.length === before + 2 && tg.edits.slice(-2).every((e) => /Confirmed by Asha/.test(e.text) && Array.isArray(e.keyboard) && (e.keyboard as unknown[]).length === 0));
  await tap(ME, 'dv:1:ok');
  ok('T3 a second ✓ is told who answered', /Already confirmed by Asha/.test(tg.answers.at(-1) ?? ''));
  await tap(ME, 'dv:1:0:=');
  ok('T3 the label button does nothing', dl.changes.length === 2);
}

{
  // T3b: the owner's plan ends after the check-in went out
  const dl = new FakeDeliveries(), st = new FakeStore(), tg = new FakeTelegram();
  const clock = clockAt('2026-11-16', '09:05');
  await new CheckinRunner(st as unknown as PocketStore, dl as unknown as DeliveryStore, tg as unknown as TelegramClient, clock).run();
  st.plans.set(OWNER, { state: 'grace', access: { telegram: 'read' } });
  st.plans.set(WIFE, { state: 'free', access: { telegram: 'none' }, coveredBy: [{ ownerId: OWNER, access: 'read' }] });
  const bot = new DeliveryBot(st as unknown as PocketStore, dl as unknown as DeliveryStore, tg as unknown as TelegramClient, clock, rates as never);
  await bot.handleCallback({ id: 'cb', from: { id: HER }, data: 'dv:1:0:+', message: { message_id: 1, chat: { id: HER, type: 'private' } } });
  ok('T3b her tap: "Not available on your plan", the reason in her chat, nothing changed',
    tg.answers.at(-1) === 'Not available on your plan' && /Family plan you log under has ended/.test(tg.sent.at(-1)!.text) && !dl.changes.length, tg.sent.at(-1)!.text);
  await bot.dues(links.get(ME)!, ME);
  ok('T3b /dues on a lapsed plan gives the plan message', /logging here is paused|part of Pocket/.test(tg.sent.at(-1)!.text), tg.sent.at(-1)!.text);
}

// ── T4 ─────────────────────────────────────────────────────────────────
{
  const dl = new FakeDeliveries(), st = new FakeStore(), tg = new FakeTelegram();
  const bot = new DeliveryBot(st as unknown as PocketStore, dl as unknown as DeliveryStore, tg as unknown as TelegramClient, clockAt('2026-11-16', '20:00'), rates as never);
  const say = (text: string, who = HER) => bot.tryText(links.get(who)!, who, 1, text);
  ok('T4 "no milk" → none today', await say('no milk') && dl.items[0].marks!['2026-11-16'] === 0 && /Milk today: none/.test(tg.sent.at(-1)!.text));
  ok('T4 "milk x2 yesterday" → 2 L on the 15th (a Sunday extra)', await say('milk x2 yesterday') && dl.items[0].marks!['2026-11-15'] === 2);
  ok('T4 "Milk 3 L" with the unit', await say('Milk 3 L') && dl.items[0].marks!['2026-11-16'] === 3);
  ok('T4 "doodhwala none" by vendor name', await say('doodhwala none') && dl.items[0].marks!['2026-11-16'] === 0);
  ok('T4 "milk 2" stays an expense entry', !(await say('milk 2')));
  ok('T4 "milk 2 kg" (wrong unit) stays an entry', !(await say('milk 2 kg')));
  ok('T4 "70 auto @taxi" is untouched', !(await say('70 auto @taxi')));
  ok('T4 a stranger\'s "no milk" isn\'t theirs to change', !(await say('no milk', OTHER)));
}

// ── T5 ─────────────────────────────────────────────────────────────────
{
  const dl = new FakeDeliveries(), st = new FakeStore(), tg = new FakeTelegram();
  dl.items[0].vendor = 'Doodhwala'; dl.items[1].vendor = 'doodhwala';
  const bot = new DeliveryBot(st as unknown as PocketStore, dl as unknown as DeliveryStore, tg as unknown as TelegramClient, clockAt('2026-11-07', '20:00'), rates as never);
  await bot.dues(links.get(HER)!, HER);
  const msg = tg.sent.at(-1)!;
  ok('T5 /dues: one vendor, both items, total 6 L + 7 papers = ₹440', tg.sent.length === 1 && /Doodhwala<\/b> · due ₹440/.test(msg.text) && /Milk: 6 L on 6 days/.test(msg.text) && /Newspaper: 7 on 7 days/.test(msg.text), msg.text);
  const data = (msg.keyboard as { callback_data: string }[][])[0][0].callback_data;
  await bot.handleCallback({ id: 'cb', from: { id: HER }, data, message: { message_id: msg.id, chat: { id: HER }, text: 'x' } });
  ok('T5 ✓ Paid: two expenses in the owner\'s book, as her, with what they cover', st.written.length === 2 && st.written.every((w) => w.owner === OWNER && w.email === 'asha@x.com' && (w.tx.settles as { to: string }).to === '2026-11-07')
     && st.written.find((w) => w.tx.regularItemId === 'ri_milk')!.tx.amount === 38400);
  ok('T5 both items paid up to the 7th', dl.items.every((i) => i.paidTo === '2026-11-07'));
  await bot.handleCallback({ id: 'cb', from: { id: ME }, data, message: { message_id: msg.id, chat: { id: ME }, text: 'x' } });
  ok('T5 tapping again records nothing more', st.written.length === 2 && /Already paid/.test(tg.answers.at(-1) ?? ''));
}

// ── T6 ─────────────────────────────────────────────────────────────────
{
  const bill = (): BillTemplate => ({
    ownerId: OWNER, id: 'tx_elec', payee: 'Electricity', amount: 184000, currency: 'INR', date: '2026-10-18', accountId: 'a1', categoryId: 'c9',
    rule: 'monthly', interval: 1, until: null, skipped: [], remindTo: 'all', remindEmail: null, remindDays: 2, lastAmount: 184000, paid: [],
  });
  ok('T6 2 days before: "before"; on the day: "due"; long past: nothing',
    BillReminderRunner.dueReminder(bill(), '2026-11-16')?.kind === 'before' && BillReminderRunner.dueReminder(bill(), '2026-11-18')?.kind === 'due'
    && BillReminderRunner.dueReminder(bill(), '2026-11-14') === null && BillReminderRunner.dueReminder({ ...bill(), paid: ['2026-11-18'] }, '2026-11-18') === null);
  const lapsed = new FakeStore(); lapsed.plans.set(OWNER, { state: 'lapsed', access: { telegram: 'none' } });
  const dlp = new FakeDeliveries(), tgp = new FakeTelegram();
  dlp.bills = [bill()];
  await new BillReminderRunner(lapsed as unknown as PocketStore, dlp as unknown as DeliveryStore, tgp as unknown as TelegramClient, clockAt('2026-11-16', '09:30')).run();
  ok('T6 no plan: no reminder, the "paused" note instead', tgp.sent.length === 2 && tgp.sent.every((m) => /paused/.test(m.text)) && !dlp.reminders.length);
  const dl = new FakeDeliveries(), st = new FakeStore(), tg = new FakeTelegram();
  dl.bills = [bill()];
  const run = (day: string, hhmm = '09:30') => new BillReminderRunner(st as unknown as PocketStore, dl as unknown as DeliveryStore, tg as unknown as TelegramClient, clockAt(day, hhmm)).run();
  await run('2026-11-16', '08:00');
  ok('T6 nothing before 9:00', tg.sent.length === 0);
  await run('2026-11-16'); await run('2026-11-16'); await run('2026-11-17');
  ok('T6 "due in 2 days" once, to both', tg.sent.length === 2 && tg.sent.every((s) => /Electricity is due in 2 days \(Wed 18 Nov\) · last time ₹1,840/.test(s.text)), tg.sent.map((s) => s.text).join(' | '));
  await run('2026-11-18');
  ok('T6 and "due today" on the day', tg.sent.length === 4 && /is due today/.test(tg.sent.at(-1)!.text));
  const bot = new DeliveryBot(st as unknown as PocketStore, dl as unknown as DeliveryStore, tg as unknown as TelegramClient, clockAt('2026-11-18', '10:00'), rates as never);
  const kb = tg.sent.at(-1)!.keyboard as { callback_data: string }[][];
  await bot.handleCallback({ id: 'cb', from: { id: HER }, data: kb[0][0].callback_data, message: { message_id: 9, chat: { id: HER }, text: 'x' } });
  const paid = st.written.at(-1)!.tx;
  ok('T6 ✓ Paid: the occurrence\'s copy with last time\'s amount, dated today', paid.id === 'tx_elec__2026-11-18' && paid.amount === 184000 && paid.date === '2026-11-18' && paid.recurringSourceId === 'tx_elec' && /Paid ₹1,840 by Asha/.test(tg.edits.at(-1)!.text));
  dl.bills[0].paid.push('2026-11-18');
  await bot.handleCallback({ id: 'cb', from: { id: ME }, data: kb[0][0].callback_data, message: { message_id: 9, chat: { id: ME }, text: 'x' } });
  ok('T6 the other copy\'s ✓ says it\'s done', /Already done/.test(tg.answers.at(-1) ?? ''));
  dl.bills = [{ ...bill(), date: '2026-10-20', paid: [] }];
  await run('2026-11-20');
  const skip = (tg.sent.at(-1)!.keyboard as { callback_data: string }[][])[0][1].callback_data;
  await bot.handleCallback({ id: 'cb', from: { id: HER }, data: skip, message: { message_id: 10, chat: { id: HER }, text: 'x' } });
  ok('T6 Skip needs edit access (she has add)', /edit access/.test(tg.answers.at(-1) ?? '') && !dl.skipped.length);
  await bot.handleCallback({ id: 'cb', from: { id: ME }, data: skip, message: { message_id: 10, chat: { id: ME }, text: 'x' } });
  ok('T6 the owner skips it', dl.skipped.join() === 'tx_elec@2026-11-20');
  dl.bills = [{ ...bill(), date: '2026-10-22' }];
  const n = st.written.length;
  ok('T6 "paid electricity 1950" pays the next open one (22 Nov) with that amount', await bot.tryText(links.get(ME)!, ME, 1, 'paid electricity 1,950') && st.written.length === n + 1 && st.written.at(-1)!.tx.amount === 195000 && st.written.at(-1)!.tx.id === 'tx_elec__2026-11-22');
  ok('T6 "paid gym 500" for no such bill is an ordinary message', !(await bot.tryText(links.get(ME)!, ME, 1, 'paid gym 500')));
}

// ── T7 adjustments ─────────────────────────────────────────────────────
{
  const dl = new FakeDeliveries(), st = new FakeStore(), tg = new FakeTelegram();
  dl.items = [{ ...milk(), paidTo: '2026-11-07', adjustments: [{ date: '2026-11-05', was: 1, now: 0, unit: 6400, settledIn: null }] }];
  const d = new DeliveryDay(dl.items[0]);
  ok('T7 a paid day changed afterwards: −₹64 on the next bill', d.openAdjustment === -6400 && d.due('2026-11-10')!.amount === 6400 && d.due('2026-11-10')!.adjust === -6400);
  ok('T7 with nothing else owed, the credit still shows', d.due('2026-11-07')!.amount === -6400 && d.due('2026-11-07')!.days === 0);
  const bot = new DeliveryBot(st as unknown as PocketStore, dl as unknown as DeliveryStore, tg as unknown as TelegramClient, clockAt('2026-11-10', '20:00'), rates as never);
  await bot.dues(links.get(ME)!, ME);
  ok('T7 /dues shows it (8–10 Nov: ₹128 − ₹64)', /2 L on 2 days \(8–10 Nov\) − ₹64 for paid days changed = ₹64/.test(tg.sent.at(-1)!.text), tg.sent.at(-1)!.text);
  const data = (tg.sent.at(-1)!.keyboard as { callback_data: string }[][])[0][0].callback_data;
  await bot.handleCallback({ id: 'cb', from: { id: ME }, data, message: { message_id: 1, chat: { id: ME }, text: 'x' } });
  ok('T7 paying includes it once; it\'s marked as in that payment', st.written.at(-1)!.tx.amount === 6400 && dl.items[0].adjustments![0].settledIn === st.written.at(-1)!.tx.id && new DeliveryDay(dl.items[0]).openAdjustment === 0);
}

ok('T* CheckinMessage buttons fit Telegram\'s 64 bytes', CheckinMessage.render(123456789, [milk(), paper()], '2026-11-16', null).keyboard.flat().every((b) => b.callback_data.length <= 64));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
