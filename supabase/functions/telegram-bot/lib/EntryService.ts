/**
 * EntryService — records an entry from a message, asks for a category when
 * one is missing (nothing is saved until it is chosen), and handles the
 * ✏️ Edit / 🗑 Delete buttons on each confirmation.
 *
 * Categories are picked in two steps: a main category, then one of its
 * subcategories. Only a subcategory can be saved.
 *
 * Row ids derive from the "seed" message (the one that first carried the
 * entry), so an edit rewrites the same rows and a delete finds them again.
 */
import { EntryParser } from './EntryParser.ts';
import type { Category, PocketBook } from './PocketBook.ts';
import type { ExchangeRates } from './ExchangeRates.ts';
import type { PocketStore, TelegramLink } from './PocketStore.ts';
import type { Keyboard, TelegramClient } from './TelegramClient.ts';
import { type PocketTransaction, TransactionFactory } from './TransactionFactory.ts';
import type { LocalClock } from './LocalClock.ts';

export interface RecordRequest {
  link: TelegramLink;
  chatId: number;
  seed: number;                     // message id the entry's row ids derive from
  text: string;                     // the entry as typed
  replace: boolean;                 // correcting an existing entry
  replyTo?: number;                 // message to reply under
  categoryId?: string;              // chosen with a button (a main one opens its subcategories)
  browseMains?: boolean;            // "back" tapped: show the main categories again
  categoryName?: string;            // typed in answer to the category question
  promptMessageId?: number | null;  // the category question to turn into the confirmation
  confirmMessageId?: number | null; // an old confirmation to mark as edited
}

export class EntryService {
  static readonly #MAX_BUTTONS = 40;

  readonly #store: PocketStore;
  readonly #telegram: TelegramClient;
  readonly #clock: LocalClock;
  readonly #rates: ExchangeRates;

  constructor(store: PocketStore, telegram: TelegramClient, clock: LocalClock, rates: ExchangeRates) {
    this.#store = store;
    this.#telegram = telegram;
    this.#clock = clock;
    this.#rates = rates;
  }

