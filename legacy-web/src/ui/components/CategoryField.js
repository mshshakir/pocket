/**
 * CategoryField — the form control that replaces a category <select>.
 *
 * Renders a button showing the current selection plus hidden <input>s carrying
 * the value, so every existing `new FormData(form)` reader keeps working
 * unchanged — `data.categoryId` and `fd.getAll('categoryIds')` behave exactly
 * as they did with the old dropdowns.
 *
 *   ┌──────────────────────────────────────────┐
 *   │ ● Food & Drink / Coffee                › │   ← button (opens the sheet)
 *   └──────────────────────────────────────────┘
 *   <input type="hidden" name="categoryId" value="cat_…">
 *
 * The field carries its own configuration in data-* attributes so the app-level
 * handler needs nothing but the element id: openCategoryPicker('txCategory').
 * setValue() patches the DOM in place, so choosing a category never triggers a
 * modal re-render and never discards a half-typed form.
 */
import { Html } from '../../core/Html.js';

export class CategoryField {
  /**
   * @param {object}   cfg
   * @param {string}   cfg.id                       unique DOM id for the field
   * @param {string}   cfg.name                     form field name ('categoryId')
   * @param {string[]|string|null} [cfg.value]      selected id(s)
   * @param {'single'|'multi'} [cfg.mode='single']
   * @param {string|null} [cfg.type=null]           type filter for the picker
   * @param {string}   [cfg.title]                  sheet heading
   * @param {string}   [cfg.placeholder]            shown when nothing is chosen
   * @param {string}   [cfg.onPick]                 optional window.__app method
   *                                                called as (fieldId, ids) after a pick
   * @param {object[]} cfg.categories               full category list (for labelling)
   * @returns {string} HTML
   */
  static render({
    id, name, value = null, mode = 'single', type = null,
    title = '', placeholder = '— Uncategorised —', onPick = '', categories = [],
  }) {
    const ids   = CategoryField.#toIds(value);
    const esc   = CategoryField.#esc;
    const label = CategoryField.#labelFor(ids, categories, placeholder);
    const dot   = CategoryField.#dotFor(ids, categories);

    return `
      <div id="${esc(id)}" class="cat-field"
           data-cat-field
           data-name="${esc(name)}"
           data-mode="${esc(mode)}"
           data-type="${esc(type || '')}"
           data-title="${esc(title)}"
           data-placeholder="${esc(placeholder)}"
           data-onpick="${esc(onPick)}">
        ${CategoryField.#hiddenInputs(name, ids)}
        <button type="button" class="select flex items-center gap-2 text-left"
                onclick="window.__app.openCategoryPicker('${Html.js(id)}')">
          ${dot}
          <span class="flex-1 min-w-0 truncate" data-cat-label>${label}</span>
          <i data-lucide="chevron-right" class="text-zinc-400" style="width:15px;height:15px;flex-shrink:0"></i>
        </button>
      </div>`;
  }

  /**
   * Read the currently-selected ids out of a rendered field.
   * @param {HTMLElement} el
   * @returns {string[]}
   */
  static getValue(el) {
    if (!el) return [];
    return [...el.querySelectorAll('input[type=hidden]')]
      .map((i) => i.value)
      .filter(Boolean);
  }

  /**
   * Replace the field's value and repaint its label in place.
   * @param {HTMLElement} el
   * @param {string[]}    ids
   * @param {object[]}    categories
   */
  static setValue(el, ids, categories = []) {
    if (!el) return;
    const name        = el.dataset.name || 'categoryId';
    const placeholder = el.dataset.placeholder || '— Uncategorised —';
    const clean       = (ids || []).filter(Boolean);

    el.querySelectorAll('input[type=hidden]').forEach((i) => i.remove());
    el.insertAdjacentHTML('afterbegin', CategoryField.#hiddenInputs(name, clean));

    const labelEl = el.querySelector('[data-cat-label]');
    if (labelEl) labelEl.innerHTML = CategoryField.#labelFor(clean, categories, placeholder);

    const btn = el.querySelector('button');
    const old = btn?.querySelector('[data-cat-dot]');
    if (btn) {
      const dotHtml = CategoryField.#dotFor(clean, categories);
      if (old) old.outerHTML = dotHtml;
      else     btn.insertAdjacentHTML('afterbegin', dotHtml);
    }
  }

  // ── Private ───────────────────────────────────────────────────────────

  /**
   * Multi-select fields emit one hidden input per id so getAll() sees an array;
   * single-select fields always emit exactly one input (empty when cleared) so
   * Object.fromEntries() still produces the key.
   */
  static #hiddenInputs(name, ids) {
    const esc = CategoryField.#esc;
    if (!ids.length) return `<input type="hidden" name="${esc(name)}" value="">`;
    return ids.map((v) => `<input type="hidden" name="${esc(name)}" value="${esc(v)}">`).join('');
  }

  static #labelFor(ids, categories, placeholder) {
    const esc = CategoryField.#esc;
    if (!ids.length) return `<span class="text-zinc-500">${esc(placeholder)}</span>`;

    const byId = new Map(categories.map((c) => [c.id, c]));
    const full = (id) => {
      const c = byId.get(id);
      if (!c) return null;
      const p = c.parentId ? byId.get(c.parentId) : null;
      return p ? `${p.name} / ${c.name}` : c.name;
    };

    const names = ids.map(full).filter(Boolean);
    if (!names.length) return `<span class="text-zinc-500">${esc(placeholder)}</span>`;
    if (names.length === 1) return esc(names[0]);
    return `${esc(names[0])} <span class="text-zinc-500">+${names.length - 1} more</span>`;
  }

  static #dotFor(ids, categories) {
    const byId  = new Map(categories.map((c) => [c.id, c]));
    const first = ids.map((i) => byId.get(i)).find(Boolean);
    const color = first?.color || '#d4d4d8';
    return `<span data-cat-dot class="inline-block rounded-full flex-shrink-0"
                  style="width:10px;height:10px;background:${CategoryField.#esc(color)}"></span>`;
  }

  static #toIds(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    return value ? [value] : [];
  }

  static #esc(s) {
    return (s ?? '').toString().replace(
      /[&<>"']/g,
      (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]),
    );
  }
}
