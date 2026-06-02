/**
 * IdGenerator — Generates collision-resistant IDs.
 *
 * Extracted from the global uid() helper so the generation strategy is
 * a single, swappable, testable unit.
 */
export class IdGenerator {
  /**
   * Generate a prefixed pseudo-random ID.
   * @param {string} [prefix='id']
   * @returns {string}  e.g. "tx_x4k2j9a3b"
   */
  static generate(prefix = 'id') {
    // Prefer crypto.randomUUID() — collision-resistant even when many IDs are
    // generated within the same millisecond (bulk CSV import, recurring
    // backfill), where the old Math.random()+Date.now() scheme could collide
    // and these IDs double as dedup keys (I3).
    const cryptoObj = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
    if (cryptoObj?.randomUUID) {
      return `${prefix}_${cryptoObj.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    }
    // Fallback for environments without crypto.randomUUID.
    return (
      prefix +
      '_' +
      Math.random().toString(36).slice(2, 9) +
      Math.random().toString(36).slice(2, 6) +
      Date.now().toString(36).slice(-4)
    );
  }
}
