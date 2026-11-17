/**
 * WebPrices — the website's prices in US dollars outside India's time zone.
 *
 * Each price on a page carries its dollar wording in data-usd; the rupee
 * wording is what the page is written with. In India (or when the time zone
 * can't be read) the page is left as it is. Text only: data-usd never holds
 * HTML. The dollar figures mirror usd_prices (migration 0059) and Money.
 */
import { Money } from '../core/Money.js';

export class WebPrices {
  #root;

  /** @param {ParentNode} root */
  constructor(root) {
    this.#root = root;
  }

  /** @returns {boolean} whether dollars were applied */
  apply(currency = Money.currency()) {
    if (currency !== 'USD') return false;
    this.#root.querySelectorAll('[data-usd]').forEach((el) => { el.textContent = el.dataset.usd; });
    return true;
  }
}
