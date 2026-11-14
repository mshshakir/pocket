/**
 * PricingToggle — the website's Monthly/Yearly switch on the pricing cards.
 *
 * Each paid card marks its parts with data attributes:
 *   [data-price-month] / [data-price-year]   the price shown for each term
 *   [data-per]                               "/month" or "/year"
 *   [data-note-month] / [data-note-year]     the small line under the price
 *   [data-plan="family"] on the buy link     becomes app.html#plans=family_<term>
 * The switch itself is [data-term="month"|"year"] buttons inside [data-terms].
 * The chosen term is passed on to the app, which opens its plan chooser at
 * that plan and term (signing in first if needed).
 */
export class PricingToggle {
  #root;
  #term;

  /** @param {HTMLElement} root the pricing section */
  constructor(root, term = 'year') {
    this.#root = root;
    this.#term = term === 'month' ? 'month' : 'year';
  }

  start() {
    this.#root.querySelectorAll('[data-term]').forEach((b) =>
      b.addEventListener('click', () => this.choose(b.dataset.term)));
    this.#render();
    return this;
  }

  choose(term) {
    this.#term = term === 'month' ? 'month' : 'year';
    this.#render();
  }

  get term() { return this.#term; }

  /** The app link for one plan and the chosen term. */
  static link(plan, term) { return `app.html#plans=${plan}_${term}`; }

  #render() {
    const t = this.#term;
    const other = t === 'month' ? 'year' : 'month';
    this.#root.querySelectorAll('[data-term]').forEach((b) => {
      const on = b.dataset.term === t;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    this.#root.querySelectorAll(`[data-price-${t}]`).forEach((el) => { el.hidden = false; });
    this.#root.querySelectorAll(`[data-price-${other}]`).forEach((el) => { el.hidden = true; });
    this.#root.querySelectorAll(`[data-note-${t}]`).forEach((el) => { el.hidden = false; });
    this.#root.querySelectorAll(`[data-note-${other}]`).forEach((el) => { el.hidden = true; });
    this.#root.querySelectorAll('[data-per]').forEach((el) => { el.textContent = `/${t}`; });
    this.#root.querySelectorAll('a[data-plan]').forEach((a) => {
      const plan = a.dataset.plan;
      a.href = PricingToggle.link(plan, a.dataset.fixedTerm || t);
      const label = a.querySelector('[data-label]');
      if (label && !a.dataset.fixedTerm) label.textContent = `Get ${a.dataset.name} ${t === 'month' ? 'monthly' : 'yearly'}`;
    });
  }
}
