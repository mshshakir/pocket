/**
 * EntryAccess — may this person add entries? (pocket_entry_access, migration 0047)
 *
 * Adding entries needs the ₹30-a-month promise, a paid plan, a family plan
 * that covers you, or an approved request to use Pocket free. While a request
 * waits, up to `waitLimit` entries may be added (counted from when it was
 * sent; books stay on the device, so the app counts them).
 *
 * Until billing_settings.promise_required is switched on, `required` is false
 * and everything is allowed. A person who isn't signed in can't be checked,
 * so when the rule is on they are asked to sign in first.
 */
import { Money } from '../../core/Money.js';

export class EntryAccess {
  static WHY = Object.freeze(['off', 'plan', 'family', 'free', 'waiting', 'none']);

  #d;

  /** @param {object} d  validated data, see from() */
  constructor(d) {
    this.#d = Object.freeze(d);
  }

  /** Nothing required: the answer before the server says otherwise. */
  static off() {
    return new EntryAccess({
      required: false, why: 'off', waitLimit: 20, waitingSince: null, freeUntil: null,
      request: null, promisePaise: 3000, promiseCredits: 150, promiseCreditDays: 30,
    });
  }

  /**
   * The rule is on but the person isn't signed in.
   * @param {object} [base]  promise price and credits from an earlier answer
   */
  static signedOut(base = {}) {
    return new EntryAccess({ ...EntryAccess.off().toJSON(), ...EntryAccess.#prices(base), required: true, why: 'signed_out' });
  }

  /** Builds from the server's `entries`. Anything odd counts as not required, never as blocked. */
  static from(raw) {
    if (!raw || typeof raw !== 'object' || raw.required !== true) return EntryAccess.off();
    const date = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);
    const req = raw.request && typeof raw.request === 'object'
      ? { status: ['pending', 'approved', 'declined', 'expired'].includes(raw.request.status) ? raw.request.status : null,
          at: date(raw.request.at), validUntil: date(raw.request.validUntil) }
      : null;
    return new EntryAccess({
      required: true,
      why: EntryAccess.WHY.includes(raw.why) ? raw.why : 'none',
      waitLimit: Number.isInteger(raw.waitLimit) && raw.waitLimit >= 0 ? raw.waitLimit : 20,
      waitingSince: date(raw.waitingSince),
      freeUntil: date(raw.freeUntil),
      request: req,
      ...EntryAccess.#prices(raw),
    });
  }

  static #prices(raw) {
    const whole = (v, d) => (Number.isInteger(v) && v > 0 ? v : d);
    return {
      promisePaise: whole(raw?.promisePaise, 3000),
      promiseCredits: whole(raw?.promiseCredits, 150),
      promiseCreditDays: whole(raw?.promiseCreditDays, 30),
    };
  }

  get required()          { return this.#d.required; }
  /** 'off' | 'plan' | 'family' | 'free' | 'waiting' | 'none' | 'signed_out' */
  get why()               { return this.#d.why; }
  get waitLimit()         { return this.#d.waitLimit; }
  get waitingSince()      { return this.#d.waitingSince ? new Date(this.#d.waitingSince) : null; }
  get freeUntil()         { return this.#d.freeUntil ? new Date(this.#d.freeUntil) : null; }
  /** The latest request: {status: 'pending'|'approved'|'declined'|'expired', at, validUntil}, or null. */
  get request()           { return this.#d.request ? { ...this.#d.request } : null; }
  get promiseRupees()     { return Math.round(this.#d.promisePaise / 100); }
  /** The promise's price as shown here: "₹30" in India, "$1" elsewhere (Money). */
  get promisePrice()      { return Money.format(Money.list('promise_month', this.#d.promisePaise)); }
  get promiseCredits()    { return this.#d.promiseCredits; }
  get promiseCreditDays() { return this.#d.promiseCreditDays; }

  /** Entries added since the request was sent (createdAt on or after it). */
  addedWhileWaiting(transactions) {
    const since = this.waitingSince;
    if (!since) return 0;
    return (transactions || []).filter((t) => t?.createdAt && Date.parse(t.createdAt) >= since.getTime()).length;
  }

  /** How many more may be added while the request waits. */
  waitLeft(transactions) {
    return Math.max(0, this.#d.waitLimit - this.addedWhileWaiting(transactions));
  }

  /**
   * May `count` new entries be added now?
   * @returns {{ok: true} | {ok: false, reason: 'none'|'wait_full'|'signed_out'}}
   */
  check(transactions, count = 1) {
    switch (this.#d.why) {
      case 'off': case 'plan': case 'family': case 'free': return { ok: true };
      case 'waiting': return this.waitLeft(transactions) >= count ? { ok: true } : { ok: false, reason: 'wait_full' };
      case 'signed_out': return { ok: false, reason: 'signed_out' };
      default: return { ok: false, reason: 'none' };
    }
  }

  toJSON() {
    return JSON.parse(JSON.stringify(this.#d));
  }
}
