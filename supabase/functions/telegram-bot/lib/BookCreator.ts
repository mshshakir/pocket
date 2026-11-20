/**
 * BookCreator — new accounts and categories from Telegram (owner, 19 Nov 2026).
 * Only in the person's OWN book: in a shared book the owner keeps control.
 *
 *   /newaccount                      name → type → currency → starting balance
 *   /newaccount HDFC Savings bank    straight away (home currency, no balance)
 *   /newcategory                     spending or received → main → name
 *   /newcategory Petrol              asks spending/received and the main, then saves
 *   ➕ New "Petrol"                  offered when a typed @category matches nothing;
 *                                    the waiting entry is saved with it
 *
 * Rows are written like the app writes them (pocket_apply_changes), so they
 * reach the app on its next sync. A starting balance is an "Opening balance"
 * entry, as the app records it.
 *
 * Callback data: na:t:<type> · na:c:<CCY|other> · na:b:0 ·
 *                nc:t:<expense|income> · nc:m:<mainId|new> · nc:e: (➕ New from the picker)
 */
import type { EntryService } from './EntryService.ts';
import type { ExchangeRates } from './ExchangeRates.ts';
import type { LocalClock } from './LocalClock.ts';
import { type Category, PocketBook } from './PocketBook.ts';
import type { BotStep, PendingStep, PocketStore, TelegramLink, WaitingEntry } from './PocketStore.ts';
import type { Keyboard, TelegramClient } from './TelegramClient.ts';
import { TransactionFactory } from './TransactionFactory.ts';
import { type BookAccess, Workspace } from './Workspace.ts';
import type { TelegramCallback } from './BotController.ts';

type AccountStep = Extract<BotStep, { kind: 'newaccount' }>;
type CategoryStep = Extract<BotStep, { kind: 'newcategory' }>;