  async record(req: RecordRequest): Promise<void> {
    const { link, chatId } = req;
    const isOwner = await this.#store.isOwnerEmail(link.owner_id, link.member_email);
    const { book } = await this.#store.loadBook(link.owner_id);
    const accounts = book.writableAccounts(isOwner ? null : link.member_email);

    const parsed = new EntryParser(book.paymentTypes).parse(req.text);
    if (!parsed.ok) return void await this.#telegram.reply(chatId, parsed.reason, req.replyTo);
    const { entry } = parsed;

    const account = book.resolveAccount(entry.accountHint, link.default_account_id, accounts);
    if (!account.ok) return void await this.#telegram.reply(chatId, account.reason, req.replyTo);
    let toAccount = null;
    if (entry.type === 'transfer') {
      const to = book.resolveAccount(entry.toAccountHint, null, accounts);
      if (!to.ok) return void await this.#telegram.reply(chatId, to.reason, req.replyTo);
      toAccount = to.value;
    }

    // Every expense and income needs a subcategory; transfers don't.
    let category: Category | null = null;
    if (entry.type !== 'transfer') {
      const type = entry.type;
      const typed = req.categoryName ?? entry.categoryHint;
      const askMains = (reason: string) =>
        this.#askCategory(req, book, reason, book.mainCategories(type), false);
      const askSubs = (main: Category) =>
        this.#askCategory(req, book, `${main.name} — which one?`, book.subcategories(main.id, type), true);

      if (req.browseMains) return void await askMains('Which category is this?');
      if (req.categoryId) {
        const chosen = book.categoryById(req.categoryId);
        if (!chosen) return void await askMains('That category no longer exists. Pick another:');
        if (book.isMain(chosen)) return void await askSubs(chosen);
        category = chosen;
      } else if (typed) {
        const found = book.resolveCategory(typed, type);
        if (found.kind === 'main') return void await askSubs(found.main);
        if (found.kind === 'choose') return void await this.#askCategory(req, book, found.reason, found.options, true);
        category = found.value;
      }
      if (!category) return void await askMains('Which category is this?');
    }

    const factory = new TransactionFactory(book, await this.#rates.current(book.fxRates));
    const txs = await factory.build({
      chatId,
      messageId: req.seed,
      entry,
      account: account.value,
      toAccount,
      category,
      date: this.#clock.isoDate(entry.daysAgo),
      addedBy: link.member_email.toLowerCase().trim(), // shown in the app as "Entered … by …"
    });

    const writer = this.#store.writerFor(link, isOwner);
    if (req.replace) {
      await writer.replace(await TransactionFactory.allIdsFor(chatId, req.seed), txs);
    } else if (await writer.add(txs) === 'duplicate') {
      return;
    }
    await this.#store.clearPending(chatId);

    const text = this.#confirmation(txs, factory, book, account.value.name, toAccount?.name ?? null, category, isOwner);
    const buttons = EntryService.#entryButtons(req.seed);
    if (req.promptMessageId) {
      await this.#telegram.edit(chatId, req.promptMessageId, text, buttons);
    } else {
      await this.#telegram.send(chatId, text, { replyTo: req.replyTo, keyboard: buttons });
    }
    if (req.replace && req.confirmMessageId && req.confirmMessageId !== req.promptMessageId) {
      await this.#telegram.edit(chatId, req.confirmMessageId, '✏️ Edited — the corrected entry is below.');
    }
  }

  /** ✏️ Edit tapped: wait for the corrected entry. */
  async startEdit(chatId: number, seed: number, confirmMessageId: number): Promise<void> {
    await this.#store.setPending(chatId, {
      kind: 'edit', seed_message_id: seed, source_text: null, replace: true,
      prompt_message_id: null, confirm_message_id: confirmMessageId,
    });
    await this.#telegram.send(chatId,
      '✏️ Send the corrected entry, written like a new one (e.g. 70 marol to modi street @taxi).\n'
      + 'It will replace the entry above. Send /cancel to keep it as it is.',
      { replyTo: confirmMessageId, forceReply: 'Corrected entry' });
  }

  /** 🗑 Delete tapped: remove the entry's rows and strike the confirmation. */
  async remove(link: TelegramLink, chatId: number, seed: number, confirmMessageId: number, shownText: string): Promise<boolean> {
    const isOwner = await this.#store.isOwnerEmail(link.owner_id, link.member_email);
    const found = await this.#store.writerFor(link, isOwner).remove(await TransactionFactory.allIdsFor(chatId, seed));
    const firstLine = shownText.split('\n')[0].replace(/^✅ |^🔁 /, '');
    await this.#telegram.edit(chatId, confirmMessageId, found ? `🗑 Deleted: ${firstLine}` : `🗑 Already removed: ${firstLine}`);
    return found > 0;
  }

  /**
   * Asks for a category with buttons; the entry waits in the chat's pending
   * step. Main categories open their subcategories (›); subcategories save.
   */
  async #askCategory(req: RecordRequest, book: PocketBook, reason: string, options: Category[], back: boolean): Promise<void> {
    const text = `🏷 ${reason}\nTap one, or type a name. Send /cancel to drop this entry.\n\n“${req.text}”`;
    const shown = options.slice(0, EntryService.#MAX_BUTTONS);
    const sameParent = shown.length > 0 && shown.every((c) => !book.isMain(c) && c.parentId === shown[0].parentId);
    const label = (c: Category) => book.isMain(c) ? `${c.name} ›` : sameParent ? c.name : book.categoryPath(c);
    const buttons: Keyboard = [];
    for (let i = 0; i < shown.length; i += 2) {
      buttons.push(shown.slice(i, i + 2).map((c) => ({
        text: label(c),
        callback_data: `${book.isMain(c) ? 'main' : 'cat'}:${c.id}`,
      })));
    }
    if (back) buttons.push([{ text: '⬅️ All categories', callback_data: 'back' }]);
    let promptId = req.promptMessageId ?? null;
    if (promptId) {
      await this.#telegram.edit(req.chatId, promptId, text, buttons);
    } else {
      promptId = await this.#telegram.send(req.chatId, text, { replyTo: req.replyTo, keyboard: buttons });
    }
    await this.#store.setPending(req.chatId, {
      kind: 'category', seed_message_id: req.seed, source_text: req.text, replace: req.replace,
      prompt_message_id: promptId, confirm_message_id: req.confirmMessageId ?? null,
    });
  }

  #confirmation(
    txs: PocketTransaction[], factory: TransactionFactory, book: PocketBook,
    accountName: string, toName: string | null, category: Category | null, isOwner: boolean,
  ): string {
    const [tx, inLeg] = txs;
    const money = (t: PocketTransaction) => factory.money.format(t.amount, t.currency);
    const parts = tx.type === 'transfer'
      ? [
        `🔁 ${money(tx)} ${accountName} → ${toName}` + (inLeg.currency !== tx.currency ? ` (received ${money(inLeg)})` : ''),
        tx.note || null,
      ]
      : [
        `✅ ${tx.type === 'income' ? '+' : ''}${money(tx)}`,
        tx.note || null,
        category ? `🏷 ${book.categoryPath(category)}` : null,
        tx.paymentType,
        accountName,
      ];
    const when = `${tx.date} · ${factory.hijri.label(tx.hijriDate)}`;
    const pending = isOwner ? '' : '\nIt will appear once the owner\'s app syncs.';
    return `${parts.filter(Boolean).join(' · ')}\n${when}${pending}`;
  }

  static #entryButtons(seed: number): Keyboard {
    return [[
      { text: '✏️ Edit', callback_data: `edit:${seed}` },
      { text: '🗑 Delete', callback_data: `del:${seed}` },
    ]];
  }
}
