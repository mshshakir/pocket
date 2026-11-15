/**
 * CheckinRunner — sends the morning delivery check-ins that are due. Called
 * every ten minutes with the summaries (telegram-summaries).
 *
 * Items are grouped per owner into slots: the same time, time zone and
 * recipients (everyone, one person, or the family group) share one message.
 * A slot is due from its time (9:00 unless set) in its own time zone, for
 * three hours — a check-in switched on in the evening waits for the next
 * morning rather than arriving late. Only items expected that day (or
 * already marked) and not yet paid are asked about. Each slot is claimed in
 * the database first, so a repeated run never sends twice. Owners whose plan
 * no longer includes Telegram get nothing.
 */
import { CheckinMessage } from './CheckinMessage.ts';
import { DeliveryDay, type DeliveryItem } from './DeliveryDay.ts';
import type { DeliveryStore } from './DeliveryStore.ts';
import type { LocalClock } from './LocalClock.ts';
import { PausedNotice } from './PausedNotice.ts';
import { PlanAccess } from './PlanAccess.ts';
import type { PocketStore } from './PocketStore.ts';
import { Recipients } from './Recipients.ts';
import type { TelegramClient } from './TelegramClient.ts';
import { TimeZones } from './TimeZones.ts';

export class CheckinRunner {
  static readonly WINDOW_MINUTES = 180;

  readonly #store: PocketStore;
  readonly #deliveries: DeliveryStore;
  readonly #telegram: TelegramClient;
  readonly #clock: LocalClock;
  readonly #recipients: Recipients;

  constructor(store: PocketStore, deliveries: DeliveryStore, telegram: TelegramClient, clock: LocalClock) {
    this.#store = store;
    this.#deliveries = deliveries;
    this.#telegram = telegram;
    this.#clock = clock;
    this.#recipients = new Recipients(deliveries);
  }

  /** The slot an item belongs to: "minute|zone|to|email". */
  static slotOf(item: DeliveryItem): string {
    const d = new DeliveryDay(item);
    const zone = item.checkinTz && TimeZones.isValid(item.checkinTz) ? item.checkinTz : TimeZones.DEFAULT;
    return `${d.checkinMinute}|${zone}|${item.checkinTo ?? 'all'}|${item.checkinTo === 'one' ? (item.checkinEmail ?? '') : ''}`;
  }

  async run(): Promise<{ checkins: number }> {
    const slots = new Map<string, DeliveryItem[]>();
    for (const item of await this.#deliveries.checkinItems()) {
      const key = `${item.ownerId}#${CheckinRunner.slotOf(item)}`;
      if (!slots.has(key)) slots.set(key, []);
      slots.get(key)!.push(item);
    }
    let checkins = 0;
    for (const [key, items] of slots) {
      try {
        if (await this.#one(key, items)) checkins++;
      } catch (e) {
        console.error('[checkins]', key, e);
      }
    }
    return { checkins };
  }

  async #one(key: string, items: DeliveryItem[]): Promise<boolean> {
    const [ownerId, slot] = key.split('#');
    const [minute, zone, to, email] = slot.split('|');
    const local = this.#clock.in(zone);
    const now = local.minuteOfDay();
    if (now < Number(minute) || now >= Number(minute) + CheckinRunner.WINDOW_MINUTES) return false;
    const day = local.isoDate();
    const today = items.filter((it) => {
      const d = new DeliveryDay(it);
      return (d.usualOn(day) > 0 || d.changedOn(day)) && !d.isPaid(day);
    });
    if (!today.length) return false;
    const targets = await this.#recipients.for(ownerId, today.map((i) => i.accountId), to, email || null);
    if (!targets.length) return false;
    const plan = await PlanAccess.load(this.#store, ownerId);
    if (!plan.ownBook) {
      await PausedNotice.send(this.#deliveries, this.#telegram, ownerId, plan, targets);
      return false;
    }
    const id = await this.#deliveries.claimCheckin(ownerId, day, slot, today.map((i) => i.id));
    if (!id) return false;
    const view = CheckinMessage.render(id, today, day, null);
    for (const t of targets) {
      const mid = await this.#telegram.send(t.chatId, view.text, { html: true, keyboard: view.keyboard, threadId: t.threadId });
      if (mid) await this.#deliveries.saveMessage(id, t.chatId, mid);
    }
    return true;
  }
}