export class BookCreator {
  /** The app's account types (data/constants ACCOUNT_TYPES), with the words people use for them. */
  static readonly TYPES: { id: string; label: string; icon: string; color: string; words: string[] }[] = [
    { id: 'bank', label: 'Bank', icon: 'landmark', color: '#3b82f6', words: ['bank', 'current', 'salary'] },
    { id: 'cash', label: 'Cash', icon: 'wallet', color: '#10b981', words: ['cash', 'wallet', 'purse'] },
    { id: 'card', label: 'Credit card', icon: 'credit-card', color: '#ef4444', words: ['card', 'credit', 'creditcard'] },
    { id: 'savings', label: 'Savings', icon: 'vault', color: '#8b5cf6', words: ['savings', 'saving'] },
    { id: 'invest', label: 'Investment', icon: 'trending-up', color: '#f59e0b', words: ['investment', 'invest', 'demat', 'gold'] },
  ];

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
    return /^n[ac]:/.test(data ?? '');
  }

  // ── /newaccount ───────────────────────────────────────────────────────

  async newAccount(link: TelegramLink, chatId: number, messageId: number, argument: string): Promise<void> {
    const own = await this.#own(link, chatId, messageId);
    if (!own) return;
    const words = argument.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      await this.#save(chatId, messageId, { kind: 'newaccount', at: 'name' });
      return void await this.#telegram.send(chatId, '🏦 New account — what is it called? (e.g. HDFC Savings)\nSend /cancel to stop.',
        { replyTo: messageId, forceReply: 'Account name' });
    }
    const last = words[words.length - 1].toLowerCase();
    const type = words.length > 1 ? BookCreator.TYPES.find((t) => t.words.includes(last) || t.id === last) : undefined;
    const name = (type ? words.slice(0, -1) : words).join(' ');
    if (!type) return void await this.#askType(chatId, messageId, { kind: 'newaccount', at: 'name', name });
    await this.#createAccount(link, chatId, messageId, own, name, type.id, own.book.homeCurrency, 0);
  }

  // ── /newcategory ──────────────────────────────────────────────────────

  async newCategory(link: TelegramLink, chatId: number, messageId: number, argument: string): Promise<void> {
    if (!(await this.#own(link, chatId, messageId))) return;
    const name = BookCreator.#clean(argument);
    await this.#save(chatId, messageId, { kind: 'newcategory', at: 'type', name: name || undefined });
    await this.#telegram.send(chatId, `🏷 New category${name ? ` “${name}”` : ''} — for spending or money received?`, {
      replyTo: messageId,
      keyboard: [[{ text: '💸 Spending', callback_data: 'nc:t:expense' }, { text: '💰 Money received', callback_data: 'nc:t:income' }]],
    });
  }

  /** A typed answer to a step of /newaccount or /newcategory. */
  async answer(link: TelegramLink, chatId: number, pending: PendingStep, text: string, messageId: number): Promise<void> {
    const step = pending.step!;
    const value = text.trim();
    if (step.kind === 'newaccount') {
      if (step.at === 'name') {
        const name = value.replace(/\s+/g, ' ').slice(0, 60);
        if (!name) return;
        return void await this.#askType(chatId, messageId, { kind: 'newaccount', at: 'name', name });
      }
      if (step.at === 'currency') {
        const ccy = value.toUpperCase();
        if (!/^[A-Z]{3}$/.test(ccy)) return void await this.#telegram.reply(chatId, 'Type a 3-letter currency code, e.g. USD or AED. Or /cancel.', messageId);
        return void await this.#askBalance(chatId, messageId, { ...step, at: 'balance', currency: ccy });
      }
      if (step.at === 'balance') {
        const m = /^(-)?(?:₹|rs\.?)?\s*(\d[\d,]*(?:\.\d+)?)$/i.exec(value);
        if (!m) return void await this.#telegram.reply(chatId, 'Type the starting balance, e.g. 25000 (or -5000 if you owe on a card), or tap Skip. Or /cancel.', messageId);
        const own = await this.#own(link, chatId, messageId);
        if (!own) return;
        const amount = Number(m[2].replace(/,/g, '')) * (m[1] ? -1 : 1);
        return void await this.#createAccount(link, chatId, messageId, own, step.name!, step.type!, step.currency!, amount, pending.seed_message_id);
      }
    }
    if (step.kind === 'newcategory') {
      const name = BookCreator.#clean(value);
      if (!name) return;
      if (step.at === 'mainname') {
        if (step.name) return void await this.#createCategory(link, chatId, messageId, { ...step, mainId: null, mainName: name }, step.name);
        await this.#save(chatId, pending.seed_message_id, { ...step, at: 'name', mainId: null, mainName: name });
        return void await this.#telegram.send(chatId, `And the subcategory under ${name}? (e.g. Petrol)`, { replyTo: messageId, forceReply: 'Subcategory name' });
      }
      if (step.at === 'name') return void await this.#createCategory(link, chatId, messageId, step, name);
      await this.#telegram.reply(chatId, 'Tap one of the buttons above, or /cancel.', messageId);
    }
  }

  async handleCallback(cb: TelegramCallback, link: TelegramLink): Promise<void> {
    const msg = cb.message!;
    const chatId = msg.chat.id;
    const [kind, what, ...rest] = (cb.data ?? '').split(':');
    const value = rest.join(':');
    const pending = await this.#store.getPending(chatId);

    // ➕ New from the category picker: the entry waiting there gets the new category.
    if (kind === 'nc' && what === 'e') {
      const offer = pending?.kind === 'category' && pending.step?.kind === 'newcategory' && pending.step.at === 'offer' ? pending.step : null;
      if (!offer || !pending?.source_text || pending.prompt_message_id !== msg.message_id) {
        return void await this.#telegram.answer(cb.id, 'This choice has expired. Send the entry again.');
      }
      await this.#telegram.answer(cb.id);
      const entry: WaitingEntry = {
        seed: pending.seed_message_id, text: pending.source_text, replace: pending.replace, owner: pending.owner_id,
        prompt: pending.prompt_message_id, confirm: pending.confirm_message_id, queue: pending.queue ?? [], shared: pending.shared ?? false,
      };
      const type: 'expense' | 'income' = /^\s*\+/.test(pending.source_text) ? 'income' : 'expense';
      return void await this.#askMain(link, chatId, msg.message_id, { kind: 'newcategory', at: 'main', type, name: offer.name, entry }, true);
    }

    const step = pending?.kind === 'edit' ? pending.step : null;
    if (kind === 'na' && step?.kind === 'newaccount') {
      await this.#telegram.answer(cb.id);
      if (what === 't') {
        const type = BookCreator.TYPES.find((t) => t.id === value);
        if (!type) return;
        await this.#telegram.edit(chatId, msg.message_id, `🏦 ${step.name} · ${type.label}`);
        return void await this.#askCurrency(link, chatId, msg.message_id, { ...step, type: type.id });
      }
      if (what === 'c') {
        if (value === 'other') {
          await this.#save(chatId, pending!.seed_message_id, { ...step, at: 'currency' });
          return void await this.#telegram.send(chatId, 'Type the currency code, e.g. USD or AED.', { replyTo: msg.message_id, forceReply: 'Currency' });
        }
        await this.#telegram.edit(chatId, msg.message_id, `🏦 ${step.name} · ${value}`);
        return void await this.#askBalance(chatId, msg.message_id, { ...step, at: 'balance', currency: value });
      }
      if (what === 'b') {
        const own = await this.#own(link, chatId, msg.message_id);
        if (!own) return;
        await this.#telegram.edit(chatId, msg.message_id, `🏦 ${step.name} · no starting balance`);
        return void await this.#createAccount(link, chatId, msg.message_id, own, step.name!, step.type!, step.currency!, 0, pending!.seed_message_id);
      }
    }
    if (kind === 'nc' && step?.kind === 'newcategory') {
      await this.#telegram.answer(cb.id);
      if (what === 't') {
        const type = value === 'income' ? 'income' : 'expense';
        await this.#telegram.edit(chatId, msg.message_id, `🏷 New ${type === 'income' ? 'money-received' : 'spending'} category${step.name ? ` “${step.name}”` : ''}`);
        return void await this.#askMain(link, chatId, msg.message_id, { ...step, at: 'main', type }, false);
      }
      if (what === 'm') {
        if (value === 'new') {
          await this.#save(chatId, pending!.seed_message_id, { ...step, at: 'mainname' });
          return void await this.#telegram.send(chatId, 'What is the new main category called? (e.g. Car)', { replyTo: msg.message_id, forceReply: 'Main category name' });
        }
        const own = await this.#own(link, chatId, msg.message_id);
        const main = own?.book.categoryById(value);
        if (!own || !main) return;
        const next: CategoryStep = { ...step, at: 'name', mainId: main.id, mainName: main.name };
        if (step.name) return void await this.#createCategory(link, chatId, msg.message_id, next, step.name);
        await this.#save(chatId, pending!.seed_message_id, next);
        return void await this.#telegram.send(chatId, `Name of the new category under ${main.name}? (e.g. Petrol)`, { replyTo: msg.message_id, forceReply: 'Category name' });
      }
    }
    await this.#telegram.answer(cb.id, 'This choice has expired. Start again.');
  }

  // ── steps ─────────────────────────────────────────────────────────────

  async #askType(chatId: number, replyTo: number, step: AccountStep): Promise<void> {
    await this.#save(chatId, replyTo, step);
    const buttons = BookCreator.TYPES.map((t) => ({ text: t.label, callback_data: `na:t:${t.id}` }));
    await this.#telegram.send(chatId, `🏦 What kind of account is “${step.name}”?`, {
      replyTo, keyboard: [buttons.slice(0, 3), buttons.slice(3)],
    });
  }

  async #askCurrency(link: TelegramLink, chatId: number, replyTo: number, step: AccountStep): Promise<void> {
    const own = await this.#own(link, chatId, replyTo);
    if (!own) return;
    const home = own.book.homeCurrency;
    const used = [...new Set(own.book.accounts.map((a) => a.currency).filter((c) => c && c !== home))].slice(0, 3);
    await this.#save(chatId, replyTo, { ...step, at: 'currency' });
    await this.#telegram.send(chatId, 'Which currency?', {
      replyTo, keyboard: [[home, ...used].map((c) => ({ text: c, callback_data: `na:c:${c}` })), [{ text: 'Other…', callback_data: 'na:c:other' }]],
    });
  }

  async #askBalance(chatId: number, replyTo: number, step: AccountStep): Promise<void> {
    await this.#save(chatId, replyTo, step);
    await this.#telegram.send(chatId, `Starting balance in ${step.currency}? Type it (e.g. 25000, or -5000 if you owe on a card), or tap Skip.`, {
      replyTo, keyboard: [[{ text: 'Skip (start at 0)', callback_data: 'na:b:0' }]],
    });
  }

  async #askMain(link: TelegramLink, chatId: number, replyTo: number, step: CategoryStep, editInPlace: boolean): Promise<void> {
    const own = await this.#own(link, chatId, replyTo);
    if (!own) return;
    const mains = own.book.mainsOfType(step.type ?? 'expense');
    const buttons: Keyboard = [];
    for (let i = 0; i < Math.min(mains.length, 40); i += 2) {
      buttons.push(mains.slice(i, i + 2).map((c) => ({ text: c.name, callback_data: `nc:m:${c.id}` })));
    }
    buttons.push([{ text: '➕ New main category', callback_data: 'nc:m:new' }]);
    // A ➕ New from the picker moves the pending entry into this step (kind 'edit' with a step).
    await this.#save(chatId, step.entry?.seed ?? replyTo, step);
    const text = `🏷 Where does ${step.name ? `“${step.name}”` : 'the new category'} go?`;
    if (editInPlace) await this.#telegram.edit(chatId, replyTo, text, buttons);
    else await this.#telegram.send(chatId, text, { replyTo, keyboard: buttons });
  }

  // ── writing ───────────────────────────────────────────────────────────

  async #createAccount(link: TelegramLink, chatId: number, replyTo: number, own: BookAccess, name: string, type: string, currency: string, balance: number, seed = replyTo): Promise<void> {
    await this.#store.clearPending(chatId);
    const book = own.book;
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (book.accounts.some((a) => PocketBook.squash(a.name) === PocketBook.squash(clean))) {
      return void await this.#telegram.reply(chatId, `You already have an account called “${clean}”. Nothing was added.`, replyTo);
    }
    const t = BookCreator.TYPES.find((x) => x.id === type) ?? BookCreator.TYPES[0];
    const account = {
      id: await BookCreator.#id('acc', chatId, seed), name: clean, type: t.id, currency,
      openingBalance: 0, balance: 0, color: t.color, icon: t.icon, archived: false, groupId: null,
      _pos: book.accounts.length,
    };
    const put: Record<string, unknown[]> = { accounts: [account] };
    if (balance !== 0) {
      const factory = new TransactionFactory(book, await this.#rates.current(book.fxRates));
      const [tx] = await factory.build({
        chatId, messageId: seed,
        entry: { type: balance > 0 ? 'income' : 'expense', amount: Math.abs(balance), note: '', paymentType: 'cash', accountHint: null, toAccountHint: null, receivedAmount: null, categoryHint: null, daysAgo: 0, date: null },
        account: { id: account.id, name: clean, currency }, toAccount: null, category: null, date: this.#clock.isoDate(), addedBy: link.email,
      });
      put.transactions = [{ ...tx, id: await BookCreator.#id('tx', chatId, seed), payee: 'Opening balance', tags: ['opening-balance'] }];
    }
    await this.#store.applyOwn(own.ownerId, { put });
    const money = new TransactionFactory(book, {}).money;
    await this.#telegram.send(chatId,
      `✅ Account added: ${clean} · ${t.label} · ${currency}${balance !== 0 ? ` · starting balance ${money.format(money.toMinor(balance, currency), currency)}` : ''}\n`
      + `Use it with #${PocketBook.squash(clean)}, or make it the default with /default ${PocketBook.squash(clean)}. It shows in the app after it syncs.`,
      { replyTo });
  }

  async #createCategory(link: TelegramLink, chatId: number, replyTo: number, step: CategoryStep, name: string): Promise<void> {
    const own = await this.#own(link, chatId, replyTo);
    if (!own) return;
    await this.#store.clearPending(chatId);
    const book = own.book;
    const type = step.type ?? 'expense';
    const seed = step.entry?.seed ?? replyTo;
    let main: Category | null = step.mainId ? book.categoryById(step.mainId) : null;
    const put: Record<string, unknown>[] = [];
    if (!main) {
      const mainName = BookCreator.#clean(step.mainName ?? '');
      if (!mainName) return;
      main = book.mainsOfType(type).find((c) => PocketBook.squash(c.name) === PocketBook.squash(mainName)) ?? null;
      if (!main) {
        main = { id: await BookCreator.#id('cat', chatId, seed, 'main'), name: mainName, type, parentId: null };
        put.push({ ...main, icon: 'tag', color: '#737373', budgetLimit: null });
      }
    }
    const existing = book.subcategories(main.id, type).find((c) => PocketBook.squash(c.name) === PocketBook.squash(name));
    let category: Category;
    if (existing) {
      category = existing;
    } else {
      const parent = main as Category & { icon?: string; color?: string };
      category = { id: await BookCreator.#id('cat', chatId, seed), name, type, parentId: main.id };
      put.push({ ...category, icon: parent.icon || 'tag', color: parent.color || '#737373', budgetLimit: null });
      await this.#store.applyOwn(own.ownerId, { put: { categories: put } });
    }

    const entry = step.entry;
    if (!entry) {
      return void await this.#telegram.send(chatId, existing
        ? `“${name}” is already under ${main.name}. Use it with @${PocketBook.squash(main.name + name)}.`
        : `✅ Category added: ${main.name} / ${name}\nUse it with @${PocketBook.squash(name)}. It shows in the app after it syncs.`, { replyTo });
    }
    // Save the entry that was waiting for it.
    await this.#entries.record({
      link, chatId, seed: entry.seed, text: entry.text, replace: entry.replace, oldOwnerId: entry.owner,
      categoryId: category.id, promptMessageId: entry.prompt, confirmMessageId: entry.confirm,
      queue: entry.queue, shared: entry.shared, replyTo,
    });
    if (!existing) await this.#telegram.send(chatId, `🏷 New category ${main.name} / ${name} added to your book.`);
  }

  /** The person's own book, if their plan lets them write to it here. */
  async #own(link: TelegramLink, chatId: number, replyTo: number): Promise<BookAccess | null> {
    const ws = await Workspace.load(this.#store, link);
    const own = ws.access(link.user_id);
    if (!own) {
      await this.#store.clearPending(chatId);
      await this.#telegram.reply(chatId, 'New accounts and categories go in your own book, which Telegram can\'t change on your plan. Add them in the Pocket app.', replyTo);
    }
    return own;
  }

  async #save(chatId: number, seed: number, step: BotStep): Promise<void> {
    await this.#store.setPending(chatId, {
      kind: 'edit', seed_message_id: seed, source_text: null, replace: false,
      prompt_message_id: null, confirm_message_id: null, owner_id: null, queue: [], shared: false, step,
    });
  }

  /** A stable id per chat and message, so a repeated update never adds twice. */
  static async #id(prefix: string, chatId: number, seed: number, extra = ''): Promise<string> {
    const bytes = new TextEncoder().encode(`telegram-new:${prefix}:${chatId}:${seed}:${extra}`);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return `${prefix}_${Array.from(hash.slice(0, 6), (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }

  static #clean(s: string): string {
    const t = s.replace(/^[@#]/, '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
  }
}
