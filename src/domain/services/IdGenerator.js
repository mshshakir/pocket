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
    return (
      prefix +
      '_' +
      Math.random().toString(36).slice(2, 9) +
      Date.now().toString(36).slice(-3)
    );
  }
}
