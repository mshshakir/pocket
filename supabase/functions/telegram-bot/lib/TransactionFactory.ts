/**
 * TransactionFactory — builds a transaction object with the same fields and
 * conventions as the app's TransactionService.create(): minor-unit amounts,
 * frozen exchangeRate/refAmount, and a hijriDate snapshot at the owner's offset.
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
  payee: string;
  note: string;
  date: string;
  hijriDate: HijriDate;
  paymentType: string;
  recordState: 'cleared';
  type: 'expense' | 'income';
  transferPairId: null;
  transferDir: null;
  transferRate: null;
  tags: string[];
  splits: null;
  recurring: null;
  recurringSourceId: null;
  createdAt: string;
  addedBy: string | null;
}

export interface BuildInput {
  id: string;
  entry: ParsedEntry;
  account: Account;
  category: Category | null;
  date: string;
  addedBy: string | null;
}

export class TransactionFactory {
  readonly #book: PocketBook;
  readonly #money: Money;
  readonly #hijri: HijriCalendar;

  constructor(book: PocketBook) {
    this.#book = book;
    this.#money = new Money(book.fxRates);
    this.#hijri = new HijriCalendar(book.hijriOffset);
  }

  get money(): Money { return this.#money; }
  get hijri(): HijriCalendar { return this.#hijri; }

  /** Stable id per Telegram message, so a webhook retry can never double-book. */
  static async idFor(chatId: number, messageId: number): Promise<string> {
    const bytes = new TextEncoder().encode(`telegram:${chatId}:${messageId}`);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hex = Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
    return `tx_${hex.slice(0, 12)}`;
  }

  build(input: BuildInput): PocketTransaction {
    const { entry, account } = input;
    const currency = account.currency || this.#book.homeCurrency;
    const home = this.#book.homeCurrency;
    const amount = this.#money.toMinor(entry.amount, currency);
    return {
      id: input.id,
      accountId: account.id,
      categoryId: input.category?.id ?? null,
      amount,
      currency,
      exchangeRate: this.#money.exchangeRate(currency, home),
      refAmount: this.#money.convert(amount, currency, home),
      payee: '',
      note: entry.note,
      date: input.date,
      hijriDate: this.#hijri.toHijri(input.date),
      paymentType: entry.paymentType || this.#book.defaultPaymentType,
      recordState: 'cleared',
      type: entry.type,
      transferPairId: null,
      transferDir: null,
      transferRate: null,
      tags: [],
      splits: null,
      recurring: null,
      recurringSourceId: null,
      createdAt: new Date().toISOString(),
      addedBy: input.addedBy,
    };
  }
}
