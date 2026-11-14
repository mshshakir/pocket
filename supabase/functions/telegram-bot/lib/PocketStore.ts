/**
 * PocketStore — the bot's data access: Telegram links and link requests,
 * books and who shares with whom, each chat's pending step (a category to
 * pick, an entry to correct), and writing entries into a book.
 *
 * Books are stored as rows (supabase/migrations 0009–0012). An entry is saved
 * with `pocket_apply_changes`, the same function the web app uses, touching
 * only that entry's rows — so nothing the app saved meanwhile is overwritten.
 * The bot runs with the service key, which skips the database's row rules, so
 * BookWriter applies the same sharing rules itself before writing:
 *   add a new entry      add access (or better) on its account
 *   change an entry      edit access — or add access when you entered it
 *   delete an entry      full access — or add access when you entered it
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

/** A line of a several-line message, waiting its turn for a category. */
export interface QueuedEntry {
  seed: number;
  line: string;        // as typed
  text: string;        // with the message's shared choices added
  shared: boolean;     // its category comes from the message's shared line
  categoryId?: string; // set once the shared category has been picked
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
  queue: QueuedEntry[];             // category step: lines of the same message still to ask about
  shared: boolean;                  // category step: this line's category is the message's shared one
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

  // ── Links ────────────────────────────────────────────────────────────────

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

  // ── Link requests ────────────────────────────────────────────────────────

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

  // ── Pending steps ────────────────────────────────────────────────────────

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

  // ── Books ────────────────────────────────────────────────────────────────

  /** A book in the app's shape. Throws if the owner has none yet. */
  async loadBook(ownerId: string): Promise<PocketBook> {
    const book = await this.tryLoadBook(ownerId);
    if (!book) throw new Error('No Pocket data found for this owner yet. Open the app once to sync.');
    return book;
  }

  /**
   * A user's book, or null if they have none yet: what the bot reads of it
   * (settings, accounts, categories and their use counts, family permissions),
   * never the transactions themselves — see migration 0013.
   */
  /** What this person's plan allows (pocket_entitlements_for, migration 0018). */
  async entitlements(userId: string): Promise<unknown> {
    const { data, error } = await this.#sb.rpc('pocket_entitlements_for', { p_user: userId });
    if (error) throw error;
    return data;
  }

  async tryLoadBook(ownerId: string): Promise<PocketBook | null> {
    const { data, error } = await this.#sb.rpc('pocket_bot_book', { owner: ownerId });
    if (error) throw error;
    return data ? new PocketBook(data) : null;
  }

  /** Owners whose family list includes this email (each may share accounts with them). */
  async sharesFor(email: string): Promise<Share[]> {
    const { data, error } = await this.#sb.from('family_members')
      .select('owner_id, space_name')
      .ilike('email', PocketStore.likeExact(email.toLowerCase().trim()))
      .is('deleted_at', null);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ owner_id: string; space_name: string | null }>;
    const owners = [...new Set(rows.map((r) => r.owner_id))];
    if (!owners.length) return [];

    const { data: settings, error: e2 } = await this.#sb.from('book_settings')
      .select('owner_id, extra->>name').in('owner_id', owners);
    if (e2) throw e2;
    const names = new Map(((settings ?? []) as Array<{ owner_id: string; name: string | null }>)
      .map((r) => [r.owner_id, r.name]));
    return owners.map((ownerId) => ({
      ownerId,
      ownerName: names.get(ownerId) || rows.find((r) => r.owner_id === ownerId)?.space_name || 'a family member',
    }));
  }

  /** Writes entries into a book as this person, under the sharing rules. */
  writerFor(ownerId: string, email: string, isOwn: boolean): EntryWriter {
    return new BookWriter(this.#sb, ownerId, email, isOwn);
  }

  /** `ilike` pattern matching `s` exactly (emails can contain `_`). */
  static likeExact(s: string): string {
    return s.replace(/[\\%_]/g, (c) => `\\${c}`);
  }
}

/** A stored transaction, as far as the sharing rules need it. */
interface StoredTx {
  id: string;
  account_id: string;
  added_by: string | null;
  deleted_at: string | null;
}

export class BookWriter implements EntryWriter {
  static readonly #LEVELS = ['view', 'add', 'edit', 'full'];

