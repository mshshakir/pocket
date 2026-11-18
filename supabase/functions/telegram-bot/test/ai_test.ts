/**
 * AI on Telegram, with a fake database, a fake Telegram and a fake Gemini.
 * Run: deno run --allow-all --import-map <map with a supabase-js stub> supabase/functions/telegram-bot/test/ai_test.ts
 *
 *   A1  What can be read: voice notes, audio, photos, PDF bills (by type or by name); not other files
 *   A2  The AI's answer: only lines that start with an amount get through, at most 20
 *   A3  The prompt offers the person's accounts and categories as tokens the parser understands
 *   A4  A voice note: charged, downloaded, read, recorded as lines; the reply shows what was heard and the cost
 *   A5  A PDF receipt is sent to the AI as application/pdf and charged as a scan
 *   A6  The AI service fails → credits given back, "You weren't charged"
 *   A7  No credits → nothing downloaded or recorded, told how to buy a pack
 *   A8  The default account is in a shared book → the family pool pays; no access → own credits
 *   A9  A typed message with no amount: worked out (free within the daily limit); a question asks consent first
 *   A13 After the daily free ones: 1 credit each; none left → the usual hint, nothing sent to the AI
 *   A10 "Allow" → stored, then the question is answered from totals (1 credit)
 *   A11 EntryParser.hasAmount tells typed entries from messages for the AI
 */
import { AiAssistant } from '../lib/AiAssistant.ts';
import { AiModel, AiModelError, type AiPart } from '../lib/AiModel.ts';
import { AiPrompts } from '../lib/AiPrompts.ts';
import { EntryParser } from '../lib/EntryParser.ts';
import { LocalClock } from '../lib/LocalClock.ts';
import { PocketBook } from '../lib/PocketBook.ts';
import { Workspace } from '../lib/Workspace.ts';
import type { AiCharge, Insights, PocketStore, TelegramLink } from '../lib/PocketStore.ts';
import type { TelegramClient } from '../lib/TelegramClient.ts';
import type { TelegramMessage } from '../lib/BotController.ts';

