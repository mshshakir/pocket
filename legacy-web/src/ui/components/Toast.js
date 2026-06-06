/**
 * Toast — Ephemeral notification component.
 *
 * Subscribes to EventBus('toast') so any layer of the app can trigger
 * a notification without holding a reference to the DOM.
 *
 * Responsibilities:
 *  - Render the toast element into the DOM on mount()
 *  - Show/hide with CSS transition
 *  - Auto-dismiss after a configurable delay
 */
import { EventBus } from '../../core/EventBus.js';

export class Toast {
  /** @type {HTMLElement|null} */
  #el = null;
  /** @type {ReturnType<typeof setTimeout>|null} */
  #timer = null;
  /** @type {number} */
  #duration;

  /**
   * @param {object} [opts]
   * @param {number} [opts.duration=1800]  auto-dismiss delay in ms
   */
  constructor({ duration = 1800 } = {}) {
    this.#duration = duration;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Mount the toast element and subscribe to the EventBus.
   * @param {HTMLElement} [container=document.body]
   */
  mount(container = document.body) {
    this.#el = document.createElement('div');
    this.#el.id        = 'toast';
    this.#el.className = 'toast';
    container.appendChild(this.#el);

    EventBus.getInstance().on('toast', ({ message }) => this.show(message));
  }

  // ── Public API ───────────────────────────────────────────────────────

  /**
   * Show a toast message.
   * @param {string} message
   */
  show(message) {
    if (!this.#el) return;
    this.#el.textContent = message;
    this.#el.classList.add('show');
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.hide(), this.#duration);
  }

  /** Immediately hide the toast. */
  hide() {
    this.#el?.classList.remove('show');
  }
}
