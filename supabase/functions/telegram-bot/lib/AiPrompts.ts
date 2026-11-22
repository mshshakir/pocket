/**
 * AiPrompts — what the bot asks the AI, and how it reads the answers.
 *
 * Entries: a voice note, a receipt photo, or a typed message the bot couldn't
 * read is turned into lines in the bot's OWN message format ("450 groceries
 * dmart @foodgroceries #hdfc card"). Those lines then go through the normal
 * parser, so accounts, categories, shared books, permissions, the category
 * question and the ✏️ / 🗑 buttons all work exactly as for a typed message.
 *
 * Questions: answered only from totals (this month, last month, budgets) —
 * never from individual entries.
 */
import { BudgetAlertRunner } from './BudgetAlertRunner.ts';
import { type PocketBook, PocketBook as Book } from './PocketBook.ts';
import type { Insights, PeriodTotals } from './PocketStore.ts';
import type { Workspace } from './Workspace.ts';

export type AiSource = 'voice' | 'receipt' | 'text';

/** What the AI made of a voice note, photo or message. */
export interface AiReading {
  kind: 'entries' | 'question' | 'none';
  heard: string;      // what it heard or read, shown back to the person
  lines: string[];    // entries in the bot's format
}

export class AiPrompts {
  static readonly MAX_LINES = 40;
  static readonly #MAX_CATEGORIES = 250;

  /**
   * @param ws        the books the person can write to
   * @param book      the book of their default account (its categories are offered)
   * @param defaultAccount  name of the default account, if any
   * @param today     YYYY-MM-DD in the person's time zone
   */
  static entries(source: AiSource, ws: Workspace, book: PocketBook | null, defaultAccount: string | null, today: string, extra = ''): string {
    const accounts = ws.choices().map((c) => `#${Book.squash(c.account.name)} = ${ws.label(c)} (${c.account.currency})`);
    const cats = (type: string) => {
      if (!book) return [];
      const out: string[] = [];
      for (const main of book.mainCategories(type)) {
        for (const sub of book.subcategories(main.id, type)) out.push(`@${Book.squash(main.name + sub.name)} = ${main.name} / ${sub.name}`);
      }
      return out.slice(0, AiPrompts.#MAX_CATEGORIES);
    };
    const [y, m, d] = today.split('-');
    const what = source === 'voice'
      ? 'The attached audio is a person saying what they spent, received or moved between accounts. It may cover several things.'
      : source === 'receipt'
        ? 'The attached picture or PDF is a receipt, invoice, bill or payment screenshot. For a PDF with several pages, read all of them and use the final amount paid or due.'
        : 'The message below is a person telling a money tracker what they spent, received or moved — or asking a question about their own money.';
    return `You turn what a person says into entries for their money tracker, Pocket. ${what}

Reply with ONLY one JSON object, no markdown:
{"kind": "entries" | "question" | "none", "heard": "short plain summary of what was said or read", "lines": ["..."]}

- "entries": one line per entry in "lines".
- "question": the person is asking about their own spending, budgets or totals (not recording anything). "lines" is [].
- "none": nothing to record and no question (greetings, unclear audio, not a receipt). "lines" is [].

LINE FORMAT (exactly this; words are separated by spaces):
  AMOUNT NOTE [@category] [#account] [date]
- AMOUNT: digits only, no currency sign or commas, e.g. 450 or 1250.50. Put "+" in front for money RECEIVED (income), e.g. +45000 salary.
- Transfer between two of their accounts: AMOUNT #from > #to (no category).
- NOTE: a few words saying what it was (shop or item). Never put a number, "#", "@" or ">" in the note.
- @category: copy one token from CATEGORIES exactly, only if it clearly fits; otherwise leave it out.
- #account: copy one token from ACCOUNTS exactly, only if the person named that account or card; otherwise leave it out (their default account is used).
- date: only if it was not today: "yesterday", or day/month like 8/11. Today is ${Number(d)}/${Number(m)}/${y}. Never a future date.
- Several things in one go: one line each.
- A receipt or bill: ONE LINE PER ITEM, in the order printed. Note = the item's name, then the shop (e.g. "Amul milk dmart"). Each item gets its own best-fitting @category. Use the item's line total (quantity × price). Tax, delivery or service charges paid on top become their own line ("gst dmart"). A discount is taken off the items it applies to (or spread over all items), so the lines add up EXACTLY to the total actually paid. Every line gets the receipt's date. A one-line bill (electricity, phone, a single service) is one line.
- Never invent an amount. If no amount was said or shown, use kind "none".
- At most ${AiPrompts.MAX_LINES} lines.

ACCOUNTS${defaultAccount ? ` (default: ${defaultAccount})` : ''}:
${accounts.join('\n') || '(none)'}

CATEGORIES — spending:
${cats('expense').join('\n') || '(none)'}

CATEGORIES — money received:
${cats('income').join('\n') || '(none)'}
${extra ? `\n${extra}` : ''}`;
  }

  /** Reads the AI's answer to an entries prompt; anything odd becomes kind "none". */
  static readEntries(text: string): AiReading {
    const none: AiReading = { kind: 'none', heard: '', lines: [] };
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return none;
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(m[0]); } catch (_) { return none; }
    const heard = typeof obj.heard === 'string' ? obj.heard.trim().slice(0, 500) : '';
    if (obj.kind === 'question') return { kind: 'question', heard, lines: [] };
    const lines = (Array.isArray(obj.lines) ? obj.lines : [])
      .filter((l): l is string => typeof l === 'string')
      .map((l) => l.replace(/[\r\n]+/g, ' ').trim())
      .filter((l) => /^\+?\d[\d.]*(\s|$)/.test(l))   // an entry starts with its amount; nothing else (no /commands) gets through
      .slice(0, AiPrompts.MAX_LINES);
    return lines.length ? { kind: 'entries', heard, lines } : { kind: 'none', heard, lines: [] };
  }

