/**
 * EntryEditor — the ✏️ Edit menu under each entry (owner, 19 Nov 2026).
 *
 * ✏️ Edit turns the confirmation's buttons into a menu:
 *
 *   Amount · Account · Category        (a transfer: Amount · From · To)
 *   Date · Note                         (a transfer: Date · Note)
 *   🗑 Delete · ✓ Done
 *
 * Account, category, payment type and date are picked with buttons right in
 * the confirmation; amount, note and date can be typed. Each change rewrites
 * the entry's own rows (same ids) and the confirmation updates in place, with
 * the menu still open. Delete asks once more. Nothing else in the entry is
 * touched: who entered it, when, and any "will be paid back" mark stay.
 *
 * The entry is read back with pocket_bot_entry, by the ids derived from this
 * chat and the message that made it — only entries made in this chat.
 * The sharing rules are the writer's: a member may change their own entries
 * on an account they can add to, anyone else's needs edit (delete: full).
 *
 * Callback data (≤ 64 bytes):
 *   ed:<action>:<seed>:<owner>   menu actions (m menu, o done, x/y delete,
 *                                a amount, A account / from, T to, c category,
 *                                d date, n note, p payment type)
 *   ef:<kind>:<value>            a pick in the open field (the entry is in the
 *                                chat's pending step): A/T account id, m main
 *                                category, c subcategory, B all categories,
 *                                p payment type #, d days ago
 */
import { EntryParser, type ParsedEntry } from './EntryParser.ts';
import type { EntryService } from './EntryService.ts';
import type { ExchangeRates } from './ExchangeRates.ts';
import type { LocalClock } from './LocalClock.ts';
import type { Account, Category } from './PocketBook.ts';
import type { BotStep, PocketStore, TelegramLink } from './PocketStore.ts';
import type { Keyboard, TelegramClient } from './TelegramClient.ts';
import { type PocketTransaction, TransactionFactory } from './TransactionFactory.ts';
import { type BookAccess, Workspace } from './Workspace.ts';
import type { TelegramCallback } from './BotController.ts';

type FieldStep = Extract<BotStep, { kind: 'field' }>;
type Row = PocketTransaction & Record<string, unknown>;

/** An entry as stored, with what it points at. */
interface Loaded {
  ws: Workspace;
  access: BookAccess;
  rows: Row[];
  main: Row;              // the expense/income row, or a transfer's out leg
  inLeg: Row | null;      // a transfer's in leg
}

