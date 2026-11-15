/**
 * OwedBot — loans and reimbursements from Telegram, written like the app
 * writes them (app.js submitDebt / submitDebtPayment / submitPayback), so the
 * app shows them under Debts at once. Only in the person's own book.
 *
 *   5000 lent Ali              a debt (lent) + an expense tagged 'debt'
 *   +20000 borrowed Hussain    a debt (borrowed) + an income tagged 'debt'
 *   2000 paid back Ali         a repayment on Ali's loan (income, 'debt-payment'),
 *                              or money paid back for Ali's open reimbursement items
 *   3000 repaid Hussain        a repayment on what you owe (expense, 'debt-payment')
 *   /toget                     what's waiting to be paid back, and loans owed to you
 *
 * None of these count as income or spending in the app (CountedEntries).
 *
 * A payback is one income entry tagged 'reimbursement' whose reimbAlloc
 * shares it across the payer's open items (Spread evenly; buttons switch to
 * Oldest first, close the rest, or count an extra as income instead of
 * keeping it as credit). Ids derive from the message, so a retried message
 * never saves twice and 🗑 Delete finds the rows again.
 */
import { EntryDate } from './EntryDate.ts';
import type { ExchangeRates } from './ExchangeRates.ts';
import type { LocalClock } from './LocalClock.ts';
import type { Money } from './Money.ts';
import { type OwedCommand, OwedParser } from './OwedParser.ts';
import { Payback } from './Payback.ts';
import type { OwedData, OwedDebt, OwedTx, PocketStore, TelegramLink } from './PocketStore.ts';
import type { Keyboard, TelegramClient } from './TelegramClient.ts';
import type { TelegramCallback } from './BotController.ts';
import { TransactionFactory } from './TransactionFactory.ts';
import { type AccountChoice, type BookAccess, Workspace } from './Workspace.ts';

export class OwedBot {
  static readonly #PREFIX = 'ow:';

  readonly #store: PocketStore;
  readonly #telegram: TelegramClient;
  readonly #clock: LocalClock;
  readonly #rates: ExchangeRates;

  constructor(store: PocketStore, telegram: TelegramClient, clock: LocalClock, rates: ExchangeRates) {
    this.#store = store;
    this.#telegram = telegram;
    this.#clock = clock;
    this.#rates = rates;
  }

