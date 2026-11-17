/**
 * PromiseSection — shows the homepage's ₹30-a-month wording only once the
 * app actually asks for it (billing_settings.promise_required, read through
 * pocket_promise_rule, migration 0048), so the page never promises or charges
 * something the app doesn't do yet.
 *
 * Elements marked data-promise="on" appear when the rule is on;
 * data-promise="off" ones appear while it is off. [data-promise-rupees] and
 * [data-promise-credits] are filled from the rule.
 */
import { Money } from '../core/Money.js';
import { APP_SUPABASE_URL, APP_SUPABASE_KEY } from '../data/constants.js';

export class PromiseSection {
  #root;
  #fetch;

  /** @param {ParentNode} root  @param {typeof fetch} [fetcher] */
  constructor(root, fetcher = globalThis.fetch?.bind(globalThis)) {
    this.#root = root;
    this.#fetch = fetcher;
  }

  /** Reads the rule; anything that fails leaves the page as it is (rule off). */
  async start() {
    this.apply(await this.#load().catch(() => null));
  }

  async #load() {
    const res = await this.#fetch(`${APP_SUPABASE_URL}/rest/v1/rpc/pocket_promise_rule`, {
      method: 'POST',
      headers: { apikey: APP_SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: '{}',
    });
    return res.ok ? res.json() : null;
  }

  /** @param {{required?: boolean, promisePaise?: number, promiseCredits?: number}|null} rule */
  apply(rule) {
    const on = rule?.required === true;
    this.#root.querySelectorAll('[data-promise]').forEach((el) => {
      el.hidden = (el.dataset.promise === 'on') !== on;
    });
    if (!on) return;
    const paise = Number.isInteger(rule.promisePaise) ? rule.promisePaise : 3000;
    const price = Money.format(Money.list('promise_month', paise));
    const credits = Number.isInteger(rule.promiseCredits) ? rule.promiseCredits : 150;
    this.#root.querySelectorAll('[data-promise-price]').forEach((el) => { el.textContent = price; });
    this.#root.querySelectorAll('[data-promise-credits]').forEach((el) => { el.textContent = String(credits); });
  }
}
