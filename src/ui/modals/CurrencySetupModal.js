/**
 * CurrencySetupModal — First sign-in home currency selection.
 */
import { CURRENCIES } from '../../data/constants.js';

export class CurrencySetupModal {
  #store;

  constructor({ store }) {
    this.#store = store;
  }

  render() {
    const cur = this.#store.getState().user?.homeCurrency || 'USD';
    const options = CURRENCIES.map(c =>
      `<option value="${c}" ${c === cur ? 'selected' : ''}>${c}</option>`
    ).join('');
    return `
      <div class="p-6">
        <div class="w-12 h-12 rounded-2xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 grid place-items-center text-xl font-bold mb-4">P</div>
        <h2 class="text-xl font-semibold mb-1">Welcome to Pocket!</h2>
        <p class="text-sm text-zinc-500 mb-5">Choose your home currency to get started. You can change this later in Settings.</p>
        <label class="block text-sm font-medium mb-1">Home currency</label>
        <select id="setupCurrency" class="select mb-6">${options}</select>
        <button class="btn btn-primary w-full" onclick="window.__app.saveCurrencySetup()">Get started</button>
      </div>`;
  }
}
