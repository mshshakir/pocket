/**
 * PauseDeliveriesModal — "away from … to …" for a pay-later regular item
 * (nothing comes on those days), and the pauses already set, each removable.
 *
 * opts: { itemId: string }
 */
import { Store }        from '../../core/Store.js';
import { DeliveryPlan } from '../../domain/services/DeliveryPlan.js';
import { VendorDues }   from '../../domain/services/VendorDues.js';
import { Html }         from '../../core/Html.js';

export class PauseDeliveriesModal {
  /** @type {Store} */ #store;

  constructor() {
    this.#store = Store.getInstance();
  }

  render(opts = {}) {
    const item = (this.#store.getState().regularItems || []).find((i) => i.id === opts.itemId);
    if (!item) return '<div class="p-5 text-sm text-zinc-500">Item not found.</div>';
    const today = VendorDues.today();
    const pauses = (Array.isArray(item.pauses) ? item.pauses : []).filter((p) => p.to >= today);
    const id = Html.escape(item.id);
    return `
      <form class="p-5" style="min-width:300px;max-width:420px" onsubmit="window.__app.submitPause(event,'${id}')">
        <div class="flex items-center justify-between mb-1">
          <h3 class="text-lg font-semibold">Pause ${Html.escape(item.name)}</h3>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>
        </div>
        <p class="text-xs text-zinc-500 mb-4">Away, or the vendor is on leave? Nothing is counted on these days.</p>
        <div class="grid grid-cols-2 gap-3 mb-4">
          <div><label class="text-xs text-zinc-500">From</label><input class="input" type="date" name="from" value="${today}" required></div>
          <div><label class="text-xs text-zinc-500">To</label><input class="input" type="date" name="to" value="${DeliveryPlan.addDays(today, 6)}" required></div>
        </div>
        <button class="btn btn-primary w-full" type="submit"><i data-lucide="pause"></i> Pause</button>
        ${pauses.length ? `
        <div class="text-sm font-semibold mt-5 mb-2">Coming up</div>
        ${pauses.map((p) => `
          <div class="flex items-center justify-between card p-2.5 mb-2 text-sm">
            <span>${DeliveryPlan.rangeLabel(p.from, p.to)}</span>
            <button type="button" class="btn btn-ghost text-xs" onclick="window.__app.liftPause('${id}','${p.from}')">Remove</button>
          </div>`).join('')}` : ''}
      </form>`;
  }
}