export class EntryEditor {
  static readonly #MAX_BUTTONS = 40;
  static readonly #LABELS: Record<string, string> = {
    a: 'amount', A: 'account', T: 'account it went to', c: 'category', d: 'date', n: 'note', p: 'payment type',
  };

  readonly #store: PocketStore;
  readonly #telegram: TelegramClient;
  readonly #entries: EntryService;
  readonly #clock: LocalClock;
  readonly #rates: ExchangeRates;

  constructor(store: PocketStore, telegram: TelegramClient, entries: EntryService, clock: LocalClock, rates: ExchangeRates) {
    this.#store = store;
    this.#telegram = telegram;
    this.#entries = entries;
    this.#clock = clock;
    this.#rates = rates;
  }

  static isButton(data?: string): boolean {
    return /^e[df]:/.test(data ?? '');
  }

  /** The single button under a confirmation. */
  static closed(seed: number, owner: string): Keyboard {
    return [[{ text: '✏️ Edit', callback_data: `ed:m:${seed}:${owner}` }]];
  }

  async handleCallback(cb: TelegramCallback, link: TelegramLink): Promise<void> {
    const msg = cb.message!;
    const chatId = msg.chat.id;
    const data = cb.data ?? '';
    if (data.startsWith('ef:')) return await this.#pick(cb, link);

    const [, action, seedText, owner = link.user_id] = data.split(':');
    const seed = Number(seedText);
    const text = msg.text ?? '';
    if (action === 'o') {
      await this.#dropStep(chatId);
      await this.#telegram.answer(cb.id);
      return void await this.#telegram.edit(chatId, msg.message_id, EntryEditor.#withoutQuestion(text), EntryEditor.closed(seed, owner));
    }
    if (action === 'y') {
      await this.#dropStep(chatId);
      const done = await this.#entries.remove(link, chatId, seed, owner, msg.message_id, EntryEditor.#withoutQuestion(text));
      return void await this.#telegram.answer(cb.id, done ? 'Deleted' : 'Already removed');
    }

    const loaded = await this.#load(link, chatId, seed, owner);
    if (!loaded) {
      await this.#telegram.answer(cb.id, 'This entry is no longer there');
      return void await this.#telegram.edit(chatId, msg.message_id, `🗑 No longer there: ${EntryEditor.#withoutQuestion(text).split('\n')[0]}`);
    }
    const isTransfer = loaded.main.type === 'transfer';
    await this.#telegram.answer(cb.id);

    if (action === 'm') {
      await this.#dropStep(chatId);
      return void await this.#telegram.edit(chatId, msg.message_id, EntryEditor.#withoutQuestion(text), EntryEditor.#menu(seed, owner, isTransfer));
    }
    if (action === 'x') {
      return void await this.#telegram.edit(chatId, msg.message_id, `${EntryEditor.#withoutQuestion(text)}\n\n🗑 Delete this entry?`, [[
        { text: '🗑 Yes, delete', callback_data: `ed:y:${seed}:${owner}` },
        { text: 'Keep it', callback_data: `ed:m:${seed}:${owner}` },
      ]]);
    }

    const step: FieldStep = { kind: 'field', field: action, seed, owner, message: msg.message_id, prompt: null };
    const back = [{ text: '« Back', callback_data: `ed:m:${seed}:${owner}` }];
    const shown = EntryEditor.#withoutQuestion(text);

    if (action === 'a' || action === 'n' || action === 'd') {
      const ask = action === 'a'
        ? `Type the new amount${isTransfer ? ' (what left the first account)' : ''}, e.g. 450`
        : action === 'n'
          ? 'Type the new note. Send a single - to clear it.'
          : 'Pick the date, or type one: yesterday, 8/11 or 8/11/2026.';
      if (action === 'd') {
        await this.#telegram.edit(chatId, msg.message_id, `${shown}\n\n📅 ${ask}`, [
          [{ text: 'Today', callback_data: 'ef:d:0' }, { text: 'Yesterday', callback_data: 'ef:d:1' }, { text: '2 days ago', callback_data: 'ef:d:2' }],
          back,
        ]);
      }
      step.prompt = await this.#telegram.send(chatId, `✏️ ${ask}\nSend /cancel to keep it as it is.`,
        { replyTo: msg.message_id, forceReply: EntryEditor.#LABELS[action] });
      return void await this.#saveStep(chatId, step);
    }

    if (action === 'A' || action === 'T') {
      const keep = action === 'A' ? String(loaded.main.accountId) : String(loaded.inLeg?.accountId ?? '');
      const other = action === 'A' ? String(loaded.inLeg?.accountId ?? '') : String(loaded.main.accountId);
      const options = loaded.access.accounts.filter((a) => a.id !== keep && (!isTransfer || a.id !== other));
      if (!options.length) return void await this.#telegram.send(chatId, 'There is no other account in this book to move it to.', { replyTo: msg.message_id });
      await this.#saveStep(chatId, step);
      return void await this.#telegram.edit(chatId, msg.message_id, `${shown}\n\n🏦 Which account${action === 'T' ? ' did it go to' : ''}?`,
        [...EntryEditor.#pairs(options.slice(0, EntryEditor.#MAX_BUTTONS).map((a) => ({ text: a.name, callback_data: `ef:${action}:${a.id}` }))), back]);
    }

    if (action === 'c') {
      if (isTransfer) return;
      await this.#saveStep(chatId, step);
      return void await this.#showMains(chatId, msg.message_id, shown, loaded, back);
    }

    if (action === 'p') {
      if (isTransfer) return;
      const types = loaded.access.book.paymentTypes;
      await this.#saveStep(chatId, step);
      return void await this.#telegram.edit(chatId, msg.message_id, `${shown}\n\n💳 How was it paid?`,
        [...EntryEditor.#pairs(types.map((t, i) => ({ text: t, callback_data: `ef:p:${i}` }))), back]);
    }
  }

  /**
   * A typed answer while a field is open (amount, note, date, or a category name).
   */
  async answer(link: TelegramLink, chatId: number, step: FieldStep, text: string, messageId: number): Promise<void> {
    const loaded = await this.#load(link, chatId, step.seed, step.owner);
    if (!loaded) {
      await this.#dropStep(chatId);
      return void await this.#telegram.reply(chatId, 'That entry is no longer there. Nothing was changed.', messageId);
    }
    const value = text.trim();
    let change: ((e: Editable) => string | null);
    if (step.field === 'a') {
      const m = /^(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)$/i.exec(value);
      const amount = m ? Number(m[1].replace(/,/g, '')) : NaN;
      if (!(amount > 0)) return void await this.#telegram.reply(chatId, 'Type just the amount, e.g. 450. Or /cancel.', messageId);
      change = (e) => { e.entry.amount = amount; e.entry.receivedAmount = null; return null; };
    } else if (step.field === 'n') {
      const note = value === '-' ? '' : value.replace(/\s+/g, ' ').slice(0, 200);
      change = (e) => { e.entry.note = note; return null; };
    } else if (step.field === 'd') {
      const parsed = new EntryParser([]).parse(`1 ${value}`);
      if (!parsed.ok) return void await this.#telegram.reply(chatId, `${parsed.reason}\nOr /cancel.`, messageId);
      const { date, daysAgo } = parsed.entry;
      if (!date && !daysAgo && !/^today$/i.test(value)) {
        return void await this.#telegram.reply(chatId, 'Type a date like yesterday, 8/11 or 8/11/2026. Or /cancel.', messageId);
      }
      const when = date ? date.resolve(this.#clock.isoDate()) : { ok: true as const, iso: this.#clock.isoDate(daysAgo) };
      if (!when.ok) return void await this.#telegram.reply(chatId, `${when.reason}\nOr /cancel.`, messageId);
      change = (e) => { e.date = when.iso; return null; };
    } else if (step.field === 'c') {
      const book = loaded.access.book;
      const found = book.resolveCategory(value, String(loaded.main.type));
      if (found.kind !== 'sub') {
        return void await this.#telegram.reply(chatId,
          found.kind === 'main' ? `${found.main.name} is a main category — tap one of its subcategories above.` : `${found.reason.split('\n')[0]} Tap one above, or /cancel.`, messageId);
      }
      change = (e) => { e.category = found.value; return null; };
    } else {
      return void await this.#telegram.reply(chatId, 'Tap one of the buttons above, or /cancel.', messageId);
    }
    await this.#apply(link, chatId, step, loaded, change);
  }

  // ── picks with buttons ────────────────────────────────────────────────

  async #pick(cb: TelegramCallback, link: TelegramLink): Promise<void> {
    const msg = cb.message!;
    const chatId = msg.chat.id;
    const pending = await this.#store.getPending(chatId);
    const step = pending?.step?.kind === 'field' ? pending.step : null;
    if (!step || step.message !== msg.message_id) return void await this.#telegram.answer(cb.id, 'This choice has expired. Tap ✏️ Edit again.');
    const loaded = await this.#load(link, chatId, step.seed, step.owner);
    if (!loaded) {
      await this.#dropStep(chatId);
      return void await this.#telegram.answer(cb.id, 'This entry is no longer there');
    }
    const [, kind, ...rest] = (cb.data ?? '').split(':');
    const value = rest.join(':');
    const book = loaded.access.book;
    const back = [{ text: '« Back', callback_data: `ed:m:${step.seed}:${step.owner}` }];
    const shown = EntryEditor.#withoutQuestion(msg.text ?? '');
    await this.#telegram.answer(cb.id);

    if (kind === 'B') return void await this.#showMains(chatId, msg.message_id, shown, loaded, back);
    if (kind === 'm') {
      const subs = book.subcategories(value, String(loaded.main.type));
      const main = book.categoryById(value);
      return void await this.#telegram.edit(chatId, msg.message_id, `${shown}\n\n🏷 ${main?.name ?? 'Category'} — which one? Or type a name.`, [
        ...EntryEditor.#pairs(subs.slice(0, EntryEditor.#MAX_BUTTONS).map((c) => ({ text: c.name, callback_data: `ef:c:${c.id}` }))),
        [{ text: '⬅️ All categories', callback_data: 'ef:B:' }], back,
      ]);
    }

    let change: (e: Editable) => string | null;
    if (kind === 'c') {
      const cat = book.categoryById(value);
      if (!cat || book.isMain(cat)) return;
      change = (e) => { e.category = cat; return null; };
    } else if (kind === 'A' || kind === 'T') {
      const acc = loaded.access.accounts.find((a) => a.id === value);
      if (!acc) return void await this.#telegram.send(chatId, 'You can no longer add to that account.', { replyTo: msg.message_id });
      change = (e) => {
        if (kind === 'A') e.account = acc; else e.toAccount = acc;
        if (e.toAccount && e.account.id === e.toAccount.id) return 'Pick two different accounts.';
        e.entry.receivedAmount = null; // a new pair of currencies: the live rate applies
        return null;
      };
    } else if (kind === 'p') {
      const type = book.paymentTypes[Number(value)];
      if (!type) return;
      change = (e) => { e.entry.paymentType = type; return null; };
    } else if (kind === 'd') {
      const iso = this.#clock.isoDate(Number(value) || 0);
      change = (e) => { e.date = iso; return null; };
    } else {
      return;
    }
    await this.#apply(link, chatId, step, loaded, change);
  }

  async #showMains(chatId: number, messageId: number, shown: string, loaded: Loaded, back: { text: string; callback_data: string }[]): Promise<void> {
    const book = loaded.access.book;
    const mains = book.mainCategories(String(loaded.main.type));
    await this.#telegram.edit(chatId, messageId, `${shown}\n\n🏷 Which category? Tap one, or type a name.`, [
      ...EntryEditor.#pairs(mains.slice(0, EntryEditor.#MAX_BUTTONS).map((c) => ({ text: `${c.name} ›`, callback_data: `ef:m:${c.id}` }))),
      back,
    ]);
  }

  // ── changing the entry ────────────────────────────────────────────────

  /** Rebuilds the entry with one change, saves it over the same ids, and refreshes the confirmation. */
  async #apply(link: TelegramLink, chatId: number, step: FieldStep, loaded: Loaded, change: (e: Editable) => string | null): Promise<void> {
    const { access, main, inLeg, ws } = loaded;
    const book = access.book;
    const splits: unknown = (main as Record<string, unknown>).splits;
    if (Array.isArray(splits) && splits.length) {
      await this.#dropStep(chatId);
      return void await this.#telegram.send(chatId, 'This entry is split across categories. Change it in the Pocket app.', { replyTo: step.message });
    }
    const account = access.accounts.find((a) => a.id === main.accountId);
    const toAccount = inLeg ? access.accounts.find((a) => a.id === inLeg.accountId) ?? null : null;
    if (!account || (inLeg && !toAccount)) {
      await this.#dropStep(chatId);
      return void await this.#telegram.send(chatId, 'You can no longer add to this entry\'s account, so it can\'t be changed here.', { replyTo: step.message });
    }
    const factory = new TransactionFactory(book, await this.#rates.current(book.fxRates));
    const major = (minor: number, ccy: string) => minor / factory.money.factor(ccy);
    const editable: Editable = {
      entry: {
        type: main.type as ParsedEntry['type'],
        amount: major(Number(main.amount), String(main.currency)),
        note: String(main.note ?? ''),
        paymentType: main.type === 'transfer' ? null : String(main.paymentType ?? '') || null,
        accountHint: null, toAccountHint: null,
        receivedAmount: inLeg && inLeg.currency !== main.currency ? major(Number(inLeg.amount), String(inLeg.currency)) : null,
        categoryHint: null, daysAgo: 0, date: null,
      },
      account, toAccount,
      category: main.categoryId ? book.categoryById(String(main.categoryId)) : null,
      date: String(main.date),
    };
    const show = (e: Editable) => EntryEditor.#value(step.field, e, book, factory.money);
    const before = show(editable);
    const problem = change(editable);
    if (problem) return void await this.#telegram.send(chatId, problem, { replyTo: step.message });
    if (editable.entry.type !== 'transfer' && !editable.category) {
      return void await this.#telegram.send(chatId, 'Pick a category first.', { replyTo: step.message });
    }

    const built = await factory.build({
      chatId, messageId: step.seed, entry: editable.entry, account: editable.account, toAccount: editable.toAccount,
      category: editable.category, date: editable.date, addedBy: (main.addedBy as string | null) ?? link.email,
    });
    // Keep everything the change doesn't touch: who entered it and when, tags, a "will be paid back" mark …
    const byId = new Map(loaded.rows.map((r) => [r.id, r]));
    const txs = built.map((t) => {
      const old = byId.get(t.id) ?? main;
      return {
        ...old, ...t,
        createdAt: (old.createdAt as string) ?? t.createdAt,
        tags: Array.isArray(old.tags) ? old.tags as string[] : t.tags,
        payee: t.type === 'transfer' ? t.payee : String(old.payee ?? ''),
      } as PocketTransaction;
    });
    const ids = await TransactionFactory.allIdsFor(chatId, step.seed);
    await this.#store.writerFor(access.ownerId, link.email, access.isOwn).replace(ids, txs);
    await this.#dropStep(chatId);
    // The prompt message (typed fields) is no longer needed once answered.
    if (step.prompt) await this.#telegram.edit(chatId, step.prompt, `✓ ${EntryEditor.#LABELS[step.field] ?? 'entry'} changed`).catch(() => {});

    const from = { access, account: editable.account };
    const to = editable.toAccount ? { access, account: editable.toAccount } : null;
    const text = this.#entries.confirmation(txs, factory, book, ws, from, to, editable.category)
      + `\n✏️ ${EntryEditor.#capital(EntryEditor.#LABELS[step.field] ?? 'entry')} changed`;
    await this.#telegram.edit(chatId, step.message, text, EntryEditor.#menu(step.seed, step.owner, editable.entry.type === 'transfer'));
    // A new message too, so the change is seen in the chat, not only in the entry above.
    const after = show(editable);
    await this.#telegram.send(chatId,
      `✅ ${EntryEditor.#capital(EntryEditor.#LABELS[step.field] ?? 'entry')} changed${before !== after ? `: ${before || '—'} → ${after || '—'}` : ''}`,
      { replyTo: step.message });
  }

  /** One field of the entry, as the person sees it (for "Amount changed: ₹450 → ₹650"). */
  static #value(field: string, e: Editable, book: BookAccess['book'], money: { format(minor: number, ccy: string): string; toMinor(major: number, ccy: string): number }): string {
    const ccy = e.account.currency;
    switch (field) {
      case 'a': return money.format(money.toMinor(e.entry.amount, ccy), ccy);
      case 'A': return e.account.name;
      case 'T': return e.toAccount?.name ?? '';
      case 'c': return e.category ? book.categoryPath(e.category) : '';
      case 'd': return e.date;
      case 'n': return e.entry.note ? `“${e.entry.note}”` : '';
      default: return '';
    }
  }

  /** The entry's rows and the book they're in, or null if it's gone (or no longer reachable). */
  async #load(link: TelegramLink, chatId: number, seed: number, owner: string): Promise<Loaded | null> {
    const ws = await Workspace.load(this.#store, link);
    const access = ws.access(owner);
    if (!access) throw new Error('You no longer have access to change this entry.');
    const rows = await this.#store.botEntry(owner, await TransactionFactory.allIdsFor(chatId, seed)) as Row[];
    if (!rows.length) return null;
    const main = rows.find((r) => r.transferDir !== 'in') ?? rows[0];
    const inLeg = rows.find((r) => r.transferDir === 'in') ?? null;
    if (Array.isArray(main.tags) && (main.tags as string[]).some((t) => ['debt', 'debt-payment', 'reimbursement'].includes(t))) {
      throw new Error('Loans and paybacks are changed with their own buttons, or in the Pocket app.');
    }
    return { ws, access, rows, main, inLeg };
  }

  async #saveStep(chatId: number, step: FieldStep): Promise<void> {
    await this.#store.setPending(chatId, {
      kind: 'edit', seed_message_id: step.seed, source_text: null, replace: true,
      prompt_message_id: step.prompt ?? null, confirm_message_id: step.message, owner_id: step.owner,
      queue: [], shared: false, step,
    });
  }

  /** Clears an open field (only a field step; other waiting steps stay). */
  async #dropStep(chatId: number): Promise<void> {
    const pending = await this.#store.getPending(chatId);
    if (pending?.step?.kind === 'field') await this.#store.clearPending(chatId);
  }

  static #menu(seed: number, owner: string, transfer: boolean): Keyboard {
    const b = (text: string, a: string) => ({ text, callback_data: `ed:${a}:${seed}:${owner}` });
    return transfer
      ? [[b('Amount', 'a'), b('From', 'A'), b('To', 'T')], [b('Date', 'd'), b('Note', 'n')], [b('🗑 Delete', 'x'), b('✓ Done', 'o')]]
      : [[b('Amount', 'a'), b('Account', 'A'), b('Category', 'c')], [b('Date', 'd'), b('Note', 'n')], [b('🗑 Delete', 'x'), b('✓ Done', 'o')]];
  }

  static #pairs<T>(items: T[]): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += 2) out.push(items.slice(i, i + 2));
    return out;
  }

  /** The confirmation without a question the menu added under it. */
  static #withoutQuestion(text: string): string {
    return text.split('\n\n')[0];
  }

  static #capital(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}

/** What a change may touch. */
interface Editable {
  entry: ParsedEntry;
  account: Account;
  toAccount: Account | null;
  category: Category | null;
  date: string;
}

