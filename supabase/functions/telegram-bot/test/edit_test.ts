/**
 * The ✏️ Edit menu and new accounts / categories, with a fake database and a fake Telegram.
 * Run: deno run --allow-all --import-map <map with a supabase-js stub> supabase/functions/telegram-bot/test/edit_test.ts
 *
 *   E1  A new entry shows one ✏️ Edit button
 *   E2  Edit opens the menu: Amount · Account · Category / Date · Note / Delete · Done (no payment type)
 *   E3  Amount typed: same rows rewritten, who entered it and when kept; confirmation updated in place
 *   E4  Category with buttons: main → subcategory
 *   E5  Date "Yesterday", note cleared with "-", account (payment type follows the account)
 *   E6  Delete asks once more; "Keep it" goes back; "Yes, delete" removes
 *   E7  Done puts the single button back; an old pick with nothing waiting has expired
 *   E8  A transfer: From / To; the same account on both sides is refused
 *   E9  A "will be paid back" mark survives a change
 *   C1  /newaccount HDFC Savings bank: added straight away (home currency, no balance)
 *   C2  /newaccount step by step, with a starting balance written as an Opening balance entry
 *   C3  A name already used is refused
 *   C4  /newcategory Petrol: spending → main → added under it
 *   C5  ➕ New "Petrol" in the category picker: made, and the waiting entry saved with it
 *   C6  No ➕ New in a shared book
 */
import { BookCreator } from '../lib/BookCreator.ts';
import { EntryEditor } from '../lib/EntryEditor.ts';
import { EntryService } from '../lib/EntryService.ts';
import { LocalClock } from '../lib/LocalClock.ts';
import { PocketBook } from '../lib/PocketBook.ts';
import type { PendingStep, PocketStore, TelegramLink } from '../lib/PocketStore.ts';
import type { TelegramClient, Keyboard } from '../lib/TelegramClient.ts';
import type { ExchangeRates } from '../lib/ExchangeRates.ts';
import type { TelegramCallback } from '../lib/BotController.ts';

