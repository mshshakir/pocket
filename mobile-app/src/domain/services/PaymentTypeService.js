/**
 * PaymentTypeService — manages built-in and user-defined payment methods.
 *
 * A transaction stores its method as a plain string (`paymentType: 'card'`),
 * not an id, so renaming a method has to rewrite every transaction that uses
 * it or the old name becomes an orphaned value that still shows up in filters.
 * That migration is this service's job — callers just ask for a rename.
 *
 * State shape (all on state.user):
 *   customPaymentTypes  string[]  methods the user added
 *   hiddenPaymentTypes  string[]  built-ins the user deleted or renamed away
 *
 * Built-ins are editable: renaming one records the original as hidden and adds
 * the new name as a custom method, which keeps BASE_TYPES a stable constant
 * while still letting the list read exactly how the user wants it.
 */

/** Methods every book starts with. */
const BASE_TYPES = ['card', 'cash', 'transfer', 'cheque', 'online'];

export class PaymentTypeService {
  #store;

  constructor(store) { this.#store = store; }

  // ── Queries ─────────────────────────────────────────────────────────

  /** @returns {string[]} the methods currently offered, in display order */
  allTypes() {
    const user   = this.#store.getState().user || {};
    const hidden = new Set(user.hiddenPaymentTypes || []);
    const custom = user.customPaymentTypes || [];
    return [...BASE_TYPES.filter((t) => !hidden.has(t)), ...custom];
  }

  /** @returns {string[]} the unmodified built-in list */
  static get baseTypes() { return [...BASE_TYPES]; }

  /** @returns {string[]} built-ins the user has deleted or renamed away */
  hiddenTypes() {
    return [...(this.#store.getState().user?.hiddenPaymentTypes || [])];
  }

  /** @param {string} name @returns {boolean} */
  isBuiltIn(name) { return BASE_TYPES.includes(name); }

  /**
   * How many transactions (including the far side of transfers) use a method.
   * @param {string} name
   * @returns {number}
   */
  usageCount(name) {
    const txs = this.#store.getState().transactions || [];
    return txs.filter((t) => t.paymentType === name).length;
  }

  // ── Mutations ───────────────────────────────────────────────────────

  /**
   * Add a user-defined method.
   * @param {string} name
   * @returns {string|undefined} the stored name, or undefined when rejected
   */
  addCustom(name) {
    const n = (name || '').trim();
    if (!n) return;
    const state = this.#store.getState();
    if (!Array.isArray(state.user.customPaymentTypes)) state.user.customPaymentTypes = [];

    // Re-adding a built-in the user previously deleted should un-hide it rather
    // than create a duplicate entry.
    const hidden = state.user.hiddenPaymentTypes || [];
    const hiddenIdx = hidden.findIndex((t) => t.toLowerCase() === n.toLowerCase());
    if (hiddenIdx >= 0) {
      hidden.splice(hiddenIdx, 1);
      this.#store.flush();
      return BASE_TYPES.find((t) => t.toLowerCase() === n.toLowerCase()) || n;
    }

    if (this.allTypes().some((t) => t.toLowerCase() === n.toLowerCase())) return n;

    state.user.customPaymentTypes.push(n);
    this.#store.flush(); // flush() emits state:changed so subscribers stay in sync
    return n;
  }

  /**
   * Rename a method and migrate every transaction that referenced it.
   *
   * @param {string} oldName
   * @param {string} newName
   * @returns {{ok:true, name:string, migrated:number}|{ok:false, reason:string}}
   */
  rename(oldName, newName) {
    const next = (newName || '').trim();
    if (!next)                return { ok: false, reason: 'Enter a name' };
    if (next === oldName)     return { ok: true, name: oldName, migrated: 0 };
    if (!this.allTypes().includes(oldName)) return { ok: false, reason: 'That method no longer exists' };
    if (this.allTypes().some((t) => t !== oldName && t.toLowerCase() === next.toLowerCase())) {
      return { ok: false, reason: `"${next}" already exists` };
    }

    const state = this.#store.getState();
    if (!Array.isArray(state.user.customPaymentTypes)) state.user.customPaymentTypes = [];
    if (!Array.isArray(state.user.hiddenPaymentTypes)) state.user.hiddenPaymentTypes = [];

    if (this.isBuiltIn(oldName)) {
      // Built-ins live in a frozen constant, so a rename is modelled as
      // "hide the original, add the new name in its place".
      state.user.hiddenPaymentTypes.push(oldName);
      state.user.customPaymentTypes.push(next);
    } else {
      const i = state.user.customPaymentTypes.indexOf(oldName);
      if (i < 0) return { ok: false, reason: 'That method no longer exists' };
      state.user.customPaymentTypes[i] = next; // in place, so ordering is stable
    }

    // Rewrite the ledger — otherwise the old string lingers on transactions and
    // reappears in the transaction filters.
    let migrated = 0;
    for (const t of state.transactions || []) {
      if (t.paymentType === oldName) { t.paymentType = next; migrated++; }
    }
    // Regular items and debts carry a default method too.
    for (const item of state.regularItems || []) {
      if (item.paymentType === oldName) item.paymentType = next;
    }

    this.#store.flush();
    return { ok: true, name: next, migrated };
  }

  /**
   * Delete a method. Refused while transactions still reference it — the same
   * rule the category delete uses, so a method can never vanish out from under
   * existing data.
   *
   * @param {string} name
   * @returns {{ok:true}|{ok:false, reason:string, count?:number}}
   */
  remove(name) {
    if (!this.allTypes().includes(name)) return { ok: false, reason: 'That method no longer exists' };
    if (this.allTypes().length <= 1)     return { ok: false, reason: 'Keep at least one payment method' };

    const count = this.usageCount(name);
    if (count > 0) {
      return {
        ok: false,
        count,
        reason: `${count} transaction${count === 1 ? '' : 's'} still use this — reassign them first`,
      };
    }

    const state = this.#store.getState();
    if (this.isBuiltIn(name)) {
      if (!Array.isArray(state.user.hiddenPaymentTypes)) state.user.hiddenPaymentTypes = [];
      state.user.hiddenPaymentTypes.push(name);
    } else {
      const i = (state.user.customPaymentTypes || []).indexOf(name);
      if (i < 0) return { ok: false, reason: 'That method no longer exists' };
      state.user.customPaymentTypes.splice(i, 1);
    }

    this.#store.flush();
    return { ok: true };
  }

  /** Restore every deleted built-in. @returns {number} how many came back */
  restoreBuiltIns() {
    const state  = this.#store.getState();
    const hidden = state.user.hiddenPaymentTypes || [];
    const n      = hidden.length;
    if (!n) return 0;
    state.user.hiddenPaymentTypes = [];
    this.#store.flush();
    return n;
  }
}
