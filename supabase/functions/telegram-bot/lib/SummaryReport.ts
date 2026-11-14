/**
 * SummaryReport — the text of a group summary (Telegram HTML).
 *
 *   📊 Shakirs · Sat 14 Nov
 *   Spent ₹2,340 in 6 entries
 *   • Groceries ₹1,150
 *   • Restaurant ₹770
 *   Received ₹4,600
 *   ✍️ Mufaddal 4 · Sakina 2
 *
 * Amounts are rounded to whole units of the book's home currency. Only the
 * space's own accounts are ever in a SpaceSummary, so nothing personal shows.
 */
import { Money } from './Money.ts';
import type { SpaceSummary } from './PocketStore.ts';

export class SummaryReport {
  static readonly #TOP_DAY = 4;
  static readonly #TOP_WEEK = 5;
  static readonly #TOP_MONTH = 6;

  readonly #money: Money;

  constructor(money: Money = new Money()) {
    this.#money = money;
  }

  /** @param when 'today' or 'yesterday', for the nothing-logged line */
  daily(day: string, s: SpaceSummary, names: boolean, when: 'today' | 'yesterday' = 'today'): string {
    const head = `📊 <b>${SummaryReport.esc(s.space)} · ${SummaryReport.#day(day)}</b>`;
    if (!s.entries) {
      return `${head}\nNothing logged in the shared accounts ${when}.\nMissed something? Send it to me in a private chat.`;
    }
    return [head, ...this.#body(s, SummaryReport.#TOP_DAY, null), ...this.#people(s, names)].join('\n');
  }

  /** @param previous the week before, for the comparison (null to leave it out) */
  weekly(from: string, to: string, s: SpaceSummary, previous: SpaceSummary | null, names: boolean): string {
    const head = `🗓 <b>${SummaryReport.esc(s.space)} · week of ${SummaryReport.#range(from, to)}</b>`;
    if (!s.entries) return `${head}\nNothing was logged in the shared accounts this week.`;
    return [head, ...this.#body(s, SummaryReport.#TOP_WEEK, previous, 'last week', false), ...this.#people(s, names)].join('\n');
  }

  /**
   * A month, compared with the month before overall and per category.
   * @param label "October 2026" · @param previousName "September"
   */
  monthly(label: string, previousName: string, s: SpaceSummary, previous: SpaceSummary | null, names: boolean): string {
    const head = `📅 <b>${SummaryReport.esc(s.space)} · ${SummaryReport.esc(label)}</b>`;
    if (!s.entries) return `${head}\nNothing was logged in the shared accounts this month.`;
    return [head, ...this.#body(s, SummaryReport.#TOP_MONTH, previous, SummaryReport.esc(previousName), true), ...this.#people(s, names)].join('\n');
  }

  #body(s: SpaceSummary, top: number, previous: SpaceSummary | null, previousName = 'last week', perCategory = false): string[] {
    const lines: string[] = [];
    const n = s.entries;
    lines.push(`Spent <b>${this.#amount(s.spent, s.currency)}</b> in ${n} ${n === 1 ? 'entry' : 'entries'}${this.#compare(s, previous, previousName)}`);
    const cats = s.categories.filter((c) => c.amount > 0);
    const before = new Map((previous?.categories ?? []).map((c) => [c.name, c.amount]));
    for (const c of cats.slice(0, top)) {
      const change = perCategory && previous ? SummaryReport.#change(c.amount, before.get(c.name) ?? 0) : '';
      lines.push(`• ${SummaryReport.esc(c.name)} ${this.#amount(c.amount, s.currency)}${change ? ` (${change})` : ''}`);
    }
    const rest = cats.slice(top).reduce((sum, c) => sum + c.amount, 0);
    if (rest > 0) lines.push(`• Other ${this.#amount(rest, s.currency)}`);
    if (s.received > 0) lines.push(`Received ${this.#amount(s.received, s.currency)}`);
    return lines;
  }

  #compare(s: SpaceSummary, previous: SpaceSummary | null, previousName: string): string {
    if (!previous) return '';
    const last = this.#amount(previous.spent, s.currency);
    const word = SummaryReport.#change(s.spent, previous.spent);
    return word ? ` (${previousName} ${last}, ${word})` : ` (${previousName} ${last})`;
  }

  /** "up 22%", "down 4%", "about the same", "new" (nothing before), or '' when both are nothing. */
  static #change(now: number, before: number): string {
    if (before <= 0) return now > 0 ? 'new' : '';
    const pct = Math.round(((now - before) / before) * 100);
    return pct === 0 ? 'about the same' : `${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}%`;
  }

  #people(s: SpaceSummary, names: boolean): string[] {
    if (!names || !s.people.length) return [];
    return [`✍️ ${s.people.map((p) => `${SummaryReport.esc(p.name)} ${p.entries}`).join(' · ')}`];
  }

  #amount(minor: number, currency: string): string {
    const f = this.#money.factor(currency);
    return this.#money.format(Math.round(minor / f) * f, currency);
  }

  static esc(text: string): string {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** "Sat 14 Nov" */
  static #day(iso: string): string {
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  /** "8–14 Nov", or "29 Nov – 5 Dec" across months. */
  static #range(from: string, to: string): string {
    const a = new Date(`${from}T00:00:00Z`), b = new Date(`${to}T00:00:00Z`);
    const month = (d: Date) => d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
    return a.getUTCMonth() === b.getUTCMonth()
      ? `${a.getUTCDate()}–${b.getUTCDate()} ${month(b)}`
      : `${a.getUTCDate()} ${month(a)} – ${b.getUTCDate()} ${month(b)}`;
  }
}
