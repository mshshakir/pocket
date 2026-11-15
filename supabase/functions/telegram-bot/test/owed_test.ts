/**
 * Loans and reimbursements on Telegram, with a fake database and a fake Telegram.
 * Run: deno run --allow-all --import-map <map with a supabase-js stub> supabase/functions/telegram-bot/test/owed_test.ts
 *
 *   O1  OwedParser: lent / borrowed / paid back (either order) / repaid; "claim" on an expense
 *   O2  "5000 lent Ali": a debt + an expense tagged debt, as the app writes them; retry never doubles
 *   O3  "2000 paid back Ali" repays Ali's loan; the last repayment marks it paid; more than owed is refused
 *   O4  "3000 repaid Hussain" pays what you owe; 🗑 Delete reopens a paid loan
 *   O5  "claim Star Health 27000" marks the expense (reimbBy, reimbExpected)
 *   O6  "+9000 paid back Star Health" spreads across open items; Oldest first re-shares; Close the rest
 *   O7  more than owed: kept as credit; "Count extra as income" switches it
 *   O8  unknown name lists who has something open; a name with both a loan and claims asks which
 *   O9  /toget lists what's waiting; 🗑 Delete on a payback reopens what it closed
 */
import { OwedParser } from '../lib/OwedParser.ts';
import { OwedBot } from '../lib/OwedBot.ts';
import { Payback } from '../lib/Payback.ts';
import { EntryService } from '../lib/EntryService.ts';
import { LocalClock } from '../lib/LocalClock.ts';
import { PocketBook } from '../lib/PocketBook.ts';
import type { OwedData, OwedDebt, OwedTx, PocketStore, TelegramLink } from '../lib/PocketStore.ts';
import type { TelegramClient } from '../lib/TelegramClient.ts';
import type { TelegramCallback } from '../lib/BotController.ts';

