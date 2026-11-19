/**
 * BotController — routes one Telegram update. Unlinked chats can only /link
 * (and answer with the emailed code). Linked chats get the commands (/help,
 * /accounts, /categories, /default, /cancel, /unlink), entry messages,
 * answers to a pending step, and button taps. A message with several lines
 * records one entry per line (BatchEntryService). In groups the bot only
 * handles summary commands (GroupService) and never records entries.
 */
import { AiAssistant } from './AiAssistant.ts';
import type { BatchEntryService } from './BatchEntryService.ts';
import { BookCreator } from './BookCreator.ts';
import { EntryEditor } from './EntryEditor.ts';
import { DeliveryBot } from './DeliveryBot.ts';
import { OwedBot } from './OwedBot.ts';
import { CategoryDirectory } from './CategoryDirectory.ts';
import { EntryBatch } from './EntryBatch.ts';
import { EntryParser } from './EntryParser.ts';
import { EntryService } from './EntryService.ts';
import type { GroupService } from './GroupService.ts';
import { HelpMenu } from './HelpMenu.ts';
import { LinkService } from './LinkService.ts';
import { PlanAccess } from './PlanAccess.ts';
import type { PocketStore, TelegramLink } from './PocketStore.ts';
import type { TelegramClient } from './TelegramClient.ts';
import { Workspace } from './Workspace.ts';

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type?: string; title?: string };
  from?: { id: number };
  text?: string;
  migrate_to_chat_id?: number; // a group became a supergroup, with this new id
  message_thread_id?: number;   // the topic (or reply thread) it was sent in
  is_topic_message?: boolean;   // sent in a topic of a group with topics
  caption?: string;             // text sent with a photo or file
  voice?: { file_id: string; duration?: number; mime_type?: string; file_size?: number };
  audio?: { file_id: string; duration?: number; mime_type?: string; file_size?: number };
  photo?: { file_id: string; file_size?: number; width?: number; height?: number }[];
  document?: { file_id: string; mime_type?: string; file_size?: number; file_name?: string };
  reply_to_message?: TelegramMessage;
}

export interface TelegramCallback {
  id: string;
  from?: { id: number };
  data?: string;
  message?: TelegramMessage;
}

export class BotController {
  readonly #store: PocketStore;
  readonly #telegram: TelegramClient;
  readonly #entries: EntryService;
  readonly #links: LinkService;
  readonly #batches: BatchEntryService;
  readonly #groups: GroupService;
  readonly #deliveries: DeliveryBot | null;
  readonly #owed: OwedBot | null;
  readonly #ai: AiAssistant | null;
  readonly #editor: EntryEditor | null;
  readonly #creator: BookCreator | null;

  constructor(
    store: PocketStore, telegram: TelegramClient, entries: EntryService,
    links: LinkService, batches: BatchEntryService, groups: GroupService,
    deliveries: DeliveryBot | null = null, owed: OwedBot | null = null, ai: AiAssistant | null = null,
    editor: EntryEditor | null = null, creator: BookCreator | null = null,
  ) {
    this.#ai = ai;
    this.#editor = editor;
    this.#creator = creator;
    this.#owed = owed;
    this.#deliveries = deliveries;
    this.#store = store;
    this.#telegram = telegram;
    this.#entries = entries;
    this.#links = links;
    this.#batches = batches;
    this.#groups = groups;
  }

