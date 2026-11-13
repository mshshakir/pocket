/**
 * EntryParser — turns a chat message into a structured entry.
 *
 *   500 diaper                    → ₹500 expense, note "diaper"
 *   500 diaper cash               → paid in cash
 *   +45000 salary                 → income
 *   250 lunch #wallet @food       → into the account starting "wallet", category starting "food"
 *   120 taxi yesterday            → dated yesterday
 *   5000 #boi > #mpesa            → transfer from BOI to MPesa
 *   5000 > #mpesa                 → transfer from the default account to MPesa
 *   5000 #boi > #mpesa =7750      → transfer where MPesa received 7,750 (cross-currency)
 *
 * Amounts may carry "₹", "rs" and thousands commas ("₹1,250.50").
 */
export type EntryType = 'expense' | 'income' | 'transfer';

export interface ParsedEntry {
  type: EntryType;
  amount: number;            // major units, as typed (source currency for transfers)
  note: string;
  paymentType: string | null;
  accountHint: string | null; // the account (source account for transfers)
  toAccountHint: string | null; // transfer destination
  receivedAmount: number | null; // transfer: amount that reached the destination, if typed
  categoryHint: string | null;
  daysAgo: number;
}

export type ParseResult = { ok: true; entry: ParsedEntry } | { ok: false; reason: string };

export class EntryParser {
  static readonly #AMOUNT = /^(\+)?(?:₹|rs\.?|inr)?(\d[\d,]*(?:\.\d+)?)$/i;
  static readonly #RECEIVED = /^=(\d[\d,]*(?:\.\d+)?)$/;
  static readonly #CURRENCY_WORDS = new Set(['rs', 'rs.', 'rupees', 'rupee', 'inr', '₹']);
  static readonly #ARROWS = /(->|→|>)/;

  readonly #paymentTypes: Set<string>;

  /** @param paymentTypes the payment types the owner's app knows */
  constructor(paymentTypes: string[]) {
    this.#paymentTypes = new Set(paymentTypes.map((p) => p.toLowerCase()));
  }

  parse(text: string): ParseResult {
    const tokens = EntryParser.#tokenize(text);
    let amount: number | null = null;
    let received: number | null = null;
    let income = false;
    let arrow = false;
    let paymentType: string | null = null;
    let categoryHint: string | null = null;
    let daysAgo = 0;
    const before: string[] = []; // #account hints before the arrow
    const after: string[] = [];  // #account hints after the arrow
    const noteWords: string[] = [];

    for (const token of tokens) {
      const lower = token.toLowerCase();
      const match = amount === null ? EntryParser.#AMOUNT.exec(token) : null;
      const recv = EntryParser.#RECEIVED.exec(token);
      if (token === '>') {
        arrow = true;
      } else if (match) {
        amount = Number(match[2].replace(/,/g, ''));
        if (match[1]) income = true;
      } else if (recv) {
        received = Number(recv[1].replace(/,/g, ''));
      } else if (token.startsWith('#') && token.length > 1) {
        (arrow ? after : before).push(lower.slice(1));
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

    // A transfer is an arrow, or two #accounts in one message.
    const isTransfer = arrow || before.length + after.length >= 2;
    let accountHint: string | null = before[0] ?? null;
    let toAccountHint: string | null = null;
    if (isTransfer) {
      toAccountHint = arrow ? (after[0] ?? null) : (before[1] ?? null);
      if (!arrow) accountHint = before[0];
      if (!toAccountHint) {
        return { ok: false, reason: 'Where should the money go? For example: 5000 #boi > #mpesa' };
      }
    }
    if (received !== null && !isTransfer) {
      return { ok: false, reason: '"=amount" is only for transfers, e.g. 5000 #boi > #mpesa =7750' };
    }

    return {
      ok: true,
      entry: {
        type: isTransfer ? 'transfer' : income ? 'income' : 'expense',
        amount,
        note: noteWords.join(' '),
        paymentType,
        accountHint,
        toAccountHint,
        receivedAmount: received,
        categoryHint: isTransfer ? null : categoryHint,
        daysAgo,
      },
    };
  }

  /** Split on spaces, and also around arrows so "#boi>#mpesa" works. */
  static #tokenize(text: string): string[] {
    return text.trim()
      .split(EntryParser.#ARROWS).map((part) => (EntryParser.#ARROWS.test(part) ? ' > ' : part)).join('')
      .split(/\s+/).filter(Boolean);
  }
}
