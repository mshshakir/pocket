/**
 * PocketStore — the bot's data access: Telegram links and link requests,
 * books and who shares with whom, each chat's pending step (a category to
 * pick, an entry to correct), and the two ways an entry reaches a book:
 *
 *   OwnerBookWriter            the owner logs their own entry → written to
 *                              `user_data` with the app's versioned
 *                              compare-and-swap, so a concurrent save by the
 *                              app is never overwritten.
 *   FamilyContributionWriter   a family member logs an entry → sent through the
 *                              owner's `family_contributions` inbox, where the
 *                              owner's app checks permissions and merges it.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { PocketBook } from './PocketBook.ts';
import type { PocketTransaction } from './TransactionFactory.ts';

/** A Telegram chat verified as one Pocket user (by an emailed sign-in code). */
export interface TelegramLink {
  chat_id: number;
  user_id: string;                 // the Pocket user this chat belongs to
  email: string;                   // their sign-in email, lower-case
  default_owner_id: string | null; // book of the default account
  default_account_id: string | null;
}

/** A /link in progress: the code was emailed, the chat hasn't sent it yet. */
export interface LinkRequest {
  chat_id: number;
  email: string;
  attempts: number;
  created_at: string;
}

/** Someone who shares a space with an email. */
export interface Share {
  ownerId: string;
  ownerName: string;
}

/** What the bot is waiting for in a chat. */
export interface PendingStep {
  kind: 'category' | 'edit';
  seed_message_id: number;          // the message whose entry this is (ids derive from it)
  source_text: string | null;       // category step: the entry text awaiting a category
  replace: boolean;                 // true when this corrects an existing entry
  prompt_message_id: number | null; // category step: the picker message
  confirm_message_id: number | null; // edit: the old confirmation to mark as edited
  owner_id: string | null;          // edit: the book the entry being corrected is in
}

export type SaveResult = 'saved' | 'duplicate';

export interface EntryWriter {
  /** Saves all rows of one entry (one row, or a transfer's two legs) together. */
  add(txs: PocketTransaction[]): Promise<SaveResult>;
  /** Swaps an entry's rows (any of `oldIds` that exist) for `txs`. */
  replace(oldIds: string[], txs: PocketTransaction[]): Promise<void>;
  /** Removes an entry's rows; returns how many were found. */
  remove(ids: string[]): Promise<number>;
}

export class PocketStore {
  static readonly #PENDING_TTL_MS = 30 * 60 * 1000;

  readonly #sb: SupabaseClient;

  constructor(sb: SupabaseClient) {
    this.#sb = sb;
  }

  // ── Links ────────────────────────────────────────────────────────────

  async findLink(chatId: number): Promise<TelegramLink | null> {
    const { data, error } = await this.#sb
      .from('telegram_links').select('chat_id, user_id, email, default_owner_id, default_account_id')
      .eq('chat_id', chatId).maybeSingle();
    if (error) throw error;
    return data;
  }

