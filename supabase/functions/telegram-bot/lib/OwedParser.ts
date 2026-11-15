/**
 * OwedParser — loans and money paid back, in chat words.
 *
 *   5000 lent Ali                 a loan you gave (Ali owes you)
 *   +20000 borrowed Hussain       a loan you took (you owe Hussain)
 *   2000 paid back Ali            money back from Ali: a loan repayment, or
 *   +27000 paid back Star Health  a reimbursement (whichever Ali / Star Health has open)
 *   2000 Ali paid back            the same, name first
 *   3000 repaid Hussain           you paying back what you owe (also "paid back to Hussain")
 *
 * The sign doesn't matter for these: the words say which way money moves.
 * #account, a payment type, a date and "yesterday" work as on any entry;
 * anything else after the name is ignored (the name is the words up to the
 * first #account, date or end).
 *
 * And on an ordinary expense, "claim <payer> [amount]" marks it as one
 * someone will pay back (splitBack). "claim" rather than "back", because
 * "auto back home" is an ordinary note:
 *
 *   30000 hospital @medical claim Star Health         they'll pay all of it
 *   30000 hospital @medical claim Star Health 27000   they'll pay 27,000 of it
 */
import { EntryDate } from './EntryDate.ts';

export type OwedKind = 'lend' | 'borrow' | 'received' | 'repay';

export interface OwedCommand {
  kind: OwedKind;
  amount: number;                // major units
  name: string;                  // the other person, company or insurer
  accountHint: string | null;
  paymentType: string | null;
  daysAgo: number;
  date: EntryDate | null;
  wants: 'loan' | 'claim' | null; // "loan" / "claim" in the message picks one when a name has both
}

export interface BackMark {
  text: string;          // the entry without the "back …" part
  payer: string;
  expected: number | null; // major units, or null for all of it
}

export class OwedParser {
  static readonly #AMOUNT = /^\+?(?:₹|rs\.?|inr)?(\d[\d,]*(?:\.\d+)?)$/i;
  static readonly #NUMBER = /^(?:₹|rs\.?)?(\d[\d,]*(?:\.\d+)?)$/i;

  readonly #paymentTypes: Set<string>;

  constructor(paymentTypes: string[]) {
    this.#paymentTypes = new Set(paymentTypes.map((p) => p.toLowerCase()));
  }

