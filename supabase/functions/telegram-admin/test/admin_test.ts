/**
 * The admin bot with a fake database and a fake Telegram.
 * Run: deno run --import-map <map with a supabase-js stub> supabase/functions/telegram-admin/test/admin_test.ts
 */
import { AdminBot } from '../lib/AdminBot.ts';
import { AdminFormat } from '../lib/AdminFormat.ts';
import type { AdminEvent, AdminStore } from '../lib/AdminStore.ts';
import type { TelegramApi } from '../lib/TelegramApi.ts';
import { WebhookSecret } from '../lib/WebhookSecret.ts';

let passed = 0, failed = 0;
const ok = (label: string, cond: boolean, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};

const ADMIN = 111, STRANGER = 222;
class FakeStore {
  linked = new Set<number>([ADMIN]);
  done: number[] = [];
  due = false;
  requests_ = [{ id: 7, name: 'Asma <b>', email: 'a@x.in', reason: 'student', at: '2026-11-17T10:00:00Z' }];
  decided: string[] = [];
  autoCalls: unknown[] = [];
  link(code: string, chat: number) { if (code === 'GOOD1234') { this.linked.add(chat); return Promise.resolve({ ok: true, email: 'me@x.in' }); } return Promise.resolve({ ok: false }); }
  isAdmin(chat: number) { return Promise.resolve(this.linked.has(chat)); }
  chats() { return Promise.resolve([...this.linked]); }
  stats() {
    return Promise.resolve({ users: 120, newToday: 3, new7: 12, new30: 40, active7: 25, recorded7: 18, plans: { family: 5, group: 1, promise: 4, family_trial: 2 },
      expiring7: 2, plus: 3, freeApproved: 12, freeWaiting: 1, auto: { used: 12, limit: 50 }, feedbackNew: 1, telegram: 9, aiUses30: 140,
      todayInr: 114900, todayUsd: 2499, monthInr: 840000, monthUsd: 4998, paymentsToday: 3, programme: { waitlisted: 6 } });
  }
  botSpeed() { return Promise.resolve({ count24: 26, avg24: 2.4, p90_24: 4.8, count3d: 40, avg3d: 2.5, failed3d: 0 }); }
  requests() { return Promise.resolve(this.requests_); }
  setRequest(chat: number, id: number, status: string) {
    if (!this.linked.has(chat)) throw new Error('not an admin');
    if (this.decided.includes(String(id))) return Promise.resolve({ ok: false });
    this.decided.push(String(id));
    return Promise.resolve({ ok: true, name: 'Asma', email: 'a@x.in', validUntil: '2027-05-17T10:00:00Z', status });
  }
  auto(_c: number, limit: number | null, reset: boolean) { this.autoCalls.push({ limit, reset }); return Promise.resolve({ limit: limit ?? 50, used: reset ? 0 : 12 }); }
  eventsDone(ids: number[]) { this.done.push(...ids); return Promise.resolve(); }
  summaryDue() { const d = this.due; this.due = false; return Promise.resolve(d); }
}
type Sent = { chat: number; html: string; buttons: unknown };
class FakeTg {
  sent: Sent[] = []; edits: { chat: number; html: string }[] = []; answers: string[] = [];
  send(chat: number, html: string, buttons: unknown = null) { this.sent.push({ chat, html, buttons }); return Promise.resolve({}); }
  edit(chat: number, _m: number, html: string) { this.edits.push({ chat, html }); return Promise.resolve({}); }
  answer(_id: string, text = '') { this.answers.push(text); return Promise.resolve({}); }
}
const make = () => { const s = new FakeStore(), t = new FakeTg(); return { s, t, bot: new AdminBot(s as unknown as AdminStore, t as unknown as TelegramApi) }; };
const msg = (chat: number, text: string) => ({ message: { chat: { id: chat, type: 'private' }, text } });
console.log('\ntelegram-admin');
{
  const { s, t, bot } = make();
  await bot.update(msg(ADMIN, '/stats'));
  const h = t.sent[0]?.html ?? '';
  ok('A1 /stats: users, plans, money in ₹ and $, reply time', /Users<\/b> 120 · today \+3/.test(h) && /Pocket Pro 5/.test(h) && /3-month offer 2/.test(h) && /Pocket Plus 3/.test(h)
     && /₹1,149 \+ \$24\.99 \(3 payments\)/.test(h) && /replies 2\.4 s average \(90% within 4\.8 s\) over 26 messages in 24 h/.test(h), h);
  ok('A1 /stats: what is waiting for you', /1 free requests · 1 feedback/.test(h) && /automatic 12 of 50/.test(h));
  void s;
}
{
  const { t, bot } = make();
  await bot.update(msg(STRANGER, '/stats'));
  await bot.update(msg(STRANGER, '/requests'));
  ok('A2 a stranger gets no answer', t.sent.length === 0);
  await bot.update(msg(STRANGER, '/start'));
  ok('A2 /start without a code: only a pointer, nothing else', t.sent.length === 1 && /admin dashboard/.test(t.sent[0].html) && !/Users/.test(t.sent[0].html));
  await bot.update({ message: { chat: { id: ADMIN, type: 'group' }, text: '/stats' } });
  ok('A2 group chats are ignored, even an admin\'s', t.sent.length === 1);
}
{
  const { s, t, bot } = make();
  await bot.update(msg(STRANGER, '/start WRONG'));
  ok('A3 a wrong code: not linked', /didn't work/.test(t.sent[0].html) && !s.linked.has(STRANGER));
  await bot.update(msg(STRANGER, '/start GOOD1234'));
  ok('A3 the right code links the chat', s.linked.has(STRANGER) && /Linked to me@x\.in/.test(t.sent[1].html));
}
{
  const { s, t, bot } = make();
  await bot.update(msg(ADMIN, '/requests'));
  ok('A4 /requests: each with Approve / Decline, names escaped', /Asma &lt;b&gt;/.test(t.sent[0].html)
     && JSON.stringify(t.sent[0].buttons).includes('fr:a:7') && JSON.stringify(t.sent[0].buttons).includes('fr:d:7'));
  await bot.update({ callback_query: { id: 'q1', data: 'fr:a:7', message: { message_id: 50, chat: { id: ADMIN } } } });
  ok('A4 Approve: approved, the message says until when', s.decided.includes('7') && /Approved<\/b> · Asma/.test(t.edits[0]?.html ?? '') && /17 May 2027/.test(t.edits[0].html) && t.answers[0] === 'Approved');
  await bot.update({ callback_query: { id: 'q2', data: 'fr:d:7', message: { message_id: 50, chat: { id: ADMIN } } } });
  ok('A4 a second tap: already decided', t.answers[1] === 'Already decided' && t.edits.length === 1);
  await bot.update({ callback_query: { id: 'q3', data: 'fr:a:8', message: { message_id: 51, chat: { id: STRANGER } } } });
  ok('A4 a stranger\'s tap does nothing', !s.decided.includes('8'));
  s.requests_ = [];
  await bot.update(msg(ADMIN, '/requests'));
  ok('A4 nothing waiting: said so', /No free requests waiting/.test(t.sent.at(-1)!.html));
}
{
  const { s, t, bot } = make();
  await bot.update(msg(ADMIN, '/auto'));
  await bot.update(msg(ADMIN, '/auto 80'));
  await bot.update(msg(ADMIN, '/auto reset'));
  await bot.update(msg(ADMIN, '/auto lots'));
  ok('A5 /auto shows, sets and resets', JSON.stringify(s.autoCalls) === JSON.stringify([{ limit: null, reset: false }, { limit: 80, reset: false }, { limit: null, reset: true }])
     && /12 of 50 used · 38 left/.test(t.sent[0].html) && /Limit set to 80/.test(t.sent[1].html) && /Count reset to 0/.test(t.sent[2].html) && /\/auto 80/.test(t.sent[3].html));
}
{
  const { s, t, bot } = make();
  s.linked.add(333);
  const list: AdminEvent[] = [
    { id: 1, kind: 'payment', payload: { product: 'family_year', amountPaise: 99900, currency: 'INR', email: 'p@x.in' }, at: '' },
    { id: 2, kind: 'payment', payload: { product: 'ai_pack', amountPaise: 10000, currency: 'USD', chargedMinor: 200, email: 'u@x.com', coupon: 'TEN' }, at: '' },
    { id: 3, kind: 'free_request', payload: { id: 9, name: 'Zed', email: 'z@x.in', reason: 'saving', status: 'pending', auto: false }, at: '' },
    { id: 4, kind: 'free_request', payload: { id: 10, name: 'Ali', email: 'al@x.in', reason: 'student', status: 'approved', auto: true }, at: '' },
    { id: 5, kind: 'feedback', payload: { email: 'f@x.in', kind: 'idea', message: 'Dark <mode>' }, at: '' },
  ];
  (s as unknown as { events: () => Promise<AdminEvent[]> }).events = () => Promise.resolve(list);
  s.due = true;
  const r = await bot.notify();
  const to111 = t.sent.filter((x) => x.chat === ADMIN).map((x) => x.html);
  ok('A6 alerts go to every linked admin', r.sent === 5 && t.sent.filter((x) => x.chat === 333).length === 6 && to111.length === 6);
  ok('A6 payments in ₹ and $, with product and code', /Payment<\/b> · ₹999 · Pocket Pro · 1 year/.test(to111[0]) && /\$2\.00 · AI pack · code TEN/.test(to111[1]));
  ok('A6 a waiting request has buttons; an automatic approval doesn\'t', JSON.stringify(t.sent.find((x) => /Zed/.test(x.html))?.buttons).includes('fr:a:9')
     && /approved automatically/.test(to111[3]) && t.sent.find((x) => /Ali/.test(x.html))?.buttons === null);
  ok('A6 feedback is escaped', /Dark &lt;mode&gt;/.test(to111[4]));
  ok('A6 sent alerts are marked done', s.done.join() === '1,2,3,4,5');
  ok('A6 the evening summary once', r.summary === true && /Today's summary/.test(to111[5]));
  const again = await bot.notify();
  ok('A6 nothing twice', again.summary === false);
}
{
  const a = await WebhookSecret.from('123:abc'), b = await WebhookSecret.from('123:abd');
  ok('A7 webhook secret: 48 hex characters, depends on the token', /^[0-9a-f]{48}$/.test(a) && a !== b);
  ok('A7 money', AdminFormat.money(114900, 0) === '₹1,149' && AdminFormat.money(0, 2499) === '₹0 + $24.99');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
