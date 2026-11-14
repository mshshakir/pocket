/**
 * PocketBook — read-only view over an owner's book (as `pocket_bot_book` returns it): their
 * preferences, accounts, categories, how often each category is used, and
 * family permissions — no transactions. It resolves the hints a message
 * carries (#account, @category) against that data.
 */
export interface Account { id: string; name: string; currency: string; archived?: boolean }
export interface Category { id: string; name: string; type?: string; parentId?: string | null }

type Resolution<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * A category lookup: a subcategory (selectable), a main category (open it to
 * pick one of its subcategories), or a set of choices to show as buttons.
 */
export type CategoryResolution =
  | { kind: 'sub'; value: Category }
  | { kind: 'main'; main: Category }
  | { kind: 'choose'; reason: string; options: Category[] };

export class PocketBook {
  static readonly #BASE_PAYMENT_TYPES = ['card', 'cash', 'cheque', 'online'];
  static readonly #WRITE_ACCESS = new Set(['add', 'edit', 'full']);
  static readonly #ACCESS_RANK: Record<string, number> = { view: 0, add: 1, edit: 2, full: 3 };

  // deno-lint-ignore no-explicit-any
  readonly #data: any;

  // deno-lint-ignore no-explicit-any
  constructor(data: any) {
    this.#data = data ?? {};
  }

