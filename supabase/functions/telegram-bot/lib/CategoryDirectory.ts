/**
 * CategoryDirectory — the /categories listing: every main expense category
 * with its subcategories, as Telegram HTML pages that each fit in one
 * message. An optional filter narrows it to matching main categories.
 */
import type { PocketBook } from './PocketBook.ts';

export class CategoryDirectory {
  static readonly #PAGE_LIMIT = 3800; // Telegram allows 4096 characters per message
  static readonly #TYPES: Array<{ type: string; title: string }> = [
    { type: 'expense', title: '💸 Expense categories' },
  ];

  readonly #book: PocketBook;

  constructor(book: PocketBook) {
    this.#book = book;
  }

  /** The listing as one or more messages; empty when the filter matches nothing. */
  pages(filter = ''): string[] {
    const key = CategoryDirectory.#squash(filter);
    const lines: string[] = [];
    for (const { type, title } of CategoryDirectory.#TYPES) {
      const mains = this.#book.mainCategories(type)
        .filter((m) => !key || CategoryDirectory.#squash(m.name).startsWith(key))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (!mains.length) continue;
      lines.push(`<b>${title}</b>`);
      for (const main of mains) {
        const subs = this.#book.subcategories(main.id, type)
          .map((s) => s.name)
          .sort((a, b) => a.localeCompare(b));
        lines.push(`<b>${CategoryDirectory.#esc(main.name)}</b>: ${subs.map(CategoryDirectory.#esc).join(', ')}`);
      }
      lines.push('');
    }
    if (!lines.length) return [];
    lines.push('<i>Use any subcategory with @, e.g. @taxi. Write names with spaces joined: @airtimemufaddal</i>');
    return CategoryDirectory.#paginate(lines);
  }

  static #paginate(lines: string[]): string[] {
    const pages: string[] = [];
    let page = '';
    for (const line of lines) {
      if (page && page.length + line.length + 1 > CategoryDirectory.#PAGE_LIMIT) {
        pages.push(page.trimEnd());
        page = '';
      }
      page += line + '\n';
    }
    if (page.trim()) pages.push(page.trimEnd());
    return pages;
  }

  static #esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  static #squash(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '');
  }
}
