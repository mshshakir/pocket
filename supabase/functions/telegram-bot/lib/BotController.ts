/**
 * BotController — routes one Telegram update: commands (/start, /help,
 * /accounts, /default, /cancel), entry messages, answers to a pending step,
 * and button taps. Only chats listed in `telegram_links` may log.
 */
import { EntryParser } from './EntryParser.ts';
import type { EntryService } from './EntryService.ts';
import { HelpMenu } from './HelpMenu.ts';
import type { PocketStore, TelegramLink } from './PocketStore.ts';
import type { TelegramClient } from './TelegramClient.ts';

export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
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

  constructor(store: PocketStore, telegram: TelegramClient, entries: EntryService) {
    this.#store = store;
    this.#telegram = telegram;
    this.#entries = entries;
  }

  async handleMessage(message: TelegramMessage): Promise<void> {
    const chatId = message.chat.id;
    const text = (message.text || '').trim();
    if (!text) return;

    const link = await this.#store.findLink(chatId);
    if (!link) {
      await this.#telegram.reply(chatId,
        `This chat isn't linked to Pocket yet.\nYour chat ID is ${chatId} — add it to the telegram_links table.`);
      return;
    }

    try {
      const command = text.split(/[\s@]/)[0].toLowerCase();
      if (command.startsWith('/')) return void await this.#command(command, text, link, chatId, message.message_id);

      const pending = await this.#store.getPending(chatId);
      if (pending?.kind === 'edit') {
        return void await this.#entries.record({
          link, chatId, seed: pending.seed_message_id, text, replace: true,
          replyTo: message.message_id, confirmMessageId: pending.confirm_message_id,
        });
      }
      if (pending?.kind === 'category' && pending.source_text) {
        // A message with an amount is a new entry; anything else names the category.
        if (!new EntryParser([]).parse(text).ok) {
          return void await this.#entries.record({
            link, chatId, seed: pending.seed_message_id, text: pending.source_text, replace: pending.replace,
            replyTo: message.message_id, categoryName: text,
            promptMessageId: pending.prompt_message_id, confirmMessageId: pending.confirm_message_id,
          });
        }
        await this.#dropPending(chatId);
      }
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
    if (!link) return void await this.#telegram.answer(cb.id, 'This chat is not linked.');

    const [action, value] = (cb.data || '').split(':');
    try {
      if (action === 'cat') {
        const pending = await this.#store.getPending(chatId);
        if (pending?.kind !== 'category' || pending.prompt_message_id !== msg.message_id || !pending.source_text) {
          return void await this.#telegram.answer(cb.id, 'This choice has expired. Send the entry again.');
        }
        await this.#telegram.answer(cb.id);
        await this.#entries.record({
          link, chatId, seed: pending.seed_message_id, text: pending.source_text, replace: pending.replace,
          categoryId: value, promptMessageId: msg.message_id, confirmMessageId: pending.confirm_message_id,
        });
      } else if (action === 'edit') {
        await this.#telegram.answer(cb.id);
        await this.#entries.startEdit(chatId, Number(value), msg.message_id);
      } else if (action === 'del') {
        const done = await this.#entries.remove(link, chatId, Number(value), msg.message_id, msg.text || '');
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

  async #command(command: string, text: string, link: TelegramLink, chatId: number, messageId: number): Promise<void> {
    if (command === '/start' || command === '/help') {
      await this.#telegram.setCommands(HelpMenu.COMMANDS);
      return void await this.#telegram.send(chatId, HelpMenu.GUIDE, { html: true });
    }
    if (command === '/cancel') {
      const had = await this.#dropPending(chatId);
      return void await this.#telegram.reply(chatId, had ? 'Cancelled. Nothing was changed.' : 'Nothing to cancel.', messageId);
    }

    const isOwner = await this.#store.isOwnerEmail(link.owner_id, link.member_email);
    const { book } = await this.#store.loadBook(link.owner_id);
    const accounts = book.writableAccounts(isOwner ? null : link.member_email);

    if (command === '/accounts') {
      const lines = accounts.map((a) => `• ${a.name}${a.id === link.default_account_id ? ' (default)' : ''}`);
      return void await this.#telegram.reply(chatId, lines.length ? lines.join('\n') : 'No accounts you can add to.');
    }
    if (command === '/default') {
      const hint = text.split(/\s+/).slice(1).join(' ').replace(/^#/, '').trim();
      if (!hint) {
        const current = accounts.find((a) => a.id === link.default_account_id);
        return void await this.#telegram.reply(chatId,
          `Default account: ${current?.name ?? 'none'}\nChange it with /default <account name>, e.g. /default boi`);
      }
      const chosen = book.resolveAccount(hint, null, accounts);
      if (!chosen.ok) return void await this.#telegram.reply(chatId, chosen.reason, messageId);
      await this.#store.setDefaultAccount(chatId, chosen.value.id);
      return void await this.#telegram.reply(chatId, `✅ Default account is now ${chosen.value.name}`, messageId);
    }
    await this.#telegram.setCommands(HelpMenu.COMMANDS);
    await this.#telegram.send(chatId, HelpMenu.GUIDE, { html: true });
  }

  /** Drops a waiting step; a category question is marked as not saved. */
  async #dropPending(chatId: number): Promise<boolean> {
    const pending = await this.#store.getPending(chatId);
    if (!pending) return false;
    await this.#store.clearPending(chatId);
    if (pending.kind === 'category' && pending.prompt_message_id) {
      await this.#telegram.edit(chatId, pending.prompt_message_id, `✖️ Not saved (no category chosen): “${pending.source_text ?? ''}”`);
    }
    return true;
  }

  static #reason(err: unknown): string {
    return err instanceof Error ? err.message : 'Something went wrong.';
  }
}
