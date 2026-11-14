/**
 * Workspace — every book a linked person may write to, and nothing else:
 *
 *   • their own book (they are its owner), and
 *   • books whose owner shares at least one account with their email at
 *     add/edit/full access (per the owner's own `family` permissions).
 *
 * Accounts are resolved across all of them; an entry then goes to the book
 * that holds the chosen account.
 *
 * Plans (PlanAccess) narrow this further: their own book only while their plan
 * includes Telegram, and a shared book only while its owner's Family plan
 * covers them.
 */
import { type Account, PocketBook } from './PocketBook.ts';
import { PlanAccess } from './PlanAccess.ts';
import type { PocketStore, TelegramLink } from './PocketStore.ts';

type Resolution<T> = { ok: true; value: T } | { ok: false; reason: string };

/** One book the person can write to. */
export interface BookAccess {
  ownerId: string;
  isOwn: boolean;
  label: string;      // "you", or who shared it
  book: PocketBook;
  accounts: Account[]; // only accounts they may add to
}

/** An account, together with the book it lives in. */
export interface AccountChoice {
  access: BookAccess;
  account: Account;
}

export class Workspace {
  readonly #accesses: BookAccess[];

  private constructor(accesses: BookAccess[]) {
    this.#accesses = accesses;
  }

  /** The person's own book and every book shared with them, loaded in parallel. */
  static async load(store: PocketStore, link: TelegramLink): Promise<Workspace> {
    const [plan, shares] = await Promise.all([PlanAccess.load(store, link.user_id), store.sharesFor(link.email)]);
    const own = plan.ownBook ? await store.tryLoadBook(link.user_id) : null;
    const accesses: BookAccess[] = [];
    if (own) {
      accesses.push({ ownerId: link.user_id, isOwn: true, label: 'you', book: own, accounts: own.accounts });
    }
    const others = shares.filter((share) => share.ownerId !== link.user_id && plan.sharedBook(share.ownerId));
    const books = await Promise.all(others.map((share) => store.tryLoadBook(share.ownerId)));
    others.forEach((share, i) => {
      const book = books[i];
      const accounts = book?.writableAccounts(link.email) ?? [];
      if (book && accounts.length) {
        accesses.push({ ownerId: share.ownerId, isOwn: false, label: share.ownerName, book, accounts });
      }
    });
    return new Workspace(accesses);
  }

  get accesses(): BookAccess[] { return this.#accesses; }

  /** The book for an owner id, only if this person may write to it. */
  access(ownerId: string): BookAccess | null {
    return this.#accesses.find((a) => a.ownerId === ownerId) ?? null;
  }

  /** Payment types known in any of the person's books. */
  get paymentTypes(): string[] {
    return [...new Set(this.#accesses.flatMap((a) => a.book.paymentTypes))];
  }

  choices(within?: BookAccess): AccountChoice[] {
    const scope = within ? [within] : this.#accesses;
    return scope.flatMap((access) => access.accounts.map((account) => ({ access, account })));
  }

  /** "BOI (Mufaddal)", or "GK - INR · shared by mshshakir@gmail.com". */
  label(c: AccountChoice): string {
    return c.access.isOwn ? c.account.name : `${c.account.name} · shared by ${c.access.label}`;
  }

  resolve(
    hint: string | null,
    fallback: { ownerId: string | null; accountId: string | null } | null,
    within?: BookAccess,
  ): Resolution<AccountChoice> {
    const candidates = this.choices(within);
    if (!candidates.length) {
      return { ok: false, reason: within ? 'There is no other account in that book to use.' : 'You don\'t have any account you can add to.' };
    }
    if (hint) {
      const key = PocketBook.squash(hint);
      const exact = candidates.filter((c) => PocketBook.squash(c.account.name) === key);
      const prefix = candidates.filter((c) => PocketBook.squash(c.account.name).startsWith(key));
      const hits = exact.length ? exact : prefix;
      if (hits.length === 1) return { ok: true, value: hits[0] };
      if (!hits.length && within && this.resolve(hint, null).ok) {
        return { ok: false, reason: 'A transfer has to stay within one book: both accounts must be yours, or both in the same shared space.' };
      }
      return {
        ok: false,
        reason: hits.length
          ? `"${hint}" matches more than one account:\n${hits.slice(0, 8).map((c) => `• ${this.label(c)}`).join('\n')}\nType a bit more of the name, e.g. #${PocketBook.squash(hits[0].account.name)}`
          : `No account matches "${hint}". Send /accounts to see them.`,
      };
    }
    const preferred = candidates.find((c) => c.access.ownerId === fallback?.ownerId && c.account.id === fallback?.accountId);
    if (preferred) return { ok: true, value: preferred };
    if (candidates.length === 1) return { ok: true, value: candidates[0] };
    return { ok: false, reason: 'Which account? Add #name to the message (e.g. 500 diaper #boi), or set a default with /default.' };
  }
}
