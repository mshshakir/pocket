/**
 * BillReminderRunner — reminds about recurring bills marked "amount changes,
 * ask me": a few days before (as chosen on the bill, 2 by default) and on the
 * day, from 9:00 in the bot's time zone. Each reminder goes once (claimed in
 * bill_reminders), to the people chosen on the bill (everyone with access, one
 * person, or the family group), with "✓ Paid ₹… (last time's amount)" and
 * "Skip this time". A bill left unpaid is reminded on its day only, not every
 * day after; it stays on the app's Bills card until paid or skipped.
 */
import { BillDates } from './BillDates.ts';
import { DeliveryDay } from './DeliveryDay.ts';
import type { BillTemplate, DeliveryStore } from './DeliveryStore.ts';
import type { LocalClock } from './LocalClock.ts';
import { Money } from './Money.ts';
import { PausedNotice } from './PausedNotice.ts';
import { PlanAccess } from './PlanAccess.ts';
import type { PocketStore } from './PocketStore.ts';
import { Recipients } from './Recipients.ts';
import type { TelegramClient } from './TelegramClient.ts';

export class BillReminderRunner {
  static readonly FROM_MINUTE = 540;

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

  /**
   * The reminder due today for a bill, if any: 'before' within its days-before
   * window, 'due' on the day (or the day after, if the run missed it).
   */
  static dueReminder(t: BillTemplate, today: string): { occurrence: string; kind: 'before' | 'due' } | null {
    const ahead = Math.max(0, Number(t.remindDays) || 0);
    for (const occ of BillDates.open(t, DeliveryDay.addDays(today, ahead))) {
      if (occ < DeliveryDay.addDays(today, -1)) continue;
      if (occ <= today) return { occurrence: occ, kind: 'due' };
      if (ahead > 0) return { occurrence: occ, kind: 'before' };
    }
    return null;
  }

  static text(t: BillTemplate, occurrence: string, kind: 'before' | 'due', today: string): string {
    const money = new Money({});
    const major = t.lastAmount / money.factor(t.currency);
    const amount = `${t.currency === 'INR' ? '₹' : ''}${major.toLocaleString('en-IN', { maximumFractionDigits: 2 })}${t.currency === 'INR' ? '' : ` ${t.currency}`}`;
    const days = Math.round((Date.parse(`${occurrence}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    const when = kind === 'due' ? (occurrence < today ? 'was due yesterday' : 'is due today')
      : days === 1 ? 'is due tomorrow' : `is due in ${days} days`;
    return `🧾 ${t.payee} ${when} (${DeliveryDay.dayLabel(occurrence)}) · last time ${amount}\n`
      + `Paid a different amount? Send: paid ${t.payee.toLowerCase()} <amount>`;
  }

  async run(): Promise<{ reminders: number }> {
    if (this.#clock.minuteOfDay() < BillReminderRunner.FROM_MINUTE) return { reminders: 0 };
    const today = this.#clock.isoDate();
    let reminders = 0;
    for (const t of await this.#deliveries.billTemplates()) {
      try {
        const due = BillReminderRunner.dueReminder(t, today);
        if (!due) continue;
        const targets = await this.#recipients.for(t.ownerId, [t.accountId], t.remindTo, t.remindEmail);
        if (!targets.length) continue;
        const plan = await PlanAccess.load(this.#store, t.ownerId);
        if (!plan.ownBook) {
          await PausedNotice.send(this.#deliveries, this.#telegram, t.ownerId, plan, targets);
          continue;
        }
        const id = await this.#deliveries.claimReminder(t.ownerId, t.id, due.occurrence, due.kind);
        if (!id) continue;
        const money = new Money({});
        const last = t.lastAmount / money.factor(t.currency);
        const keyboard = [[
          { text: `✓ Paid ${t.currency === 'INR' ? '₹' : ''}${last.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`, callback_data: `bp:${id}` },
          { text: 'Skip this time', callback_data: `bs:${id}` },
        ]];
        for (const target of targets) {
          await this.#telegram.send(target.chatId, BillReminderRunner.text(t, due.occurrence, due.kind, today), { keyboard, threadId: target.threadId });
        }
        reminders++;
      } catch (e) {
        console.error('[bills]', t.ownerId, t.id, e);
      }
    }
    return { reminders };
  }
}
