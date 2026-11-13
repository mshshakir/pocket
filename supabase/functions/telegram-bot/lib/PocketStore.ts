/**
 * PocketStore — the bot's data access. Reads the Telegram link table and the
 * owner's book, and provides the two ways an entry reaches Pocket:
 *
 *   OwnerBookWriter            the owner logs their own entry → appended to
 *                              `user_data` with the app's versioned
 *                              compare-and-swap, so a concurrent save by the
 *                              app is never overwritten.
 *   FamilyContributionWriter   a family member logs an entry → dropped into the
 *                              owner's `family_contributions` inbox, where the
 *                              owner's app checks permissions and merges it.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { PocketBook } from './PocketBook.ts';
import type { PocketTransaction } from './TransactionFactory.ts';

export interface TelegramLink {
  chat_id: number;
  owner_id: string;
  member_email: string;
  default_account_id: string | null;
}

export type SaveResult = 'saved' | 'duplicate';

export interface EntryWriter {
  /** Saves all rows of one entry (one row, or a transfer's two legs) together. */
  save(txs: PocketTransaction[]): Promise<SaveResult>;
}

export class PocketStore {
  readonly #sb: SupabaseClient;

  constructor(sb: SupabaseClient) {
    this.#sb = sb;
  }

  async findLink(chatId: number): Promise<TelegramLink | null> {
    const { data, error } = await this.#sb
      .from('telegram_links').select('chat_id, owner_id, member_email, default_account_id')
      .eq('chat_id', chatId).maybeSingle();
    if (error) throw error;
    return data;
  }

  async setDefaultAccount(chatId: number, accountId: string): Promise<void> {
    const { error } = await this.#sb
      .from('telegram_links').update({ default_account_id: accountId }).eq('chat_id', chatId);
    if (error) throw error;
  }

  async loadBook(ownerId: string): Promise<{ book: PocketBook; version: number; data: Record<string, unknown> }> {
    const { data, error } = await this.#sb
      .from('user_data').select('data, version').eq('id', ownerId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('No Pocket data found for this owner yet. Open the app once to sync.');
    return { book: new PocketBook(data.data), version: data.version ?? 0, data: data.data };
  }

  /** Whether `email` is the owner's own sign-in email (owner path vs member path). */
  async isOwnerEmail(ownerId: string, email: string): Promise<boolean> {
    const { data, error } = await this.#sb.auth.admin.getUserById(ownerId);
    if (error) throw error;
    return (data.user?.email || '').toLowerCase().trim() === email.toLowerCase().trim();
  }

  writerFor(link: TelegramLink, isOwner: boolean): EntryWriter {
    return isOwner
      ? new OwnerBookWriter(this, link.owner_id)
      : new FamilyContributionWriter(this.#sb, link.owner_id, link.member_email);
  }

  /** One compare-and-swap attempt; false when another device saved first. */
  async casUpdate(ownerId: string, expectedVersion: number, data: Record<string, unknown>): Promise<boolean> {
    const { data: rows, error } = await this.#sb
      .from('user_data')
      .update({ data, version: expectedVersion + 1, updated_at: new Date().toISOString() })
      .eq('id', ownerId).eq('version', expectedVersion)
      .select('version');
    if (error) throw error;
    return !!rows?.length;
  }
}

export class OwnerBookWriter implements EntryWriter {
  static readonly #MAX_ATTEMPTS = 4;

  readonly #store: PocketStore;
  readonly #ownerId: string;

  constructor(store: PocketStore, ownerId: string) {
    this.#store = store;
    this.#ownerId = ownerId;
  }

  async save(txs: PocketTransaction[]): Promise<SaveResult> {
    for (let attempt = 0; attempt < OwnerBookWriter.#MAX_ATTEMPTS; attempt++) {
      const { book, version, data } = await this.#store.loadBook(this.#ownerId);
      if (book.hasTransaction(txs[0].id)) return 'duplicate';
      const transactions = Array.isArray(data.transactions) ? data.transactions : [];
      const next = { ...data, transactions: [...transactions, ...txs] };
      if (await this.#store.casUpdate(this.#ownerId, version, next)) return 'saved';
    }
    throw new Error('The app was saving at the same moment. Please send it again.');
  }
}

export class FamilyContributionWriter implements EntryWriter {
  readonly #sb: SupabaseClient;
  readonly #ownerId: string;
  readonly #memberEmail: string;

  constructor(sb: SupabaseClient, ownerId: string, memberEmail: string) {
    this.#sb = sb;
    this.#ownerId = ownerId;
    this.#memberEmail = memberEmail.toLowerCase().trim();
  }

  async save(txs: PocketTransaction[]): Promise<SaveResult> {
    const { data: existing, error: lookupError } = await this.#sb
      .from('family_contributions').select('id')
      .eq('owner_id', this.#ownerId).eq('tx_data->>id', txs[0].id).limit(1);
    if (lookupError) throw lookupError;
    if (existing?.length) return 'duplicate';

    // One insert, so a transfer's two legs land together or not at all.
    const { error } = await this.#sb.from('family_contributions').insert(txs.map((tx) => ({
      owner_id: this.#ownerId,
      member_email: this.#memberEmail,
      account_id: tx.accountId,
      tx_data: tx,
      synced: false,
    })));
    if (error) throw error;
    return 'saved';
  }
}
