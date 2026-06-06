/**
 * ExchangeRateService — keeps the FX rate table current.
 *
 * The app historically used a hardcoded FX table (units per 1 USD), which drifts
 * out of date (e.g. USD→INR was stuck at 83 while the live rate is ~95+). This
 * service refreshes the live `RATES` table from a free, key-less feed and
 * persists the result so rates survive reloads and remain available offline.
 *
 * Source: open.er-api.com (USD base, no API key, generous free tier).
 *
 * No DOM. State + notifications go through Store / EventBus.
 */
import { Store }    from '../../core/Store.js';
import { EventBus } from '../../core/EventBus.js';
import { RATES }    from './FxRates.js';

const ENDPOINT   = 'https://open.er-api.com/v6/latest/USD';
const REFRESH_MS = 6 * 60 * 60 * 1000; // re-fetch at most every 6 hours

export class ExchangeRateService {
  /** @type {Store} */    #store;
  /** @type {EventBus} */ #bus;

  constructor() {
    this.#store = Store.getInstance();
    this.#bus   = EventBus.getInstance();
  }

  /**
   * Seed the in-memory table from the last persisted live rates, so a reload
   * uses the most recent known rates even before (or without) a network fetch.
   */
  seedFromState() {
    const persisted = this.#store.getState()?.fxRates;
    if (persisted && typeof persisted === 'object') this.#merge(persisted);
  }

  /**
   * Fetch the latest rates if the cached set is stale (or `force`), update the
   * live table, persist, and notify the UI so totals re-render.
   * Failures are swallowed — the app keeps using the last-known/seed rates.
   * @param {boolean} [force=false]
   * @returns {Promise<boolean>} true if rates were updated
   */
  async refresh(force = false) {
    const state = this.#store.getState();
    const last  = state.fxRatesUpdatedAt ? Date.parse(state.fxRatesUpdatedAt) : 0;
    if (!force && last && (Date.now() - last) < REFRESH_MS) return false;

    try {
      const res = await fetch(ENDPOINT, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json  = await res.json();
      const rates = json?.rates;
      if (!rates || typeof rates.USD !== 'number') throw new Error('Unexpected payload');

      this.#merge(rates);
      state.fxRates          = { ...RATES };
      state.fxRatesUpdatedAt = new Date().toISOString();
      this.#store.persist();
      this.#bus.emit('state:changed', state);
      return true;
    } catch (e) {
      console.warn('[ExchangeRateService] rate refresh failed:', e);
      return false;
    }
  }

  /** When the rates were last refreshed (ISO), or null. */
  get lastUpdated() {
    return this.#store.getState()?.fxRatesUpdatedAt ?? null;
  }

  /** Merge only valid positive numbers into the live table (in place). */
  #merge(map) {
    for (const [code, value] of Object.entries(map)) {
      if (typeof value === 'number' && isFinite(value) && value > 0) RATES[code] = value;
    }
  }
}
