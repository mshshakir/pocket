/**
 * EntryService — records an entry from a message into the right book, asks
 * for a category when one is missing (nothing is saved until it is chosen),
 * and handles the ✏️ Edit / 🗑 Delete buttons on each confirmation.
 *
 * The book is the one holding the chosen account: the person's own, or a
 * space shared with them (see Workspace). Categories come from that book and
 * are picked in two steps, main then subcategory; only a subcategory saves.
 *
 * Row ids derive from the "seed" message (the one that first carried the
 * entry), so an edit rewrites the same rows and a delete finds them again.
 *
 * Lines of a several-line message that still need a category wait in a
 * queue and are asked about one at a time; see BatchEntryService.
 */
import { EntryParser } from './EntryParser.ts';
import type { Category, PocketBook } from './PocketBook.ts';
import type { ExchangeRates } from './ExchangeRates.ts';
import type { PocketStore, QueuedEntry, TelegramLink } from './PocketStore.ts';
import type { Keyboard, TelegramClient } from './TelegramClient.ts';
import { type PocketTransaction, TransactionFactory } from './TransactionFactory.ts';
import type { LocalClock } from './LocalClock.ts';
import { type AccountChoice, Workspace } from './Workspace.ts';

export interface RecordRequest {
  link: TelegramLink;
  chatId: number;
  seed: number;                     // id the entry's row ids derive from
  text: string;                     // the entry as typed
  replace: boolean;                 // correcting an existing entry
  oldOwnerId?: string | null;       // replace: the book the old entry is in
  replyTo?: number;                 // message to reply under
  categoryId?: string;              // chosen with a button (a main one opens its subcategories)
  browseMains?: boolean;            // "back" tapped: show the main categories again
  categoryName?: string;            // typed in answer to the category question
  promptMessageId?: number | null;  // the category question to turn into the confirmation
  confirmMessageId?: number | null; // an old confirmation to mark as edited
  label?: string;                   // the line as typed, when it is one of several
  defer?: boolean;                  // don't ask for a category yet; report 'deferred'
  queue?: QueuedEntry[];            // lines of the same message to handle after this one
  shared?: boolean;                 // this line's category is the message's shared one
}