  static isButton(data?: string): boolean {
    return !!data && data.startsWith(OwedBot.#PREFIX);
  }

  /** Handles the message when it's a loan or a payback; false otherwise. */
  async tryText(link: TelegramLink, chatId: number, messageId: number, text: string): Promise<boolean> {
    if (!/\b(lent|loaned|borrowed|repaid|paid\s+back)\b/i.test(text)) return false; // most messages: no lookups
    const ws = await Workspace.load(this.#store, link);
    const parsed = new OwedParser(ws.paymentTypes).parse(text);
    if (!parsed) return false;
    if ('error' in parsed) return await this.#say(chatId, parsed.error, messageId);
    const own = ws.access(link.user_id);
    if (!own?.isOwn) {
      await this.#telegram.reply(chatId, 'Loans and money paid back are kept in your own book. It isn\'t available on your plan.', messageId);
      return true;
    }
    const when = parsed.date ? parsed.date.resolve(this.#clock.isoDate()) : { ok: true as const, iso: this.#clock.isoDate(parsed.daysAgo) };
    if (!when.ok) return await this.#say(chatId, when.reason, messageId);
    const fallback = { ownerId: link.default_owner_id, accountId: link.default_account_id };
    const chosen = ws.resolve(parsed.accountHint, fallback, own);
    if (!chosen.ok) return await this.#say(chatId, chosen.reason, messageId);

    const ids = await OwedBot.#ids(chatId, messageId);
    if (await this.#store.txIdUsed(own.ownerId, ids.tx)) return true; // a retry: handled before

    const ctx: Ctx = {
      link, chatId, messageId, own, account: chosen.value, cmd: parsed, date: when.iso, ids,
      factory: new TransactionFactory(own.book, await this.#rates.current(own.book.fxRates)),
    };
    if (parsed.kind === 'lend' || parsed.kind === 'borrow') await this.#newLoan(ctx);
    else await this.#repayOrPayback(ctx, await this.#store.loadOwed(own.ownerId));
    return true;
  }

  /** Replies, and reports the message as handled. */
  async #say(chatId: number, text: string, replyTo: number): Promise<true> {
    await this.#telegram.reply(chatId, text, replyTo);
    return true;
  }

  /** /toget — reimbursements waiting, by payer, and loans owed to you. */
  async toget(link: TelegramLink, chatId: number): Promise<void> {
    const ws = await Workspace.load(this.#store, link);
    const own = ws.access(link.user_id);
    if (!own?.isOwn) return void await this.#telegram.send(chatId, 'Nothing to show: this works with your own book.');
    const owed = await this.#store.loadOwed(own.ownerId);
    const money = new TransactionFactory(own.book, await this.#rates.current(own.book.fxRates)).money;
    const groups = new Map<string, { name: string; items: ReturnType<typeof Payback.open>[] }>();
    for (const tx of owed.items) {
      const it = Payback.open(tx);
      if (it.outstanding <= 0) continue;
      const k = Payback.key(tx.reimbBy);
      if (!groups.has(k)) groups.set(k, { name: String(tx.reimbBy).trim(), items: [] });
      groups.get(k)!.items.push(it);
    }
    const lines: string[] = [];
    for (const g of groups.values()) {
      const cur = g.items[0].tx.currency;
      const total = g.items.reduce((n, i) => n + (i.tx.currency === cur ? i.outstanding : money.convert(i.outstanding, i.tx.currency, cur)), 0);
      lines.push(`<b>${OwedBot.#esc(g.name)}</b> — ${money.format(total, cur)} to get back`);
      for (const i of g.items) {
        lines.push(`• ${OwedBot.#esc(OwedBot.#title(i.tx))} · ${OwedBot.#day(i.tx.date)} · ${money.format(i.outstanding, i.tx.currency)}${i.paid > 0 ? ` (${Math.round((i.paid / (i.expected || 1)) * 100)}% back)` : ''}`);
      }
    }
    const loans = owed.debts.filter((d) => d.type === 'lent');
    if (loans.length) {
      if (lines.length) lines.push('');
      lines.push('<b>Loans owed to you</b>');
      for (const d of loans) lines.push(`• ${OwedBot.#esc(d.counterparty)} · ${money.format(Math.max(0, d.principal - d._paid), d.currency)} of ${money.format(d.principal, d.currency)}`);
    }
    const text = lines.length
      ? `${lines.join('\n')}\n\nRecord money that comes: <code>+27000 paid back Star Health</code>`
      : 'Nothing to get back.\nMark an expense: <code>30000 hospital @medical claim Star Health</code>\nRecord a loan: <code>5000 lent Ali</code>';
    await this.#telegram.send(chatId, text, { html: true });
  }

  async handleCallback(cb: TelegramCallback, link: TelegramLink): Promise<void> {
    const msg = cb.message!;
    const [, action, seedText] = (cb.data || '').split(':');
    const seed = Number(seedText);
    const ws = await Workspace.load(this.#store, link);
    const own = ws.access(link.user_id);
    if (!own?.isOwn) return void await this.#telegram.answer(cb.id, 'Not available');
    const ids = await OwedBot.#ids(msg.chat.id, seed);
    const tx = await this.#store.loadOwedTx(own.ownerId, ids.tx);
    if (!tx) {
      await this.#telegram.answer(cb.id, 'Already removed');
      return void await this.#telegram.edit(msg.chat.id, msg.message_id, `🗑 Already removed: ${(msg.text || '').split('\n')[0]}`);
    }
    const factory = new TransactionFactory(own.book, await this.#rates.current(own.book.fxRates));
    if (action === 'del') return void await this.#delete(cb, own, tx);
    if (!Array.isArray(tx.tags) || !tx.tags.includes(Payback.TAG)) return void await this.#telegram.answer(cb.id);
    const owed = await this.#store.loadOwed(own.ownerId);
    const items = OwedBot.#payerItems(owed, tx.reimbBy);
    if (action === 'oldest' || action === 'spread') {
      this.#share(tx, items, action, factory.money);
    } else if (action === 'income' || action === 'keep') {
      if (Number(tx.reimbExtra) > 0) tx.reimbExtraAs = action;
    } else if (action === 'close') {
      const closing = items.filter((i) => Payback.open(i).outstanding > 0);
      for (const i of closing) i.reimbClosed = true;
      tx.reimbClosedIds = [...new Set([...(tx.reimbClosedIds || []), ...closing.map((i) => i.id)])];
      if (closing.length) await this.#store.applyOwn(own.ownerId, { put: { transactions: closing.map((i) => Payback.clean(i)) } });
    }
    await this.#store.applyOwn(own.ownerId, { put: { transactions: [Payback.clean(tx)] } });
    await this.#telegram.answer(cb.id, { oldest: 'Shared oldest first', spread: 'Shared evenly', income: 'Extra counted as income', keep: 'Extra kept as credit', close: 'Closed' }[action] ?? undefined);
    const view = this.#paybackText(tx, items, factory, own, null);
    await this.#telegram.edit(msg.chat.id, msg.message_id, view.text, view.keyboard(seed));
  }

  // ── loans ──────────────────────────────────────────────────────────────────

  async #newLoan(c: Ctx): Promise<void> {
    const lent = c.cmd.kind === 'lend';
    const [tx] = await c.factory.build(OwedBot.#entry(c, lent ? 'expense' : 'income'));
    Object.assign(tx, {
      payee: c.cmd.name, note: `${lent ? 'Lent to ' : 'Borrowed from '}${c.cmd.name}`,
      paymentType: c.cmd.paymentType || 'transfer', tags: ['debt'], debtId: c.ids.debt, debtRole: 'initial',
    });
    const debt = {
      id: c.ids.debt, type: lent ? 'lent' : 'borrowed', counterparty: c.cmd.name, principal: tx.amount,
      currency: tx.currency, accountId: c.account.account.id, dateTaken: c.date, dueDate: null, note: '',
      status: 'active', initialTxId: tx.id,
    };
    await this.#store.applyOwn(c.own.ownerId, { put: { transactions: [tx], debts: [debt] } });
    const m = c.factory.money.format(tx.amount, tx.currency);
    const text = lent
      ? `🤝 Lent ${m} to ${c.cmd.name} · ${c.account.account.name}\n${c.cmd.name} owes you ${m} · not spending`
      : `🤝 Borrowed ${m} from ${c.cmd.name} · ${c.account.account.name}\nYou owe ${c.cmd.name} ${m} · not income`;
    await this.#confirm(c, `${text}\n${this.#when(c, tx)}`, OwedBot.#deleteOnly(c.messageId));
  }

  async #repayOrPayback(c: Ctx, owed: OwedData): Promise<void> {
    const wantType = c.cmd.kind === 'received' ? 'lent' : 'borrowed';
    const loans = OwedBot.#match(owed.debts.filter((d) => d.type === wantType), (d) => d.counterparty, c.cmd.name);
    const payers = c.cmd.kind === 'received'
      ? OwedBot.#match(OwedBot.#payers(owed), (p) => p, c.cmd.name)
      : [];
    const useLoan = loans.length && (!payers.length || c.cmd.wants === 'loan');
    const usePayback = payers.length && (!loans.length || c.cmd.wants === 'claim');
    if (useLoan) return await this.#repayLoan(c, loans);
    if (usePayback) return await this.#payback(c, owed, payers[0]);
    if (loans.length && payers.length) {
      return void await this.#telegram.reply(c.chatId,
        `${c.cmd.name} has a loan and items to pay back. Say which, e.g.\n+${c.cmd.amount} loan paid back ${c.cmd.name}\n+${c.cmd.amount} claim paid back ${c.cmd.name}`, c.messageId);
    }
    const known = c.cmd.kind === 'received'
      ? [...new Set([...owed.debts.filter((d) => d.type === 'lent').map((d) => d.counterparty), ...OwedBot.#payers(owed)])]
      : owed.debts.filter((d) => d.type === 'borrowed').map((d) => d.counterparty);
    const none = c.cmd.kind === 'received'
      ? `Nothing open for "${c.cmd.name}" — no loan to them and nothing marked for them to pay back.`
      : `You don't owe "${c.cmd.name}" anything in Pocket.`;
    const list = known.length ? `\nNames with something open:\n${known.slice(0, 15).map((n) => `• ${n}`).join('\n')}` : '';
    const tip = c.cmd.kind === 'received' ? '\nTo save it as ordinary income, send it without "paid back".' : '\nTo record a new loan: +20000 borrowed Hussain';
    await this.#telegram.reply(c.chatId, `${none}${list}${tip}`, c.messageId);
  }

  async #repayLoan(c: Ctx, loans: OwedDebt[]): Promise<void> {
    const debt = loans[0]; // the oldest open one
    if ((c.account.account.currency || c.own.book.homeCurrency) !== debt.currency) {
      return void await this.#telegram.reply(c.chatId, `This loan is in ${debt.currency}. Pick an account in ${debt.currency} with #name.`, c.messageId);
    }
    const left = Math.max(0, debt.principal - debt._paid);
    const lent = debt.type === 'lent';
    const [tx] = await c.factory.build(OwedBot.#entry(c, lent ? 'income' : 'expense'));
    if (tx.amount > left + 1) {
      const who = lent ? `${debt.counterparty} owes ${c.factory.money.format(left, debt.currency)}` : `You owe ${debt.counterparty} ${c.factory.money.format(left, debt.currency)}`;
      return void await this.#telegram.reply(c.chatId, `That's more than what's left: ${who}. Send that amount, or change the loan in the app.`, c.messageId);
    }
    Object.assign(tx, {
      payee: debt.counterparty, note: `${lent ? 'Repayment from ' : 'Payment to '}${debt.counterparty}`,
      paymentType: c.cmd.paymentType || 'transfer', tags: ['debt-payment'], debtId: debt.id, debtRole: 'payment',
    });
    const after = left - tx.amount;
    const changes: Record<string, unknown> = { put: { transactions: [tx], ...(after <= 1 ? { debts: [{ ...Payback.clean(debt), status: 'paid' }] } : {}) } };
    await this.#store.applyOwn(c.own.ownerId, changes);
    const m = (v: number) => c.factory.money.format(v, debt.currency);
    const head = lent
      ? `↩️ ${m(tx.amount)} from ${debt.counterparty} · ${c.account.account.name} · loan repayment`
      : `↩️ Paid ${debt.counterparty} ${m(tx.amount)} · ${c.account.account.name}`;
    const state = after <= 1 ? `${lent ? `${debt.counterparty}'s loan` : `Your loan from ${debt.counterparty}`} is fully paid ✓`
      : lent ? `${debt.counterparty} still owes ${m(after)}` : `You still owe ${debt.counterparty} ${m(after)}`;
    await this.#confirm(c, `${head}\n${state} · not ${lent ? 'income' : 'spending'}\n${this.#when(c, tx)}`, OwedBot.#deleteOnly(c.messageId));
  }

  // ── reimbursements ─────────────────────────────────────────────────────────

  async #payback(c: Ctx, owed: OwedData, payer: string): Promise<void> {
    const items = OwedBot.#payerItems(owed, payer);
    const [tx] = await c.factory.build(OwedBot.#entry(c, 'income'));
    const name = String(items[0]?.reimbBy ?? payer).trim();
    Object.assign(tx, {
      payee: name, note: 'Paid back', paymentType: c.cmd.paymentType || 'transfer', categoryId: null,
      tags: [Payback.TAG], reimbBy: name, claimId: null, reimbAlloc: [], reimbExtra: 0, reimbExtraAs: null,
    });
    const row = tx as unknown as OwedTx;
    this.#share(row, items, 'spread', c.factory.money);
    if (Number(row.reimbExtra) > 0) row.reimbExtraAs = 'keep';
    await this.#store.applyOwn(c.own.ownerId, { put: { transactions: [row] } });
    const view = this.#paybackText(row, items, c.factory, c.own, c.date);
    await this.#confirm(c, view.text, view.keyboard(c.messageId));
  }

  /** (Re)share a payment across the payer's items; its own earlier share is taken back first. */
  #share(pay: OwedTx, items: OwedTx[], mode: 'spread' | 'oldest', money: Money): void {
    const own = new Map<string, number>((pay.reimbAlloc || []).map((a: { txId: string; amount: number }) => [a.txId, Number(a.amount) || 0]));
    const cur = pay.currency;
    const list = items.map((tx) => {
      const it = Payback.open(tx, own.get(tx.id) ?? 0);
      return { id: tx.id, tx, owedOwn: it.outstanding, outstanding: tx.currency === cur ? it.outstanding : money.convert(it.outstanding, tx.currency, cur) };
    });
    const { parts, extra } = Payback.allocate(list, pay.amount, mode);
    pay.reimbAlloc = parts.map((p) => {
      const i = list.find((x) => x.id === p.txId)!;
      const amount = p.amount >= i.outstanding ? i.owedOwn : i.tx.currency === cur ? p.amount : Math.min(i.owedOwn, money.convert(p.amount, cur, i.tx.currency));
      return { txId: p.txId, amount, pay: p.amount };
    });
    pay.reimbExtra = extra;
    if (extra <= 0) pay.reimbExtraAs = null;
    else if (!pay.reimbExtraAs) pay.reimbExtraAs = 'keep';
    pay.reimbMode = mode;
    // Items as they stand after this payment (for the message).
    for (const i of items) i._paid = Math.max(0, (Number(i._paid) || 0) - (own.get(i.id) ?? 0)) + (pay.reimbAlloc.find((a: { txId: string }) => a.txId === i.id)?.amount ?? 0);
  }

  #paybackText(pay: OwedTx, items: OwedTx[], factory: TransactionFactory, own: BookAccess, date: string | null) {
    const money = factory.money;
    const shares = new Map<string, number>((pay.reimbAlloc || []).map((a: { txId: string; amount: number }) => [a.txId, a.amount]));
    const lines = items.filter((i) => shares.has(i.id)).map((i) => {
      const it = Payback.open(i);
      const pct = Math.round(Math.min(1, it.paid / (it.expected || 1)) * 100);
      return `• ${OwedBot.#title(i)} (${OwedBot.#day(i.date)}) ${money.format(shares.get(i.id)!, i.currency)} · Reimbursed ${pct}%${i.reimbClosed ? ' · closed' : ''}`;
    });
    const extra = Number(pay.reimbExtra) || 0;
    const left = items.filter((i) => Payback.open(i).outstanding > 0);
    const acc = own.book.accounts.find((a) => a.id === pay.accountId)?.name ?? '';
    const text = [
      `↩️ ${money.format(pay.amount, pay.currency)} paid back by ${pay.reimbBy} · ${acc} · not income`,
      ...lines,
      extra > 0 ? `${money.format(extra, pay.currency)} more than owed · ${pay.reimbExtraAs === 'income' ? 'counted as income' : 'kept as credit for their next item'}` : null,
      left.length ? `Still to get back from ${pay.reimbBy}: ${money.format(left.reduce((n, i) => n + Payback.open(i).outstanding, 0), left[0].currency)}` : null,
      `${pay.date ?? date} · ${factory.hijri.label(pay.hijriDate)}`,
    ].filter(Boolean).join('\n');
    const keyboard = (seed: number): Keyboard => {
      const rows: Keyboard = [];
      const share = lines.length > 1 || left.length > 0
        ? [{ text: pay.reimbMode === 'oldest' ? 'Spread evenly' : 'Oldest first', callback_data: `${OwedBot.#PREFIX}${pay.reimbMode === 'oldest' ? 'spread' : 'oldest'}:${seed}` }]
        : [];
      const close = left.length ? [{ text: 'Close the rest', callback_data: `${OwedBot.#PREFIX}close:${seed}` }] : [];
      if (share.length || close.length) rows.push([...share, ...close]);
      if (extra > 0) {
        rows.push([pay.reimbExtraAs === 'income'
          ? { text: 'Keep extra as credit', callback_data: `${OwedBot.#PREFIX}keep:${seed}` }
          : { text: 'Count extra as income', callback_data: `${OwedBot.#PREFIX}income:${seed}` }]);
      }
      rows.push([{ text: '🗑 Delete', callback_data: `${OwedBot.#PREFIX}del:${seed}` }]);
      return rows;
    };
    return { text, keyboard };
  }

  // ── delete ─────────────────────────────────────────────────────────────────

  async #delete(cb: TelegramCallback, own: BookAccess, tx: OwedTx): Promise<void> {
    const msg = cb.message!;
    const changes: { put: Record<string, unknown[]>; remove: Record<string, string[]> } = { put: {}, remove: { transactions: [tx.id] } };
    if (tx.debtRole === 'initial' && tx.debtId) {
      const debt = await this.#store.loadDebt(own.ownerId, tx.debtId);
      if (debt && debt._paid > 0) {
        await this.#telegram.answer(cb.id, 'Has repayments');
        return void await this.#telegram.send(msg.chat.id, 'This loan already has repayments. Delete them first, or delete the loan in the app.', { replyTo: msg.message_id });
      }
      if (debt) changes.remove.debts = [debt.id];
    } else if (tx.debtRole === 'payment' && tx.debtId) {
      const debt = await this.#store.loadDebt(own.ownerId, tx.debtId);
      if (debt?.status === 'paid') changes.put.debts = [{ ...Payback.clean(debt), status: 'active' }];
    } else if (Array.isArray(tx.reimbClosedIds) && tx.reimbClosedIds.length) {
      // Reopen what "Close the rest" closed with this payment.
      const closed = await Promise.all(tx.reimbClosedIds.map((id: string) => this.#store.loadOwedTx(own.ownerId, id)));
      const reopen = closed.filter((t): t is OwedTx => !!t && t.reimbClosed === true).map((t) => ({ ...Payback.clean(t), reimbClosed: null }));
      if (reopen.length) changes.put.transactions = reopen;
    }
    await this.#store.applyOwn(own.ownerId, { ...(Object.keys(changes.put).length ? { put: changes.put } : {}), remove: changes.remove });
    await this.#telegram.answer(cb.id, 'Deleted');
    await this.#telegram.edit(msg.chat.id, msg.message_id, `🗑 Deleted: ${(msg.text || '').split('\n')[0]}`);
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  async #confirm(c: Ctx, text: string, keyboard: Keyboard): Promise<void> {
    await this.#telegram.send(c.chatId, text, { replyTo: c.messageId, keyboard });
  }

  #when(c: Ctx, tx: { date: string; hijriDate: unknown }): string {
    // deno-lint-ignore no-explicit-any
    return `${tx.date} · ${c.factory.hijri.label(tx.hijriDate as any)}`;
  }

  static async #ids(chatId: number, seed: number): Promise<{ tx: string; debt: string }> {
    const tx = await TransactionFactory.idFor(chatId, seed);
    return { tx, debt: `dbt_${tx.slice(3)}` };
  }

  static #entry(c: Ctx, type: 'expense' | 'income') {
    return {
      chatId: c.chatId, messageId: c.messageId, account: c.account.account, toAccount: null, category: null,
      date: c.date, addedBy: c.link.email,
      entry: {
        type, amount: c.cmd.amount, note: '', paymentType: c.cmd.paymentType, accountHint: null, toAccountHint: null,
        receivedAmount: null, categoryHint: null, daysAgo: 0, date: null as EntryDate | null,
      },
    };
  }

  static #deleteOnly(seed: number): Keyboard {
    return [[{ text: '🗑 Delete', callback_data: `${OwedBot.#PREFIX}del:${seed}` }]];
  }

  /** Names that match exactly (ignoring case and spaces), else start with what was typed. */
  static #match<T>(list: T[], name: (x: T) => string, typed: string): T[] {
    const key = Payback.key(typed);
    const exact = list.filter((x) => Payback.key(name(x)) === key);
    if (exact.length) return exact;
    const prefix = list.filter((x) => Payback.key(name(x)).startsWith(key));
    const names = new Set(prefix.map((x) => Payback.key(name(x))));
    return names.size === 1 ? prefix : [];
  }

  /** Payers with an open item or credit. */
  static #payers(owed: OwedData): string[] {
    const seen = new Map<string, string>();
    for (const t of owed.items) if (Payback.open(t).outstanding > 0) seen.set(Payback.key(t.reimbBy), String(t.reimbBy).trim());
    return [...seen.values()];
  }

  static #payerItems(owed: OwedData, payer: string): OwedTx[] {
    const k = Payback.key(payer);
    return owed.items.filter((t) => Payback.key(t.reimbBy) === k).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  static #title(t: OwedTx): string {
    return String(t.payee || t.note || 'Expense').slice(0, 40);
  }

  static #day(iso: string): string {
    const [, m, d] = String(iso).split('-').map(Number);
    return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] ?? ''}`;
  }

  static #esc(s: string): string {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

interface Ctx {
  link: TelegramLink;
  chatId: number;
  messageId: number;
  own: BookAccess;
  account: AccountChoice;
  cmd: OwedCommand;
  date: string;
  ids: { tx: string; debt: string };
  factory: TransactionFactory;
}
