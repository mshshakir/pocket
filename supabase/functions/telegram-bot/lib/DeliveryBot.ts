/**
 * DeliveryBot — pay-later items and bills in Telegram, for a person verified
 * by their linked private chat (in a group, the person who tapped):
 *
 *   check-in buttons   − / + change today's quantity; ✓ confirms for everyone
 *   typed changes      "no milk", "milk none", "milk x2", "milk 2 L", "no milk yesterday"
 *   /deliveries        today's check-in, with the buttons
 *   /dues              what's owed to each vendor, with "✓ Paid ₹…" per vendor
 *   bill reminders     "✓ Paid ₹…" (last time's amount) or "Skip this time";
 *                      "paid electricity 1950" records a different amount
 *
 * Every change goes through the server's own access check (pocket_delivery_apply)
 * or the same sharing rules as entries (BookWriter): owner, or a family member
 * with add access to the item's — or bill's — account.
 */
import { BillDates } from './BillDates.ts';
import { CheckinMessage } from './CheckinMessage.ts';
import { DeliveryDay, type DeliveryItem } from './DeliveryDay.ts';
import type { BillTemplate, DeliveryStore } from './DeliveryStore.ts';
import type { ExchangeRates } from './ExchangeRates.ts';
import { HijriCalendar } from './HijriCalendar.ts';
import type { LocalClock } from './LocalClock.ts';
import { Money } from './Money.ts';
import { PlanAccess } from './PlanAccess.ts';
import type { PocketStore, TelegramLink } from './PocketStore.ts';
import { Recipients } from './Recipients.ts';
import type { TelegramClient } from './TelegramClient.ts';
import type { PocketTransaction } from './TransactionFactory.ts';

interface Cb {
  id: string;
  from?: { id: number };
  data?: string;
  message?: { message_id: number; chat: { id: number; type?: string }; text?: string };
}

/**
 * One person acting: their link, their plan, and the books they may use here —
 * their own when their plan includes Telegram, and shared spaces their family
 * member's plan covers them in.
 */
interface Actor {
  link: TelegramLink;
  plan: PlanAccess;
  owners: string[];
}

export class DeliveryBot {
  static readonly #DAY_WORDS: Record<string, number> = { today: 0, yesterday: -1 };

  readonly #store: PocketStore;
  readonly #deliveries: DeliveryStore;
  readonly #telegram: TelegramClient;
  readonly #clock: LocalClock;
  readonly #rates: ExchangeRates;
  readonly #recipients: Recipients;

  constructor(store: PocketStore, deliveries: DeliveryStore, telegram: TelegramClient, clock: LocalClock, rates: ExchangeRates) {
    this.#store = store;
    this.#deliveries = deliveries;
    this.#telegram = telegram;
    this.#clock = clock;
    this.#rates = rates;
    this.#recipients = new Recipients(deliveries);
  }

  static isButton(data: string | undefined): boolean {
    return CheckinMessage.isButton(data) || /^(bp|bs|dp):/.test(data ?? '');
  }

  // ── buttons ─────────────────────────────────────────────────────────────

  async handleCallback(cb: Cb): Promise<void> {
    const data = cb.data ?? '';
    const actor = await this.#actor(cb.from?.id);
    if (!actor) return void await this.#telegram.answer(cb.id, 'Link your Telegram to Pocket first: send /link to the bot in a private chat.');
    if (!actor.owners.length) return void await this.#planNotice(cb, actor);
    try {
      if (CheckinMessage.isButton(data)) return void await this.#checkinTap(cb, actor);
      const [kind, ref, extra] = data.split(':');
      if (kind === 'bp' || kind === 'bs') return void await this.#billTap(cb, actor, Number(ref), kind === 'bp');
      if (kind === 'dp') return void await this.#duesTap(cb, actor, ref, extra);
      await this.#telegram.answer(cb.id);
    } catch (err) {
      console.error('[deliveries] callback', err);
      await this.#telegram.answer(cb.id, `⚠️ ${DeliveryBot.#reason(err)}`.slice(0, 190));
    }
  }