/** What happened to one entry. */
export type RecordOutcome = 'saved' | 'duplicate' | 'asked' | 'deferred' | 'rejected';

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

  /**
   * Records one entry, then moves on to the next queued line unless this one
   * is now waiting for a category. With lines still queued, a failure is
   * reported here and the queue carries on; otherwise it is thrown.
   */
  async record(req: RecordRequest): Promise<RecordOutcome> {
    let outcome: RecordOutcome;
    let category: Category | null = null;
    try {
      ({ outcome, category } = await this.#recordOne(req));
    } catch (err) {
      if (!req.queue?.length) throw err;
      await this.#telegram.send(req.chatId, `⚠️ Not saved: ${EntryService.#prefix(req)}${EntryService.reason(err)}`);
      outcome = 'rejected';
    }
    if (outcome !== 'asked' && outcome !== 'deferred' && req.queue?.length) {
      await this.#next(req, outcome === 'saved' ? category : null);
    }
    return outcome;
  }

  /** ✏️ Edit tapped: wait for the corrected entry. */
  async startEdit(link: TelegramLink, chatId: number, seed: number, ownerId: string, confirmMessageId: number): Promise<void> {
    const ws = await Workspace.load(this.#store, link);
    if (!ws.access(ownerId)) throw new Error('You no longer have access to change this entry.');
    await this.#store.setPending(chatId, {
      kind: 'edit', seed_message_id: seed, source_text: null, replace: true,
      prompt_message_id: null, confirm_message_id: confirmMessageId, owner_id: ownerId,
      queue: [], shared: false,
    });
    await this.#telegram.send(chatId,
      '✏️ Send the corrected entry, written like a new one (e.g. 70 marol to modi street @taxi).\n'
      + 'It will replace the entry above. Send /cancel to keep it as it is.',
      { replyTo: confirmMessageId, forceReply: 'Corrected entry' });
  }

  /** 🗑 Delete tapped: remove the entry's rows from its book and strike the confirmation. */
  async remove(link: TelegramLink, chatId: number, seed: number, ownerId: string, confirmMessageId: number, shownText: string): Promise<boolean> {
    const ws = await Workspace.load(this.#store, link);
    const access = ws.access(ownerId);
    if (!access) throw new Error('You no longer have access to change this entry.');
    const found = await this.#store.writerFor(access.ownerId, link.email, access.isOwn)
      .remove(await TransactionFactory.allIdsFor(chatId, seed));
    const firstLine = shownText.split('\n')[0].replace(/^✅ |^🔁 /, '');
    await this.#telegram.edit(chatId, confirmMessageId, found ? `🗑 Deleted: ${firstLine}` : `🗑 Already removed: ${firstLine}`);
    return found > 0;
  }

  static reason(err: unknown): string {
    return err instanceof Error ? err.message : 'Something went wrong.';
  }

  async #recordOne(req: RecordRequest): Promise<{ outcome: RecordOutcome; category: Category | null }> {
    const { link, chatId } = req;
    const ws = await Workspace.load(this.#store, link);

    const parsed = new EntryParser(ws.paymentTypes).parse(req.text);
    if (!parsed.ok) return await this.#reject(req, parsed.reason);
    const { entry } = parsed;

    const fallback = { ownerId: link.default_owner_id, accountId: link.default_account_id };
    const chosen = ws.resolve(entry.accountHint, fallback);
    if (!chosen.ok) return await this.#reject(req, chosen.reason);
    const from = chosen.value;
    const { access } = from;
    const book = access.book;

    let to: AccountChoice | null = null;
    if (entry.type === 'transfer') {
      const target = ws.resolve(entry.toAccountHint, null, access); // same book only
      if (!target.ok) return await this.#reject(req, target.reason);
      to = target.value;
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

      if (req.browseMains) return await askMains('Which category is this?');
      if (req.categoryId) {
        const picked = book.categoryById(req.categoryId);
        if (!picked) return await askMains('Pick a category from this book:');
        if (book.isMain(picked)) return await askSubs(picked);
        category = picked;
      } else if (typed) {
        const found = book.resolveCategory(typed, type);
        if (found.kind === 'main') return await askSubs(found.main);
        if (found.kind === 'choose') return await this.#askCategory(req, book, found.reason, found.options, true);
        category = found.value;
      }
      if (!category) return await askMains('Which category is this?');
    }

    const factory = new TransactionFactory(book, await this.#rates.current(book.fxRates));
    const txs = await factory.build({
      chatId,
      messageId: req.seed,
      entry,
      account: from.account,
      toAccount: to?.account ?? null,
      category,
      date: this.#clock.isoDate(entry.daysAgo),
      addedBy: link.email, // shown in the app as "Entered … by …"
    });

    const writer = this.#store.writerFor(access.ownerId, link.email, access.isOwn);
    const ids = await TransactionFactory.allIdsFor(chatId, req.seed);
    if (req.replace && req.oldOwnerId && req.oldOwnerId !== access.ownerId) {
      // The correction moved the entry to another book: take it out of the old one first.
      const old = ws.access(req.oldOwnerId);
      if (old) await this.#store.writerFor(old.ownerId, link.email, old.isOwn).remove(ids);
      await writer.add(txs);
    } else if (req.replace) {
      await writer.replace(ids, txs);
    } else if (await writer.add(txs) === 'duplicate') {
      return { outcome: 'duplicate', category };
    }
    if (req.promptMessageId || req.replace) await this.#store.clearPending(chatId);

    const text = this.#confirmation(txs, factory, book, ws, from, to, category);
    const buttons = EntryService.#entryButtons(req.seed, access.ownerId);
    if (req.promptMessageId) {
      await this.#telegram.edit(chatId, req.promptMessageId, text, buttons);
    } else {
      await this.#telegram.send(chatId, text, { replyTo: req.replyTo, keyboard: buttons });
    }
    if (req.replace && req.confirmMessageId && req.confirmMessageId !== req.promptMessageId) {
      await this.#telegram.edit(chatId, req.confirmMessageId, '✏️ Edited — the corrected entry is below.');
    }
    return { outcome: 'saved', category };
  }

  /**
   * Moves on to the next queued line. Once a shared category has been picked
   * for one line, the other lines that use it get the same one.
   */
  async #next(req: RecordRequest, chosen: Category | null): Promise<void> {
    const queue = (req.queue ?? []).map((q) =>
      req.shared && chosen && q.shared && !q.categoryId ? { ...q, categoryId: chosen.id } : q);
    const [next, ...rest] = queue;
    try {
      await this.record({
        link: req.link, chatId: req.chatId, seed: next.seed, text: next.text, replace: false,
        label: next.line, categoryId: next.categoryId, queue: rest, shared: next.shared,
      });
    } catch (err) {
      // Only reached for the last line: record() reports the others itself.
      await this.#telegram.send(req.chatId, `⚠️ Not saved: “${next.line}” — ${EntryService.reason(err)}`);
    }
  }

  async #reject(req: RecordRequest, reason: string): Promise<{ outcome: RecordOutcome; category: null }> {
    await this.#telegram.reply(req.chatId, `${EntryService.#prefix(req)}${reason}`, req.replyTo);
    return { outcome: 'rejected', category: null };
  }

  /** “line” — , naming the line when it is one of several. */
  static #prefix(req: RecordRequest): string {
    return req.label ? `“${req.label}” — ` : '';
  }

  /**
   * Asks for a category with buttons; the entry waits in the chat's pending
   * step. Main categories open their subcategories (›); subcategories save.
   */
  async #askCategory(
    req: RecordRequest, book: PocketBook, reason: string, options: Category[], back: boolean,
  ): Promise<{ outcome: RecordOutcome; category: null }> {
    if (req.defer) return { outcome: 'deferred', category: null };
    const waiting = req.queue?.length ?? 0;
    const more = waiting ? `\n${waiting} more line${waiting > 1 ? 's' : ''} after this one; /cancel drops them too.` : '';
    const text = `🏷 ${reason}\nTap one, or type a name. Send /cancel to drop this entry.${more}\n\n“${req.text}”`;
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
      prompt_message_id: promptId, confirm_message_id: req.confirmMessageId ?? null, owner_id: req.oldOwnerId ?? null,
      queue: req.queue ?? [], shared: req.shared ?? false,
    });
    return { outcome: 'asked', category: null };
  }

  #confirmation(
    txs: PocketTransaction[], factory: TransactionFactory, book: PocketBook, ws: Workspace,
    from: AccountChoice, to: AccountChoice | null, category: Category | null,
  ): string {
    const [tx, inLeg] = txs;
    const money = (t: PocketTransaction) => factory.money.format(t.amount, t.currency);
    const parts = tx.type === 'transfer'
      ? [
        `🔁 ${money(tx)} ${from.account.name} → ${to!.account.name}` + (inLeg.currency !== tx.currency ? ` (received ${money(inLeg)})` : ''),
        tx.note || null,
        from.access.isOwn ? null : `shared by ${from.access.label}`,
      ]
      : [
        `✅ ${tx.type === 'income' ? '+' : ''}${money(tx)}`,
        tx.note || null,
        category ? `🏷 ${book.categoryPath(category)}` : null,
        tx.paymentType,
        ws.label(from),
      ];
    const when = `${tx.date} · ${factory.hijri.label(tx.hijriDate)}`;
    const pending = from.access.isOwn ? '' : '\nIt will appear once the owner\'s app syncs.';
    return `${parts.filter(Boolean).join(' · ')}\n${when}${pending}`;
  }

  static #entryButtons(seed: number, ownerId: string): Keyboard {
    return [[
      { text: '✏️ Edit', callback_data: `edit:${seed}:${ownerId}` },
      { text: '🗑 Delete', callback_data: `del:${seed}:${ownerId}` },
    ]];
  }
}
