/**
 * Modal — Centralised modal/sheet manager.
 *
 * Renders modal content into a shared backdrop + card container so there
 * is always at most one modal open at a time.  Modal content is provided
 * by view-specific ModalView classes that implement render() → HTML string.
 *
 * Architecture:
 *  Modal is a container; the content strategy is injected per open() call.
 *  This avoids a giant switch-case and keeps each modal self-contained.
 */
import { EventBus } from '../../core/EventBus.js';

export class Modal {
  /** @type {HTMLElement|null} */ #backdrop    = null;
  /** @type {HTMLElement|null} */ #card        = null;
  /** @type {string|null} */      #active      = null;
  /** @type {object|null} */      #currentOpts = null;

  /** @type {Map<string, object>}  name → ModalView instance */
  #registry = new Map();

  constructor() {}

  // ── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Mount the backdrop + card elements.
   * @param {HTMLElement} [container=document.body]
   */
  mount(container = document.body) {
    this.#backdrop = document.createElement('div');
    this.#backdrop.id        = 'modalRoot';
    this.#backdrop.className = 'modal-backdrop';
    this.#backdrop.addEventListener('click', (e) => {
      if (e.target === this.#backdrop) this.close();
    });

    this.#card = document.createElement('div');
    this.#card.id        = 'modalCard';
    this.#card.className = 'modal';
    this.#card.addEventListener('click', (e) => e.stopPropagation());

    this.#backdrop.appendChild(this.#card);
    container.appendChild(this.#backdrop);
  }

  // ── Registry ─────────────────────────────────────────────────────────

  /**
   * Register a named modal view.
   * @param {string} name
   * @param {object} view  must implement render(opts) → string
   */
  register(name, view) {
    this.#registry.set(name, view);
  }

  // ── Open / Close ─────────────────────────────────────────────────────

  /**
   * Open a named modal.
   * @param {string} name
   * @param {object} [opts={}]  passed through to view.render(opts)
   */
  open(name, opts = {}) {
    // Special _raw mode: opts.html is injected directly (for dynamic one-off dialogs)
    if (name === '_raw') {
      this.#active      = '_raw';
      this.#currentOpts = opts;
      this.#card.innerHTML = opts.html || '';
      this.#backdrop.classList.add('open');
      document.body.style.overflow = 'hidden';
      if (typeof lucide !== 'undefined') lucide.createIcons();
      return;
    }

    const view = this.#registry.get(name);
    if (!view) {
      console.warn(`[Modal] No view registered for "${name}"`);
      return;
    }

    this.#active           = name;
    this.#currentOpts      = opts;
    this.#card.innerHTML   = view.render(opts);
    this.#backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Re-run Lucide icon replacement inside the new content
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Notify any post-open hooks
    view.onOpen?.(opts, this.#card);

    EventBus.getInstance().emit('modal:opened', { name, opts });
  }

  /**
   * Re-render the currently open modal in-place using stored opts.
   * Call this after mutating modal view state (e.g. toggling splits).
   */
  refresh() {
    if (!this.#active || this.#active === '_raw') return;
    const view = this.#registry.get(this.#active);
    if (!view || !this.#card) return;
    this.#card.innerHTML = view.render(this.#currentOpts ?? {});
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  /** Close the active modal. */
  close() {
    this.#backdrop.classList.remove('open');
    document.body.style.overflow = '';
    const prev        = this.#active;
    this.#active      = null;
    this.#card.innerHTML = '';
    EventBus.getInstance().emit('modal:closed', { name: prev });
  }

  /** @returns {string|null} name of the currently open modal */
  get active() {
    return this.#active;
  }

  /** @returns {boolean} */
  get isOpen() {
    return this.#active !== null;
  }

  /**
   * Update the card content in-place (used by modals that re-render on user
   * input without closing, e.g. when toggling splits mode).
   * @param {string} html
   */
  updateContent(html) {
    if (!this.#card) return;
    this.#card.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}
