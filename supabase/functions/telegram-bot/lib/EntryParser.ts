/**
 * EntryParser — turns a chat message into a structured entry.
 *
 *   500 diaper                → ₹500 expense, note "diaper"
 *   500 diaper cash           → paid in cash
 *   +45000 salary             → income
 *   250 lunch #wallet @food   → into the account starting "wallet", category starting "food"
 *   120 taxi yesterday        → dated yesterday
 *
 * Amounts may carry "₹", "rs" and thousands commas ("₹1,250.50").
 */
export interface ParsedEntry {
  type: 'expense' | 'income';
  amount: number;          // major units, as typed
  note: string;
  paymentType: string | null;
  accountHint: string | null;
  categoryHint: string | null;
  daysAgo: number;
}

export type ParseResult = { ok: true; entry: ParsedEntry } | { ok: false; reason: string };

export class EntryParser {
  static readonly #AMOUNT = /^(\+)?(?:₹|rs\.?|inr)?(\d[\d,]*(?:\.\d+)?)$/i;
  static readonly #CURRENCY_WORDS = new Set(['rs', 'rs.', 'rupees', 'rupee', 'inr', '₹']);

  readonly #paymentTypes: Set<string>;

  /** @param paymentTypes the payment types the owner's app knows */
  constructor(paymentTypes: string[]) {
    this.#paymentTypes = new Set(paymentTypes.map((p) => p.toLowerCase()));
  }

  parse(text: string): ParseResult {
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    let amount: number | null = null;
    let type: ParsedEntry['type'] = 'expense';
    let paymentType: string | null = null;
    let accountHint: string | null = null;
    let categoryHint: string | null = null;
    let daysAgo = 0;
    const noteWords: string[] = [];

    for (const token of tokens) {
      const lower = token.toLowerCase();
      const match = amount === null ? EntryParser.#AMOUNT.exec(token) : null;
      if (match) {
        amount = Number(match[2].replace(/,/g, ''));
        if (match[1]) type = 'income';
      } else if (token.startsWith('#') && token.length > 1) {
        accountHint = lower.slice(1);
      } else if (token.startsWith('@') && token.length > 1) {
        categoryHint = lower.slice(1);
      } else if (lower === 'yesterday') {
        daysAgo = 1;
      } else if (paymentType === null && this.#paymentTypes.has(lower)) {
        paymentType = lower;
      } else if (!EntryParser.#CURRENCY_WORDS.has(lower)) {
        noteWords.push(token);
      }
    }

    if (amount === null || !(amount > 0)) {
      return { ok: false, reason: 'I couldn\'t find an amount. Try something like: 500 diaper cash' };
    }
    return {
      ok: true,
      entry: { type, amount, note: noteWords.join(' '), paymentType, accountHint, categoryHint, daysAgo },
    };
  }
}
