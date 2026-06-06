/**
 * Router — Lightweight client-side router (hash-free, history-free).
 *
 * The app is a single-page SPA where "routes" are named view keys
 * (e.g. 'dashboard', 'transactions').  The Router tracks the active
 * route, fires EventBus('route:changed') on navigation, and provides
 * a back-stack for drill-in views (account detail, etc.).
 */
import { EventBus } from './EventBus.js';

export class Router {
  /** @type {Router|null} */
  static #instance = null;

  /** @type {string} */
  #current = 'dashboard';

  /** @type {string[]} */
  #stack = [];

  /** @type {EventBus} */
  #bus;

  constructor() {
    if (Router.#instance) {
      throw new Error('Router is a singleton — use Router.getInstance()');
    }
    this.#bus = EventBus.getInstance();
  }

  /** @returns {Router} */
  static getInstance() {
    if (!Router.#instance) {
      Router.#instance = new Router();
    }
    return Router.#instance;
  }

  // ── Accessors ───────────────────────────────────────────────────────

  /** @returns {string} */
  get current() {
    return this.#current;
  }

  /** @returns {boolean} */
  get canGoBack() {
    return this.#stack.length > 0;
  }

  // ── Navigation ──────────────────────────────────────────────────────

  /**
   * Navigate to a new route.
   * @param {string} route - route id (e.g. 'dashboard', 'transactions')
   * @param {object} [params={}] - arbitrary params forwarded to the view
   * @param {object} [options]
   * @param {boolean} [options.pushStack=false] - push current route to back-stack
   */
  navigate(route, params = {}, { pushStack = false } = {}) {
    if (pushStack && this.#current !== route) {
      this.#stack.push(this.#current);
    }
    this.#current = route;
    this.#bus.emit('route:changed', { route, params });
  }

  /**
   * Navigate back to the previous stacked route.
   * Falls back to 'dashboard' when the stack is empty.
   */
  back() {
    const prev = this.#stack.pop() ?? 'dashboard';
    this.#current = prev;
    this.#bus.emit('route:changed', { route: prev, params: {} });
  }

  /**
   * Clear the back-stack (e.g. when navigating from the main nav bar).
   */
  clearStack() {
    this.#stack = [];
  }
}
