/**
 * PausedNotice — tells the people who get delivery check-ins and bill
 * reminders, once, that these have stopped because the book owner's plan no
 * longer includes Telegram (like the group summaries' paused note). Once per
 * plan end: claimed in delivery_checkins under the day the plan ended, so a
 * renewal followed by another lapse is told again.
 */
import type { DeliveryStore } from './DeliveryStore.ts';
import type { PlanAccess } from './PlanAccess.ts';
import type { Target } from './Recipients.ts';
import type { TelegramClient } from './TelegramClient.ts';

export class PausedNotice {
  static readonly TEXT = '⏸ Pocket\'s morning delivery check-ins and bill reminders are paused: the plan for this book '
    + 'no longer includes Telegram. They start again when it is renewed. Everything still works in the app.';

  static async send(deliveries: DeliveryStore, telegram: TelegramClient, ownerId: string, plan: PlanAccess, targets: Target[]): Promise<boolean> {
    if (!targets.length) return false;
    const day = plan.endsAt ? plan.endsAt.toISOString().slice(0, 10) : '2000-01-01';
    if (!(await deliveries.claimCheckin(ownerId, day, 'paused-notice', []))) return false;
    for (const t of targets) await telegram.send(t.chatId, PausedNotice.TEXT, { threadId: t.threadId });
    return true;
  }
}
