/**
 * HabitModal — create or change a habit: its name, how to recognise it
 * (words in the payee or note, categories, shortcuts), and an optional
 * monthly limit (times and/or amount).
 *
 * opts: { id?: string, preset?: { name, words } }  — id 'item:<shortcut>' edits
 * the habit a shortcut has by itself; saving keeps it as a habit of its own.
 */
import { Store }           from '../../core/Store.js';
import { CurrencyService } from '../../domain/services/CurrencyService.js';
import { HabitService }    from '../../domain/services/HabitService.js';
import { Html }            from '../../core/Html.js';

export class HabitModal {
  /** @type {Store} */           #store;
  /** @type {CurrencyService} */ #fx;
  /** @type {() => HabitService} */ #habits;

  constructor({ habits }) {
    this.#store = Store.getInstance();
    this.#fx = new CurrencyService();
    this.#habits = habits;
  }

  render(opts = {}) {
    const state = this.#store.getState();
    const home = state.user.homeCurrency;
    const existing = opts.id ? this.#habits().all(state).find((h) => h.id === opts.id) : null;
    const h = existing ?? { name: opts.preset?.name ?? '', words: opts.preset?.words ?? [], categoryIds: [], itemIds: [], icon: 'tag', color: HabitService.COLORS[0] };
    const cats = (state.categories || []).filter((c) => c.type === 'expense');
    const mains = cats.filter((c) => !c.parentId);
    const shortcuts = (state.regularItems || []).filter((i) => i.payLater !== true);
    const id = Html.escape(existing && !existing.implicit ? existing.id : '');
    const catOption = (c, depth) => `
      <label class="check"><input type="checkbox" name="categoryIds" value="${Html.escape(c.id)}" ${(h.categoryIds || []).includes(c.id) ? 'checked' : ''}>${depth ? '— ' : ''}${Html.escape(c.name)}</label>`;
    return `
      <form class="p-5" style="min-width:320px;max-width:480px" onsubmit="window.__app.submitHabit(event,'${id}','${Html.escape(existing?.implicit ? existing.itemIds[0] : '')}')">
        <div class="flex items-center justify-between mb-1">
          <h3 class="text-lg font-semibold">${existing ? 'Edit habit' : 'New habit'}</h3>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>
        </div>
        <p class="text-xs text-zinc-500 mb-4">Follow one small, repeated spend across all your entries — however they were added.</p>

        <label class="text-xs text-zinc-500">Name</label>
        <input class="input mb-3" name="name" required maxlength="40" placeholder="e.g. Coffee, Swiggy, Autos" value="${Html.escape(h.name)}">

        <label class="text-xs text-zinc-500">Words in the payee or note (comma between them)</label>
        <input class="input mb-1" name="words" maxlength="200" placeholder="e.g. coffee, chai, starbucks" value="${Html.escape((h.words || []).join(', '))}">
        <div class="text-[11px] text-zinc-500 mb-3">Whole words; capitals don't matter.</div>

        ${shortcuts.length ? `
        <label class="text-xs text-zinc-500 block mb-1">Entries from these shortcuts</label>
        <div class="checks mb-3">${shortcuts.map((i) => `<label class="check"><input type="checkbox" name="itemIds" value="${Html.escape(i.id)}" ${(h.itemIds || []).includes(i.id) ? 'checked' : ''}>${Html.escape(i.name)}</label>`).join('')}</div>` : ''}

        <details class="mb-3" ${(h.categoryIds || []).length ? 'open' : ''}>
          <summary class="text-xs text-zinc-500 cursor-pointer">Or everything in a category</summary>
          <div class="checks mt-2" style="max-height:10rem;overflow:auto">
            ${mains.map((m) => catOption(m, 0) + cats.filter((c) => c.parentId === m.id).map((c) => catOption(c, 1)).join('')).join('')}
          </div>
        </details>

        <label class="text-xs text-zinc-500 block mb-1">Limit per month (optional)</label>
        <div class="grid grid-cols-2 gap-3 mb-1">
          <div class="flex items-center gap-2"><input class="input" type="number" min="0" step="1" name="limitCount" placeholder="—" value="${h.limitCount || ''}"><span class="text-xs text-zinc-500">times</span></div>
          <div class="flex items-center gap-2"><span class="text-xs text-zinc-500">${Html.escape(home)}</span><input class="input" type="number" min="0" step="${CurrencyService.stepFor(home)}" name="limitAmount" placeholder="—" value="${h.limitAmount ? this.#fx.fromMinor(h.limitAmount, home) : ''}"></div>
        </div>
        <div class="text-[11px] text-zinc-500 mb-3">You'll see a note when an entry brings it near or over.</div>

        <label class="text-xs text-zinc-500 block mb-1">Icon</label>
        <div class="flex flex-wrap gap-2 mb-4">
          ${HabitService.ICONS.map((ic, i) => `
            <label class="cursor-pointer"><input type="radio" name="icon" value="${ic}" class="sr-only" ${h.icon === ic || (!h.icon && i === 0) ? 'checked' : ''}>
              <span class="habit-icon-pick" style="color:${HabitService.COLORS[i % HabitService.COLORS.length]}"><i data-lucide="${ic}"></i></span></label>`).join('')}
        </div>

        <div class="flex gap-2">
          ${existing && !existing.implicit ? `<button type="button" class="btn btn-outline text-rose-500" onclick="window.__app.deleteHabit('${id}')"><i data-lucide="trash-2"></i></button>` : ''}
          <div class="flex-1"></div>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
          <button class="btn btn-primary" type="submit"><i data-lucide="check"></i> Save</button>
        </div>
      </form>`;
  }
}