  /** A loan or a payback, or null when the message is an ordinary entry. */
  parse(text: string): OwedCommand | { error: string } | null {
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    const lower = tokens.map((t) => t.toLowerCase());
    if (!tokens.length) return null;

    // Which phrase, and where the name sits.
    let kind: OwedKind | null = null;
    let nameAt = -1;      // first token of the name
    let nameEnd = -1;     // exclusive, when the name comes before the phrase
    for (let i = 0; i < lower.length && !kind; i++) {
      const w = lower[i], next = lower[i + 1], third = lower[i + 2];
      if (w === 'lent' || w === 'loaned') { kind = 'lend'; nameAt = i + 1 + (next === 'to' ? 1 : 0); }
      else if (w === 'borrowed') { kind = 'borrow'; nameAt = i + 1 + (next === 'from' ? 1 : 0); }
      else if (w === 'repaid' || (w === 'paid' && next === 'back' && third === 'to')) {
        kind = 'repay'; nameAt = w === 'repaid' ? i + 1 + (next === 'to' ? 1 : 0) : i + 3;
      } else if (w === 'paid' && next === 'back') {
        kind = 'received';
        if (third === 'by' || third === 'from') nameAt = i + 3;
        else if (third && !OwedParser.#stop(tokens[i + 2], this.#paymentTypes)) nameAt = i + 2;
        else { nameAt = -1; nameEnd = i; } // "Ali paid back"
      }
    }
    if (!kind) return null;

    const amountIdx = tokens.findIndex((t) => OwedParser.#AMOUNT.test(t));
    if (amountIdx < 0) return { error: 'I couldn\'t find an amount. For example: 5000 lent Ali' };
    const amount = Number(OwedParser.#AMOUNT.exec(tokens[amountIdx])![1].replace(/,/g, ''));
    if (!(amount > 0)) return { error: 'The amount must be more than 0.' };

    let name: string[] = [];
    if (nameAt >= 0) {
      for (let i = nameAt; i < tokens.length; i++) {
        if (i === amountIdx || OwedParser.#stop(tokens[i], this.#paymentTypes)) break;
        name.push(tokens[i]);
      }
    } else {
      // Name before "paid back": the words between the amount and the phrase.
      name = tokens.slice(0, nameEnd).filter((t) => !OwedParser.#stop(t, this.#paymentTypes));
    }
    // "loan" / "claim" only pick which kind; they aren't part of the name.
    name = name.filter((t) => !/^(loan|claim|reimburs\w*)$/i.test(t));
    const who = name.join(' ').replace(/^[@#]/, '').trim();
    if (!who) {
      const eg = { lend: '5000 lent Ali', borrow: '+20000 borrowed Hussain', received: '2000 paid back Ali', repay: '3000 repaid Hussain' }[kind];
      return { error: `Who is it? For example: ${eg}` };
    }

    let accountHint: string | null = null;
    let paymentType: string | null = null;
    let daysAgo = 0;
    let date: EntryDate | null = null;
    for (const t of tokens) {
      const l = t.toLowerCase();
      if (t.startsWith('#') && t.length > 1 && accountHint === null) accountHint = l.slice(1);
      else if (l === 'yesterday') daysAgo = 1;
      else if (EntryDate.looksLikeDate(t)) {
        const parsed = EntryDate.parse(t);
        if (parsed && 'invalid' in parsed) return { error: parsed.invalid };
        date = parsed;
      } else if (paymentType === null && this.#paymentTypes.has(l)) paymentType = l;
    }
    const wants = lower.includes('loan') ? 'loan' : lower.some((w) => w === 'claim' || w.startsWith('reimburs')) ? 'claim' : null;
    return { kind, amount, name: who, accountHint, paymentType, daysAgo, date, wants };
  }

  /**
   * "… claim <payer> [amount]" on an expense: the payer is the words after
   * "claim" (or "claim from"), up to an #account, @category, date or the end;
   * a number among them is how much they'll pay.
   */
  splitBack(text: string): BackMark | null {
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    let at = -1;
    tokens.forEach((t, i) => {
      if (t.toLowerCase() === 'claim' && i > 0 && at < 0) at = i;
    });
    if (at < 0) return null;
    const payer: string[] = [];
    let expected: number | null = null;
    let end = at + 1 + (tokens[at + 1]?.toLowerCase() === 'from' ? 1 : 0);
    for (; end < tokens.length; end++) {
      const t = tokens[end];
      if (t.startsWith('#') || t.startsWith('@') || EntryDate.looksLikeDate(t) || t.toLowerCase() === 'yesterday') break;
      const n = OwedParser.#NUMBER.exec(t);
      if (n && payer.length) { expected = Number(n[1].replace(/,/g, '')); continue; }
      if (this.#paymentTypes.has(t.toLowerCase()) && payer.length) break;
      payer.push(t);
    }
    if (!payer.length) return null;
    const rest = [...tokens.slice(0, at), ...tokens.slice(end)].join(' ');
    return { text: rest, payer: payer.join(' '), expected };
  }

  /** Words that end a name: #account, @category, dates, "yesterday", payment types, amounts. */
  static #stop(t: string | undefined, paymentTypes: Set<string>): boolean {
    if (!t) return true;
    const l = t.toLowerCase();
    return t.startsWith('#') || t.startsWith('@') || l === 'yesterday' || EntryDate.looksLikeDate(t)
      || paymentTypes.has(l) || OwedParser.#AMOUNT.test(t);
  }
}
