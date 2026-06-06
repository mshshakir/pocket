/**
 * CurrencySetupModal — First sign-in home currency selection.
 */
import { CURRENCIES } from '../../data/constants.js';
import { HijriCalendarService } from '../../domain/services/HijriCalendarService.js';

/**
 * CurrencySetupModal — Two-step first-launch onboarding.
 *
 * Step 1: Home currency selection.
 * Step 2: Hijri date calibration (offset corrector).
 *
 * Each step is a separate render() variant selected by #step.
 * The modal re-renders in-place via Modal.refresh() when stepping.
 */
export class CurrencySetupModal {
  #store;
  #hijri;
  #step; // 1 | 2

  constructor({ store }) {
    this.#store = store;
    this.#hijri = new HijriCalendarService();
    this.#step  = 1;
  }

  /** Reset to step 1 (called each time the modal is opened). */
  onOpen() {
    this.#step = 1;
  }

  render() {
    return this.#step === 1 ? this.#renderStep1() : this.#renderStep2();
  }

  // ── Step 1: currency ───────────────────────────────────────────────

  #renderStep1() {
    const cur     = this.#store.getState().user?.homeCurrency || 'USD';
    const options = CURRENCIES.map(c =>
      `<option value="${c}" ${c === cur ? 'selected' : ''}>${c}</option>`
    ).join('');

    return `
      <div class="p-6" style="min-width:320px;max-width:420px">
        <!-- Step indicator -->
        <div class="flex items-center gap-2 mb-5">
          <div class="flex items-center gap-1.5">
            <div class="w-6 h-6 rounded-full bg-zinc-900 text-white text-xs grid place-items-center font-bold">1</div>
            <div class="text-xs font-medium">Currency</div>
          </div>
          <div class="flex-1 h-px bg-zinc-200 dark:bg-zinc-700"></div>
          <div class="flex items-center gap-1.5">
            <div class="w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-400 text-xs grid place-items-center font-bold">2</div>
            <div class="text-xs text-zinc-400">Calendar</div>
          </div>
        </div>

        <div class="w-12 h-12 rounded-2xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 grid place-items-center text-xl font-bold mb-4">P</div>
        <h2 class="text-xl font-semibold mb-1">Welcome to Pocket!</h2>
        <p class="text-sm text-zinc-500 mb-5">Choose your home currency. All balances and reports will be shown in this currency.</p>

        <label class="block text-sm font-medium mb-1">Home currency</label>
        <select id="setupCurrency" class="select mb-6">${options}</select>

        <button class="btn btn-primary w-full" onclick="window.__app.currencySetupNext()">
          Next <i data-lucide="arrow-right"></i>
        </button>
      </div>`;
  }

  // ── Step 2: Hijri offset calibration ───────────────────────────────

  #renderStep2() {
    const u          = this.#store.getState().user;
    const offset     = u?.hijriOffset ?? 0;
    const todayHijri = this.#hijri.format(new Date(), { long: true });

    return `
      <div class="p-6" style="min-width:320px;max-width:420px">
        <!-- Step indicator -->
        <div class="flex items-center gap-2 mb-5">
          <div class="flex items-center gap-1.5">
            <div class="w-6 h-6 rounded-full bg-emerald-500 text-white text-xs grid place-items-center">
              <i data-lucide="check" style="width:12px;height:12px"></i>
            </div>
            <div class="text-xs text-zinc-400">Currency</div>
          </div>
          <div class="flex-1 h-px bg-zinc-200 dark:bg-zinc-700"></div>
          <div class="flex items-center gap-1.5">
            <div class="w-6 h-6 rounded-full bg-zinc-900 text-white text-xs grid place-items-center font-bold">2</div>
            <div class="text-xs font-medium">Calendar</div>
          </div>
        </div>

        <div class="w-10 h-10 rounded-xl grid place-items-center mb-4" style="background:#0ea5e922;color:#0ea5e9">
          <i data-lucide="moon-star" style="width:22px;height:22px"></i>
        </div>
        <h2 class="text-xl font-semibold mb-1">Hijri date calibration</h2>
        <p class="text-sm text-zinc-500 mb-4">
          Pocket calculates the Hijri date automatically. If your local moon sighting
          puts it a day earlier or later, adjust it here.
        </p>

        <!-- Live date display -->
        <div class="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-4 mb-5 text-center">
          <div class="text-xs text-zinc-500 mb-1">Today shows as</div>
          <div class="text-lg font-semibold" id="setupHijriDisplay">${todayHijri}</div>
          ${offset !== 0
            ? `<div class="text-xs mt-1 ${offset > 0 ? 'text-amber-600' : 'text-blue-600'}">
                 ${offset > 0 ? '+' : ''}${offset} day${Math.abs(offset) !== 1 ? 's' : ''} applied
               </div>`
            : `<div class="text-xs text-zinc-400 mt-1">Calculated date · no adjustment</div>`}
        </div>

        <!-- Stepper -->
        <div class="flex items-center gap-4 mb-2">
          <button class="btn btn-outline flex-1 text-xl font-bold justify-center py-3"
                  onclick="window.__app.adjustHijriOffset(-1)"
                  ${offset <= -7 ? 'disabled' : ''}>−</button>
          <div class="flex-1 text-center">
            <div class="text-3xl font-bold">${offset > 0 ? '+' : ''}${offset}</div>
            <div class="text-xs text-zinc-500">days</div>
          </div>
          <button class="btn btn-outline flex-1 text-xl font-bold justify-center py-3"
                  onclick="window.__app.adjustHijriOffset(+1)"
                  ${offset >= 7 ? 'disabled' : ''}>+</button>
        </div>
        <div class="text-xs text-zinc-400 text-center mb-5">
          You can always change this later in Settings → Hijri calendar
        </div>

        <button class="btn btn-primary w-full" onclick="window.__app.saveCurrencySetup()">
          <i data-lucide="check"></i> Done — open Pocket
        </button>
      </div>`;
  }

  /** Called by app.js to advance from step 1 → step 2. */
  advanceToStep2() {
    this.#step = 2;
  }

  #esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, m =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }
}
