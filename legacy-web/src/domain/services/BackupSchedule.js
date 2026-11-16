/**
 * BackupSchedule — how often a backup should be made, and whether one is due.
 *
 * Counts calendar days on the device's own clock, so "every day" means once
 * per day whatever the hour, not 24 hours apart.
 */
export class BackupSchedule {
  /** [key, label, days between backups] */
  static #CHOICES = Object.freeze([
    ['off',     'Only when I tap Back up now', 0],
    ['daily',   'Every day',   1],
    ['weekly',  'Every week',  7],
    ['monthly', 'Every month', 30],
  ]);
  static DEFAULT = 'weekly';

  #key;

  /** @param {string} [key] one of off | daily | weekly | monthly; anything else = the default */
  constructor(key) {
    this.#key = BackupSchedule.#CHOICES.some(([k]) => k === key) ? key : BackupSchedule.DEFAULT;
  }

  /** @returns {Array<{key: string, label: string}>} */
  static choices() {
    return BackupSchedule.#CHOICES.map(([key, label]) => ({ key, label }));
  }

  get key() { return this.#key; }
  get label() { return BackupSchedule.#CHOICES.find(([k]) => k === this.#key)[1]; }
  get days() { return BackupSchedule.#CHOICES.find(([k]) => k === this.#key)[2]; }
  get automatic() { return this.days > 0; }

  /**
   * @param {string|null} lastAt  when the last backup finished (ISO), or null for never
   * @param {Date} [now]
   */
  isDue(lastAt, now = new Date()) {
    if (!this.automatic) return false;
    const last = lastAt ? new Date(lastAt) : null;
    if (!last || Number.isNaN(last.getTime())) return true;
    return BackupSchedule.#dayNumber(now) - BackupSchedule.#dayNumber(last) >= this.days;
  }

  /**
   * How far through the period the last backup is: 0 = just made, 1 = due,
   * 2 = a whole period overdue. Never backed up counts as 1 (due). Null when
   * there is no schedule.
   * @param {string|null} lastAt @param {Date} [now]
   * @returns {number|null}
   */
  progress(lastAt, now = new Date()) {
    if (!this.automatic) return null;
    const last = lastAt ? new Date(lastAt) : null;
    if (!last || Number.isNaN(last.getTime())) return 1;
    return Math.max(0, (BackupSchedule.#dayNumber(now) - BackupSchedule.#dayNumber(last)) / this.days);
  }

  /**
   * Days until the next backup is due (0 or less = due now). Null when there is no schedule.
   * @param {string|null} lastAt @param {Date} [now]
   * @returns {number|null}
   */
  daysLeft(lastAt, now = new Date()) {
    const done = this.progress(lastAt, now);
    return done === null ? null : Math.round((1 - done) * this.days);
  }

  /** Whole days since a fixed point, by the local calendar. */
  static #dayNumber(d) {
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
  }
}
