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

  // ── Private ─────────────────────────────────────────────────────────────

  static #esc(s) {
    return (s || '').toString().replace(
      /[&<>"']/g,
      (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]),
    );
  }
}