  /** Ties a chat to a verified user, replacing any earlier link of that chat. */
  async saveLink(chatId: number, userId: string, email: string): Promise<void> {
    await this.clearPending(chatId);
    const { error } = await this.#sb.from('telegram_links').upsert({
      chat_id: chatId, user_id: userId, email: email.toLowerCase().trim(),
      default_owner_id: userId, default_account_id: null,
    });
    if (error) throw error;
  }

  async removeLink(chatId: number): Promise<boolean> {
    const { data, error } = await this.#sb.from('telegram_links').delete().eq('chat_id', chatId).select('chat_id');
    if (error) throw error;
    return !!data?.length;
  }

  async setDefaultAccount(chatId: number, ownerId: string, accountId: string): Promise<void> {
    const { error } = await this.#sb.from('telegram_links')
      .update({ default_owner_id: ownerId, default_account_id: accountId }).eq('chat_id', chatId);
    if (error) throw error;
  }

  // ── Link requests ────────────────────────────────────────────────────

  async getLinkRequest(chatId: number): Promise<LinkRequest | null> {
    const { data, error } = await this.#sb
      .from('telegram_link_requests').select('*').eq('chat_id', chatId).maybeSingle();
    if (error) throw error;
    return data;
  }

  async saveLinkRequest(chatId: number, email: string): Promise<void> {
    const { error } = await this.#sb.from('telegram_link_requests').upsert({
      chat_id: chatId, email, attempts: 0, created_at: new Date().toISOString(),
    });
    if (error) throw error;
  }

  async countLinkAttempt(chatId: number, attempts: number): Promise<void> {
    const { error } = await this.#sb.from('telegram_link_requests').update({ attempts }).eq('chat_id', chatId);
    if (error) throw error;
  }

  async deleteLinkRequest(chatId: number): Promise<void> {
    const { error } = await this.#sb.from('telegram_link_requests').delete().eq('chat_id', chatId);
    if (error) throw error;
  }

  // ── Pending steps ────────────────────────────────────────────────────

  async getPending(chatId: number): Promise<PendingStep | null> {
    const { data, error } = await this.#sb
      .from('telegram_pending').select('*').eq('chat_id', chatId).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    if (Date.now() - Date.parse(data.created_at) > PocketStore.#PENDING_TTL_MS) {
      await this.clearPending(chatId);
      return null;
    }
    return data;
  }

  async setPending(chatId: number, step: PendingStep): Promise<void> {
    const { error } = await this.#sb.from('telegram_pending')
      .upsert({ chat_id: chatId, ...step, created_at: new Date().toISOString() });
    if (error) throw error;
  }

  async clearPending(chatId: number): Promise<void> {
    const { error } = await this.#sb.from('telegram_pending').delete().eq('chat_id', chatId);
    if (error) throw error;
  }

  // ── Books ────────────────────────────────────────────────────────────

  async loadBook(ownerId: string): Promise<{ book: PocketBook; version: number; data: Record<string, unknown> }> {
    const { data, error } = await this.#sb
      .from('user_data').select('data, version').eq('id', ownerId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('No Pocket data found for this owner yet. Open the app once to sync.');
    return { book: new PocketBook(data.data), version: data.version ?? 0, data: data.data };
  }

  /** A user's book, or null if they have none yet. */
  async tryLoadBook(ownerId: string): Promise<PocketBook | null> {
    const { data, error } = await this.#sb.from('user_data').select('data').eq('id', ownerId).maybeSingle();
    if (error) throw error;
    return data ? new PocketBook(data.data) : null;
  }

  /** Owners who share a space with this email (their app keeps family_shares current). */
  async sharesFor(email: string): Promise<Share[]> {
    const { data, error } = await this.#sb.from('family_shares')
      .select('owner_id, snapshot->>ownerName, snapshot->>sharedBy')
      .eq('member_email', email.toLowerCase().trim());
    if (error) throw error;
    const byOwner = new Map<string, Share>();
    for (const row of (data ?? []) as Array<{ owner_id: string; ownerName: string | null; sharedBy: string | null }>) {
      if (!byOwner.has(row.owner_id)) {
        byOwner.set(row.owner_id, { ownerId: row.owner_id, ownerName: row.ownerName || row.sharedBy || 'a family member' });
      }
    }
    return [...byOwner.values()];
  }

  /** Writes to a book: directly when it is the person's own, else via the owner's inbox. */
  writerFor(ownerId: string, email: string, isOwn: boolean): EntryWriter {
    return isOwn
      ? new OwnerBookWriter(this, ownerId)
      : new FamilyContributionWriter(this.#sb, this, ownerId, email);
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

type TxRow = { id: string };

export class OwnerBookWriter implements EntryWriter {
  static readonly #MAX_ATTEMPTS = 4;

  readonly #store: PocketStore;
  readonly #ownerId: string;

  constructor(store: PocketStore, ownerId: string) {
    this.#store = store;
    this.#ownerId = ownerId;
  }

  async add(txs: PocketTransaction[]): Promise<SaveResult> {
    let duplicate = false;
    await this.#mutate((rows) => {
      duplicate = rows.some((t) => t.id === txs[0].id);
      return duplicate ? null : [...rows, ...txs];
    });
    return duplicate ? 'duplicate' : 'saved';
  }

  async replace(oldIds: string[], txs: PocketTransaction[]): Promise<void> {
    const drop = new Set(oldIds);
    await this.#mutate((rows) => [...rows.filter((t) => !drop.has(t.id)), ...txs]);
  }

  async remove(ids: string[]): Promise<number> {
    const drop = new Set(ids);
    let removed = 0;
    await this.#mutate((rows) => {
      const kept = rows.filter((t) => !drop.has(t.id));
      removed = rows.length - kept.length;
      return removed ? kept : null;
    });
    return removed;
  }

  /** Applies `change` to the transaction list under compare-and-swap; null means "nothing to write". */
  async #mutate(change: (rows: TxRow[]) => TxRow[] | null): Promise<void> {
    for (let attempt = 0; attempt < OwnerBookWriter.#MAX_ATTEMPTS; attempt++) {
      const { version, data } = await this.#store.loadBook(this.#ownerId);
      const rows = (Array.isArray(data.transactions) ? data.transactions : []) as TxRow[];
      const next = change(rows);
      if (next === null) return;
      if (await this.#store.casUpdate(this.#ownerId, version, { ...data, transactions: next })) return;
    }
    throw new Error('The app was saving at the same moment. Please try again.');
  }
}

