/**
 * PlanService — the signed-in person's plan, kept current for the app.
 *
 * Asks the server (pocket_entitlements) and remembers the last answer between
 * visits, so opening the app offline still knows the plan. Announces every
 * change on the bus as 'plan:changed'.
 *
 * The server is the authority and refuses what a plan doesn't allow with
 * SQLSTATE PP402 (migration 0020); isPlanError() recognises that refusal so
 * the app can explain it instead of showing a raw error.
 */
import { EventBus } from '../../core/EventBus.js';
import { UserRecord } from '../../core/UserRecord.js';
import { Entitlements } from './Entitlements.js';

export class PlanService {
  static KEY = 'pocket.v2.plan';
  static ERROR_CODE = 'PP402';

  /** @type {(fn: string, args?: object) => Promise<{data: any, error: any}>} */
  #rpc;
  #bus;
  #record;
  #current = Entitlements.free();
  /** True once this session has a server answer (not only the remembered one). */
  #fresh = false;
  /** When the server last answered (ms). */
  #askedAt = 0;
  #known = false;

  /**
   * @param {(fn: string, args?: object) => Promise<{data: any, error: any}>} rpc
   * @param {object} [opts]
   * @param {EventBus} [opts.bus]
   * @param {import('../../core/KeyValueStore.js').KeyValueStore} [opts.store]
   */
  constructor(rpc, { bus = EventBus.getInstance(), store } = {}) {
    this.#rpc = rpc;
    this.#bus = bus;
    this.#record = new UserRecord(PlanService.KEY, store);
  }

  /** @returns {Entitlements} */
  get current() { return this.#current; }

  /** Whether the current answer came from the server this session. */
  get isFresh() { return this.#fresh; }

  /**
   * Whether the plan is known at all: answered by the server this session, or
   * remembered from a previous one. Unknown (first start, offline) means the
   * app should carry on as before and let the server decide.
   */
  get isKnown() { return this.#known; }

  /** Start a session: the remembered plan straight away, then the server's. */
  async start(userId) {
    this.#fresh = false;
    this.#known = false;
    const saved = await this.#record.load(userId);
    if (saved?.plan) { this.#known = true; this.#set(Entitlements.from(saved.plan)); }
    return this.refresh();
  }

  /**
   * Ask the server again. On failure (offline) the last known plan stands.
   * @returns {Promise<Entitlements>}
   */
  async refresh() {
    try {
      const { data, error } = await this.#rpc('pocket_entitlements');
      if (error) throw error;
      this.#fresh = true;
      this.#known = true;
      this.#askedAt = Date.now();
      this.#set(Entitlements.from(data));
      this.#record.save({ plan: this.#current.toJSON() });
    } catch (e) {
      console.warn('[PlanService] could not refresh the plan:', e?.message || e);
    }
    return this.#current;
  }

  /** Ask again only when the last answer is older than maxAgeMs (or there is none). */
  refreshIfStale(maxAgeMs = 60_000) {
    return Date.now() - this.#askedAt > maxAgeMs ? this.refresh() : Promise.resolve(this.#current);
  }

  /** Signed out: back to Free, and forget the remembered plan. */
  reset() {
    this.#fresh = false;
    this.#known = false;
    this.#askedAt = 0;
    this.#record.clear();
    this.#set(Entitlements.free());
  }

  /** The cloud price list (plans table), for showing options. */
  async catalogue(client) {
    const { data, error } = await client.from('plans').select('code, name, seats, sync, telegram, sharing, monthly_paise, yearly_paise, trial_paise, trial_days, sort, active')
      .eq('active', true).order('sort');
    if (error) throw error;
    return data ?? [];
  }

  /** @param {any} err */
  static isPlanError(err) {
    return err?.code === PlanService.ERROR_CODE;
  }

  /**
   * A sentence for the person, from a server refusal.
   * @param {any} err
   */
  static explain(err) {
    if (err?.hint) return err.hint;
    switch (err?.details) {
      case 'sharing': return 'Sharing with family needs a Family plan.';
      case 'seats':   return 'Your Family plan is full. Remove someone to add another person.';
      case 'shared':  return 'This shared space is read-only: its owner\'s Family plan is not active.';
      default:        return 'Saving to the cloud needs a Sync or Family plan.';
    }
  }

  #set(next) {
    const before = JSON.stringify(this.#current.toJSON());
    this.#current = next;
    if (JSON.stringify(next.toJSON()) !== before) this.#bus.emit('plan:changed', { plan: next });
  }
}
