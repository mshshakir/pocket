/**
 * CategoryMergeModal — move a category into another one.
 *
 * Two ways in:
 *   mode 'merge'  — Edit category → More options → Merge into…
 *   mode 'delete' — Delete on a category that's still used: its entries need
 *                   somewhere to go, so it's the same merge, worded as a delete.
 *
 * opts: { id: string, mode?: 'merge'|'delete', into?: string }
 */
import { Html } from '../../core/Html.js';

export class CategoryMergeModal {
  /** @type {() => import('../../domain/services/CategoryService.js').CategoryService} */
  #categories;

  /** @param {{categories: () => object}} deps */
  constructor({ categories }) {
    this.#categories = categories;
  }

  render(opts = {}) {
    const cats    = this.#categories();
    const src     = cats.find(opts.id);
    const close   = `<button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>`;
    if (!src) return `<div class="p-5"><div class="flex justify-between items-center"><b>Category not found</b>${close}</div></div>`;

    const del     = opts.mode === 'delete';
    const targets = cats.mergeTargets(src.id);
    const into    = targets.find((t) => t.id === opts.into)?.id || '';
    const name    = Html.escape(src.name);
    const title   = del ? `Delete ${name}` : `Merge ${name}`;
    const intro   = del
      ? `${name} is still in use. Pick where its entries should go — then it's deleted.`
      : `Everything in ${name} moves to the category you pick, then ${name} is removed. The other category keeps its name, colour and limit.`;

    if (!targets.length) {
      return `
        <div class="p-5">
          <div class="flex items-center justify-between mb-3"><h3 class="text-lg font-semibold">${title}</h3>${close}</div>
          <p class="text-sm text-zinc-500">There's no other ${Html.escape(src.type)} category to move it to. Add one first.</p>
        </div>`;
    }

    return `
      <form onsubmit="window.__app.mergeCategory(event,'${src.id}','${del ? 'delete' : 'merge'}')" class="p-5">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-lg font-semibold">${title}</h3>${close}
        </div>
        <p class="text-sm text-zinc-500 mb-4">${intro}</p>

        <div class="mb-3">
          <label class="text-xs text-zinc-500">Move to</label>
          <select class="select" name="into" required onchange="window.__app.previewCategoryMerge('${src.id}', this.value)">
            <option value="">— Pick a category —</option>
            ${targets.map((t) => `<option value="${t.id}" ${t.id === into ? 'selected' : ''}>${Html.escape(cats.fullName(t.id))}</option>`).join('')}
          </select>
        </div>

        <div id="categoryMergePreview" class="text-sm mb-4">${into ? this.previewText(src.id, into) : ''}</div>

        <div class="flex items-center gap-2">
          <div class="flex-1"></div>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
          <button type="submit" class="btn ${del ? 'btn-outline text-rose-500' : 'btn-primary'}">
            <i data-lucide="${del ? 'trash-2' : 'merge'}"></i> ${del ? 'Move and delete' : 'Merge'}
          </button>
        </div>
      </form>`;
  }

  /**
   * The plain-words line under the picker, e.g.
   * "Moves 42 entries and 2 regulars to Food. Its sub-category Snacks moves too."
   * @param {string} id
   * @param {string} intoId
   * @returns {string} HTML
   */
  previewText(id, intoId) {
    const cats = this.#categories();
    const tgt  = cats.find(intoId);
    if (!tgt) return '';
    const p     = cats.mergePreview(id, intoId);
    const parts = [
      CategoryMergeModal.#count(p.entries, 'entry', 'entries'),
      CategoryMergeModal.#count(p.regulars, 'regular', 'regulars'),
      CategoryMergeModal.#count(p.budgets, 'budget', 'budgets'),
      CategoryMergeModal.#count(p.habits, 'habit', 'habits'),
    ].filter(Boolean);
    const what  = parts.length ? `Moves ${CategoryMergeModal.#join(parts)}` : 'Nothing uses it yet; it just goes';
    const lines = [`${what} to <b>${Html.escape(cats.fullName(tgt.id))}</b>.`];
    if (p.movedSubs.length)  lines.push(`${CategoryMergeModal.#subs(p.movedSubs)} moves under ${Html.escape(tgt.name)}.`);
    if (p.mergedSubs.length) lines.push(`${CategoryMergeModal.#subs(p.mergedSubs)} joins the one with the same name.`);
    return lines.map((l) => `<div>${l}</div>`).join('') +
      `<div class="text-xs text-zinc-500 mt-1">You can undo this straight after.</div>`;
  }

  // ── Private ──────────────────────────────────────────────────────────

  static #count(n, one, many) { return n ? `${n} ${n === 1 ? one : many}` : ''; }

  static #join(parts) {
    return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  }

  static #subs(names) {
    const list = names.map((n) => Html.escape(n));
    return names.length === 1 ? `Its sub-category ${list[0]}` : `Its sub-categories ${CategoryMergeModal.#join(list)}`;
  }
}
