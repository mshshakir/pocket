/**
 * PocketBook — read-only view over an owner's `user_data.data` blob: their
 * preferences, accounts, categories and family permissions. It resolves the
 * hints a message carries (#account, @category) against that data.
 */
export interface Account { id: string; name: string; currency: string; archived?: boolean }
export interface Category { id: string; name: string; type?: string; parentId?: string | null }

type Resolution<T> = { ok: true; value: T } | { ok: false; reason: string };

/** A category lookup either finds one, or explains why and offers choices to tap. */
export type CategoryResolution =
  | { ok: true; value: Category }
  | { ok: false; reason: string; options: Category[] };

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

  hasTransaction(id: string): boolean {
    return (this.#data.transactions || []).some((t: { id: string }) => t.id === id);
  }

  /** The account a stored transaction belongs to, if it is in the book. */
  accountOfTransaction(id: string): string | null {
    return (this.#data.transactions || []).find((t: { id: string }) => t.id === id)?.accountId ?? null;
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
      const key = PocketBook.#squash(hint);
      const exact = candidates.filter((a) => PocketBook.#squash(a.name) === key);
      const prefix = candidates.filter((a) => PocketBook.#squash(a.name).startsWith(key));
      const hits = exact.length ? exact : prefix;
      if (hits.length === 1) return { ok: true, value: hits[0] };
      return {
        ok: false,
        reason: hits.length
          ? `"${hint}" matches more than one account:\n${hits.slice(0, 8).map((a) => `• ${a.name}`).join('\n')}\nType a bit more of the name, e.g. #${PocketBook.#squash(hits[0].name)}`
          : `No account matches "${hint}". Send /accounts to see them.`,
      };
    }
    const fallback = candidates.find((a) => a.id === defaultId);
    if (fallback) return { ok: true, value: fallback };
    if (candidates.length === 1) return { ok: true, value: candidates[0] };
    return { ok: false, reason: 'Which account? Add #name to the message, for example: 500 diaper #household' };
  }

  // ── Categories ───────────────────────────────────────────────────────

  categoryById(id: string): Category | null {
    return (this.#data.categories || []).find((c: Category) => c.id === id) ?? null;
  }

  /**
   * Match "@hint" against category names of this type. A name can be given
   * alone ("taxi") or with its parent ("childrentoiletries") to tell
   * same-named categories apart. Ambiguity returns the matches as options.
   */
  resolveCategory(hint: string, type: string): CategoryResolution {
    const key = PocketBook.#squash(hint);
    const all = this.#categoriesOfType(type);
    const keysOf = (c: Category) => [PocketBook.#squash(c.name), PocketBook.#squash(this.#parentName(c) + c.name)];
    const exact = all.filter((c) => keysOf(c).some((k) => k === key));
    const prefix = all.filter((c) => keysOf(c).some((k) => k.startsWith(key)));
    const hits = exact.length ? exact : prefix;
    if (hits.length === 1) return { ok: true, value: hits[0] };
    if (hits.length > 1) {
      return { ok: false, reason: `"${hint}" matches more than one category. Which one?`, options: hits.slice(0, 12) };
    }
    return {
      ok: false,
      reason: `No category matches "${hint}". Pick one, or type a category name:`,
      options: this.topCategories(type),
    };
  }

  /** Most-used categories of a type, for quick buttons. */
  topCategories(type: string, limit = 8): Category[] {
    const uses = new Map<string, number>();
    for (const t of this.#data.transactions || []) {
      if (t.type === type && t.categoryId) uses.set(t.categoryId, (uses.get(t.categoryId) ?? 0) + 1);
    }
    return this.#categoriesOfType(type)
      .filter((c) => uses.has(c.id))
      .sort((a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0))
      .slice(0, limit);
  }

  /** "Taxi", or "Toiletries (Children)" when the name alone is ambiguous. */
  categoryLabel(c: Category): string {
    const twins = this.#categoriesOfType(c.type || '').filter((o) => o.name === c.name);
    const parent = this.#parentName(c);
    return twins.length > 1 && parent ? `${c.name} (${parent})` : c.name;
  }

  #categoriesOfType(type: string): Category[] {
    return (this.#data.categories || []).filter((c: Category) => !c.type || !type || c.type === type);
  }

  #parentName(c: Category): string {
    return c.parentId ? (this.categoryById(c.parentId)?.name ?? '') : '';
  }

  static #squash(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '');
  }
}
