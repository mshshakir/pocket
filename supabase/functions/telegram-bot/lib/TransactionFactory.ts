/**
 * TransactionFactory — builds transactions with the same fields and
 * conventions as the app (TransactionService.create and
 * TransactionComposer#buildTransferPair): minor-unit amounts, frozen
 * exchangeRate/refAmount, acctMinor, and a hijriDate snapshot at the owner's
 * offset. A row the app would complete on load (a missing field it back-fills)
 * looks edited to the app, which then saves it again under the app user's name
 * — so every field the app derives is written here up front.
 */
import { HijriCalendar, type HijriDate } from './HijriCalendar.ts';
import { Money } from './Money.ts';
import type { Account, Category, PocketBook } from './PocketBook.ts';
import type { ParsedEntry } from './EntryParser.ts';

export interface PocketTransaction {
  id: string;
  accountId: string;
  categoryId: string | null;
  amount: number;
  currency: string;
  exchangeRate: number;
  refAmount: number;
  /** The amount in the account's own currency, frozen at creation (LedgerMath.stampAccountAmounts). */
  acctMinor: number;
  payee: string;
  note: string;
  date: string;
  hijriDate: HijriDate;
  paymentType: string;
  recordState: 'cleared';
  type: 'expense' | 'income' | 'transfer';
  transferPairId: string | null;
  transferDir: 'out' | 'in' | null;
  transferRate: number | null;
  tags: string[];
  splits: null;
  recurring: null;
  recurringSourceId: null;
  createdAt: string;
  addedBy: string | null;
}

export interface BuildInput {
  chatId: number;
  messageId: number;
  entry: ParsedEntry;
  account: Account;
  toAccount: Account | null;
  category: Category | null;
  date: string;
  addedBy: string | null;
}

export class TransactionFactory {
  readonly #book: PocketBook;
  readonly #money: Money;
  readonly #hijri: HijriCalendar;

  /** @param rates units per 1 USD (live, merged over the book's saved rates) */
  constructor(book: PocketBook, rates: Record<string, number>) {
    this.#book = book;
    this.#money = new Money(rates);
    this.#hijri = new HijriCalendar(book.hijriOffset);
  }

  get money(): Money { return this.#money; }
  get hijri(): HijriCalendar { return this.#hijri; }

  /** Stable id per Telegram message (and transfer leg), so a webhook retry can never double-book. */
  static async idFor(chatId: number, messageId: number, leg = ''): Promise<string> {
    const bytes = new TextEncoder().encode(`telegram:${chatId}:${messageId}${leg ? ':' + leg : ''}`);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hex = Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
    return `tx_${hex.slice(0, 12)}`;
  }

  /** Every id an entry from this message could have (single row, or a transfer's legs). */
  static async allIdsFor(chatId: number, messageId: number): Promise<string[]> {
    return Promise.all(['', 'out', 'in'].map((leg) => TransactionFactory.idFor(chatId, messageId, leg)));
  }

  /** One row for an expense or income; two linked rows (out, in) for a transfer. */
  async build(input: BuildInput): Promise<PocketTransaction[]> {
    return input.entry.type === 'transfer' ? await this.#transfer(input) : [await this.#single(input)];
  }

  async #single(input: BuildInput): Promise<PocketTransaction> {
    const { entry, account } = input;
    const currency = account.currency || this.#book.homeCurrency;
    const amount = this.#money.toMinor(entry.amount, currency);
    return {
      ...this.#common(input),
      id: await TransactionFactory.idFor(input.chatId, input.messageId),
      accountId: account.id,
      categoryId: input.category?.id ?? null,
      ...this.#valued(amount, currency),
      payee: '',
      paymentType: entry.paymentType || this.#book.defaultPaymentType,
      type: entry.type as 'expense' | 'income',
      transferPairId: null,
      transferDir: null,
      transferRate: null,
    };
  }

  /** H4: denominated in the SOURCE account's currency; H5: a typed received amount wins over the live rate. */
  async #transfer(input: BuildInput): Promise<PocketTransaction[]> {
    const { entry, account: from } = input;
    const to = input.toAccount;
    if (!to) throw new Error('Pick an account to transfer to.');
    if (to.id === from.id) throw new Error('Pick two different accounts.');

    const fromCcy = from.currency || this.#book.homeCurrency;
    const toCcy = to.currency || this.#book.homeCurrency;
    const sent = this.#money.toMinor(entry.amount, fromCcy);
    let rate: number;
    let received: number;
    if (fromCcy === toCcy) {
      rate = 1;
      received = sent;
    } else if (entry.receivedAmount !== null) {
      received = this.#money.toMinor(entry.receivedAmount, toCcy);
      rate = entry.receivedAmount / entry.amount;
    } else {
      rate = this.#money.rate(fromCcy, toCcy);
      received = this.#money.toMinor(entry.amount * rate, toCcy);
    }

    const outId = await TransactionFactory.idFor(input.chatId, input.messageId, 'out');
    const inId = await TransactionFactory.idFor(input.chatId, input.messageId, 'in');
    const shared = {
      ...this.#common(input),
      categoryId: null,
      payee: 'Transfer',
      paymentType: 'transfer',
      type: 'transfer' as const,
      transferRate: rate,
    };
    return [
      { ...shared, id: outId, accountId: from.id, ...this.#valued(sent, fromCcy), transferPairId: inId, transferDir: 'out' },
      { ...shared, id: inId, accountId: to.id, ...this.#valued(received, toCcy), transferPairId: outId, transferDir: 'in' },
    ];
  }

  /** Every row the bot writes is in its own account's currency, so acctMinor is the amount itself. */
  #valued(amount: number, currency: string) {
    const home = this.#book.homeCurrency;
    return {
      amount,
      acctMinor: amount,
      currency,
      exchangeRate: this.#money.exchangeRate(currency, home),
      refAmount: this.#money.convert(amount, currency, home),
    };
  }

  #common(input: BuildInput) {
    return {
      note: input.entry.note,
      date: input.date,
      hijriDate: this.#hijri.toHijri(input.date),
      recordState: 'cleared' as const,
      tags: [],
      splits: null,
      recurring: null,
      recurringSourceId: null,
      createdAt: new Date().toISOString(),
      addedBy: input.addedBy,
    };
  }
}
