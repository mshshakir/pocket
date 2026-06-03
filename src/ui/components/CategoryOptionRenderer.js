/**
 * CategoryOptionRenderer — Single source of truth for category <option>/<optgroup> HTML.
 *
 * Produces a structured dropdown that mirrors the parent → child hierarchy:
 *
 *   <optgroup label="Food & Drink">
 *     <option value="…">Coffee</option>
 *     <option value="…">Groceries</option>
 *   </optgroup>
 *   <option value="…">Transport</option>   ← root with no matching children
 *
 * Rules:
 *  • Root with type-matching children  → <optgroup> containing those children.
 *  • Root with no children, matching type (or no filter) → standalone <option>.
 *  • Root whose type doesn't match AND has no matching children → skipped.
 *  • Orphaned subcategories (parent missing) → rescued as standalone <option>s.
 *
 * Type-filtering is applied INSIDE the function so a subcategory is never
 * silently dropped because its parent happens to have a different type.
 *
 * Usage (static — no instantiation needed):
 *   import { CategoryOptionRenderer } from '…/CategoryOptionRenderer.js';
 *   html += CategoryOptionRenderer.render(allCats, selectedId, 'expense');
 */
export class CategoryOptionRenderer {
  /**
   * Build <option> / <optgroup> HTML for a category <select>.
   *
   * @param {object[]}      allCats    Full category list (unfiltered).
   * @param {string|null}   selectedId Currently-selected category ID (or null).
   * @param {string|null}   typeFilter 'expense' | 'income' | 'transfer' | null (no filter).
   * @returns {string}  HTML fragment — insert after a blank "Uncategorised" <option>.
   */
  static render(allCats, selectedId, typeFilter = null) {
    const matchType    = (c) => !typeFilter || c.type === typeFilter;
    const esc          = CategoryOptionRenderer.#esc;
    const sel          = (id) => id === selectedId ? 'selected' : '';
    const renderedChildIds = new Set();

    // ── Step 1: roots with type-matching children → optgroup ─────────────
    const roots   = allCats.filter((c) => !c.parentId).sort((a, b) => a.name.localeCompare(b.name));
    const grouped = roots.map((root) => {
      const children = allCats
        .filter((c) => c.parentId === root.id && matchType(c))
        .sort((a, b) => a.name.localeCompare(b.name));

      if (children.length > 0) {
        children.forEach((c) => renderedChildIds.add(c.id));
        return `<optgroup label="${esc(root.name)}">${
          children.map((c) => `<option value="${c.id}" ${sel(c.id)}>${esc(c.name)}</option>`).join('')
        }</optgroup>`;
      }

      if (matchType(root)) {
        return `<option value="${root.id}" ${sel(root.id)}>${esc(root.name)}</option>`;
      }

      return ''; // wrong type, no matching children — omit
    }).filter(Boolean).join('');

    // ── Step 2: orphan rescue ─────────────────────────────────────────────
    // Subcategories whose parent doesn't exist in allCats are rendered
    // as standalone options so they never silently vanish from the picker.
    const orphans = allCats
      .filter((c) => c.parentId && matchType(c) && !renderedChildIds.has(c.id) &&
                     !roots.find((r) => r.id === c.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => `<option value="${c.id}" ${sel(c.id)}>${esc(c.name)}</option>`)
      .join('');

    return grouped + orphans;
  }

  /**
   * Build a flat, indented option list that mirrors the parent → child
   * hierarchy while keeping BOTH parents and children selectable.
   *
   * Unlike render() (which uses <optgroup>, whose labels are not selectable),
   * this is used where a parent category itself is a valid choice — e.g. a
   * budget that should cover a whole category including its sub-categories.
   *
   *   Food & Drink            ← selectable parent
   *      ↳ Coffee             ← selectable, indented child
   *      ↳ Groceries
   *   Transport
   *
   * @param {object[]}    allCats    Full category list (unfiltered).
   * @param {string|null} selectedId Currently-selected category ID (or null).
   * @param {string|null} typeFilter 'expense' | 'income' | 'transfer' | null.
   * @returns {string} HTML fragment of <option> elements.
   */
  static renderHierarchical(allCats, selectedId, typeFilter = null) {
    const matchType = (c) => !typeFilter || c.type === typeFilter;
    const esc       = CategoryOptionRenderer.#esc;
    const sel       = (id) => id === selectedId ? 'selected' : '';
    const childPrefix = '   ↳ '; // nbsp×3 + ↳ + nbsp
    const rendered  = new Set();

    const roots = allCats.filter((c) => !c.parentId).sort((a, b) => a.name.localeCompare(b.name));
    let html = '';
    for (const root of roots) {
      const children = allCats
        .filter((c) => c.parentId === root.id && matchType(c))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (!matchType(root) && children.length === 0) continue; // wrong type, nothing to show
      if (matchType(root)) {
        html += `<option value="${root.id}" ${sel(root.id)}>${esc(root.name)}</option>`;
      }
      for (const c of children) {
        rendered.add(c.id);
        html += `<option value="${c.id}" ${sel(c.id)}>${childPrefix}${esc(c.name)}</option>`;
      }
    }

    // Orphan rescue — subcategories whose parent is missing.
    const orphans = allCats
      .filter((c) => c.parentId && matchType(c) && !rendered.has(c.id) && !roots.find((r) => r.id === c.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => `<option value="${c.id}" ${sel(c.id)}>${esc(c.name)}</option>`)
      .join('');

    return html + orphans;
  }

  /**
   * Build an indented checkbox tree for selecting MULTIPLE categories (e.g. a
   * budget that spans several sub-categories). Parents and children both get a
   * checkbox; children are indented under their parent.
   *
   * @param {object[]}        allCats     Full category list (unfiltered).
   * @param {string[]|Set}    selectedIds Currently-checked category IDs.
   * @param {string|null}     typeFilter  'expense' | 'income' | 'transfer' | null.
   * @param {string}          name        Checkbox group name (FormData key).
   * @returns {string} HTML fragment of <label><input type="checkbox"> rows.
   */
  static renderCheckboxTree(allCats, selectedIds = [], typeFilter = null, name = 'categoryIds') {
    const set       = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
    const matchType = (c) => !typeFilter || c.type === typeFilter;
    const esc       = CategoryOptionRenderer.#esc;
    const row = (c, indent) => `
      <label class="flex items-center gap-2 py-1.5 px-2 rounded-lg cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/60 ${indent ? 'pl-7' : ''}">
        <input type="checkbox" name="${name}" value="${c.id}" ${set.has(c.id) ? 'checked' : ''} class="accent-zinc-900 dark:accent-white">
        <span class="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${c.color || '#a1a1aa'}"></span>
        <span class="text-sm ${indent ? 'text-zinc-600 dark:text-zinc-300' : 'font-medium'}">${indent ? '↳ ' : ''}${esc(c.name)}</span>
      </label>`;

    const roots    = allCats.filter((c) => !c.parentId).sort((a, b) => a.name.localeCompare(b.name));
    const rendered = new Set();
    let html = '';
    for (const root of roots) {
      const children = allCats
        .filter((c) => c.parentId === root.id && matchType(c))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (!matchType(root) && children.length === 0) continue;
      if (matchType(root)) html += row(root, false);
      for (const c of children) { rendered.add(c.id); html += row(c, true); }
    }
    const orphans = allCats
      .filter((c) => c.parentId && matchType(c) && !rendered.has(c.id) && !roots.find((r) => r.id === c.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const c of orphans) html += row(c, false);

    return html || '<div class="text-xs text-zinc-500 py-2 px-2">No matching categories yet.</div>';
  }

  // ── Private ─────────────────────────────────────────────────────────────

  static #esc(s) {
    return (s || '').toString().replace(
      /[&<>"']/g,
      (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]),
    );
  }
}
