/**
 * EntryBatch — splits a message with several lines into separate entries.
 *
 *   200 fruits
 *   80 clips
 *   1351 oct 2026 bill @electricity #boi
 *   #mpesa @groceries cash yesterday      ← a "shared" line: no amount
 *
 * A shared line (only #account, @category, a payment type or "yesterday")
 * fills in whatever a line leaves out; a line's own choices always win.
 * Transfers keep their own accounts and need no category, so only
 * "yesterday" carries over to them. Lines with no amount are reported back.
 */
import { EntryParser } from './EntryParser.ts';

/** One entry line, with the shared choices it lacked written onto it. */
export interface BatchItem {
  seed: number;    // row ids derive from this (see EntryBatch.seedFor)
  line: string;    // the line as typed, for messages
  text: string;    // the line plus any shared choices it lacked
  shared: boolean; // its category comes from the shared line
}

export interface InvalidLine {
  line: string;
  reason: string;
}

export type BatchPlan =
  | { ok: true; items: BatchItem[]; invalid: InvalidLine[] }
  | { ok: false; reason: string };

interface SharedChoices {
  account: string | null;
  category: string | null;
  paymentType: string | null;
  yesterday: boolean;
}

export class EntryBatch {
  static readonly MAX_LINES = 50;
  static readonly #SEED_SPAN = 100; // > MAX_LINES, so seeds of different messages never meet

  readonly #parser: EntryParser;
  readonly #paymentTypes: Set<string>;

  constructor(paymentTypes: string[]) {
    this.#parser = new EntryParser(paymentTypes);
    this.#paymentTypes = new Set(paymentTypes.map((p) => p.toLowerCase()));
  }

  /** Whether a message has more than one non-empty line. */
  static isBatch(text: string): boolean {
    return EntryBatch.#lines(text).length > 1;
  }

  /**
   * The seed for line `index` (1-based) of a message. Negative, so it can
   * never equal a real message id, which single-line entries use.
   */
  static seedFor(messageId: number, index: number): number {
    return -(messageId * EntryBatch.#SEED_SPAN + index);
  }

  plan(text: string, messageId: number): BatchPlan {
    const lines = EntryBatch.#lines(text);
    if (lines.length > EntryBatch.MAX_LINES) {
      return { ok: false, reason: `Please send at most ${EntryBatch.MAX_LINES} lines at a time.` };
    }

    const shared: SharedChoices = { account: null, category: null, paymentType: null, yesterday: false };
    const entryLines: string[] = [];
    const invalid: InvalidLine[] = [];
    for (const line of lines) {
      if (this.#isSharedLine(line)) this.#readShared(line, shared);
      else entryLines.push(line);
    }

    const items: BatchItem[] = [];
    entryLines.forEach((line, i) => {
      const parsed = this.#parser.parse(line);
      if (!parsed.ok) return void invalid.push({ line, reason: parsed.reason.split('\n')[0] });
      const own = parsed.entry;
      const extra: string[] = [];
      let fromShared = false;
      if (own.type !== 'transfer') {
        if (!own.accountHint && shared.account) extra.push(`#${shared.account}`);
        if (!own.categoryHint && shared.category) {
          extra.push(`@${shared.category}`);
          fromShared = true;
        }
        if (!own.paymentType && shared.paymentType) extra.push(shared.paymentType);
      }
      if (!own.daysAgo && shared.yesterday) extra.push('yesterday');
      items.push({
        seed: EntryBatch.seedFor(messageId, i + 1),
        line,
        text: [line, ...extra].join(' '),
        shared: fromShared,
      });
    });
    return { ok: true, items, invalid };
  }

  /** A line of only #account, @category, payment type and "yesterday" words. */
  #isSharedLine(line: string): boolean {
    return line.split(/\s+/).every((word) => {
      const lower = word.toLowerCase();
      return /^[#@]\S+$/.test(word) || lower === 'yesterday' || this.#paymentTypes.has(lower);
    });
  }

  /** Later shared lines override earlier ones. */
  #readShared(line: string, shared: SharedChoices): void {
    for (const word of line.split(/\s+/)) {
      const lower = word.toLowerCase();
      if (word.startsWith('#')) shared.account = lower.slice(1);
      else if (word.startsWith('@')) shared.category = lower.slice(1);
      else if (lower === 'yesterday') shared.yesterday = true;
      else shared.paymentType = lower;
    }
  }

  static #lines(text: string): string[] {
    return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }
}
