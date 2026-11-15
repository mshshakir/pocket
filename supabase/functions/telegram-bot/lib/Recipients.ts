/**
 * Recipients — where a check-in or bill reminder goes, as chosen on the item
 * (or bill) in the app:
 *   all    everyone with access: the owner and family members who can add to
 *          the account, each in their private chat with the bot
 *   one    one person (by email), in their private chat
 *   group  the Telegram family group(s) tied to a space holding the account
 *   off    nobody
 * People without a linked Telegram are simply left out.
 */
import type { DeliveryStore, NotifyGroup, NotifyPerson } from './DeliveryStore.ts';

export interface Target {
  chatId: number;
  threadId: number | null;
}

export class Recipients {
  readonly #store: DeliveryStore;

  constructor(store: DeliveryStore) {
    this.#store = store;
  }

  async for(ownerId: string, accountIds: (string | null)[], to: string | undefined, email: string | null | undefined): Promise<Target[]> {
    const choice = to ?? 'all';
    if (choice === 'off') return [];
    const out = new Map<number, Target>();
    for (const accountId of [...new Set(accountIds)]) {
      if (choice === 'group') {
        for (const g of await this.#store.groups(ownerId, accountId)) out.set(g.chatId, { chatId: g.chatId, threadId: g.threadId ?? null });
        continue;
      }
      const people = await this.#store.people(ownerId, accountId);
      const chosen = choice === 'one' ? people.filter((p) => p.email === String(email || '').toLowerCase()) : people;
      for (const p of chosen) for (const chat of p.chats) out.set(chat, { chatId: chat, threadId: null });
    }
    return [...out.values()];
  }

  /** The display name of whoever answered (from the owner's people list), or a fallback. */
  static nameOf(people: NotifyPerson[], email: string): string {
    return people.find((p) => p.email === email.toLowerCase())?.name || email.split('@')[0];
  }
}

export type { NotifyGroup };
