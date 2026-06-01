/**
 * PaymentTypeService — manages built-in and user-defined payment types.
 */
const BASE_TYPES = ['card', 'cash', 'transfer', 'cheque', 'online'];

export class PaymentTypeService {
  #store;

  constructor(store) { this.#store = store; }

  allTypes() {
    const custom = this.#store.getState().user?.customPaymentTypes || [];
    return [...BASE_TYPES, ...custom];
  }

  addCustom(name) {
    const n = name.trim();
    if (!n) return;
    const state = this.#store.getState();
    if (!Array.isArray(state.user.customPaymentTypes)) state.user.customPaymentTypes = [];
    const list = state.user.customPaymentTypes;
    if (!list.includes(n)) {
      list.push(n);
      this.#store.persist();
    }
    return n;
  }
}
