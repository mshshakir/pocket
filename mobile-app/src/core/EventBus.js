/**
 * EventBus — Singleton pub/sub event dispatcher.
 *
 * Decouples producers from consumers so services and views can communicate
 * without holding direct references to each other.
 *
 * Usage:
 *   EventBus.getInstance().on('state:changed', handler);
 *   EventBus.getInstance().emit('state:changed', payload);
 */
export class EventBus {
  /** @type {EventBus|null} */
  static #instance = null;

  /** @type {Map<string, Set<Function>>} */
  #handlers = new Map();

  constructor() {
    if (EventBus.#instance) {
      throw new Error('EventBus is a singleton — use EventBus.getInstance()');
    }
  }

  /** @returns {EventBus} */
  static getInstance() {
    if (!EventBus.#instance) {
      EventBus.#instance = new EventBus();
    }
    return EventBus.#instance;
  }

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} handler
   * @returns {() => void} unsubscribe function
   */
  on(event, handler) {
    if (!this.#handlers.has(event)) {
      this.#handlers.set(event, new Set());
    }
    this.#handlers.get(event).add(handler);
    return () => this.off(event, handler);
  }

  /**
   * Subscribe to an event exactly once; auto-removes after first fire.
   * @param {string} event
   * @param {Function} handler
   */
  once(event, handler) {
    const wrapper = (data) => {
      handler(data);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
  }

  /**
   * Remove a specific handler.
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    this.#handlers.get(event)?.delete(handler);
  }

  /**
   * Broadcast an event to all subscribers.
   * @param {string} event
   * @param {*} [data]
   */
  emit(event, data) {
    const handlers = this.#handlers.get(event);
    if (!handlers) return;
    // Iterate a SNAPSHOT: a handler that subscribes/unsubscribes during dispatch
    // (common when a view re-wires itself on 'state:changed') must not be visited
    // mid-loop. Live Set.forEach would include just-added handlers and can loop.
    for (const fn of [...handlers]) {
      try {
        fn(data);
      } catch (err) {
        console.error(`[EventBus] Error in handler for "${event}":`, err);
      }
    }
  }

  /** Remove all handlers (useful for testing). */
  clear() {
    this.#handlers.clear();
  }
}
