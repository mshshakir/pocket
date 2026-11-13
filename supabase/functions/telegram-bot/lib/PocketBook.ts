/**
 * PocketBook — read-only view over an owner's `user_data.data` blob: their
 * preferences, accounts, categories and family permissions. It resolves the
 * hints a message carries (#account, @category) against that data.
 */
export interface Account { id: string; name: string; currency: string; archived?: boolean }
export interface Category { id: string; name: string; type?: string; parentId?: string | null }

type Resolution<T> = { ok: true; value: T } | { ok: false; reason: string };

export class PocketBook {
  static readonly #BASE_PAYMENT_TYPES = ['card', 'cash', 'cheque', 'online'];
  static readonly #WRITE_ACCESS = new Set(['add', 'edit', 'full']);

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

  /** Accounts a family member may add to; everything when `memberEmail` is null (the owner). */
  writableAccounts(memberEmail: string | null): Account[] {
    if (memberEmail === null) return this.accounts;
    const key = memberEmail.toLowerCase().trim();
    const member = (this.#data.family || [])
      .find((m: { email?: string }) => (m.email || '').toLowerCase().trim() === key);
    const allowed = new Set<string>(
      (member?.permissions || [])
        .filter((p: { access: string }) => PocketBook.#WRITE_ACCESS.has(p.access))
        .map((p: { accountId: string }) => p.accountId),
    );
    return this.accounts.filter((a) => allowed.has(a.id));
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

  resolveCategory(hint: string | null, type: string): Resolution<Category | null> {
    if (!hint) return { ok: true, value: null };
    const key = PocketBook.#squash(hint);
    const all: Category[] = (this.#data.categories || [])
      .filter((c: Category) => !c.type || c.type === type);
    const exact = all.filter((c) => PocketBook.#squash(c.name) === key);
    const prefix = all.filter((c) => PocketBook.#squash(c.name).startsWith(key));
    const hits = exact.length ? exact : prefix;
    if (hits.length === 1) return { ok: true, value: hits[0] };
    return { ok: false, reason: hits.length ? `"@${hint}" matches more than one category.` : `No category matches "@${hint}".` };
  }

  static #squash(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '');
  }
}
