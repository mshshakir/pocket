/**
 * PlanCompare — the "Compare plans" table on the website.
 *
 * On wide screens every plan's column shows. On phones one plan shows at a
 * time, chosen with the tabs above the table ([data-compare-tab]), so the
 * table never scrolls sideways. Cells carry [data-col="free|plus|pro|group"];
 * the table root's data-show says which column phones see.
 *
 * Plan tags elsewhere on the page ([data-plan-tag="pro"] links to #compare)
 * open the table at that plan.
 */
export class PlanCompare {
  static #PLANS = ['free', 'plus', 'pro', 'group'];

  #root;

  /** @param {HTMLElement} root the [data-compare] element */
  constructor(root) {
    this.#root = root;
  }

  start(doc = document) {
    if (!this.#root) return this;
    this.#root.querySelectorAll('[data-compare-tab]').forEach((b) =>
      b.addEventListener('click', () => this.show(b.dataset.compareTab)));
    doc.querySelectorAll('[data-plan-tag]').forEach((a) =>
      a.addEventListener('click', () => this.show(a.dataset.planTag)));
    this.show(this.#root.dataset.show || 'pro');
    return this;
  }

  /** Shows one plan's column on phones (all columns stay on wide screens). */
  show(plan) {
    const p = PlanCompare.#PLANS.includes(plan) ? plan : 'pro';
    this.#root.dataset.show = p;
    this.#root.querySelectorAll('[data-compare-tab]').forEach((b) => {
      const on = b.dataset.compareTab === p;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  get shown() { return this.#root?.dataset.show ?? null; }
}