  async handleMessage(message: TelegramMessage): Promise<void> {
    const chatId = message.chat.id;
    if (message.migrate_to_chat_id) return void await this.#store.moveGroup(chatId, message.migrate_to_chat_id);
    const text = (message.text || '').trim();
    const media = message.chat.type && message.chat.type !== 'private' ? null : AiAssistant.mediaOf(message);
    if (!text && !media) return;
    if (message.chat.type && message.chat.type !== 'private') {
      if (message.chat.type === 'channel') return;
      try {
        await this.#groups.handle(message);
      } catch (err) {
        console.error('[telegram-bot] group', err);
        await this.#telegram.reply(chatId, '⚠️ Something went wrong. Please try again.', message.message_id);
      }
      return;
    }

    // "typing…" shows while the bot works; it isn't waited for.
    void Promise.resolve().then(() => this.#telegram.typing(chatId)).catch(() => {});
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
      if (LinkService.isRecentCode(text, link)) {
        await this.#dropPending(chatId);
        return void await this.#telegram.reply(chatId,
          `✅ This chat is already connected to ${link.email}. That code isn't needed again, and nothing was saved.\nTo record an amount this large, add a note, e.g. ${text} rent`,
          message.message_id);
      }

      // Everything an entry needs is fetched at once rather than one after another.
      const planLoad = PlanAccess.load(this.#store, link.user_id);
      const books = Workspace.load(this.#store, link, planLoad);
      books.catch(() => {}); // not every message needs the books; a failure surfaces where one does
      const [plan, pending] = await Promise.all([planLoad, this.#store.getPending(chatId)]);
      const notice = plan.notice();
      if (notice) {
        await this.#dropPending(chatId);
        return void await this.#telegram.reply(chatId, notice, message.message_id);
      }

      if (media) {
        if (!this.#ai) return;
        await this.#dropPending(chatId);
        return void await this.#ai.handleMedia(link, chatId, message, media, await books,
          (lines) => this.#recordText(link, chatId, message.message_id, lines, books, true));
      }

      // A step of the ✏️ Edit menu, /newaccount or /newcategory waiting for typed text.
      if (pending?.kind === 'edit' && pending.step) {
        const step = pending.step;
        if (step.kind === 'field' && this.#editor) return void await this.#editor.answer(link, chatId, step, text, message.message_id);
        if (step.kind !== 'field' && this.#creator) return void await this.#creator.answer(link, chatId, pending, text, message.message_id);
      }
      if (pending?.kind === 'edit') {
        return void await this.#entries.record({
          link, chatId, seed: pending.seed_message_id, text, replace: true, oldOwnerId: pending.owner_id,
          replyTo: message.message_id, confirmMessageId: pending.confirm_message_id, workspace: await books,
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
            queue: pending.queue ?? [], shared: pending.shared ?? false, workspace: await books,
          });
        }
        await this.#dropPending(chatId);
      }
      await this.#recordText(link, chatId, message.message_id, text, books);
    } catch (err) {
      console.error('[telegram-bot]', err);
      await this.#telegram.reply(chatId, `⚠️ Not saved: ${BotController.#reason(err)}`, message.message_id);
    }
  }

  /**
   * Records a message's text: loans and paybacks, deliveries, several lines, or
   * one entry. A message with no amount at all is first given to the AI, which
   * may work out the entry or find a question (`fromAi` stops it going round).
   */
  async #recordText(link: TelegramLink, chatId: number, messageId: number, text: string, books: Promise<Workspace>, fromAi = false): Promise<void> {
    const batch = EntryBatch.isBatch(text);
    // Loans and paybacks ("5000 lent Ali", "+27000 paid back Star Health") come before "paid <bill> <amount>".
    if (this.#owed && !batch && await this.#owed.tryText(link, chatId, messageId, text)) return;
    if (this.#deliveries && !batch && await this.#deliveries.tryText(link, chatId, messageId, text)) return;
    if (batch) return void await this.#batches.record(link, chatId, messageId, text);
    if (!fromAi && this.#ai && !EntryParser.hasAmount(text)
        && await this.#ai.interpret(link, chatId, messageId, text, await books,
          (lines) => this.#recordText(link, chatId, messageId, lines, books, true))) return;
    await this.#entries.record({
      link, chatId, seed: messageId, text, replace: false, replyTo: messageId, workspace: await books,
    });
  }

  async handleCallback(cb: TelegramCallback): Promise<void> {
    const msg = cb.message;
    if (!msg) return void await this.#telegram.answer(cb.id);
    if (HelpMenu.isButton(cb.data)) {
      const page = HelpMenu.page(HelpMenu.pageFor(cb.data));
      await this.#telegram.answer(cb.id);
      return void await this.#telegram.edit(msg.chat.id, msg.message_id, page.text, page.keyboard, true);
    }
    // Check-ins, /dues and bill reminders: in private chats and family groups alike.
    if (this.#deliveries && DeliveryBot.isButton(cb.data)) return void await this.#deliveries.handleCallback(cb);
    if (msg.chat.type && msg.chat.type !== 'private') {
      try {
        return void await this.#groups.handleCallback(cb);
      } catch (err) {
        console.error('[telegram-bot] group callback', err);
        return void await this.#telegram.answer(cb.id, '⚠️ Not done');
      }
    }
    const chatId = msg.chat.id;
    const link = await this.#store.findLink(chatId);
    if (!link) return void await this.#telegram.answer(cb.id, 'This chat is not connected. Send /link.');

    // The ✏️ Edit menu and new accounts / categories: the plan must still include Telegram.
    if ((this.#editor && EntryEditor.isButton(cb.data)) || (this.#creator && BookCreator.isButton(cb.data))) {
      const notice = (await PlanAccess.load(this.#store, link.user_id)).notice();
      if (notice) return void await this.#telegram.answer(cb.id, 'Not available on your plan');
      try {
        if (EntryEditor.isButton(cb.data)) return void await this.#editor!.handleCallback(cb, link);
        return void await this.#creator!.handleCallback(cb, link);
      } catch (err) {
        console.error('[telegram-bot] edit/create callback', err);
        await this.#telegram.answer(cb.id, '⚠️ Not done');
        return void await this.#telegram.send(chatId, `⚠️ ${BotController.#reason(err)}`, { replyTo: msg.message_id });
      }
    }
    if (this.#ai && AiAssistant.isButton(cb.data)) {
      try {
        return void await this.#ai.handleCallback(cb, link);
      } catch (err) {
        console.error('[telegram-bot] ai callback', err);
        return void await this.#telegram.answer(cb.id, '⚠️ Not done');
      }
    }
    // edit/del carry the book's owner id; buttons from before shared books meant your own book.
    if (this.#owed && OwedBot.isButton(cb.data)) {
      const notice = (await PlanAccess.load(this.#store, link.user_id)).notice();
      if (notice) return void await this.#telegram.answer(cb.id, 'Not available on your plan');
      try {
        return void await this.#owed.handleCallback(cb, link);
      } catch (err) {
        console.error('[telegram-bot] owed callback', err);
        await this.#telegram.answer(cb.id, '⚠️ Not done');
        return void await this.#telegram.send(chatId, `⚠️ ${BotController.#reason(err)}`, { replyTo: msg.message_id });
      }
    }
    const [action, value, ownerId = link.user_id] = (cb.data || '').split(':');
    try {
      if (action === 'cat' || action === 'main' || action === 'back' || action === 'edit' || action === 'del') {
        const notice = (await PlanAccess.load(this.#store, link.user_id)).notice();
        if (notice) {
          await this.#telegram.answer(cb.id, 'Not available on your plan');
          return void await this.#telegram.send(chatId, notice, { replyTo: msg.message_id });
        }
      }
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

    if (this.#deliveries && command === '/deliveries') return void await this.#deliveries.deliveries(link, chatId);
    if (this.#deliveries && command === '/dues') return void await this.#deliveries.dues(link, chatId);
    if (this.#owed && command === '/toget') return void await this.#owed.toget(link, chatId);

    if (this.#creator && (command === '/newaccount' || command === '/newcategory')) {
      const notice = (await PlanAccess.load(this.#store, link.user_id)).notice();
      if (notice) return void await this.#telegram.reply(chatId, notice, messageId);
      await this.#dropPending(chatId);
      if (command === '/newaccount') return void await this.#creator.newAccount(link, chatId, messageId, argument);
      return void await this.#creator.newCategory(link, chatId, messageId, argument);
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
    const page = HelpMenu.page();
    await this.#telegram.send(chatId, page.text, { html: true, keyboard: page.keyboard });
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