  /** The prompt for a question, with the person's totals in major units. */
  static question(question: string, data: Insights): string {
    const money = (minor: number) => BudgetAlertRunner.money(minor, data.currency);
    const period = (label: string, p: PeriodTotals) => {
      const lines = p.categories.map((c) =>
        `  ${c.type === 'income' ? 'received' : 'spent'} · ${c.sub ? `${c.main} / ${c.sub}` : c.main}: ${money(c.amount)}`);
      return `${label} (${p.from} to ${p.to}): spent ${money(p.spent)}, received ${money(p.received)}, ${p.entries} entries\n${lines.join('\n') || '  (nothing recorded)'}`;
    };
    const budgets = data.budgets.map((b) => {
      const cur = b.currency || data.currency;
      const f = (n: number | undefined) => BudgetAlertRunner.money(Number(n) || 0, cur);
      const left = (Number(b.limit) || 0) - (Number(b.spent) || 0);
      return `  ${b.name || b.label || 'Budget'} (${b.from ?? '?'} to ${b.to ?? '?'}): limit ${f(b.limit)}, spent ${f(b.spent)}, ${left >= 0 ? `left ${f(left)}` : `over by ${f(-left)}`}`;
    });
    return `You answer a person's question about their own money in Pocket, their money tracker, using ONLY the totals below.

Rules:
- Answer in 1 to 4 short lines of plain text, in the language of the question. No markdown, no tables.
- Use the amounts exactly as given. You may add or subtract them.
- If the totals don't answer it (account balances, a single entry, other dates, other people's books), say you can only see this month's and last month's totals and budgets here, and to open the Pocket app for the rest.
- Budget figures are as of the last time the Pocket app saved, so they may miss entries added since.
- Never give investment, tax or financial advice, and never suggest buying or selling anything.

Today: ${data.today}. Currency: ${data.currency}.

${period('This month so far', data.thisMonth)}

${period('Last month', data.lastMonth)}

Budgets:
${budgets.join('\n') || '  (no budgets)'}

Question: ${question.slice(0, 1000)}`;
  }
}
