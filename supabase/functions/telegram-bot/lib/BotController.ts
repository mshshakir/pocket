/**
 * BotController — routes one Telegram update. Unlinked chats can only /link
 * (and answer with the emailed code). Linked chats get the commands (/help,
 * /accounts, /categories, /default, /cancel, /unlink), entry messages,
 * answers to a pending step, and button taps. A message with several lines
 * records one entry per line (BatchEntryService).
 */
import type { BatchEntryService } from './BatchEntryService.ts';
import { CategoryDirectory } from './CategoryDirectory.ts';
import { EntryBatch } from './EntryBatch.ts';
import { EntryParser } from './EntryParser.ts';
import { EntryService } from './EntryService.ts';
import { HelpMenu } from './HelpMenu.ts';
import { LinkService } from './LinkService.ts';
import type { PocketStore, TelegramLink } from './PocketStore.ts';
import type { TelegramClient } from './TelegramClient.ts';
import { Workspace } from './Workspace.ts';

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type?: string };
  text?: string;
}

export interface TelegramCallback {
  id: string;
  data?: string;
  message?: TelegramMessage;
}

export class BotController {
  readonly #store: PocketStore;
  readonly #telegram: TelegramClient;
  readonly #entries: EntryService;
  readonly #links: LinkService;
  readonly #batches: BatchEntryService;

  constructor(
    store: PocketStore, telegram: TelegramClient, entries: EntryService,
    links: LinkService, batches: BatchEntryService,
  ) {
    this.#store = store;
    this.#telegram = telegram;
    this.#entries = entries;
    this.#links = links;
    this.#batches = batches;
  }

