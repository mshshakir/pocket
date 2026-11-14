/**
 * GroupSummaries — builds the daily and weekly summary for one group from
 * its shared space (PocketStore.spaceSummary → SummaryReport).
 */
import { LocalClock } from './LocalClock.ts';
import type { GroupLink, PocketStore } from './PocketStore.ts';
import { SummaryMonths } from './SummaryMonths.ts';
import type { SummaryReport } from './SummaryReport.ts';

export class GroupSummaries {
  readonly #store: PocketStore;
  readonly #report: SummaryReport;

  constructor(store: PocketStore, report: SummaryReport) {
    this.#store = store;
    this.#report = report;
  }

  /** The summary of one day, or null when the space no longer exists. */
  async daily(group: GroupLink, day: string, when: 'today' | 'yesterday' = 'today'): Promise<string | null> {
    const s = await this.#store.spaceSummary(group.owner_id, group.space_id, day, day);
    return s ? this.#report.daily(day, s, group.names, when) : null;
  }

  /** The seven days ending on `lastDay`, compared with the seven before. */
  async weekly(group: GroupLink, lastDay: string): Promise<string | null> {
    const from = LocalClock.shift(lastDay, -6);
    const [s, previous] = await Promise.all([
      this.#store.spaceSummary(group.owner_id, group.space_id, from, lastDay),
      this.#store.spaceSummary(group.owner_id, group.space_id, LocalClock.shift(from, -7), LocalClock.shift(lastDay, -7)),
    ]);
    return s ? this.#report.weekly(from, lastDay, s, previous, group.names) : null;
  }

  /** The group's month (by its calendar) that `day` falls in. */
  async months(group: GroupLink): Promise<SummaryMonths> {
    const offset = group.calendar === 'hijri' ? await this.#store.hijriOffset(group.owner_id) : 0;
    return SummaryMonths.for(group.calendar === 'hijri' ? 'hijri' : 'gregorian', offset);
  }

  /** The month ending on `lastDay`, compared with the month before. */
  async monthly(group: GroupLink, lastDay: string, months?: SummaryMonths): Promise<string | null> {
    const cal = months ?? await this.months(group);
    const month = cal.month(lastDay);
    const before = cal.previous(month);
    const [s, previous] = await Promise.all([
      this.#store.spaceSummary(group.owner_id, group.space_id, month.from, lastDay),
      this.#store.spaceSummary(group.owner_id, group.space_id, before.from, before.to),
    ]);
    return s ? this.#report.monthly(month.label, before.short, s, previous, group.names) : null;
  }
}
