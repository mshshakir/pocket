/**
 * SeedFactory — generates fresh sample data for new users.
 *
 * The book is SampleBook: about six months of a household in India, with
 * every feature in use. All of it is flagged as sample (BookCleaner), so a new
 * user can remove it without touching anything they entered themselves.
 *
 * Extracted from the monolithic seed() function into a proper class
 * so it can be injected, tested, and replaced independently.
 */
import { SampleBook } from './SampleBook.js';

export class SeedFactory {
  /**
   * Build and return a complete initial state object.
   * @returns {object}
   */
  static create() {
    return new SampleBook().build();
  }
}
