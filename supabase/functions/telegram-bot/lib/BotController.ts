/**
 * BotController — handles one Telegram update: commands (/start, /help,
 * /accounts, /default) and entry messages. Only chats listed in
 * `telegram_links` may log.
 */
import { EntryParser } from './EntryParser.ts';
import type { PocketStore } from './PocketStore.ts';
import type { TelegramClient } from './TelegramClient.ts';
import { TransactionFactory } from './TransactionFactory.ts';

export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
}

/** Today's date (or N days ago) as YYYY-MM-DD in a fixed time zone. */
export class LocalClock {
  readonly #timeZone: string;

  constructor(timeZone: string) {
    this.#timeZone = timeZone;
  }

  isoDate(daysAgo = 0): string {
    const when = new Date(Date.now() - daysAgo * 86_400_000);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.#timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(when);
  }
}

export class BotController {
  static readonly #HELP = [
    'Send an entry like:',
    '• 500 diaper — expense of 500',
    '• 500 diaper cash — with payment type',
    '• +45000 salary — income',
    '• 250 lunch #wallet — into the account whose name starts with "wallet"',
    '• 250 lunch @food — with the category starting "food"',
    '• 120 taxi yesterday — dated yesterday',
    '',
    '/accounts lists the accounts you can add to.',
    '/default shows the default account; /default <name> changes it.',
    'Edit or delete entries in the Pocket app.',
  ].join('\n');

  readonly #store: PocketStore;
  readonly #telegram: TelegramClient;
  readonly #clock: LocalClock;

  constructor(store: PocketStore, telegram: TelegramClient, clock: LocalClock) {
    this.#store = store;
    this.#telegram = telegram;
    this.#clock = clock;
  }

  async handle(message: TelegramMessage): Promise<void> {
    const chatId = message.chat.id;
    const text = (message.text || '').trim();
    if (!text) return;

    const link = await this.#store.findLink(chatId);
    if (!link) {
      await this.#telegram.reply(chatId,
        `This chat isn't linked to Pocket yet.\nYour chat ID is ${chatId} — add it to the telegram_links table.`);
      return;
    }

    const command = text.split(/[\s@]/)[0].toLowerCase();
    if (command === '/start' || command === '/help') {
      await this.#telegram.reply(chatId, BotController.#HELP);
      return;
    }

    try {
      const isOwner = await this.#store.isOwnerEmail(link.owner_id, link.member_email);
      const { book } = await this.#store.loadBook(link.owner_id);
      const accounts = book.writableAccounts(isOwner ? null : link.member_email);

      if (command === '/accounts') {
        const lines = accounts.map((a) => `• ${a.name}${a.id === link.default_account_id ? ' (default)' : ''}`);
        await this.#telegram.reply(chatId, lines.length ? lines.join('\n') : 'No accounts you can add to.');
        return;
      }
      if (command === '/default') {
        const hint = text.split(/\s+/).slice(1).join(' ').replace(/^#/, '').trim();
        if (!hint) {
          const current = accounts.find((a) => a.id === link.default_account_id);
          await this.#telegram.reply(chatId,
            `Default account: ${current?.name ?? 'none'}\nChange it with /default <account name>, e.g. /default boi`);
          return;
        }
        const chosen = book.resolveAccount(hint, null, accounts);
        if (!chosen.ok) return void await this.#telegram.reply(chatId, chosen.reason, message.message_id);
        await this.#store.setDefaultAccount(chatId, chosen.value.id);
        await this.#telegram.reply(chatId, `✅ Default account is now ${chosen.value.name}`, message.message_id);
        return;
      }
      if (command.startsWith('/')) {
        await this.#telegram.reply(chatId, BotController.#HELP);
        return;
      }

      const parsed = new EntryParser(book.paymentTypes).parse(text);
      if (!parsed.ok) return void await this.#telegram.reply(chatId, parsed.reason, message.message_id);
      const { entry } = parsed;

      const account = book.resolveAccount(entry.accountHint, link.default_account_id, accounts);
      if (!account.ok) return void await this.#telegram.reply(chatId, account.reason, message.message_id);
      const category = book.resolveCategory(entry.categoryHint, entry.type);
      if (!category.ok) return void await this.#telegram.reply(chatId, category.reason, message.message_id);

      const factory = new TransactionFactory(book);
      const tx = factory.build({
        id: await TransactionFactory.idFor(chatId, message.message_id),
        entry,
        account: account.value,
        category: category.value,
        date: this.#clock.isoDate(entry.daysAgo),
        addedBy: isOwner ? null : link.member_email.toLowerCase().trim(),
      });

      const result = await this.#store.writerFor(link, isOwner).save(tx);
      if (result === 'duplicate') return;

      const sign = tx.type === 'income' ? '+' : '';
      const parts = [
        `✅ ${sign}${factory.money.format(tx.amount, tx.currency)}`,
        tx.note || null,
        tx.paymentType,
        account.value.name,
        category.value?.name ?? null,
      ].filter(Boolean);
      const when = `${tx.date} · ${factory.hijri.label(tx.hijriDate)}`;
      const pending = isOwner ? '' : '\nIt will appear once the owner\'s app syncs.';
      await this.#telegram.reply(chatId, `${parts.join(' · ')}\n${when}${pending}`, message.message_id);
    } catch (err) {
      console.error('[telegram-bot]', err);
      const reason = err instanceof Error ? err.message : 'Something went wrong.';
      await this.#telegram.reply(chatId, `⚠️ Not saved: ${reason}`, message.message_id);
    }
  }
}