  async #checkinTap(cb: Cb, actor: Actor): Promise<void> {
    const tap = CheckinMessage.parse(cb.data ?? '');
    const checkin = tap ? await this.#deliveries.checkin(tap.checkinId) : null;
    if (!tap || !checkin) return void await this.#telegram.answer(cb.id, 'This check-in has expired.');
    if (checkin.answered_by) {
      // A copy can still show buttons if two taps crossed; tapping it puts it right.
      await this.#telegram.answer(cb.id, `Already confirmed by ${checkin.answered_by}`);
      return void await this.#redraw(checkin.id, checkin.owner_id, checkin.items, checkin.day);
    }
    if (!actor.owners.includes(checkin.owner_id)) return void await this.#planNotice(cb, actor);
    const items = await this.#checkinItems(checkin.owner_id, checkin.items);
    if (tap.index >= 0 && tap.step === 0) return void await this.#telegram.answer(cb.id, 'Use − or + to change it');

    const people = await this.#deliveries.people(checkin.owner_id, items[0]?.accountId ?? null);
    const name = Recipients.nameOf(people, actor.link.email);
    if (tap.index < 0) {
      if (!(await this.#mayAny(actor, checkin.owner_id, items))) return void await this.#telegram.answer(cb.id, 'You can only view these deliveries');
      if (!(await this.#deliveries.answer(checkin.id, name))) return void await this.#telegram.answer(cb.id, 'Someone already confirmed');
      // "That's right": each item that came that day is recorded as delivered (red in the app until paid).
      for (const it of items) {
        if (new DeliveryDay(it).qtyOn(checkin.day) <= 0) continue;
        if ((await this.#deliveries.access(actor.link.user_id, checkin.owner_id, it.accountId)) < 1) continue;
        await this.#deliveries.change(actor.link.user_id, checkin.owner_id, it.id, { confirm: checkin.day });
      }
      await this.#telegram.answer(cb.id, 'Thanks — saved');
      return void await this.#redraw(checkin.id, checkin.owner_id, checkin.items, checkin.day);
    }
    const item = items[tap.index];
    if (!item) return void await this.#telegram.answer(cb.id, 'That item is gone');
    const day = new DeliveryDay(item);
    const qty = Math.max(0, day.qtyOn(checkin.day) + tap.step);
    await this.#setDay(actor, item, checkin.day, qty);
    await this.#telegram.answer(cb.id, `${item.name}: ${qty ? day.qtyLabel(qty) : 'none'}`);
    await this.#redraw(checkin.id, checkin.owner_id, checkin.items, checkin.day);
  }

  /**
   * Updates every copy of a check-in (private chats and the group) from what
   * is saved NOW — never from what this tap saw. Two quick taps (− then ✓)
   * are handled at the same time; drawing from a stale picture let the − tap's
   * buttons land after ✓ had confirmed it. If the check-in was confirmed while
   * this was drawing, it draws once more so the confirmed view is last.
   */
  async #redraw(checkinId: number, ownerId: string, itemIds: string[], day: string): Promise<void> {
    for (let pass = 0; pass < 2; pass++) {
      const before = (await this.#deliveries.checkin(checkinId))?.answered_by ?? null;
      const items = await this.#checkinItems(ownerId, itemIds);
      const view = CheckinMessage.render(checkinId, items, day, before);
      for (const m of await this.#deliveries.messages(checkinId)) {
        await this.#telegram.edit(m.chat_id, m.message_id, view.text, view.keyboard, true);
      }
      const after = (await this.#deliveries.checkin(checkinId))?.answered_by ?? null;
      if (after === before) return;
    }
  }

  async #checkinItems(ownerId: string, ids: string[]): Promise<DeliveryItem[]> {
    const all = await this.#deliveries.itemsOf(ownerId);
    return ids.map((id) => all.find((i) => i.id === id)).filter((i): i is DeliveryItem => !!i);
  }

  async #mayAny(actor: Actor, ownerId: string, items: DeliveryItem[]): Promise<boolean> {
    for (const it of items) if ((await this.#deliveries.access(actor.link.user_id, ownerId, it.accountId)) >= 1) return true;
    return false;
  }

  /** Sets a day (or clears it back to the usual) through the server's access check. */
  async #setDay(actor: Actor, item: DeliveryItem, iso: string, qty: number): Promise<void> {
    const mark = new DeliveryDay(item).markFor(iso, qty);
    await this.#deliveries.change(actor.link.user_id, item.ownerId, item.id, mark === null ? { clear: iso } : { set: { date: iso, qty: mark } });
  }

  // ── typed ───────────────────────────────────────────────────────────────

  /**
   * A typed delivery change or bill payment; false when the text is something
   * else (an ordinary entry). "milk 2" alone stays an entry of 2 spent — a
   * delivery needs "x2", the unit ("2 L"), "none" or "no …".
   */
  async tryText(link: TelegramLink, chatId: number, messageId: number, text: string): Promise<boolean> {
    const paid = /^paid\s+(.+?)\s+([\d,]+(?:\.\d+)?)$/i.exec(text.trim());
    if (paid) return await this.#typedBill(link, chatId, messageId, paid[1], Number(paid[2].replace(/,/g, '')));

    const t = text.trim().toLowerCase().replace(/\s+/g, ' ');
    const dayWord = /\s(today|yesterday)$/.exec(t);
    const body = dayWord ? t.slice(0, dayWord.index) : t;
    const offset = dayWord ? DeliveryBot.#DAY_WORDS[dayWord[1]] : 0;
    let name: string | null = null, qty: number | null = null, unit: string | null = null;
    let m: RegExpExecArray | null;
    if ((m = /^no (.+)$/.exec(body))) { name = m[1]; qty = 0; }
    else if ((m = /^(.+?) (none|nil|0 ?x)$/.exec(body))) { name = m[1]; qty = 0; }
    else if ((m = /^(.+?) x ?(\d+(?:\.\d+)?)$/.exec(body))) { name = m[1]; qty = Number(m[2]); }
    else if ((m = /^(.+?) (\d+(?:\.\d+)?) ?([a-z]{1,10})$/.exec(body))) { name = m[1]; qty = Number(m[2]); unit = m[3]; }
    if (!name || qty === null) return false;

    const actor = await this.#actorFromLink(link);
    const item = await this.#findItem(actor, name);
    if (!item) return false;
    const day = new DeliveryDay(item);
    if (unit && day.unit.toLowerCase().replace(/s$/, '') !== unit.replace(/s$/, '')) return false;
    const iso = this.#clock.isoDate(-offset);
    try {
      await this.#setDay(actor, item, iso, qty);
    } catch (err) {
      await this.#telegram.reply(chatId, `⚠️ ${DeliveryBot.#reason(err)}`, messageId);
      return true;
    }
    await this.#telegram.reply(chatId, `✓ ${item.name} ${offset ? 'yesterday' : 'today'}: ${qty ? day.qtyLabel(qty) : 'none'}`, messageId);
    const today = await this.#deliveries.latestCheckin(item.ownerId, iso);
    if (today && today.items.includes(item.id) && !today.answered_by) await this.#redraw(today.id, item.ownerId, today.items, iso);
    return true;
  }

  async #findItem(actor: Actor, typed: string): Promise<DeliveryItem | null> {
    const want = typed.trim().toLowerCase();
    for (const owner of actor.owners) {
      for (const it of await this.#deliveries.itemsOf(owner)) {
        const names = [it.name, it.vendor ?? ''].map((n) => n.trim().toLowerCase()).filter(Boolean);
        if (names.includes(want) && (await this.#deliveries.access(actor.link.user_id, owner, it.accountId)) >= 1) return it;
      }
    }
    return null;
  }

  // ── /deliveries and /dues ───────────────────────────────────────────────

  /** Today's check-in for every book this person can change, with buttons. */
  async deliveries(link: TelegramLink, chatId: number): Promise<void> {
    const actor = await this.#actorFromLink(link);
    if (!actor.owners.length) return void await this.#telegram.reply(chatId, actor.plan.notice() ?? 'Not available on your plan.');
    const today = this.#clock.isoDate();
    let sent = 0;
    for (const owner of actor.owners) {
      const items = [];
      for (const it of await this.#deliveries.itemsOf(owner)) {
        const d = new DeliveryDay(it);
        if ((d.usualOn(today) > 0 || d.changedOn(today)) && !d.isPaid(today)
            && (await this.#deliveries.access(link.user_id, owner, it.accountId)) >= 1) items.push(it);
      }
      if (!items.length) continue;
      const id = await this.#deliveries.claimCheckin(owner, today, `manual:${chatId}`, items.map((i) => i.id))
        ?? (await this.#deliveries.latestCheckin(owner, today))?.id;
      if (!id) continue;
      const view = CheckinMessage.render(id, items, today, null);
      const mid = await this.#telegram.send(chatId, view.text, { html: true, keyboard: view.keyboard });
      if (mid) await this.#deliveries.saveMessage(id, chatId, mid);
      sent++;
    }
    if (!sent) await this.#telegram.reply(chatId, 'Nothing is expected today. Deliveries (milk, newspaper) are set up in the app: Regulars → Deliveries.');
  }

  /** What's owed to each vendor up to today, with a "Paid" button per vendor. */
  async dues(link: TelegramLink, chatId: number): Promise<void> {
    const actor = await this.#actorFromLink(link);
    if (!actor.owners.length) return void await this.#telegram.reply(chatId, actor.plan.notice() ?? 'Not available on your plan.');
    const today = this.#clock.isoDate();
    const money = new Money({});
    let any = false;
    for (const owner of actor.owners) {
      const vendors = new Map<string, { name: string; lines: string[]; total: number; currency: string; first: DeliveryItem }>();
      for (const it of await this.#deliveries.itemsOf(owner)) {
        if ((await this.#deliveries.access(link.user_id, owner, it.accountId)) < 1) continue;
        const d = new DeliveryDay(it);
        const due = d.due(today);
        if (!due || due.amount <= 0) continue;
        const key = d.vendor.toLowerCase();
        const cur = it.currency || 'INR';
        if (!vendors.has(key)) vendors.set(key, { name: d.vendor, lines: [], total: 0, currency: cur, first: it });
        const v = vendors.get(key)!;
        v.lines.push(`  ${it.name}: ${due.days ? `${d.qtyLabel(due.qty)} on ${due.days} day${due.days === 1 ? '' : 's'} (${DeliveryDay.rangeLabel(due.from, due.to)})` : 'adjustments'}`
          + `${due.adjust ? ` ${due.adjust > 0 ? '+' : '−'} ${DeliveryBot.#inr(Math.abs(due.adjust), cur, money)} for paid days changed` : ''} = ${DeliveryBot.#inr(due.amount, cur, money)}`);
        v.total += due.amount;
      }
      for (const v of vendors.values()) {
        any = true;
        await this.#telegram.send(chatId, `<b>${DeliveryBot.#esc(v.name)}</b> · due ${DeliveryBot.#inr(v.total, v.currency, money)}\n${DeliveryBot.#esc(v.lines.join('\n'))}`, {
          html: true,
          keyboard: [[{ text: `✓ Paid ${DeliveryBot.#inr(v.total, v.currency, money)}`, callback_data: `dp:${v.first.id}:${today.replace(/-/g, '')}` }]],
        });
      }
    }
    if (!any) await this.#telegram.reply(chatId, 'Nothing owed to vendors right now.');
  }

  /** "✓ Paid" under /dues: one expense per item of that vendor, up to that day, then paid up to it. */
  async #duesTap(cb: Cb, actor: Actor, itemId: string, ymd: string): Promise<void> {
    const upTo = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
    let owner: string | null = null, first: DeliveryItem | null = null, all: DeliveryItem[] = [];
    for (const o of actor.owners) {
      all = await this.#deliveries.itemsOf(o);
      first = all.find((i) => i.id === itemId) ?? null;
      if (first) { owner = o; break; }
    }
    if (!owner || !first) return void await this.#telegram.answer(cb.id, 'That item is gone');
    const vendor = new DeliveryDay(first).vendor.toLowerCase();
    const items = all.filter((i) => new DeliveryDay(i).vendor.toLowerCase() === vendor);
    const book = await this.#store.loadBook(owner);
    const money = new Money(await this.#rates.current(book.fxRates));
    const hijri = new HijriCalendar(book.hijriOffset);
    const writer = this.#store.writerFor(owner, actor.link.email, owner === actor.link.user_id);
    const today = this.#clock.isoDate();
    let total = 0, count = 0, cur = 'INR';
    for (const it of items) {
      const d = new DeliveryDay(it);
      const due = d.due(upTo);
      if (!due || due.amount <= 0 || !it.accountId) continue;
      cur = it.currency || book.homeCurrency;
      const tx = {
        id: await DeliveryBot.#id(`dues:${owner}:${it.id}:${due.to}`),
        accountId: it.accountId, categoryId: it.categoryId ?? null, type: 'expense',
        amount: due.amount, currency: cur, exchangeRate: money.exchangeRate(cur, book.homeCurrency),
        refAmount: money.convert(due.amount, cur, book.homeCurrency),
        payee: d.vendor, description: `${it.name} · ${DeliveryDay.rangeLabel(due.from, due.to)}`,
        note: `Paid ${d.vendor}: ${d.qtyLabel(due.qty)} on ${due.days} day${due.days === 1 ? '' : 's'}`,
        date: today, hijriDate: hijri.toHijri(today), paymentType: 'cash', recordState: 'cleared',
        transferPairId: null, transferDir: null, transferRate: null, tags: [], splits: null, recurring: null, recurringSourceId: null,
        createdAt: new Date().toISOString(), addedBy: actor.link.email,
        regularItemId: it.id, qty: due.qty, unitAmount: due.qty ? Math.round(due.amount / due.qty) : due.amount,
        settles: { from: due.from, to: due.to, qty: due.qty },
      } as unknown as PocketTransaction;
      const saved = await writer.add([tx]);
      await this.#deliveries.change(actor.link.user_id, owner, it.id, { paidTo: due.to, tx: (tx as unknown as { id: string }).id });
      if (saved === 'saved') { total += due.amount; count++; }
    }
    if (!count) return void await this.#telegram.answer(cb.id, 'Already paid');
    await this.#telegram.answer(cb.id, 'Payment recorded');
    if (cb.message) {
      await this.#telegram.edit(cb.message.chat.id, cb.message.message_id,
        `${cb.message.text ?? ''}\n\n✓ Paid ${DeliveryBot.#inr(total, cur, money)} on ${DeliveryDay.dayLabel(today)} (up to ${DeliveryDay.rangeLabel(upTo, upTo)})`);
    }
  }

  // ── bills ───────────────────────────────────────────────────────────────

  async #billTap(cb: Cb, actor: Actor, reminderId: number, pay: boolean): Promise<void> {
    const r = await this.#deliveries.reminder(reminderId);
    const t = r ? (await this.#deliveries.billTemplates()).find((x) => x.ownerId === r.owner_id && x.id === r.template_id) : null;
    if (!r || !t) return void await this.#telegram.answer(cb.id, 'This bill was changed or removed in the app');
    if (!actor.owners.includes(t.ownerId)) return void await this.#planNotice(cb, actor);
    if ((t.paid ?? []).includes(r.occurrence) || (t.skipped ?? []).includes(r.occurrence)) {
      return void await this.#telegram.answer(cb.id, 'Already done');
    }
    const name = Recipients.nameOf(await this.#deliveries.people(t.ownerId, t.accountId), actor.link.email);
    if (pay) {
      await this.#payBill(actor, t, r.occurrence, t.lastAmount);
      await this.#telegram.answer(cb.id, 'Recorded as paid');
      if (cb.message) await this.#telegram.edit(cb.message.chat.id, cb.message.message_id, `${cb.message.text ?? ''}\n\n✓ Paid ${DeliveryBot.#inr(t.lastAmount, t.currency, new Money({}))} by ${name}`);
    } else {
      if ((await this.#deliveries.access(actor.link.user_id, t.ownerId, t.accountId)) < 2) {
        return void await this.#telegram.answer(cb.id, 'Skipping a bill needs edit access');
      }
      await this.#deliveries.skipBill(t.ownerId, t.id, r.occurrence);
      await this.#telegram.answer(cb.id, 'Skipped this time');
      if (cb.message) await this.#telegram.edit(cb.message.chat.id, cb.message.message_id, `${cb.message.text ?? ''}\n\n⏭ Skipped by ${name}`);
    }
  }

  /** "paid electricity 1950": the earliest open occurrence of that bill (up to its reminder window). */
  async #typedBill(link: TelegramLink, chatId: number, messageId: number, typed: string, major: number): Promise<boolean> {
    const actor = await this.#actorFromLink(link);
    const want = typed.trim().toLowerCase();
    const t = (await this.#deliveries.billTemplates())
      .find((b) => actor.owners.includes(b.ownerId) && b.payee.trim().toLowerCase() === want);
    if (!t) return false;
    const today = this.#clock.isoDate();
    const occurrence = BillDates.open(t, DeliveryDay.addDays(today, Math.max(7, t.remindDays)))[0];
    if (!occurrence) {
      await this.#telegram.reply(chatId, `Nothing is due for ${t.payee} right now.`, messageId);
      return true;
    }
    const money = new Money({});
    const amount = money.toMinor(major, t.currency);
    try {
      await this.#payBill(actor, t, occurrence, amount);
    } catch (err) {
      await this.#telegram.reply(chatId, `⚠️ ${DeliveryBot.#reason(err)}`, messageId);
      return true;
    }
    await this.#telegram.reply(chatId, `✓ ${t.payee} (due ${DeliveryDay.dayLabel(occurrence)}) paid: ${DeliveryBot.#inr(amount, t.currency, money)}`, messageId);
    return true;
  }

  /** The occurrence's copy ("<template>__<date>"), dated today, through the sharing rules. */
  async #payBill(actor: Actor, t: BillTemplate, occurrence: string, amount: number): Promise<void> {
    const book = await this.#store.loadBook(t.ownerId);
    const money = new Money(await this.#rates.current(book.fxRates));
    const hijri = new HijriCalendar(book.hijriOffset);
    const today = this.#clock.isoDate();
    const tx = {
      id: `${t.id}__${occurrence}`, accountId: t.accountId, categoryId: t.categoryId, type: 'expense',
      amount, currency: t.currency, exchangeRate: money.exchangeRate(t.currency, book.homeCurrency),
      refAmount: money.convert(amount, t.currency, book.homeCurrency), payee: t.payee, note: '',
      date: today, hijriDate: hijri.toHijri(today), paymentType: book.defaultPaymentType, recordState: 'cleared',
      transferPairId: null, transferDir: null, transferRate: null, tags: [], splits: null, recurring: null,
      recurringSourceId: t.id, createdAt: new Date().toISOString(), addedBy: actor.link.email,
    } as unknown as PocketTransaction;
    const saved = await this.#store.writerFor(t.ownerId, actor.link.email, t.ownerId === actor.link.user_id).add([tx]);
    if (saved === 'duplicate') throw new Error('That bill is already recorded as paid.');
  }

  // ── people ──────────────────────────────────────────────────────────────

  /** The person behind a tap: Telegram user ids are their private chat ids. */
  async #actor(telegramUserId: number | undefined): Promise<Actor | null> {
    if (!telegramUserId) return null;
    const link = await this.#store.findLink(telegramUserId);
    return link ? await this.#actorFromLink(link) : null;
  }

  async #actorFromLink(link: TelegramLink): Promise<Actor> {
    const plan = await PlanAccess.load(this.#store, link.user_id);
    const owners = (await this.#deliveries.ownersFor(link.user_id, link.email)).filter((o) => plan.mayUseBook(o, link.user_id));
    return { link, plan, owners };
  }

  /** A short "not on your plan" on the button, and the full explanation in their private chat. */
  async #planNotice(cb: Cb, actor: Actor): Promise<void> {
    await this.#telegram.answer(cb.id, 'Not available on your plan');
    await this.#telegram.send(actor.link.chat_id, actor.plan.notice() ?? 'Telegram isn\'t part of your plan for that book.');
  }

  static async #id(seed: string): Promise<string> {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed)));
    return `tx_${Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12)}`;
  }

  static #inr(minor: number, currency: string, money: Money): string {
    const major = minor / money.factor(currency);
    const s = major.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(major) ? 0 : 2, maximumFractionDigits: 2 });
    return currency === 'INR' ? `₹${s}` : `${s} ${currency}`;
  }

  static #esc(s: string): string {
    return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  }

  static #reason(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.replace(/^pocket_[a-z_]+ failed: /, '') || 'Not done';
  }
}

