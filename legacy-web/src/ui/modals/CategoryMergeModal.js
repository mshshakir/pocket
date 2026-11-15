/**
 * CategoryMergeModal — move one or more categories into another one.
 *
 * Ways in:
 *   mode 'merge'  — Categories → Merge (pick several), or Edit category → Merge
 *   mode 'delete' — Delete on a category that's still used: its entries need
 *                   somewhere to go, so it's the same merge, worded as a delete.
 *
 * The choice is three cards, not a dropdown, so every option is in sight:
 *   Keep one of these  — a ticked category takes the rest (2+ ticked only)
 *   Move into another  — search + list of other categories
 *   New category       — type a name
 *
 * opts: { ids?: string[], id?: string, mode?: 'merge'|'delete' }
 */
import { Html } from '../../core/Html.js';

export class CategoryMergeModal {
  /** Card keys, also the value of the form's `choice` radio. */
  static KEEP  = 'keep';
  static OTHER = 'other';
  static NEW   = 'new';

  /** @type {() => import('../../domain/services/CategoryService.js').CategoryService} */
  #categories;

  /** @param {{categories: () => object}} deps */
  constructor({ categories }) {
    this.#categories = categories;
  }

  /** The picked ids from opts. */
  static idsOf(opts = {}) {
    return Array.isArray(opts.ids) ? opts.ids : (opts.id ? [opts.id] : []);
  }

  /**
   * What the form currently says: the card picked and the category or name.
   * @param {HTMLFormElement} form
   * @returns {{choice:string, intoId:string, newName:string}}
   */
  static readForm(form) {
    const fd     = new FormData(form);
    const choice = String(fd.get('choice') || '');
    const intoId = choice === CategoryMergeModal.KEEP ? String(fd.get('keepId') || '')
      : choice === CategoryMergeModal.OTHER ? String(fd.get('otherId') || '') : '';
    return { choice, intoId, newName: String(fd.get('newName') || '') };
  }

