/**
 * SummaryRunner — posts the group summaries that are due. Called every ten
 * minutes (pg_cron → the telegram-summaries function); it decides what's due
 * itself, in each group's own time zone, from its chosen time (9 pm unless
 * changed) and weekly day (Sunday unless changed):
 *
 *   daily   once per day, about the day (the day before, for a morning time)
 *   weekly  on the chosen day, about the seven days ending that day
 *   monthly when the month (regular or Hijri, as chosen) has just ended,
 *           compared with the month before
 *   yearly  when the group's year ends (31 December / end of Zilhaj, or the
 *           date it chose), compared with the year before
 *
 * Each summary is claimed in the database before it is sent, so overlapping
 * or repeated runs never post twice, and calling it early posts nothing.
 * Summaries go to the topic chosen with /summary on (groups with topics), or
 * to the group itself. If that topic was deleted, they go to General from
 * then on. A group whose owner's Family plan has ended is told once that
 * summaries are paused; a group the bot was removed from is forgotten.
 */
import type { GroupSummaries } from './GroupSummaries.ts';
import { PlanAccess } from './PlanAccess.ts';
import type { GroupLink, PocketStore } from './PocketStore.ts';
import { LocalClock } from './LocalClock.ts';
import { SummarySchedule } from './SummarySchedule.ts';
import { TimeZones } from './TimeZones.ts';
import type { TelegramClient } from './TelegramClient.ts';

export interface RunResult {
  posted: number;
  paused: number;
  removed: number;
}

export class SummaryRunner {
  static readonly #PAUSED = '⏸ Pocket summaries are paused: the Pocket Pro plan for this shared space has ended. '
    + 'They start again when it is renewed.';

  readonly #store: PocketStore;
  readonly #telegram: TelegramClient;
  readonly #summaries: GroupSummaries;
  readonly #clock: LocalClock;

  constructor(store: PocketStore, telegram: TelegramClient, summaries: GroupSummaries, clock: LocalClock) {
    this.#store = store;
    this.#telegram = telegram;
    this.#summaries = summaries;
    this.#clock = clock;
  }

  /** @param clock now; each group is looked at in its own time zone */
  async run(): Promise<RunResult> {
    const result: RunResult = { posted: 0, paused: 0, removed: 0 };
    for (const group of await this.#store.groups()) {
      try {
        const local = this.#clock.in(TimeZones.isValid(group.time_zone) ? group.time_zone : TimeZones.DEFAULT);
        const at = group.post_minute ?? SummarySchedule.DEFAULT_MINUTE;
        if (local.minuteOfDay() < at) continue;
        await this.#one(group, local.isoDate(), local.weekday() === (group.weekly_day ?? SummarySchedule.DEFAULT_WEEKDAY),
          SummarySchedule.coversYesterday(at), result);
      } catch (e) {
        console.error('[summaries] group', group.chat_id, e);
      }
    }
    return result;
  }

  /**
   * @param today the posting day (what each summary is claimed under)
   * @param weekDay today is the group's weekly day
   * @param yesterday a morning time: summarise the day before
   */
  async #one(group: GroupLink, today: string, weekDay: boolean, yesterday: boolean, result: RunResult): Promise<void> {
    const about = yesterday ? LocalClock.shift(today, -1) : today;
    const dailyDue = group.daily && (group.last_daily ?? '') < today;
    const weeklyDue = weekDay && group.weekly && (group.last_weekly ?? '') < today;
    const months = group.monthly && (group.last_monthly ?? '') < today ? await this.#summaries.months(group) : null;
    const monthlyDue = !!months?.isLastDay(about);
    const years = group.yearly && (group.last_yearly ?? '') < today ? await this.#summaries.years(group) : null;
    const yearlyDue = !!years?.isYearEnd(about);
    if (!dailyDue && !weeklyDue && !monthlyDue && !yearlyDue) return;

    if (!(await PlanAccess.load(this.#store, group.owner_id)).canShare) {
      if (!group.paused_notice) {
        await this.#store.updateGroup(group.chat_id, { paused_notice: true });
        if (await this.#post(group, SummaryRunner.#PAUSED, false, result)) result.paused++;
      }
      return;
    }
    if (group.paused_notice) await this.#store.updateGroup(group.chat_id, { paused_notice: false });

    if (dailyDue && await this.#store.claimSummary(group.chat_id, 'daily', today)) {
      const text = await this.#summaries.daily(group, about, yesterday ? 'yesterday' : 'today');
      if (text && await this.#post(group, text, true, result)) result.posted++;
    }
    if (weeklyDue && await this.#store.claimSummary(group.chat_id, 'weekly', today)) {
      const text = await this.#summaries.weekly(group, about);
      if (text && await this.#post(group, text, true, result)) result.posted++;
    }
    if (monthlyDue && await this.#store.claimSummary(group.chat_id, 'monthly', today)) {
      const text = await this.#summaries.monthly(group, about, months!);
      if (text && await this.#post(group, text, true, result)) result.posted++;
    }
    if (yearlyDue && await this.#store.claimSummary(group.chat_id, 'yearly', today)) {
      const text = await this.#summaries.yearly(group, about, years!);
      if (text && await this.#post(group, text, true, result)) result.posted++;
    }
  }

  /** Sends; moves to General if the topic is gone; forgets the group when the bot can no longer post there. */
  async #post(group: GroupLink, text: string, html: boolean, result: RunResult): Promise<boolean> {
    let sent = await this.#telegram.post(group.chat_id, text, html, group.thread_id ?? null);
    if (sent.topicGone) {
      group.thread_id = null;
      await this.#store.updateGroup(group.chat_id, { thread_id: null });
      sent = await this.#telegram.post(group.chat_id, text, html, null);
    }
    if (sent.gone) {
      await this.#store.removeGroup(group.chat_id);
      result.removed++;
    }
    return sent.ok;
  }
}