  readonly #sb: SupabaseClient;
  readonly #ownerId: string;
  readonly #email: string;
  readonly #isOwn: boolean;
  #grants: Map<string, string> | null = null;

  constructor(sb: SupabaseClient, ownerId: string, email: string, isOwn: boolean) {
    this.#sb = sb;
    this.#ownerId = ownerId;
    this.#email = email.toLowerCase().trim();
    this.#isOwn = isOwn;
  }

  async add(txs: PocketTransaction[]): Promise<SaveResult> {
    // Telegram can deliver a message twice: an id already used (even by an
    // entry since deleted) means this one was handled before.
    if ((await this.#stored([txs[0].id])).length) return 'duplicate';
    await this.#mayAdd(txs);
    await this.#apply({ put: { transactions: txs } });
    return 'saved';
  }

  async replace(oldIds: string[], txs: PocketTransaction[]): Promise<void> {
    const live = (await this.#stored(oldIds)).filter((t) => !t.deleted_at);
    for (const t of live) await this.#mayChange(t, 'edit');
    await this.#mayAdd(txs);
    const keep = new Set(txs.map((t) => t.id));
    const gone = live.map((t) => t.id).filter((id) => !keep.has(id));
    await this.#apply({ put: { transactions: txs }, ...(gone.length ? { remove: { transactions: gone } } : {}) });
  }

  async remove(ids: string[]): Promise<number> {
    const live = (await this.#stored(ids)).filter((t) => !t.deleted_at);
    if (!live.length) return 0;
    for (const t of live) await this.#mayChange(t, 'full');
    await this.#apply({ remove: { transactions: live.map((t) => t.id) } });
    return live.length;
  }

  // ── sharing rules (skipped for the owner) ────────────────────────────────────────

  async #mayAdd(txs: PocketTransaction[]): Promise<void> {
    if (this.#isOwn) return;
    for (const tx of txs) {
      if (!PocketBook.allows(await this.#access(tx.accountId), 'add')) {
        throw new Error('You don\'t have permission to add to that account.');
      }
    }
  }

  async #mayChange(tx: StoredTx, needed: 'edit' | 'full'): Promise<void> {
    if (this.#isOwn) return;
    const access = await this.#access(tx.account_id);
    const mine = (tx.added_by || '').toLowerCase().trim() === this.#email;
    if (PocketBook.allows(access, needed) || (mine && PocketBook.allows(access, 'add'))) return;
    const verb = needed === 'edit' ? 'edit' : 'delete';
    throw new Error(`Changing this entry needs ${needed} access. Ask the owner to ${verb} it.`);
  }

  /** This person's access to one of the owner's accounts ('' for none). */
  async #access(accountId: string): Promise<string> {
    if (!this.#grants) {
      const { data: members, error } = await this.#sb.from('family_members').select('id')
        .eq('owner_id', this.#ownerId).ilike('email', PocketStore.likeExact(this.#email))
        .is('deleted_at', null);
      if (error) throw error;
      const ids = (members ?? []).map((m: { id: string }) => m.id);
      this.#grants = new Map();
      if (ids.length) {
        const { data, error: e2 } = await this.#sb.from('member_account_permissions')
          .select('account_id, access').eq('owner_id', this.#ownerId).in('member_id', ids);
        if (e2) throw e2;
        for (const p of (data ?? []) as Array<{ account_id: string; access: string }>) {
          // Two family entries with one email: the stronger grant counts.
          const had = this.#grants.get(p.account_id);
          if (!had || BookWriter.#LEVELS.indexOf(p.access) > BookWriter.#LEVELS.indexOf(had)) {
            this.#grants.set(p.account_id, p.access);
          }
        }
      }
    }
    return this.#grants.get(accountId) ?? '';
  }

  // ── storage ────────────────────────────────────────────────────────────────────

  async #stored(ids: string[]): Promise<StoredTx[]> {
    if (!ids.length) return [];
    const { data, error } = await this.#sb.from('transactions')
      .select('id, account_id, added_by, deleted_at')
      .eq('owner_id', this.#ownerId).in('id', ids);
    if (error) throw error;
    return (data ?? []) as StoredTx[];
  }

  async #apply(changes: Record<string, unknown>): Promise<void> {
    const { error } = await this.#sb.rpc('pocket_apply_changes', { book: this.#ownerId, changes });
    if (error) throw new Error(error.message);
  }
}