  render(opts = {}) {
    const cats  = this.#categories();
    const srcs  = CategoryMergeModal.idsOf(opts).map((id) => cats.find(id)).filter(Boolean);
    const close = `<button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>`;
    const head  = (title) => `<div class="flex items-center justify-between mb-3"><h3 class="text-lg font-semibold">${title}</h3>${close}</div>`;
    if (!srcs.length) return `<div class="p-5">${head('Category not found')}</div>`;

    const del    = opts.mode === 'delete';
    const ids    = srcs.map((c) => c.id);
    const idsArg = ids.join(',');
    const one    = srcs.length === 1;
    const name   = one ? Html.escape(srcs[0].name) : `${srcs.length} categories`;
    const title  = del ? `Delete ${name}` : `Merge ${name}`;

    if (new Set(srcs.map((c) => c.type)).size > 1) {
      return `<div class="p-5">${head(title)}<p class="text-sm text-zinc-500">Pick categories of one type — all expense, or all income.</p></div>`;
    }
    const keep    = cats.mergeKeepOptions(ids);
    const others  = cats.mergeTargetsMany(ids);
    const list    = one ? '' : `<div class="flex flex-wrap gap-1 mb-3">${srcs.map((c) => `<span class="chip">${Html.escape(cats.fullName(c.id))}</span>`).join('')}</div>`;
    const intro   = del ? `${name} is still in use. Choose where its entries go — then it's deleted.` : 'Choose where everything goes:';
    const refresh = `window.__app.previewCategoryMerge('${idsArg}')`;

    const cards = [
      keep.length   && { key: CategoryMergeModal.KEEP,  icon: 'circle-check', label: 'Keep one of these' },
      others.length && { key: CategoryMergeModal.OTHER, icon: 'folder-input', label: 'Move into another' },
      { key: CategoryMergeModal.NEW, icon: 'circle-plus', label: 'New category' },
    ].filter(Boolean);
    const first = cards[0].key;
    const shown = (key) => (key === first ? '' : 'style="display:none"');

    return `
      <form onsubmit="window.__app.mergeCategory(event,'${idsArg}')" class="p-5 category-merge-form">
        ${head(title)}
        ${list}
        <p class="text-sm text-zinc-500 mb-3">${intro}</p>

        <div class="grid gap-2 mb-4" style="grid-template-columns:repeat(${cards.length},minmax(0,1fr))">
          ${cards.map((c) => `
            <label class="cursor-pointer">
              <input type="radio" name="choice" value="${c.key}" class="peer sr-only" ${c.key === first ? 'checked' : ''} onchange="${refresh}">
              <span class="merge-card flex flex-col items-center justify-center gap-1 text-center rounded-xl border-2 border-zinc-200 dark:border-zinc-800 px-2 py-3 text-sm font-medium h-full
                           peer-checked:border-zinc-900 peer-checked:bg-zinc-900 peer-checked:text-white dark:peer-checked:border-white dark:peer-checked:bg-white dark:peer-checked:text-zinc-900">
                <i data-lucide="${c.icon}"></i>${c.label}
              </span>
            </label>`).join('')}
        </div>

        ${keep.length ? `
        <div data-merge-panel="${CategoryMergeModal.KEEP}" class="mb-3" ${shown(CategoryMergeModal.KEEP)}>
          <div class="text-xs text-zinc-500 mb-1">Which one stays? The others move into it.</div>
          <div class="card divide-y divide-zinc-100 dark:divide-zinc-800">
            ${keep.map((c) => this.#row('keepId', c, cats, refresh)).join('')}
          </div>
        </div>` : ''}

        ${others.length ? `
        <div data-merge-panel="${CategoryMergeModal.OTHER}" class="mb-3" ${shown(CategoryMergeModal.OTHER)}>
          ${others.length > 6 ? `<input class="input mb-2" type="search" placeholder="Search categories" autocomplete="off" oninput="window.__app.filterCategoryMerge(this.value)">` : ''}
          <div class="card divide-y divide-zinc-100 dark:divide-zinc-800 overflow-y-auto" style="max-height:240px">
            ${others.map((c) => this.#row('otherId', c, cats, refresh)).join('')}
          </div>
        </div>` : ''}

        <div data-merge-panel="${CategoryMergeModal.NEW}" class="mb-3" ${shown(CategoryMergeModal.NEW)}>
          <label class="text-xs text-zinc-500">Name of the new category</label>
          <input class="input" name="newName" autocomplete="off" placeholder="e.g. Household" oninput="${refresh}">
        </div>

        <div id="categoryMergePreview" class="text-sm mb-4"></div>

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
   * The plain-words line under the choices, e.g.
   * "Removes Grocery. Moves 42 entries to Food. Sub-category Snacks moves under Food."
   * @param {string[]} ids
   * @param {{choice:string, intoId:string, newName:string}} pick  from readForm()
   * @returns {string} HTML
   */
  previewText(ids, pick) {
    const plan = this.#plan(ids, pick);
    if (plan.note !== undefined) return plan.note ? `<div class="text-zinc-500">${Html.escape(plan.note)}</div>` : '';
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

  // ── Private ──────────────────────────────────────────────────────────

  #row(field, c, cats, refresh) {
    return `
      <label class="merge-row flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900" data-name="${Html.escape(cats.fullName(c.id).toLowerCase())}">
        <input type="radio" name="${field}" value="${c.id}" onchange="${refresh}">
        <span class="icon-pill" style="background:${Html.color(c.color)}22;color:${Html.color(c.color)};width:28px;height:28px"><i data-lucide="${Html.icon(c.icon, 'tag')}" style="width:14px;height:14px"></i></span>
        <span class="flex-1 text-sm">${Html.escape(cats.fullName(c.id))}</span>
      </label>`;
  }

  /**
   * Work out what the picked choice means.
   * @returns {{note?:string, summary?:object, label?:string, shortName?:string, isNew?:boolean, removed?:string[]}}
   */
  #plan(ids, { choice, intoId, newName }) {
    const cats = this.#categories();
    const name = (id) => cats.find(id)?.name || '';
    if (choice === CategoryMergeModal.NEW) {
      if (!(newName || '').trim()) return { note: 'Type a name for the new category.' };
      const d = cats.draftMergeTarget(ids, newName);
      if (!d.ok) return { note: d.reason };
      const summary = cats.mergePreviewNew(ids, newName);
      if (!summary) return { note: 'They can\'t all go into a new category.' };
      const parent  = d.category.parentId ? name(d.category.parentId) : '';
      return { summary, isNew: true, shortName: d.category.name,
        label: parent ? `${parent} / ${d.category.name}` : d.category.name, removed: ids.map(name) };
    }
    if (!intoId || !cats.find(intoId)) {
      return { note: choice === CategoryMergeModal.KEEP ? 'Tap the one to keep.' : choice === CategoryMergeModal.OTHER ? 'Tap a category.' : '' };
    }
    const from    = choice === CategoryMergeModal.KEEP ? ids.filter((id) => id !== intoId) : ids;
    const summary = cats.mergePreviewMany(from, intoId);
    if (!summary) return { note: 'That one won\'t work — pick another.' };
    return { summary, label: cats.fullName(intoId), shortName: name(intoId),
      removed: (from.length > 1 || choice === CategoryMergeModal.KEEP) ? from.map(name) : [] };
  }

  static #count(n, one, many) { return n ? `${n} ${n === 1 ? one : many}` : ''; }

  static #join(parts) {
    return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  }

  static #subs(names) {
    const list = names.map((n) => Html.escape(n));
    return names.length === 1 ? `Sub-category ${list[0]}` : `Sub-categories ${CategoryMergeModal.#join(list)}`;
  }
}
