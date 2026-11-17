/**
 * RecordingGaps — notices when someone has stopped recording, or records on
 * and off, so the app can offer help. Worked out on the device from entry
 * dates alone; nothing is sent anywhere.
 *
 *   catchUp    No entry dated in the last GAP_DAYS days or more (up to
 *              CATCH_UP_MAX): the catch-up service can fill the gap.
 *   programme  Recorded on fewer than ON_OFF_DAYS of the last WINDOW days
 *              (but on some), or stopped for longer than CATCH_UP_MAX:
 *              the habit programme is built for this.
 *   restDue    Paid half of the habit programme and the 6 weeks are over:
 *              the second half is due.
 *
 * Nobody hears anything in their first NEW_DAYS (counted from the first entry
 * they made in Pocket: imported or back-dated entries don't make someone
 * "old"), and the programme isn't suggested to anyone already in it, or to
 * anyone recording on STEADY_DAYS of the last 7 days (they're doing it now).
 * Bills and repeats added by the app don't count as recording.
 */
export class RecordingGaps {
  static NEW_DAYS = 14;
  static GAP_DAYS = 3;
  static CATCH_UP_MAX = 30;
  static WINDOW = 30;
  static ON_OFF_DAYS = 15;
  /** Recorded on this many of the last 7 days: no programme suggestion. */
  static STEADY_DAYS = 5;
  /** Programme statuses that mean they're in it, or on their way. */
  static #IN_PROGRAMME = new Set(['waitlisted', 'offered', 'confirmed', 'completed']);

  /**
   * @param {Array<{date?: string, createdAt?: string, recurring?: unknown, recurringSourceId?: unknown}>} transactions
   * @param {string} today  YYYY-MM-DD, local
   * @param {{status?: string, payPlan?: string, restPaid?: boolean, batch?: {endsOn?: string}}|null} [programme]
   * @returns {{kind: 'catchUp', days: number} | {kind: 'programme', recordedDays: number, window: number, stopped: boolean} | {kind: 'restDue'} | null}
   */
  static suggestion(transactions, today, programme = null) {
    if (programme?.payPlan === 'split' && !programme.restPaid && programme.batch?.endsOn && today >= programme.batch.endsOn
        && (programme.status === 'confirmed' || programme.status === 'completed')) {
      return { kind: 'restDue' };
    }

    const own = (transactions || []).filter((t) => t && !t.recurring && !t.recurringSourceId && typeof t.date === 'string');
    if (!own.length) return null;
    // When they started using Pocket: the earliest entry they made here. Entries
    // without a made-on time (old imports) only count if none has one.
    const made = own.map((t) => RecordingGaps.#day(t.createdAt)).filter(Boolean);
    const first = (made.length ? made : own.map((t) => t.date)).reduce((min, d) => (d < min ? d : min), today);
    if (RecordingGaps.#between(first, today) < RecordingGaps.NEW_DAYS) return null;

    const inProgramme = RecordingGaps.#IN_PROGRAMME.has(programme?.status);
    const lastDated = own.reduce((max, t) => (t.date <= today && t.date > max ? t.date : max), '');
    const gap = lastDated ? RecordingGaps.#between(lastDated, today) : Infinity;

    if (gap >= RecordingGaps.GAP_DAYS && gap <= RecordingGaps.CATCH_UP_MAX) return { kind: 'catchUp', days: gap };
    if (inProgramme) return null;
    if (gap > RecordingGaps.CATCH_UP_MAX) return { kind: 'programme', recordedDays: 0, window: RecordingGaps.WINDOW, stopped: true };

    // Days on which they actually recorded something (when it was entered, not the date it is for).
    const since = RecordingGaps.#addDays(today, -(RecordingGaps.WINDOW - 1));
    const days = new Set();
    for (const t of own) {
      const d = RecordingGaps.#day(t.createdAt) || t.date;
      if (d >= since && d <= today) days.add(d);
    }
    const week = RecordingGaps.#addDays(today, -6);
    const lately = [...days].filter((d) => d >= week).length;
    if (lately >= RecordingGaps.STEADY_DAYS) return null;
    if (days.size > 0 && days.size < RecordingGaps.ON_OFF_DAYS) {
      return { kind: 'programme', recordedDays: days.size, window: RecordingGaps.WINDOW, stopped: false };
    }
    return null;
  }

  /** The local calendar day of an ISO time, or '' when there isn't one. */
  static #day(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  static #between(from, to) {
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
  }

  static #addDays(iso, n) {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
}