let passed = 0, failed = 0;
const ok = (label: string, cond: boolean, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nLoans and paybacks on Telegram');

{
  const p = new OwedParser(['cash', 'card']);
  const k = (t: string) => { const r = p.parse(t); return r && !('error' in r) ? `${r.kind}|${r.amount}|${r.name}` : JSON.stringify(r); };
  ok('O1 lent / borrowed', k('5000 lent Ali') === 'lend|5000|Ali' && k('+20000 borrowed from Hussain Bhai cash') === 'borrow|20000|Hussain Bhai');
  ok('O1 paid back, name before or after', k('2000 paid back Ali') === 'received|2000|Ali' && k('2000 Ali paid back') === 'received|2000|Ali' && k('+27000 paid back Star Health #boi') === 'received|27000|Star Health');
  ok('O1 repaid / paid back to', k('3000 repaid Hussain') === 'repay|3000|Hussain' && k('3000 paid back to Hussain') === 'repay|3000|Hussain');
  ok('O1 ordinary entries are left alone', p.parse('500 lunch @food') === null && p.parse('70 auto back home @taxi') === null);
  const c = p.splitBack('30000 hospital @medical claim Star Health 27000');
  ok('O1 claim: payer and amount, rest kept', c?.payer === 'Star Health' && c.expected === 27000 && c.text === '30000 hospital @medical');
  ok('O1 "auto back home" is not a claim', p.splitBack('70 auto back home @taxi') === null);
}

// ── fakes ─────────────────────────────────────────────────────────────────
const OWNER = 'u1', ME = 7;
const link: TelegramLink = { chat_id: ME, user_id: OWNER, email: 'me@x.com', default_owner_id: OWNER, default_account_id: 'a1' };
const book = new PocketBook({
  user: { homeCurrency: 'INR', hijriOffset: 0, defaultPaymentType: 'card' }, fxRates: { INR: 1 },
  accounts: [{ id: 'a1', name: 'HDFC', currency: 'INR' }, { id: 'a2', name: 'Cash', currency: 'INR' }],
  categories: [{ id: 'm', name: 'Health', type: 'expense' }, { id: 'med', name: 'Medical', type: 'expense', parentId: 'm' }],
});

class FakeStore {
  txs = new Map<string, OwedTx>();
  debts = new Map<string, OwedDebt & Record<string, unknown>>();
  used = new Set<string>();
  entitlements() { return Promise.resolve({ state: 'active', access: { telegram: 'write' } }); }
  sharesFor() { return Promise.resolve([]); }
  tryLoadBook() { return Promise.resolve(book); }
  loadBook() { return Promise.resolve(book); }
  getPending() { return Promise.resolve(null); }
  clearPending() { return Promise.resolve(); }
  setPending() { return Promise.resolve(); }
  txIdUsed(_o: string, id: string) { return Promise.resolve(this.used.has(id)); }
  applyOwn(_o: string, ch: { put?: Record<string, Record<string, unknown>[]>; remove?: Record<string, string[]> }) {
    for (const t of ch.put?.transactions ?? []) { this.txs.set(t.id as string, structuredClone(t) as OwedTx); this.used.add(t.id as string); }
    for (const d of ch.put?.debts ?? []) this.debts.set(d.id as string, structuredClone(d) as OwedDebt);
    for (const id of ch.remove?.transactions ?? []) this.txs.delete(id);
    for (const id of ch.remove?.debts ?? []) this.debts.delete(id);
    return Promise.resolve();
  }
  writerFor() {
    return {
      add: (txs: OwedTx[]) => { if (this.used.has(txs[0].id)) return Promise.resolve('duplicate' as const); for (const t of txs) { this.txs.set(t.id, structuredClone(t)); this.used.add(t.id); } return Promise.resolve('saved' as const); },
      replace: () => Promise.resolve(), remove: () => Promise.resolve(0),
    };
  }
  #paid(id: string) {
    let n = 0;
    for (const p of this.txs.values()) if ((p.tags || []).includes('reimbursement')) for (const a of p.reimbAlloc || []) if (a.txId === id) n += a.amount;
    return n;
  }
  #debtPaid(d: OwedDebt) {
    let n = 0;
    for (const t of this.txs.values()) if (t.debtId === d.id && t.id !== d.initialTxId) n += t.amount;
    return n;
  }
  loadOwed(): Promise<OwedData> {
    const items = [...this.txs.values()].filter((t) => t.type === 'expense' && t.reimbBy && t.reimbClosed !== true)
      .map((t) => ({ ...structuredClone(t), _paid: this.#paid(t.id) }));
    const debts = [...this.debts.values()].filter((d) => d.status !== 'paid').map((d) => ({ ...structuredClone(d), _paid: this.#debtPaid(d) }));
    const credits = [...this.txs.values()].filter((t) => (t.tags || []).includes('reimbursement') && t.reimbExtraAs === 'keep').map((t) => structuredClone(t));
    return Promise.resolve({ items, debts, credits, claims: [] });
  }
  loadOwedTx(_o: string, id: string) { const t = this.txs.get(id); return Promise.resolve(t ? structuredClone(t) : null); }
  loadDebt(_o: string, id: string) { const d = this.debts.get(id); return Promise.resolve(d ? { ...structuredClone(d), _paid: this.#debtPaid(d) } : null); }
}

class FakeTelegram {
  sent: { text: string; keyboard?: { text: string; callback_data: string }[][]; id: number; replyTo?: number }[] = [];
  edits: { id: number; text: string; keyboard?: { text: string; callback_data: string }[][] }[] = [];
  answers: (string | undefined)[] = [];
  #next = 500;
  send(_c: number, text: string, opts: { keyboard?: { text: string; callback_data: string }[][]; replyTo?: number } = {}) {
    const id = this.#next++; this.sent.push({ text, keyboard: opts.keyboard, id, replyTo: opts.replyTo }); return Promise.resolve(id);
  }
  reply(c: number, text: string, replyTo?: number) { return this.send(c, text, { replyTo }).then(() => undefined); }
  edit(_c: number, id: number, text: string, keyboard?: { text: string; callback_data: string }[][]) { this.edits.push({ id, text, keyboard }); return Promise.resolve(); }
  answer(_id: string, text?: string) { this.answers.push(text); return Promise.resolve(); }
}

const store = new FakeStore();
const tg = new FakeTelegram();
const clock = new LocalClock('Asia/Kolkata', () => Date.parse('2026-11-15T12:00:00+05:30'));
const rates = { current: () => Promise.resolve({ INR: 1 }) };
const bot = new OwedBot(store as unknown as PocketStore, tg as unknown as TelegramClient, clock, rates as never);
const entries = new EntryService(store as unknown as PocketStore, tg as unknown as TelegramClient, clock, rates as never);
let msg = 100;
const say = async (text: string) => { const id = ++msg; const handled = await bot.tryText(link, ME, id, text); return { id, handled, last: tg.sent.at(-1) }; };
const tap = async (sent: { id: number; text: string; keyboard?: { text: string; callback_data: string }[][] }, label: RegExp) => {
  const b = sent.keyboard?.flat().find((x) => label.test(x.text));
  if (!b) throw new Error(`no button ${label} in ${JSON.stringify(sent.keyboard)}`);
  const cb = { id: 'cb', data: b.callback_data, message: { message_id: sent.id, chat: { id: ME, type: 'private' }, text: sent.text } } as TelegramCallback;
  await bot.handleCallback(cb, link);
  return tg.edits.at(-1)!;
};
const txs = () => [...store.txs.values()];

// O2 / O3
{
  const r = await say('5000 lent Ali');
  const debt = [...store.debts.values()][0];
  const tx = txs().find((t) => t.debtId === debt?.id)!;
  ok('O2 a debt (lent, Ali, ₹5,000, active) and its first entry', r.handled && debt?.type === 'lent' && debt.counterparty === 'Ali' && debt.principal === 500000 && debt.status === 'active' && debt.initialTxId === tx?.id);
  ok('O2 the entry: expense from HDFC, tagged debt, as the app writes it', tx.type === 'expense' && tx.accountId === 'a1' && tx.tags.includes('debt') && tx.debtRole === 'initial' && tx.payee === 'Ali' && tx.note === 'Lent to Ali');
  ok('O2 the reply says Ali owes you and it isn\'t spending', /Lent ₹5,000 to Ali/.test(r.last!.text) && /owes you/.test(r.last!.text) && /not spending/.test(r.last!.text), r.last!.text);
  const before = store.debts.size;
  await bot.tryText(link, ME, r.id, '5000 lent Ali');
  ok('O2 the same message again saves nothing', store.debts.size === before);

  const p1 = await say('2000 paid back Ali #cash');
  const pay = txs().find((t) => t.debtRole === 'payment')!;
  ok('O3 a repayment: income into Cash on Ali\'s loan', pay.type === 'income' && pay.accountId === 'a2' && pay.debtId === debt.id && pay.tags.includes('debt-payment') && /Ali still owes ₹3,000/.test(p1.last!.text), p1.last!.text);
  const big = await say('4000 Ali paid back');
  ok('O3 more than what\'s left is refused', /more than what's left/.test(big.last!.text) && txs().filter((t) => t.debtRole === 'payment').length === 1);
  const p2 = await say('3000 Ali paid back');
  ok('O3 the last repayment marks the loan paid', store.debts.get(debt.id)!.status === 'paid' && /fully paid/.test(p2.last!.text));
}

// O4
{
  await say('+20000 borrowed Hussain');
  const r = await say('20000 repaid Hussain');
  const d = [...store.debts.values()].find((x) => x.counterparty === 'Hussain')!;
  const pay = txs().find((t) => t.debtId === d.id && t.debtRole === 'payment')!;
  ok('O4 paying what you owe: an expense, and the loan is paid', pay.type === 'expense' && d.status === 'paid' && /Paid Hussain ₹20,000/.test(r.last!.text));
  await tap(r.last!, /Delete/);
  ok('O4 🗑 Delete removes it and reopens the loan', !store.txs.has(pay.id) && store.debts.get(d.id)!.status === 'active');
}

// O5 – O7
{
  const add = async (text: string) => { const id = ++msg; await entries.record({ link, chatId: ME, seed: id, text, replace: false, replyTo: id }); return [...store.txs.values()].at(-1)!; };
  const a = await add('30000 hospital @medical claim Star Health 27000');
  ok('O5 claim marks the expense: Star Health, ₹27,000 of ₹30,000', a.reimbBy === 'Star Health' && a.reimbExpected === 2700000 && a.amount === 3000000 && a.type === 'expense');
  ok('O5 the reply says who will pay back', /Star Health will pay back ₹27,000/.test(tg.sent.at(-1)!.text), tg.sent.at(-1)!.text);
  const b = await add('5000 pharmacy @medical claim Star Health');
  ok('O5 without an amount they pay it all', b.reimbBy === 'Star Health' && !b.reimbExpected);
  const bad = await add('500 tea @medical claim Office 900');
  ok('O5 can\'t expect back more than spent', !bad.reimbBy || bad.id === b.id);

  const r = await say('+16000 paid back Star Health');
  const pay = txs().find((t) => (t.tags || []).includes('reimbursement'))!;
  const share = Object.fromEntries((pay.reimbAlloc || []).map((x: { txId: string; amount: number }) => [x.txId, x.amount]));
  ok('O6 spread evenly: 27,000 and 5,000 owed → 13,500 and 2,500', share[a.id] === 1350000 && share[b.id] === 250000, JSON.stringify(share));
  ok('O6 an income entry tagged reimbursement, not income', pay.type === 'income' && /not income/.test(r.last!.text) && /Reimbursed 50%/.test(r.last!.text), r.last!.text);
  const e1 = await tap(r.last!, /Oldest first/);
  const s2 = Object.fromEntries((store.txs.get(pay.id)!.reimbAlloc || []).map((x: { txId: string; amount: number }) => [x.txId, x.amount]));
  ok('O6 Oldest first: the hospital gets all 16,000', s2[a.id] === 1600000 && !s2[b.id] && /Spread evenly/.test(JSON.stringify(e1.keyboard)), JSON.stringify(s2));
  const e2 = await tap({ id: r.last!.id, text: e1.text, keyboard: e1.keyboard }, /Close the rest/);
  ok('O6 Close the rest closes both (nothing more coming)', store.txs.get(a.id)!.reimbClosed === true && store.txs.get(b.id)!.reimbClosed === true && /closed/.test(e2.text));

  const c = await add('2000 checkup @medical claim Star Health');
  const r2 = await say('+3000 paid back star health');
  const p2 = [...store.txs.values()].filter((t) => (t.tags || []).includes('reimbursement')).at(-1)!;
  ok('O7 3,000 for 2,000 owed: 1,000 kept as credit', p2.reimbAlloc[0].txId === c.id && p2.reimbExtra === 100000 && p2.reimbExtraAs === 'keep' && /kept as credit/.test(r2.last!.text));
  const e3 = await tap(r2.last!, /Count extra as income/);
  ok('O7 "Count extra as income" switches it', store.txs.get(p2.id)!.reimbExtraAs === 'income' && /counted as income/.test(e3.text));

  // O9 delete reopens what it closed
  await tap({ id: r.last!.id, text: e2.text, keyboard: e2.keyboard }, /Delete/);
  ok('O9 deleting the first payback reopens the items it closed', !store.txs.has(pay.id) && store.txs.get(a.id)!.reimbClosed == null && store.txs.get(b.id)!.reimbClosed == null);
}

// O8 / O9
{
  const r = await say('500 paid back Zed');
  ok('O8 unknown name: lists who has something open', /Nothing open for "Zed"/.test(r.last!.text) && /Star Health/.test(r.last!.text), r.last!.text);
  await say('1000 lent Star Health');
  const both = await say('500 paid back Star Health');
  ok('O8 a name with a loan and claims asks which', /loan paid back/.test(both.last!.text) && /claim paid back/.test(both.last!.text));
  const loan = await say('500 loan paid back Star Health');
  ok('O8 "loan" picks the loan', /loan repayment/.test(loan.last!.text));
  await bot.toget(link, ME);
  const t = tg.sent.at(-1)!.text;
  ok('O9 /toget lists Star Health\'s items and loans owed to you', /Star Health<\/b> — ₹32,000 to get back/.test(t) && /Loans owed to you/.test(t), t);
}

ok('Payback.clean drops read-only fields', !('_paid' in Payback.clean({ id: 'x', _paid: 3 })));
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
