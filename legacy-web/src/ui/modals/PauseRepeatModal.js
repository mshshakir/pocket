/**
 * PauseRepeatModal — pause a repeating entry or bill: from a day, for a
 * month or a few, until a date, or until you resume. Pauses already set are
 * listed; one in progress can be resumed, a later one removed.
 *
 * Dates inside a pause are skipped: nothing is added, a bill isn't due and
 * the bot doesn't remind (RepeatPause).
 *
 * opts: { id: string }  the repeat's original entry
 */
import { Store }       from '../../core/Store.js';
import { RepeatPause } from '../../domain/services/RepeatPause.js';
import { BillService } from '../../domain/services/BillService.js';
import { DateService } from '../../domain/services/DateService.js';
import { DeliveryPlan } from '../../domain/services/DeliveryPlan.js';
import { Html }        from '../../core/Html.js';

export class PauseRepeatModal {
  /** @type {Store} */ #store;

  constructor() {
    this.#store = Store.getInstance();
  }

  /** The day `months` months after `iso`, minus one (1 Dec + 1 month → 31 Dec). */
  static monthsFrom(iso, months) {
    const [y, m, d] = iso.split('-').map(Number);
    const end = new Date(Date.UTC(y, m - 1 + months, d - 1));
    return end.toISOString().slice(0, 10);
  }

  render(opts = {}) {
    const state = this.#store.getState();
    const t = (state.transactions || []).find((x) => x.id === opts.id && x.recurring);
    if (!t) return '<div class="p-5 text-sm text-zinc-500">Not found.</div>';
    const today = DateService.todayIso();
    const id = Html.js(t.id);
    const name = Html.escape(BillService.nameOf(t, state));
    const live = RepeatPause.list(t).filter((p) => (p.to || RepeatPause.FOREVER) >= today);
    const how = (k, label, checked) => `
      <label class="cursor-pointer">
        <input type="radio" name="length" value="${k}" ${checked ? 'checked' : ''} class="peer sr-only"
               onchange="this.form.querySelector('[data-until]').style.display = this.value === 'date' ? '' : 'none'">
        <span class="btn btn-outline w-full justify-center text-sm peer-checked:bg-zinc-900 peer-checked:text-white dark:peer-checked:bg-white dark:peer-checked:text-zinc-900">${label}</span>
      </label>`;
    return `
      <form class="p-5 pause-repeat-form" onsubmit="window.__app.submitRepeatPause(event,'${id}')">
        <div class="flex items-center justify-between mb-1">
          <h3 class="text-lg font-semibold">Pause ${name}</h3>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()" aria-label="Close"><i data-lucide="x"></i></button>
        </div>
        <p class="text-xs text-zinc-500 mb-4">Away, or not paying it for a while? Dates in the pause are skipped — nothing is added, no reminders, and they aren't filled in later.</p>
        <div class="mb-3">
          <label class="text-xs text-zinc-500">From</label>
          <input class="input" type="date" name="from" value="${today}" required>
        </div>
        <div class="text-xs text-zinc-500 mb-1">For</div>
        <div class="grid grid-cols-3 gap-2 mb-2">
          ${how('1', '1 month', true)}${how('2', '2 months')}${how('3', '3 months')}
        </div>
        <div class="grid grid-cols-2 gap-2 mb-3">
          ${how('date', 'Until a date')}${how('open', 'Until I resume')}
        </div>
        <div data-until style="display:none" class="mb-3">
          <label class="text-xs text-zinc-500">Last paused day</label>
          <input class="input" type="date" name="to" min="${today}">
        </div>
        <button class="btn btn-primary w-full justify-center" type="submit"><i data-lucide="pause"></i> Pause</button>
        ${live.length ? `
        <div class="text-sm font-semibold mt-5 mb-2">Pauses</div>
        ${live.map((p) => `
          <div class="flex items-center justify-between card p-2.5 mb-2 text-sm">
            <span>${p.to ? DeliveryPlan.rangeLabel(p.from, p.to) : `From ${DeliveryPlan.shortDate(p.from)} · until you resume`}</span>
            <button type="button" class="btn btn-ghost text-xs" onclick="window.__app.resumeRepeat('${id}')">${p.from <= today ? 'Resume now' : 'Remove'}</button>
          </div>`).join('')}` : ''}
      </form>`;
  }
}
