/**
 * SummarySchedule — when a group's summaries go out: a time of day (minutes
 * after local midnight) and, for the weekly one, a day of the week.
 *
 *   "9pm", "9 pm", "21:00", "8:30 pm", "2130", "7.45am" → minutes
 *   "fri", "Friday", "jumuah" → 5
 *
 * A morning time (before noon) summarises the day before: a 7 am summary is
 * about yesterday, not the first seven hours of today.
 */
export class SummarySchedule {
  static readonly DEFAULT_MINUTE = 21 * 60;
  static readonly DEFAULT_WEEKDAY = 0;
  static readonly #NOON = 12 * 60;

  static readonly DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  static readonly #DAY_WORDS: Record<string, number> = {
    sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
    thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, jumuah: 5, jumma: 5, juma: 5, sat: 6, saturday: 6,
  };

  /** Minutes after midnight, or null when it isn't a time. */
  static parseTime(typed: string): number | null {
    const t = typed.trim().toLowerCase().replace(/\s+/g, '');
    let m = t.match(/^(\d{1,2})(?:[:.](\d{2}))?(am|pm)$/);
    if (m) {
      let h = Number(m[1]);
      const min = Number(m[2] ?? 0);
      if (h < 1 || h > 12 || min > 59) return null;
      if (h === 12) h = 0;
      if (m[3] === 'pm') h += 12;
      return h * 60 + min;
    }
    m = t.match(/^(\d{1,2})[:.](\d{2})$/) ?? t.match(/^(\d{2})(\d{2})$/);
    if (m) {
      const h = Number(m[1]), min = Number(m[2]);
      return h <= 23 && min <= 59 ? h * 60 + min : null;
    }
    return null;
  }

  /** 0 = Sunday … 6 = Saturday, or null. */
  static parseDay(typed: string): number | null {
    const d = SummarySchedule.#DAY_WORDS[typed.trim().toLowerCase()];
    return d === undefined ? null : d;
  }

  /** "9 pm", "8:30 pm", "7 am", "12 pm" */
  static formatTime(minute: number): string {
    const h24 = Math.floor(minute / 60), min = minute % 60;
    const h = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h}${min ? `:${String(min).padStart(2, '0')}` : ''} ${h24 < 12 ? 'am' : 'pm'}`;
  }

  /** True for a morning time: the summary is about the day before. */
  static coversYesterday(minute: number): boolean {
    return minute < SummarySchedule.#NOON;
  }
}