let passed = 0, failed = 0;
const ok = (label: string, cond: boolean, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nEdit menu, new accounts and categories');

const ME = 'u1', FAMILY = 'u9', CHAT = 7;
const bookData = () => ({
  user: { homeCurrency: 'INR', defaultPaymentType: 'card', hijriOffset: 0 }, fxRates: { INR: 83, USD: 1 },
  accounts: [{ id: 'a1', name: 'HDFC', currency: 'INR', type: 'bank' }, { id: 'a2', name: 'Cash', currency: 'INR', type: 'cash' }, { id: 'a3', name: 'Wise', currency: 'USD', type: 'bank' }],
  categories: [
    { id: 'm1', name: 'Food', type: 'expense', icon: 'utensils', color: '#f97316' },
    { id: 's1', name: 'Groceries', type: 'expense', parentId: 'm1' }, { id: 's2', name: 'Restaurant', type: 'expense', parentId: 'm1' },
    { id: 'm2', name: 'Transport', type: 'expense', icon: 'car', color: '#3b82f6' }, { id: 's3', name: 'Taxi', type: 'expense', parentId: 'm2' },
  ],
});

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

class FakeStore {
  rows = new Map<string, Row>();          // book owner + id → row
  pending: PendingStep | null = null;
  applied: { owner: string; changes: Row }[] = [];
  replaced: Row[][] = [];
  data = bookData();
  shared = false;
  entitlements() { return Promise.resolve({ state: 'active', access: { telegram: 'write' }, coveredBy: [{ ownerId: FAMILY, access: 'write' }] }); }
  sharesFor() { return Promise.resolve(this.shared ? [{ ownerId: FAMILY, ownerName: 'Abbas' }] : []); }
  tryLoadBook(id: string) {
    if (id === FAMILY) return Promise.resolve(new PocketBook({ ...bookData(), accounts: [{ id: 'f1', name: 'House', currency: 'INR' }], family: [{ email: 'me@x.com', permissions: [{ accountId: 'f1', access: 'add' }] }] }));
    return Promise.resolve(new PocketBook(this.data));
  }
  loadBook(id: string) { return this.tryLoadBook(id); }
  getPending() { return Promise.resolve(this.pending ? structuredClone(this.pending) : null); }
  setPending(_c: number, step: PendingStep) { this.pending = structuredClone(step); return Promise.resolve(); }
  clearPending() { this.pending = null; return Promise.resolve(); }
  botEntry(owner: string, ids: string[]) { return Promise.resolve(ids.map((id) => this.rows.get(`${owner}:${id}`)).filter((r) => r && !r.deleted).map((r) => structuredClone(r))); }
  applyOwn(owner: string, changes: Row) {
    this.applied.push({ owner, changes: structuredClone(changes) });
    for (const a of changes.put?.accounts ?? []) this.data.accounts.push(a);
    for (const c of changes.put?.categories ?? []) this.data.categories.push(c);
    for (const t of changes.put?.transactions ?? []) this.rows.set(`${owner}:${t.id}`, structuredClone(t));
    return Promise.resolve();
  }
  writerFor(owner: string) {
    return {
      add: (txs: Row[]) => {
        if (this.rows.has(`${owner}:${txs[0].id}`)) return Promise.resolve('duplicate' as const);
        for (const t of txs) this.rows.set(`${owner}:${t.id}`, structuredClone(t));
        return Promise.resolve('saved' as const);
      },
      replace: (ids: string[], txs: Row[]) => {
        this.replaced.push(structuredClone(txs));
        const keep = new Set(txs.map((t) => t.id));
        for (const id of ids) if (!keep.has(id)) this.rows.delete(`${owner}:${id}`);
        for (const t of txs) this.rows.set(`${owner}:${t.id}`, structuredClone(t));
        return Promise.resolve();
      },
      remove: (ids: string[]) => {
        let n = 0;
        for (const id of ids) if (this.rows.delete(`${owner}:${id}`)) n++;
        return Promise.resolve(n);
      },
    };
  }
}

class FakeTelegram {
  sent: { id: number; text: string; keyboard?: Keyboard; forceReply?: string }[] = [];
  edits = new Map<number, { text: string; keyboard?: Keyboard }>();
  answers: (string | undefined)[] = [];
  #next = 100;
  send(_c: number, text: string, o: { keyboard?: Keyboard; forceReply?: string } = {}) { const id = this.#next++; this.sent.push({ id, text, ...o }); this.edits.set(id, { text, keyboard: o.keyboard }); return Promise.resolve(id); }
  reply(c: number, text: string) { return this.send(c, text).then(() => {}); }
  edit(_c: number, id: number, text: string, keyboard?: Keyboard) { this.edits.set(id, { text, keyboard }); return Promise.resolve(); }
  answer(_id: string, text?: string) { this.answers.push(text); return Promise.resolve(); }
  last() { return this.sent[this.sent.length - 1]; }
}

const rates = { current: (s: Record<string, number>) => Promise.resolve(s) } as unknown as ExchangeRates;
const clock = new LocalClock('Asia/Kolkata', () => Date.parse('2026-11-19T06:00:00Z'));
const link: TelegramLink = { chat_id: CHAT, user_id: ME, email: 'me@x.com', default_owner_id: ME, default_account_id: 'a1' };

function setup() {
  const store = new FakeStore(), tg = new FakeTelegram();
  const s = store as unknown as PocketStore, t = tg as unknown as TelegramClient;
  const entries = new EntryService(s, t, clock, rates);
  return { store, tg, entries, editor: new EntryEditor(s, t, entries, clock, rates), creator: new BookCreator(s, t, entries, clock, rates) };
}
const buttons = (k?: Keyboard) => (k ?? []).flat().map((b) => b.text);
const data = (k: Keyboard | undefined, text: string) => (k ?? []).flat().find((b) => b.text === text)?.callback_data ?? '';
const tap = (messageId: number, d: string, tg: FakeTelegram): TelegramCallback =>
  ({ id: 'cb', data: d, message: { message_id: messageId, chat: { id: CHAT, type: 'private' }, text: tg.edits.get(messageId)?.text } });

// ── E1–E7 ─────────────────────────────────────────────────────────────────
{
  const t = setup();
  await t.entries.record({ link, chatId: CHAT, seed: 42, text: '450 dmart @groceries', replace: false, replyTo: 42 });
  const conf = t.tg.last();
  ok('E1 one ✏️ Edit button', buttons(conf.keyboard).join('|') === '✏️ Edit', buttons(conf.keyboard).join('|'));
  const [row] = [...t.store.rows.values()];
  row.createdAt = '2026-11-01T00:00:00Z'; row.addedBy = 'wife@x.com';

  await t.editor.handleCallback(tap(conf.id, data(conf.keyboard, '✏️ Edit'), t.tg), link);
  const menu = t.tg.edits.get(conf.id)!.keyboard;
  ok('E2 the menu', buttons(menu).join('|') === 'Amount|Account|Category|Date|Note|🗑 Delete|✓ Done', buttons(menu).join('|'));
  ok('E1 payment type follows the account, and isn\'t shown', row.paymentType === 'online' && !/online|card\b/.test(conf.text), conf.text);

  await t.editor.handleCallback(tap(conf.id, data(menu, 'Amount'), t.tg), link);
  ok('E3 asks for the amount', t.store.pending?.step?.kind === 'field' && /new amount/.test(t.tg.last().text) && !!t.tg.last().forceReply);
  await t.editor.answer(link, CHAT, t.store.pending!.step as never, '650', 60);
  const saved = [...t.store.rows.values()][0];
  ok('E3 same row, new amount', t.store.rows.size === 1 && saved.amount === 65000 && saved.id === row.id, JSON.stringify(saved).slice(0, 120));
  ok('E3 who entered it and when are kept', saved.addedBy === 'wife@x.com' && saved.createdAt === '2026-11-01T00:00:00Z' && saved.categoryId === 's1');
  const after = t.tg.edits.get(conf.id)!;
  const note = t.tg.sent.find((m) => m.text.startsWith('✅ Amount changed'));
  ok('E3 a new message confirms the change, old → new', note?.text === '✅ Amount changed: ₹450 → ₹650', note?.text);
  ok('E3 confirmation updated in place, menu still open', /₹650/.test(after.text) && /Amount changed/.test(after.text) && buttons(after.keyboard).includes('✓ Done') && !t.store.pending, after.text);

  // E4 category
  await t.editor.handleCallback(tap(conf.id, data(after.keyboard, 'Category'), t.tg), link);
  const mains = t.tg.edits.get(conf.id)!.keyboard;
  ok('E4 main categories', buttons(mains).includes('Food ›') && buttons(mains).includes('Transport ›'));
  await t.editor.handleCallback(tap(conf.id, data(mains, 'Transport ›'), t.tg), link);
  const subs = t.tg.edits.get(conf.id)!.keyboard;
  await t.editor.handleCallback(tap(conf.id, data(subs, 'Taxi'), t.tg), link);
  ok('E4 the change is confirmed in a new message', t.tg.sent.some((m) => m.text === '✅ Category changed: Food / Groceries → Transport / Taxi'), t.tg.sent.map((m) => m.text).filter((x) => x.startsWith('✅')).join(' | '));
  ok('E4 subcategory saved', [...t.store.rows.values()][0].categoryId === 's3' && /Transport \/ Taxi/.test(t.tg.edits.get(conf.id)!.text), t.tg.edits.get(conf.id)!.text);

  // E5 date, note, payment, account
  let k = t.tg.edits.get(conf.id)!.keyboard;
  await t.editor.handleCallback(tap(conf.id, data(k, 'Date'), t.tg), link);
  await t.editor.handleCallback(tap(conf.id, data(t.tg.edits.get(conf.id)!.keyboard, 'Yesterday'), t.tg), link);
  ok('E5 date yesterday', [...t.store.rows.values()][0].date === '2026-11-18', [...t.store.rows.values()][0].date);
  k = t.tg.edits.get(conf.id)!.keyboard;
  await t.editor.handleCallback(tap(conf.id, data(k, 'Note'), t.tg), link);
  await t.editor.answer(link, CHAT, t.store.pending!.step as never, '-', 61);
  ok('E5 note cleared', [...t.store.rows.values()][0].note === '');
  k = t.tg.edits.get(conf.id)!.keyboard;
  await t.editor.handleCallback(tap(conf.id, data(k, 'Account'), t.tg), link);
  await t.editor.handleCallback(tap(conf.id, data(t.tg.edits.get(conf.id)!.keyboard, 'Cash'), t.tg), link);
  ok('E5 account', [...t.store.rows.values()][0].accountId === 'a2' && [...t.store.rows.values()][0].amount === 65000);
  ok('E5 moved to Cash: paid in cash', [...t.store.rows.values()][0].paymentType === 'cash');

  // E6 delete
  k = t.tg.edits.get(conf.id)!.keyboard;
  await t.editor.handleCallback(tap(conf.id, data(k, '🗑 Delete'), t.tg), link);
  const ask = t.tg.edits.get(conf.id)!;
  ok('E6 asks once more', /Delete this entry\?/.test(ask.text) && buttons(ask.keyboard).join('|') === '🗑 Yes, delete|Keep it' && t.store.rows.size === 1);
  await t.editor.handleCallback(tap(conf.id, data(ask.keyboard, 'Keep it'), t.tg), link);
  ok('E6 Keep it goes back to the menu', !/Delete this entry/.test(t.tg.edits.get(conf.id)!.text) && buttons(t.tg.edits.get(conf.id)!.keyboard).includes('Amount'));

  // E7 done, expired
  k = t.tg.edits.get(conf.id)!.keyboard;
  await t.editor.handleCallback(tap(conf.id, data(k, '✓ Done'), t.tg), link);
  ok('E7 Done: one button again', buttons(t.tg.edits.get(conf.id)!.keyboard).join('|') === '✏️ Edit');
  await t.editor.handleCallback(tap(conf.id, 'ef:c:s2', t.tg), link);
  ok('E7 an old pick has expired', /expired/.test(t.tg.answers[t.tg.answers.length - 1] ?? '') && [...t.store.rows.values()][0].categoryId === 's3');

  await t.editor.handleCallback(tap(conf.id, data(t.tg.edits.get(conf.id)!.keyboard, '✏️ Edit'), t.tg), link);
  await t.editor.handleCallback(tap(conf.id, data(t.tg.edits.get(conf.id)!.keyboard, '🗑 Delete'), t.tg), link);
  await t.editor.handleCallback(tap(conf.id, data(t.tg.edits.get(conf.id)!.keyboard, '🗑 Yes, delete'), t.tg), link);
  ok('E6 Yes, delete removes it', t.store.rows.size === 0 && /Deleted/.test(t.tg.edits.get(conf.id)!.text), t.tg.edits.get(conf.id)!.text);
}

// ── E8 transfer ───────────────────────────────────────────────────────────
{
  const t = setup();
  await t.entries.record({ link, chatId: CHAT, seed: 50, text: '5000 #hdfc > #cash', replace: false, replyTo: 50 });
  const conf = t.tg.last();
  await t.editor.handleCallback(tap(conf.id, data(conf.keyboard, '✏️ Edit'), t.tg), link);
  const menu = t.tg.edits.get(conf.id)!.keyboard;
  ok('E8 transfer menu', buttons(menu).join('|') === 'Amount|From|To|Date|Note|🗑 Delete|✓ Done', buttons(menu).join('|'));
  await t.editor.handleCallback(tap(conf.id, data(menu, 'To'), t.tg), link);
  const options = buttons(t.tg.edits.get(conf.id)!.keyboard);
  ok('E8 To offers the other accounts only', options.includes('Wise') && !options.includes('HDFC') && !options.includes('Cash'), options.join('|'));
  await t.editor.handleCallback(tap(conf.id, data(t.tg.edits.get(conf.id)!.keyboard, 'Wise'), t.tg), link);
  const legs = [...t.store.rows.values()];
  const inLeg = legs.find((r) => r.transferDir === 'in')!;
  ok('E8 now goes to Wise, converted', legs.length === 2 && inLeg.accountId === 'a3' && inLeg.currency === 'USD' && inLeg.amount > 0, JSON.stringify(inLeg).slice(0, 100));
}

// ── E9 claim kept ─────────────────────────────────────────────────────────
{
  const t = setup();
  await t.entries.record({ link, chatId: CHAT, seed: 55, text: '30000 hospital @groceries claim Star Health', replace: false, replyTo: 55 });
  const conf = t.tg.last();
  await t.editor.handleCallback(tap(conf.id, data(conf.keyboard, '✏️ Edit'), t.tg), link);
  await t.editor.handleCallback(tap(conf.id, data(t.tg.edits.get(conf.id)!.keyboard, 'Note'), t.tg), link);
  await t.editor.answer(link, CHAT, t.store.pending!.step as never, 'hospital bill', 62);
  const r = [...t.store.rows.values()][0];
  ok('E9 the paid-back mark survives', r.reimbBy === 'Star Health' && r.note === 'hospital bill', JSON.stringify(r).slice(0, 160));
}

// ── C1–C3 accounts ────────────────────────────────────────────────────────
{
  const t = setup();
  await t.creator.newAccount(link, CHAT, 70, 'HDFC Savings bank');
  const acc = t.store.applied[0]?.changes.put.accounts[0];
  ok('C1 added straight away', acc?.name === 'HDFC Savings' && acc.type === 'bank' && acc.currency === 'INR' && acc.icon === 'landmark' && !t.store.applied[0].changes.put.transactions, JSON.stringify(acc));
  ok('C1 tells how to use it', /#hdfcsavings/.test(t.tg.last().text));

  await t.creator.newAccount(link, CHAT, 71, '');
  ok('C2 asks the name', /what is it called/.test(t.tg.last().text) && t.store.pending?.step?.kind === 'newaccount');
  await t.creator.answer(link, CHAT, t.store.pending!, 'Amex', 72);
  const typeMsg = t.tg.last();
  ok('C2 asks the type', buttons(typeMsg.keyboard).join('|') === 'Bank|Cash|Credit card|Savings|Investment');
  await t.creator.handleCallback(tap(typeMsg.id, data(typeMsg.keyboard, 'Credit card'), t.tg), link);
  const ccyMsg = t.tg.last();
  ok('C2 asks the currency: home first, then ones in use', buttons(ccyMsg.keyboard).join('|') === 'INR|USD|Other…', buttons(ccyMsg.keyboard).join('|'));
  await t.creator.handleCallback(tap(ccyMsg.id, data(ccyMsg.keyboard, 'INR'), t.tg), link);
  await t.creator.answer(link, CHAT, t.store.pending!, '-5000', 73);
  const put = t.store.applied[1]?.changes.put;
  ok('C2 card with an opening balance entry', put?.accounts[0].type === 'card' && put.transactions?.[0].type === 'expense' && put.transactions[0].amount === 500000
    && put.transactions[0].payee === 'Opening balance' && put.transactions[0].tags.includes('opening-balance') && put.transactions[0].accountId === put.accounts[0].id, JSON.stringify(put).slice(0, 200));
  ok('C2 nothing left waiting', !t.store.pending);

  await t.creator.newAccount(link, CHAT, 74, 'hdfc');
  await t.creator.handleCallback(tap(t.tg.last().id, 'na:t:bank', t.tg), link);
  await t.creator.handleCallback(tap(t.tg.last().id, 'na:c:INR', t.tg), link);
  await t.creator.handleCallback(tap(t.tg.last().id, 'na:b:0', t.tg), link);
  ok('C3 a name already used is refused', t.store.applied.length === 2 && /already have an account/.test(t.tg.last().text), t.tg.last().text);
}

// ── C4 category ───────────────────────────────────────────────────────────
{
  const t = setup();
  await t.creator.newCategory(link, CHAT, 80, 'petrol');
  const q = t.tg.last();
  await t.creator.handleCallback(tap(q.id, data(q.keyboard, '💸 Spending'), t.tg), link);
  const where = t.tg.last();
  ok('C4 asks where, with a new main option', buttons(where.keyboard).includes('Transport') && buttons(where.keyboard).includes('➕ New main category'));
  await t.creator.handleCallback(tap(where.id, data(where.keyboard, 'Transport'), t.tg), link);
  const cat = t.store.applied[0]?.changes.put.categories[0];
  ok('C4 added under Transport, looking like it', cat?.name === 'Petrol' && cat.parentId === 'm2' && cat.icon === 'car' && cat.type === 'expense', JSON.stringify(cat));
  ok('C4 tells how to use it', /Transport \/ Petrol/.test(t.tg.last().text) && !t.store.pending);
}

// ── C5 / C6 ➕ New from the picker ─────────────────────────────────────────
{
  const t = setup();
  await t.entries.record({ link, chatId: CHAT, seed: 90, text: '300 fuel @petrol', replace: false, replyTo: 90 });
  const picker = t.tg.last();
  ok('C5 the picker offers ➕ New', buttons(picker.keyboard)[0] === '➕ New category “Petrol”', buttons(picker.keyboard).join('|'));
  await t.creator.handleCallback(tap(picker.id, data(picker.keyboard, '➕ New category “Petrol”'), t.tg), link);
  const where = t.tg.edits.get(picker.id)!;
  ok('C5 asks where it goes, in the same message', /Where does “Petrol” go/.test(where.text));
  await t.creator.handleCallback(tap(picker.id, data(where.keyboard, 'Transport'), t.tg), link);
  const cat = t.store.applied[0]?.changes.put.categories[0];
  const entry = [...t.store.rows.values()][0];
  ok('C5 category made and the entry saved with it', cat?.name === 'Petrol' && entry?.categoryId === cat.id && entry.amount === 30000, JSON.stringify(entry ?? {}).slice(0, 120));
  ok('C5 the picker became the confirmation', /Transport \/ Petrol/.test(t.tg.edits.get(picker.id)!.text) && buttons(t.tg.edits.get(picker.id)!.keyboard).join('|') === '✏️ Edit', t.tg.edits.get(picker.id)!.text);

  const s = setup();
  s.store.shared = true;
  await s.entries.record({ link, chatId: CHAT, seed: 91, text: '300 fuel #house @petrol', replace: false, replyTo: 91 });
  ok('C6 no ➕ New in a shared book', !buttons(s.tg.last().keyboard).some((b) => b.startsWith('➕')), buttons(s.tg.last().keyboard).join('|'));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
