/**
 * RATES — the app's live, mutable FX rate table (units per 1 USD).
 *
 * Seeded from the static FX table in constants.js so the app always has
 * sensible rates offline / before the first live fetch. ExchangeRateService
 * overwrites entries from a live feed at runtime. It deliberately mirrors the
 * bracket-access shape of FX (`RATES['INR']`) so existing call sites read live
 * rates with no change in syntax.
 *
 * It is a plain (non-frozen) object precisely so it can be updated in place;
 * never reassign the binding — mutate via Object.assign so all importers see
 * the new values.
 */
import { FX } from '../../data/constants.js';

export const RATES = { ...FX };