  get homeCurrency(): string { return this.#data.user?.homeCurrency || 'INR'; }
  get hijriOffset(): number { return Number(this.#data.user?.hijriOffset) || 0; }
  get defaultPaymentType(): string { return this.#data.user?.defaultPaymentType || 'card'; }
  get fxRates(): Record<string, number> { return this.#data.fxRates || {}; }

  get paymentTypes(): string[] {
    const hidden = new Set<string>((this.#data.user?.hiddenPaymentTypes || []).map((p: string) => p.toLowerCase()));
    const custom: string[] = this.#data.user?.customPaymentTypes || [];
    return [...PocketBook.#BASE_PAYMENT_TYPES, ...custom].filter((p) => !hidden.has(p.toLowerCase()));
  }

  get accounts(): Account[] {
    return (this.#data.accounts || []).filter((a: Account) => !a.archived);
  }

  /** Accounts a family member may add to; everything when `memberEmail` is null (the owner). */
  writableAccounts(memberEmail: string | null): Account[] {
    if (memberEmail === null) return this.accounts;
    return this.accounts.filter((a) => PocketBook.#WRITE_ACCESS.has(this.accessFor(memberEmail, a.id)));
  }

  /** A member's access level on one account: view | add | edit | full, or '' for none. */
  accessFor(memberEmail: string, accountId: string): string {
    const key = memberEmail.toLowerCase().trim();
    const member = (this.#data.family || [])
      .find((m: { email?: string }) => (m.email || '').toLowerCase().trim() === key);
    return (member?.permissions || []).find((p: { accountId: string }) => p.accountId === accountId)?.access ?? '';
  }

  /** Whether `access` is at least `needed` (add ≤ edit ≤ full), as the app checks it. */
  static allows(access: string, needed: 'add' | 'edit' | 'full'): boolean {
    return (PocketBook.#ACCESS_RANK[access] ?? -1) >= PocketBook.#ACCESS_RANK[needed];
  }

  resolveAccount(hint: string | null, defaultId: string | null, candidates: Account[]): Resolution<Account> {
    if (!candidates.length) return { ok: false, reason: 'You don\'t have permission to add to any account.' };
    if (hint) {
      const key = PocketBook.squash(hint);
      const exact = candidates.filter((a) => PocketBook.squash(a.name) === key);
      const prefix = candidates.filter((a) => PocketBook.squash(a.name).startsWith(key));
      const hits = exact.length ? exact : prefix;
      if (hits.length === 1) return { ok: true, value: hits[0] };
      return {
        ok: false,
        reason: hits.length
          ? `"${hint}" matches more than one account:\n${hits.slice(0, 8).map((a) => `• ${a.name}`).join('\n')}\nType a bit more of the name, e.g. #${PocketBook.squash(hits[0].name)}`
          : `No account matches "${hint}". Send /accounts to see them.`,
      };
    }
    const fallback = candidates.find((a) => a.id === defaultId);
    if (fallback) return { ok: true, value: fallback };
    if (candidates.length === 1) return { ok: true, value: candidates[0] };
    return { ok: false, reason: 'Which account? Add #name to the message, for example: 500 diaper #household' };
  }

  // ── Categories ───────────────────────────────────────────────────────
  // Two levels: main categories (no parent) group subcategories. Only a
  // subcategory can be saved on an entry; a main one is opened to choose.

  categoryById(id: string): Category | null {
    return (this.#data.categories || []).find((c: Category) => c.id === id) ?? null;
  }

  /** A main category is one without a parent; it can't be saved on an entry. */
  isMain(c: Category): boolean {
    return !c.parentId || !this.categoryById(c.parentId);
  }

  /** Main categories that have subcategories of this type, most-used first. */
  mainCategories(type: string): Category[] {
    const uses = this.#uses(type);
    const score = new Map<string, number>();
    for (const sub of this.#subcategoriesOfType(type)) {
      score.set(sub.parentId!, (score.get(sub.parentId!) ?? 0) + (uses.get(sub.id) ?? 0));
    }
    return [...score.keys()]
      .map((id) => this.categoryById(id)!)
      .sort((a, b) => (score.get(b.id)! - score.get(a.id)!) || a.name.localeCompare(b.name));
  }

  /** Subcategories of one main category for this type, most-used first. */
  subcategories(mainId: string, type: string): Category[] {
    const uses = this.#uses(type);
    return this.#subcategoriesOfType(type)
      .filter((c) => c.parentId === mainId)
      .sort((a, b) => ((uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0)) || a.name.localeCompare(b.name));
  }

  /**
   * Match "@hint" against subcategory names ("taxi", or with the parent:
   * "childrentoiletries") and main category names ("travel" opens Travel).
   */
  resolveCategory(hint: string, type: string): CategoryResolution {
    const key = PocketBook.squash(hint);
    const subs = this.#subcategoriesOfType(type);
    const mains = this.mainCategories(type);
    const keysOf = (c: Category) => this.isMain(c)
      ? [PocketBook.squash(c.name)]
      : [PocketBook.squash(c.name), PocketBook.squash(this.#parentName(c) + c.name)];
    const all = [...subs, ...mains];
    const exact = all.filter((c) => keysOf(c).some((k) => k === key));
    const prefix = all.filter((c) => keysOf(c).some((k) => k.startsWith(key)));
    const hits = exact.length ? exact : prefix;
    if (hits.length === 1) {
      return this.isMain(hits[0]) ? { kind: 'main', main: hits[0] } : { kind: 'sub', value: hits[0] };
    }
    if (hits.length > 1) {
      return { kind: 'choose', reason: `"${hint}" matches more than one category. Which one?`, options: hits.slice(0, 30) };
    }
    return { kind: 'choose', reason: `No category matches "${hint}". Pick one:`, options: mains };
  }

  /** "Travel / Taxi", as the app shows it. */
  categoryPath(c: Category): string {
    const parent = this.#parentName(c);
    return parent ? `${parent} / ${c.name}` : c.name;
  }

  #subcategoriesOfType(type: string): Category[] {
    return (this.#data.categories || [])
      .filter((c: Category) => (!c.type || c.type === type) && !this.isMain(c));
  }

  /** How many entries of this type use each category (counted by the database). */
  #uses(type: string): Map<string, number> {
    const counts: Record<string, number> = this.#data.categoryUses?.[type] ?? {};
    return new Map(Object.entries(counts).map(([id, n]) => [id, Number(n) || 0]));
  }

  #parentName(c: Category): string {
    return c.parentId ? (this.categoryById(c.parentId)?.name ?? '') : '';
  }

  /** Lower-case letters and digits only, so "INR (Mufaddal)" matches "inrm". */
  static squash(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '');
  }
}
