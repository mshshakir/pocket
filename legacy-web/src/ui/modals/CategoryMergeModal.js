/**
 * CategoryMergeModal — move one or more categories into another one.
 *
 * Ways in:
 *   mode 'merge'  — Categories → Merge (pick several), or Edit category → Merge into…
 *   mode 'delete' — Delete on a category that's still used: its entries need
 *                   somewhere to go, so it's the same merge, worded as a delete.
 *
 * opts: { ids?: string[], id?: string, mode?: 'merge'|'delete', into?: string }
 */
import { Html } from '../../core/Html.js';

export class CategoryMergeModal {
  /** The "+ New category…" choice in the picker. */
  static NEW = '__new';

  /** @type {() => import('../../domain/services/CategoryService.js').CategoryService} */
  #categories;

  /** @param {{categories: () => object}} deps */
  constructor({ categories }) {
    this.#categories = categories;
  }

  /** The picked ids from opts, existing ones only. */
  static idsOf(opts = {}) {
    return Array.isArray(opts.ids) ? opts.ids : (opts.id ? [opts.id] : []);
  }

  render(opts = {}) {
    const cats  = this.#categories();
    const srcs  = CategoryMergeModal.idsOf(opts).map((id) => cats.find(id)).filter(Boolean);
    const close = `<button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>`;
    const head  = (title) => `<div class="flex items-center justify-between mb-3"><h3 class="text-lg font-semibold">${title}</h3>${close}</div>`;
    if (!srcs.length) return `<div class="p-5">${head('Category not found')}</div>`;

    const del     = opts.mode === 'delete';
    const ids     = srcs.map((c) => c.id);
    const idsArg  = ids.join(',');
    const one     = srcs.length === 1;
    const name    = one ? Html.escape(srcs[0].name) : `${srcs.length} categories`;
    const title   = del ? `Delete ${name}` : `Merge ${name}`;

    if (new Set(srcs.map((c) => c.type)).size > 1) {
      return `<div class="p-5">${head(title)}<p class="text-sm text-zinc-500">Pick categories of one type — all expense, or all income.</p></div>`;
    }
    const targets = cats.mergeTargetsMany(ids);
    const keep    = cats.mergeKeepOptions(ids);
    const into    = [...targets, ...keep].find((t) => t.id === opts.into)?.id || '';
    const list    = one ? '' : `<div class="flex flex-wrap gap-1 mb-3">${srcs.map((c) => `<span class="chip">${Html.escape(cats.fullName(c.id))}</span>`).join('')}</div>`;
    const intro   = del
      ? `${name} is still in use. Pick where its entries should go — then it's deleted.`
      : one
        ? `Everything in ${name} moves to the category you pick, then ${name} is removed. The category you pick keeps its name, colour and limit.`
        : `Keep one of them, move them all into another category, or make a new one. Everything moves there and the rest are removed.`;
    const opt = (t, label) => `<option value="${t.id}" ${t.id === into ? 'selected' : ''}>${label}</option>`;

    return `
      <form onsubmit="window.__app.mergeCategory(event,'${idsArg}','${del ? 'delete' : 'merge'}')" class="p-5">
        ${head(title)}
        ${list}
        <p class="text-sm text-zinc-500 mb-4">${intro}</p>

        <div class="mb-3">
          <label class="text-xs text-zinc-500">Move to</label>
          <select class="select" name="into" required onchange="window.__app.previewCategoryMerge('${idsArg}', this.value)">
            <option value="">— Pick a category —</option>
            ${keep.length ? `<optgroup label="Keep one of these">${keep.map((t) => opt(t, `Keep ${Html.escape(cats.fullName(t.id))}`)).join('')}</optgroup>` : ''}
            ${targets.length ? `<optgroup label="${keep.length ? 'Or move into' : 'Move into'}">${targets.map((t) => opt(t, Html.escape(cats.fullName(t.id)))).join('')}</optgroup>` : ''}
            <option value="${CategoryMergeModal.NEW}">+ New category…</option>
          </select>
        </div>

        <div id="categoryMergeNew" class="mb-3" style="display:none">
          <label class="text-xs text-zinc-500">New category name</label>
          <input class="input" name="newName" autocomplete="off" oninput="window.__app.previewCategoryMerge('${idsArg}', '${CategoryMergeModal.NEW}')">
        </div>

        <div id="categoryMergePreview" class="text-sm mb-4">${into ? this.previewText(ids, into) : ''}</div>

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
   * "Moves 42 entries and 2 regulars to Food. Sub-category Snacks moves under Food."
   * @param {string[]} ids
   * @param {string} intoId  a category id, or CategoryMergeModal.NEW
   * @param {string} [newName]  the name typed for a new category
   * @returns {string} HTML
   */
  previewText(ids, intoId, newName = '') {
    const plan = this.#plan(ids, intoId, newName);
    if (plan.note !== undefined) return `<div class="text-zinc-500">${Html.escape(plan.note)}</div>`;
    const p = plan.summary;
    const parts = [
      CategoryMergeModal.#count(p.entries, 'entry', 'entries'),
      CategoryMergeModal.#count(p.regulars, 'regular', 'regulars'),
      CategoryMergeModal.#count(p.budgets, 'budget', 'budgets'),
      CategoryMergeModal.#count(p.habits, 'habit', 'habits'),
    ].filter(Boolean);
    const what  = parts.length ? `Moves ${CategoryMergeModal.#join(parts)}` : 'Nothing uses them yet; they just go';
    const lines = [];
    if (plan.isNew) lines.push(`Makes a new category <b>${Html.escape(plan.label)}</b>.`);
    if (plan.removed.length) lines.push(`Removes ${CategoryMergeModal.#join(plan.removed.map((n) => Html.escape(n)))}.`);
    lines.push(`${what} to <b>${Html.escape(plan.label)}</b>.`);
    if (p.movedSubs.length)  lines.push(`${CategoryMergeModal.#subs(p.movedSubs)} ${p.movedSubs.length === 1 ? 'moves' : 'move'} under ${Html.escape(plan.shortName)}.`);
    if (p.mergedSubs.length) lines.push(`${CategoryMergeModal.#subs(p.mergedSubs)} ${p.mergedSubs.length === 1 ? 'joins the one' : 'join the ones'} with the same name.`);
    return lines.map((l) => `<div>${l}</div>`).join('') +
      `<div class="text-xs text-zinc-500 mt-1">You can undo this straight after.</div>`;
  }

  /**
   * Work out what the picked choice means: keep one of the ticked, another
   * category, or a new one.
   * @returns {{note?:string, summary?:object, label?:string, shortName?:string, isNew?:boolean, removed?:string[]}}
   */
  #plan(ids, intoId, newName) {
    const cats = this.#categories();
    const name = (id) => cats.find(id)?.name || '';
    if (intoId === CategoryMergeModal.NEW) {
      if (!(newName || '').trim()) return { note: 'Type a name for the new category.' };
      const d = cats.draftMergeTarget(ids, newName);
      if (!d.ok) return { note: d.reason };
      const summary = cats.mergePreviewNew(ids, newName);
      if (!summary) return { note: 'They can\'t all go into a new category.' };
      const parent  = d.category.parentId ? name(d.category.parentId) : '';
      return { summary, isNew: true, shortName: d.category.name,
        label: parent ? `${parent} / ${d.category.name}` : d.category.name, removed: ids.map(name) };
    }
    if (!cats.find(intoId)) return { note: '' };
    const from    = ids.includes(intoId) ? ids.filter((id) => id !== intoId) : ids;
    const summary = cats.mergePreviewMany(from, intoId);
    if (!summary) return { note: 'That one won\'t work — pick another.' };
    return { summary, label: cats.fullName(intoId), shortName: name(intoId), removed: from.length > 1 || ids.includes(intoId) ? from.map(name) : [] };
  }

  // ── Private ──────────────────────────────────────────────────────────

  static #count(n, one, many) { return n ? `${n} ${n === 1 ? one : many}` : ''; }

  static #join(parts) {
    return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  }

  static #subs(names) {
    const list = names.map((n) => Html.escape(n));
    return names.length === 1 ? `Sub-category ${list[0]}` : `Sub-categories ${CategoryMergeModal.#join(list)}`;
  }
}