export class FamilyContributionWriter implements EntryWriter {
  readonly #sb: SupabaseClient;
  readonly #store: PocketStore;
  readonly #ownerId: string;
  readonly #memberEmail: string;

  constructor(sb: SupabaseClient, store: PocketStore, ownerId: string, memberEmail: string) {
    this.#sb = sb;
    this.#store = store;
    this.#ownerId = ownerId;
    this.#memberEmail = memberEmail.toLowerCase().trim();
  }

  async add(txs: PocketTransaction[]): Promise<SaveResult> {
    const { data: existing, error } = await this.#sb
      .from('family_contributions').select('id')
      .eq('owner_id', this.#ownerId).eq('tx_data->>id', txs[0].id).limit(1);
    if (error) throw error;
    if (existing?.length) return 'duplicate';
    await this.#insert(txs);
    return 'saved';
  }

  async replace(oldIds: string[], txs: PocketTransaction[]): Promise<void> {
    const markers = await this.#retract(oldIds, new Set(txs.map((t) => t.id)));
    // One insert: the owner's app applies the markers before the new rows (audit H6).
    await this.#insert([...markers, ...txs]);
  }

  async remove(ids: string[]): Promise<number> {
    const { book } = await this.#store.loadBook(this.#ownerId);
    const unsynced = await this.#dropUnsynced(ids);
    const markers = await this.#retract(ids, new Set(), book);
    if (markers.length) await this.#insert(markers);
    return unsynced + markers.length;
  }

  /**
   * Takes back rows: ones the owner's app hasn't merged yet are simply deleted
   * from the inbox; merged ones get the same delete markers the app sends.
   * Changing a merged row needs edit access, deleting one needs full access.
   */
  async #retract(ids: string[], reAdded: Set<string>, loaded?: PocketBook): Promise<Record<string, unknown>[]> {
    const book = loaded ?? (await this.#store.loadBook(this.#ownerId)).book;
    if (!loaded) await this.#dropUnsynced(ids);
    const markers: Record<string, unknown>[] = [];
    for (const id of ids) {
      const accountId = book.accountOfTransaction(id);
      if (!accountId) continue;
      const replacing = reAdded.has(id);
      const needed = replacing ? 'edit' : 'full';
      if (!PocketBook.allows(book.accessFor(this.#memberEmail, accountId), needed)) {
        throw new Error(`This entry is already in the owner's book, and changing it needs ${needed} access. Ask the owner to ${replacing ? 'edit' : 'delete'} it.`);
      }
      markers.push(replacing
        ? { _delete: true, _replace: true, id: `rep_${id}_${Date.now()}`, targetId: id, accountId }
        : { _delete: true, id: `del_${id}_${Date.now()}`, targetId: id, accountId });
    }
    return markers;
  }

  /** Deletes this member's not-yet-merged inbox rows for these ids; returns how many. */
  async #dropUnsynced(ids: string[]): Promise<number> {
    const { data, error } = await this.#sb.from('family_contributions')
      .delete()
      .eq('owner_id', this.#ownerId).eq('member_email', this.#memberEmail).eq('synced', false)
      .in('tx_data->>id', ids)
      .select('id');
    if (error) throw error;
    return data?.length ?? 0;
  }

  async #insert(rows: Record<string, unknown>[]): Promise<void> {
    const { error } = await this.#sb.from('family_contributions').insert(rows.map((tx) => ({
      owner_id: this.#ownerId,
      member_email: this.#memberEmail,
      account_id: (tx as { accountId?: string }).accountId,
      tx_data: tx,
      synced: false,
    })));
    if (error) throw error;
  }
}
