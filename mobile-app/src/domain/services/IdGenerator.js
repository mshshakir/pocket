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
    // Hermes (React Native) has no crypto.randomUUID; getRandomValues may be
    // present natively or via a polyfill. Prefer it — these IDs double as
    // dedup keys across devices, so entropy matters.
    if (cryptoObj?.getRandomValues) {
      const bytes = new Uint8Array(8);
      cryptoObj.getRandomValues(bytes);
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return `${prefix}_${hex.slice(0, 12)}`;
    }
    // Last-resort fallback (no crypto at all).
    return (
      prefix +
      '_' +
      Math.random().toString(36).slice(2, 9) +
      Math.random().toString(36).slice(2, 6) +
      Date.now().toString(36).slice(-4)
    );
  }
}