  async handleMessage(message: TelegramMessage): Promise<void> {
    const chatId = message.chat.id;
    const text = (message.text || '').trim();
    if (!text) return;
    if (message.chat.type && message.chat.type !== 'private') {
      return void await this.#telegram.reply(chatId, 'Please message me directly, not in a group.');
    }

    try {
      const command = text.split(/[\s@]/)[0].toLowerCase();
      const argument = text.split(/\s+/).slice(1).join(' ');

      // Linking works for any chat: a code answers a pending /link, /link starts one.
      if (LinkService.isCode(text)) {
        const request = await this.#store.getLinkRequest(chatId);
        if (request) return void await this.#links.verify(chatId, request, text);
      }
      if (command === '/link') return void await this.#links.start(chatId, argument);

      const link = await this.#store.findLink(chatId);
      if (!link) {
        return void await this.#telegram.reply(chatId,
          'Welcome to Pocket! To connect this chat to your Pocket account, send /link followed by the email you sign in with, e.g.\n/link name@gmail.com');
      }
      if (command.startsWith('/')) return void await this.#command(command, argument, link, chatId, message.message_id);

      const pending = await this.#store.getPending(chatId);
      if (pending?.kind === 'edit') {
        return void await this.#entries.record({
          link, chatId, seed: pending.seed_message_id, text, replace: true, oldOwnerId: pending.owner_id,
          replyTo: message.message_id, confirmMessageId: pending.confirm_message_id,
        });
      }
      if (pending?.kind === 'category' && pending.source_text) {
        // A message with an amount is a new entry; anything else names the category.
        if (!new EntryParser([]).parse(text).ok) {
          return void await this.#entries.record({
            link, chatId, seed: pending.seed_message_id, text: pending.source_text,
            replace: pending.replace, oldOwnerId: pending.owner_id,
            replyTo: message.message_id, categoryName: text,
            promptMessageId: pending.prompt_message_id, confirmMessageId: pending.confirm_message_id,
            queue: pending.queue ?? [], shared: pending.shared ?? false,
          });
        }
        await this.#dropPending(chatId);
      }
      if (EntryBatch.isBatch(text)) return void await this.#batches.record(link, chatId, message.message_id, text);
      await this.#entries.record({ link, chatId, seed: message.message_id, text, replace: false, replyTo: message.message_id });
    } catch (err) {
      console.error('[telegram-bot]', err);
      await this.#telegram.reply(chatId, `⚠️ Not saved: ${BotController.#reason(err)}`, message.message_id);
    }
  }

  async handleCallback(cb: TelegramCallback): Promise<void> {
    const msg = cb.message;
    if (!msg) return void await this.#telegram.answer(cb.id);
    const chatId = msg.chat.id;
    const link = await this.#store.findLink(chatId);
    if (!link) return void await this.#telegram.answer(cb.id, 'This chat is not connected. Send /link.');

    // edit/del carry the book's owner id; buttons from before shared books meant your own book.
    const [action, value, ownerId = link.user_id] = (cb.data || '').split(':');
    try {
      if (action === 'cat' || action === 'main' || action === 'back') {
        // cat: a subcategory (saves) · main: open its subcategories · back: all main categories
        const pending = await this.#store.getPending(chatId);
        if (pending?.kind !== 'category' || pending.prompt_message_id !== msg.message_id || !pending.source_text) {
          return void await this.#telegram.answer(cb.id, 'This choice has expired. Send the entry again.');
        }
        await this.#telegram.answer(cb.id);
        await this.#entries.record({
          link, chatId, seed: pending.seed_message_id, text: pending.source_text,
          replace: pending.replace, oldOwnerId: pending.owner_id,
          categoryId: action === 'back' ? undefined : value, browseMains: action === 'back',
          promptMessageId: msg.message_id, confirmMessageId: pending.confirm_message_id,
          queue: pending.queue ?? [], shared: pending.shared ?? false,
        });
      } else if (action === 'edit') {
        await this.#telegram.answer(cb.id);
        await this.#entries.startEdit(link, chatId, Number(value), ownerId, msg.message_id);
      } else if (action === 'del') {
        const done = await this.#entries.remove(link, chatId, Number(value), ownerId, msg.message_id, msg.text || '');
        await this.#telegram.answer(cb.id, done ? 'Deleted' : 'Already removed');
      } else {
        await this.#telegram.answer(cb.id);
      }
    } catch (err) {
      console.error('[telegram-bot] callback', err);
      await this.#telegram.answer(cb.id, '⚠️ Not done');
      await this.#telegram.send(chatId, `⚠️ ${BotController.#reason(err)}`, { replyTo: msg.message_id });
    }
  }

  async #command(command: string, argument: string, link: TelegramLink, chatId: number, messageId: number): Promise<void> {
    if (command === '/start' || command === '/help') return void await this.#help(chatId);
    if (command === '/unlink') return void await this.#links.unlink(chatId);
    if (command === '/cancel') {
      const had = await this.#dropPending(chatId);
      return void await this.#telegram.reply(chatId, had ? 'Cancelled. Nothing was changed.' : 'Nothing to cancel.', messageId);
    }

    const ws = await Workspace.load(this.#store, link);
    const fallback = { ownerId: link.default_owner_id, accountId: link.default_account_id };
    const isDefault = (ownerId: string, accountId: string) =>
      ownerId === link.default_owner_id && accountId === link.default_account_id;

    if (command === '/accounts') {
      const sections = ws.accesses.map((a) => {
        const title = a.isOwn ? `Your accounts (${link.email})` : `Shared by ${a.label}`;
        const rows = a.accounts.map((acc) => `• ${acc.name}${isDefault(a.ownerId, acc.id) ? ' (default)' : ''}`);
        return [title, ...rows].join('\n');
      });
      return void await this.#telegram.reply(chatId, sections.length ? sections.join('\n\n') : 'No accounts you can add to yet.');
    }
    if (command === '/categories') {
      const current = ws.resolve(null, fallback);
      const book = current.ok ? current.value.access.book : ws.accesses[0]?.book;
      const pages = book ? new CategoryDirectory(book).pages(argument) : [];
      if (!pages.length) {
        return void await this.#telegram.reply(chatId, `No main category matches "${argument}". Send /categories to see them all.`, messageId);
      }
      for (const page of pages) await this.#telegram.send(chatId, page, { html: true });
      return;
    }
    if (command === '/default') {
      const hint = argument.replace(/^#/, '').trim();
      if (!hint) {
        const current = ws.resolve(null, fallback);
        return void await this.#telegram.reply(chatId,
          `Default account: ${current.ok ? ws.label(current.value) : 'none'}\nChange it with /default <account name>, e.g. /default boi`);
      }
      const chosen = ws.resolve(hint, null);
      if (!chosen.ok) return void await this.#telegram.reply(chatId, chosen.reason, messageId);
      await this.#store.setDefaultAccount(chatId, chosen.value.access.ownerId, chosen.value.account.id);
      return void await this.#telegram.reply(chatId, `✅ Default account is now ${ws.label(chosen.value)}`, messageId);
    }
    await this.#help(chatId);
  }

  async #help(chatId: number): Promise<void> {
    await this.#telegram.setCommands(HelpMenu.COMMANDS);
    await this.#telegram.send(chatId, HelpMenu.GUIDE, { html: true });
  }

  /** Drops a waiting step; a category question, and any lines queued behind it, are marked as not saved. */
  async #dropPending(chatId: number): Promise<boolean> {
    const pending = await this.#store.getPending(chatId);
    if (!pending) return false;
    await this.#store.clearPending(chatId);
    if (pending.kind === 'category' && pending.prompt_message_id) {
      const queued = (pending.queue ?? []).map((q) => `\n• “${q.line}”`).join('');
      await this.#telegram.edit(chatId, pending.prompt_message_id,
        `✖️ Not saved (no category chosen): “${pending.source_text ?? ''}”${queued ? `\nAlso not saved:${queued}` : ''}`);
    }
    return true;
  }

  static #reason(err: unknown): string {
    return EntryService.reason(err);
  }
}
