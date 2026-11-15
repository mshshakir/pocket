/**
 * BudgetPace — is spending on track for this point in the period?
 *
 * The plan is an even spread: by day d of an n-day period, d/n of the limit.
 *   expected   what the plan allows by the end of today
 *   ahead      spent − expected (positive = spending faster than planned)
 *   perDay     what can still go out each day, today included, after the
 *              bills still to come: (limit − spent − due) ÷ days remaining
 *   state      'ahead' | 'behind' | 'on-track' | 'over' | 'idle'
 * A gap within 3% of the limit counts as on track, so a single coffee
 * doesn't flip the message back and forth.
 *
 * Pure: numbers in, numbers out (minor units).
 */
export class BudgetPace {
  static TOLERANCE = 0.03;

  /** @type {number} */ #limit;
  /** @type {number} */ #spent;
  /** @type {number} */ #due;
  /** @type {{status:string, days:number, elapsed:number, remaining:number}} */ #period;

  /**
   * @param {{limit:number, spent:number, due?:number, period:{status:string, days:number, elapsed:number, remaining:number}}} p
   */
  constructor({ limit, spent, due = 0, period }) {
    this.#limit  = Math.max(0, Number(limit) || 0);
    this.#spent  = Math.max(0, Number(spent) || 0);
    this.#due    = Math.max(0, Number(due) || 0);
    this.#period = period;
  }

  /** Pace only means something while a period of more than a day is running. */
  get applies() {
    return this.#period.status === 'active' && this.#period.days > 1 && this.#limit > 0;
  }

  get expected() {
    if (!this.applies) return 0;
    return Math.round(this.#limit * this.#period.elapsed / this.#period.days);
  }

  /** Where the plan says you should be today, as a percent of the bar. */
  get markerPct() {
    return this.applies ? Math.min(100, (100 * this.#period.elapsed) / this.#period.days) : null;
  }

  /** Spent already at or past the limit. */
  get overLimit() { return this.#limit > 0 && this.#spent >= this.#limit; }

  get ahead() { return this.#spent - this.expected; }

  /** Left to spend once bills still to come are paid. */
  get free() { return this.#limit - this.#spent - this.#due; }

  get perDay() {
    const days = this.#period.remaining;
    if (!this.applies || days <= 0) return 0;
    return Math.max(0, Math.floor(this.free / days));
  }

  get state() {
    if (!this.applies) return 'idle';
    if (this.#spent + this.#due > this.#limit) return 'over';
    const gap = this.ahead;
    if (Math.abs(gap) <= this.#limit * BudgetPace.TOLERANCE) return 'on-track';
    return gap > 0 ? 'ahead' : 'behind';
  }
}