let passed = 0, failed = 0;
const ok = (label: string, cond: boolean, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nAI on Telegram');

// ── fakes ─────────────────────────────────────────────────────────────────
const ME = 'u1', FAMILY = 'u9', CHAT = 7;
const book = new PocketBook({
  user: { homeCurrency: 'INR', defaultPaymentType: 'card' },
  accounts: [{ id: 'a1', name: 'HDFC Bank', currency: 'INR' }, { id: 'a2', name: 'Cash', currency: 'INR' }],
  categories: [
    { id: 'm1', name: 'Food', type: 'expense' }, { id: 's1', name: 'Groceries', type: 'expense', parentId: 'm1' },
    { id: 'm2', name: 'Work', type: 'income' }, { id: 's2', name: 'Salary', type: 'income', parentId: 'm2' },
  ],
});
const familyBook = new PocketBook({
  user: { homeCurrency: 'INR' },
  accounts: [{ id: 'f1', name: 'House', currency: 'INR' }],
  categories: [{ id: 'm1', name: 'Home', type: 'expense' }, { id: 's1', name: 'Rent', type: 'expense', parentId: 'm1' }],
  family: [{ email: 'me@x.com', permissions: [{ accountId: 'f1', access: 'add' }] }],
});

class FakeStore {
  charges: { user: string; book: string; ref: string; kind: string; seconds: number }[] = [];
  refunds: string[] = [];
  allowed = false;
  credits = 100;
  shared = false;
  noAccessFor = new Set<string>();
  textFreeLeft = 20;
  textRefs: string[] = [];
  aiText(user: string, ref: string): Promise<AiCharge> {
    this.textRefs.push(ref);
    if (this.textFreeLeft > 0) { this.textFreeLeft--; return Promise.resolve({ ok: true, free: true, freeLeft: this.textFreeLeft }); }
    return this.aiCharge(user, user, ref, 'text', 0);
  }
  entitlements() { return Promise.resolve({ state: 'active', access: { telegram: 'write' }, coveredBy: [{ ownerId: FAMILY, access: 'write' }] }); }
  sharesFor() { return Promise.resolve(this.shared ? [{ ownerId: FAMILY, ownerName: 'Abbas' }] : []); }
  tryLoadBook(id: string) { return Promise.resolve(id === FAMILY ? familyBook : book); }
  aiCharge(user: string, bookId: string, ref: string, kind: string, seconds: number): Promise<AiCharge> {
    this.charges.push({ user, book: bookId, ref, kind, seconds });
    if (this.noAccessFor.has(bookId)) return Promise.resolve({ ok: false, reason: 'no_access' });
    const cost = kind === 'voice' ? Math.max(1, Math.ceil(seconds / 30)) : kind === 'question' || kind === 'text' ? 1 : 5;
    if (cost > this.credits) return Promise.resolve({ ok: false, reason: 'no_credits', cost, remaining: this.credits });
    this.credits -= cost;
    return Promise.resolve({ ok: true, chargedTo: bookId === user ? 'own' : 'family', cost, remaining: this.credits });
  }
  aiRefund(_u: string, ref: string) { this.refunds.push(ref); return Promise.resolve(); }
  allowAiQuestions() { this.allowed = true; return Promise.resolve(); }
  insights(): Promise<Insights> {
    const p = (spent: number) => ({ from: '2026-11-01', to: '2026-11-18', spent, received: 0, entries: 3,
      categories: [{ type: 'expense' as const, main: 'Food', sub: 'Groceries', amount: spent }] });
    return Promise.resolve({ currency: 'INR', today: '2026-11-18', thisMonth: p(450000), lastMonth: p(600000),
      budgets: [{ name: 'Groceries', from: '2026-11-01', to: '2026-11-30', currency: 'INR', spent: 450000, limit: 800000 }] });
  }
}

class FakeTelegram {
  replies: string[] = [];
  sent: { text: string; keyboard?: unknown }[] = [];
  edits: string[] = [];
  downloads = 0;
  file: Uint8Array | null = new Uint8Array([1, 2, 3, 4]);
  reply(_c: number, text: string) { this.replies.push(text); return Promise.resolve(); }
  send(_c: number, text: string, o: { keyboard?: unknown } = {}) { this.sent.push({ text, keyboard: o.keyboard }); return Promise.resolve(1); }
  edit(_c: number, _m: number, text: string) { this.edits.push(text); return Promise.resolve(); }
  answer() { return Promise.resolve(); }
  download() { this.downloads++; return Promise.resolve(this.file); }
}

class FakeModel {
  calls: AiPart[][] = [];
  answers: (string | Error)[] = [];
  generate(parts: AiPart[]): Promise<string> {
    this.calls.push(parts);
    const a = this.answers.shift() ?? '{"kind":"none","heard":"","lines":[]}';
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
  }
}

const clock = new LocalClock('Asia/Kolkata', () => Date.parse('2026-11-18T08:00:00Z'));
const link: TelegramLink = { chat_id: CHAT, user_id: ME, email: 'me@x.com', default_owner_id: ME, default_account_id: 'a1' };
function setup(over: Partial<TelegramLink> = {}) {
  const store = new FakeStore(), tg = new FakeTelegram(), model = new FakeModel();
  const ai = new AiAssistant(store as unknown as PocketStore, tg as unknown as TelegramClient, model as unknown as AiModel, clock);
  const recorded: string[] = [];
  return { store, tg, model, ai, recorded, link: { ...link, ...over }, record: (t: string) => { recorded.push(t); return Promise.resolve(); } };
}
const ws = (store: FakeStore, l: TelegramLink = link) => Workspace.load(store as unknown as PocketStore, l);
const msg = (over: Partial<TelegramMessage>): TelegramMessage => ({ message_id: 42, chat: { id: CHAT, type: 'private' }, ...over });

// ── A1 ────────────────────────────────────────────────────────────────────
{
  const v = AiAssistant.mediaOf(msg({ voice: { file_id: 'v', duration: 12, mime_type: 'audio/ogg', file_size: 9000 } }));
  ok('A1 a voice note', v?.source === 'voice' && v.seconds === 12 && v.mime === 'audio/ogg');
  const p = AiAssistant.mediaOf(msg({ photo: [{ file_id: 'small', file_size: 1000 }, { file_id: 'big', file_size: 200000 }, { file_id: 'huge', file_size: 9_000_000 }] }));
  ok('A1 a photo: the largest size that fits', p?.source === 'receipt' && p.fileId === 'big', p?.fileId);
  const pdf = AiAssistant.mediaOf(msg({ document: { file_id: 'd', mime_type: 'application/pdf', file_name: 'bill.pdf', file_size: 50000 } }));
  ok('A1 a PDF bill', pdf?.source === 'receipt' && pdf.mime === 'application/pdf');
  const named = AiAssistant.mediaOf(msg({ document: { file_id: 'd', mime_type: 'application/octet-stream', file_name: 'Invoice-Nov.PDF' } }));
  ok('A1 a PDF with no type is known by its name', named?.mime === 'application/pdf', named?.mime);
  ok('A1 other files are left alone', AiAssistant.mediaOf(msg({ document: { file_id: 'd', mime_type: 'application/zip', file_name: 'x.zip' } })) === null
    && AiAssistant.mediaOf(msg({ text: '500 lunch' })) === null);
}

// ── A2 ────────────────────────────────────────────────────────────────────
{
  const r = AiPrompts.readEntries('```json\n{"kind":"entries","heard":"450 groceries","lines":["450 groceries @foodgroceries","/unlink","hello","+45000 salary"]}\n```');
  ok('A2 only entries that start with an amount', r.kind === 'entries' && r.lines.join('|') === '450 groceries @foodgroceries|+45000 salary', r.lines.join('|'));
  ok('A2 a question', AiPrompts.readEntries('{"kind":"question","heard":"how much on food","lines":[]}').kind === 'question');
  ok('A2 nonsense is "none"', AiPrompts.readEntries('sorry').kind === 'none' && AiPrompts.readEntries('{"kind":"entries","lines":["no amount"]}').kind === 'none');
  const many = AiPrompts.readEntries(JSON.stringify({ kind: 'entries', lines: Array.from({ length: 30 }, (_, i) => `${i + 1} x`) }));
  ok('A2 at most 20 lines', many.lines.length === 20);
}

// ── A3 ────────────────────────────────────────────────────────────────────
{
  const { store } = setup();
  const w = await ws(store);
  const prompt = AiPrompts.entries('voice', w, book, 'HDFC Bank', '2026-11-18');
  ok('A3 accounts and categories as tokens', prompt.includes('#hdfcbank') && prompt.includes('@foodgroceries') && prompt.includes('@worksalary'));
  ok('A3 today and the default account', prompt.includes('Today is 18/11/2026') && prompt.includes('default: HDFC Bank'));
}

// ── A4 ────────────────────────────────────────────────────────────────────
{
  const t = setup();
  t.model.answers.push('{"kind":"entries","heard":"Spent 450 on groceries from HDFC","lines":["450 groceries @foodgroceries #hdfcbank"]}');
  const m = msg({ voice: { file_id: 'v', duration: 40, mime_type: 'audio/ogg', file_size: 9000 } });
  await t.ai.handleMedia(t.link, CHAT, m, AiAssistant.mediaOf(m)!, await ws(t.store), t.record);
  ok('A4 charged for 40 seconds of voice', t.store.charges[0]?.kind === 'voice' && t.store.charges[0].seconds === 40 && t.store.charges[0].ref === 'tg:7:42');
  ok('A4 the audio and the prompt went to the AI', t.model.calls[0]?.length === 2 && 'inline_data' in t.model.calls[0][0]);
  ok('A4 recorded as a typed line', t.recorded[0] === '450 groceries @foodgroceries #hdfcbank', t.recorded[0]);
  ok('A4 the reply shows what was heard and the cost', /Heard: “Spent 450/.test(t.tg.replies[0]) && /2 AI credits, 98 left/.test(t.tg.replies[0]), t.tg.replies[0]);
}

// ── A5 ────────────────────────────────────────────────────────────────────
{
  const t = setup();
  t.model.answers.push('{"kind":"entries","heard":"Tata Power bill, total 2,340","lines":["2340 tata power"]}');
  const m = msg({ document: { file_id: 'd', mime_type: 'application/pdf', file_name: 'bill.pdf', file_size: 80000 }, caption: 'electricity' });
  await t.ai.handleMedia(t.link, CHAT, m, AiAssistant.mediaOf(m)!, await ws(t.store), t.record);
  const part = t.model.calls[0]?.[0] as { inline_data?: { mime_type: string } };
  ok('A5 the PDF is sent as application/pdf', part?.inline_data?.mime_type === 'application/pdf');
  ok('A5 charged as a scan, caption passed on', t.store.charges[0]?.kind === 'receipt' && JSON.stringify(t.model.calls[0]).includes('electricity'));
  ok('A5 recorded', t.recorded[0] === '2340 tata power' && /📷 Read/.test(t.tg.replies[0]));
}

// ── A6 ────────────────────────────────────────────────────────────────────
{
  const t = setup();
  t.model.answers.push(new AiModelError('The AI service could not be reached. Please try again.'));
  const m = msg({ voice: { file_id: 'v', duration: 5 } });
  await t.ai.handleMedia(t.link, CHAT, m, AiAssistant.mediaOf(m)!, await ws(t.store), t.record);
  ok('A6 refunded and told', t.store.refunds[0] === 'tg:7:42' && /weren't charged/.test(t.tg.replies[0]) && !t.recorded.length);
}

// ── A7 ────────────────────────────────────────────────────────────────────
{
  const t = setup();
  t.store.credits = 2;
  const m = msg({ photo: [{ file_id: 'p', file_size: 1000 }] });
  await t.ai.handleMedia(t.link, CHAT, m, AiAssistant.mediaOf(m)!, await ws(t.store), t.record);
  ok('A7 nothing downloaded or recorded', t.tg.downloads === 0 && !t.model.calls.length && !t.recorded.length);
  ok('A7 told how many are needed and where to buy', /needs 5 AI credits and you have 2/.test(t.tg.replies[0]) && /Settings → Your plan/.test(t.tg.replies[0]), t.tg.replies[0]);
}

// ── A8 ────────────────────────────────────────────────────────────────────
{
  const t = setup({ default_owner_id: FAMILY, default_account_id: 'f1' });
  t.store.shared = true;
  t.model.answers.push('{"kind":"entries","heard":"rent","lines":["20000 rent"]}');
  const m = msg({ voice: { file_id: 'v', duration: 10 } });
  await t.ai.handleMedia(t.link, CHAT, m, AiAssistant.mediaOf(m)!, await ws(t.store, t.link), t.record);
  ok('A8 the family pool pays in a shared space', t.store.charges[0]?.book === FAMILY && /left in the family pool/.test(t.tg.replies[0]), t.tg.replies[0]);
  const u = setup({ default_owner_id: FAMILY, default_account_id: 'f1' });
  u.store.shared = true;
  u.store.noAccessFor.add(FAMILY);
  u.model.answers.push('{"kind":"entries","heard":"rent","lines":["20000 rent"]}');
  await u.ai.handleMedia(u.link, CHAT, m, AiAssistant.mediaOf(m)!, await ws(u.store, u.link), u.record);
  ok('A8 no access to the pool → own credits', u.store.charges.map((c) => c.book).join(',') === `${FAMILY},${ME}` && u.recorded.length === 1);
}

// ── A9 ────────────────────────────────────────────────────────────────────
{
  const t = setup();
  t.model.answers.push('{"kind":"entries","heard":"gave Ali five thousand","lines":["5000 gave ali"]}');
  const done = await t.ai.interpret(t.link, CHAT, 42, 'gave ali five thousand', await ws(t.store), t.record);
  ok('A9 worked out for free', done && !t.store.charges.length && t.store.textRefs[0] === 'tgt:7:42' && t.recorded[0] === '5000 gave ali' && /Understood as/.test(t.tg.replies[0]));
  const q = setup();
  q.model.answers.push('{"kind":"question","heard":"how much left for groceries","lines":[]}');
  const asked = await q.ai.interpret(q.link, CHAT, 43, "what's left for groceries?", await ws(q.store), q.record);
  ok('A9 a question asks consent first, charging nothing', asked && !q.store.charges.length && /Allow questions/.test(q.tg.sent[0]?.text ?? '') && !!q.tg.sent[0]?.keyboard);
  const n = setup();
  n.model.answers.push('{"kind":"none","heard":"hi","lines":[]}');
  ok('A9 small talk falls back to the usual message', !(await n.ai.interpret(n.link, CHAT, 44, 'hello', await ws(n.store), n.record)));
}

// ── A10 ───────────────────────────────────────────────────────────────────
{
  const t = setup();
  t.model.answers.push('You have ₹3,500 left of your ₹8,000 groceries budget.');
  await t.ai.handleCallback({
    id: 'cb', data: 'aiq:yes',
    message: msg({ message_id: 50, reply_to_message: msg({ message_id: 43, text: "what's left for groceries?" }) }),
  }, t.link);
  ok('A10 consent stored', t.store.allowed && /Questions are on/.test(t.tg.edits[0] ?? ''));
  const prompt = JSON.stringify(t.model.calls[0] ?? []);
  ok('A10 answered from totals', prompt.includes('Groceries') && prompt.includes('limit') && !prompt.includes('#hdfcbank'));
  ok('A10 1 credit, own book', t.store.charges[0]?.kind === 'question' && t.store.charges[0].book === ME && /₹3,500 left/.test(t.tg.replies[0]) && /1 AI credit,/.test(t.tg.replies[0]), t.tg.replies[0]);
  const again = setup({ ai_questions: true });
  again.model.answers.push('{"kind":"question","heard":"","lines":[]}', 'You spent ₹4,500 on food this month.');
  await again.ai.interpret(again.link, CHAT, 60, 'how much on food this month', await ws(again.store), again.record);
  ok('A10 once allowed, questions are answered straight away', !again.tg.sent.length && /₹4,500/.test(again.tg.replies[0] ?? ''));
}

// ── A13 ───────────────────────────────────────────────────────────────────
{
  const t = setup();
  t.store.textFreeLeft = 1;
  t.model.answers.push('{"kind":"entries","heard":"","lines":["80 chai"]}', '{"kind":"entries","heard":"","lines":["60 auto"]}');
  await t.ai.interpret(t.link, CHAT, 70, 'chai eighty', await ws(t.store), t.record);
  ok('A13 the last free one says so', /last free one/.test(t.tg.replies[0] ?? '') && !t.store.charges.length, t.tg.replies[0]);
  await t.ai.interpret(t.link, CHAT, 71, 'auto sixty', await ws(t.store), t.record);
  ok('A13 then 1 credit each', t.store.charges[0]?.kind === 'text' && /1 AI credit, 99 left/.test(t.tg.replies[1] ?? '') && t.recorded.length === 2, t.tg.replies[1]);
  const n = setup();
  n.store.textFreeLeft = 0; n.store.credits = 0;
  const handled = await n.ai.interpret(n.link, CHAT, 72, 'auto sixty', await ws(n.store), n.record);
  ok('A13 none left: the usual hint, nothing sent to the AI', handled && !n.model.calls.length && /Start with the amount/.test(n.tg.replies[0] ?? '') && !n.recorded.length);
  const f = setup();
  f.store.textFreeLeft = 0;
  f.model.answers.push(new AiModelError('down'));
  ok('A13 AI failure after the limit: refunded, falls back', !(await f.ai.interpret(f.link, CHAT, 73, 'auto sixty', await ws(f.store), f.record)) && f.store.refunds[0] === 'tgt:7:73');
}

// ── A11 ───────────────────────────────────────────────────────────────────
ok('A11 hasAmount', EntryParser.hasAmount('500 lunch') && EntryParser.hasAmount('₹1,250 rent') && !EntryParser.hasAmount('gave ali five thousand') && !EntryParser.hasAmount("what's left for groceries?"));

// AiModel.base64 handles large files without blowing the stack.
ok('A12 base64 of a large file', AiModel.base64(new Uint8Array(200_000)).length === 266_668);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
