/**
 * CategoryService — Category CRUD, hierarchy helpers, subcategory resolution.
 *
 * Manages the two-level category tree (root + one level of subcategories).
 * No DOM, no state side-effects.
 */
import { Store }       from '../../core/Store.js';
import { IdGenerator } from './IdGenerator.js';
import { CATEGORY_APPEARANCE_DEFAULTS, NAME_COLOR_PALETTE } from '../../data/constants.js';

export class CategoryService {
  /** @type {Store} */
  #store;

  constructor() {
    this.#store = Store.getInstance();
  }

  // ── Queries ─────────────────────────────────────────────────────────

  /**
   * Find a category by ID.
   * Accepts an optional override list (used when rendering shared accounts).
   * @param {string} id
   * @param {object[]} [list]
   * @returns {object|undefined}
   */
  find(id, list) {
    const cats = list ?? this.#store.getState().categories;
    return cats.find((c) => c.id === id);
  }

  /**
   * Full hierarchical name for a category.
   * e.g. "Food & Drink / Dining out"
   * @param {string} id
   * @param {object[]} [list]
   * @returns {string}
   */
  fullName(id, list) {
    const cats = list ?? this.#store.getState().categories;
    const c    = this.find(id, cats);
    if (!c) return '';
    if (c.parentId) {
      const p = this.find(c.parentId, cats);
      if (p) return `${p.name} / ${c.name}`;
    }
    return c.name;
  }

  /**
   * Return `catId` plus its FULL subtree (children, grandchildren, …). Callers
   * such as BudgetService rely on this being the transitive closure so spend in
   * a deeply-nested category still rolls up to an ancestor budget; the previous
   * one-level version silently dropped grandchildren. Guarded against a
   * parentId cycle so a malformed tree can't loop forever.
   * @param {string} catId
   * @returns {string[]}
   */
  descendants(catId) {
    const cats = this.#store.getState().categories;
    const childrenOf = new Map();
    for (const c of cats) {
      if (!childrenOf.has(c.parentId)) childrenOf.set(c.parentId, []);
      childrenOf.get(c.parentId).push(c.id);
    }

    const out = [], seen = new Set(), stack = [catId];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue; // cycle guard
      seen.add(id);
      out.push(id);
      for (const childId of (childrenOf.get(id) || [])) stack.push(childId);
    }
    return out;
  }

  /**
   * Root categories (no parent) filtered by type.
   * @param {'expense'|'income'|'transfer'|null} [type]
   * @returns {object[]}
   */
  roots(type = null) {
    const cats = this.#store.getState().categories;
    return cats.filter(
      (c) => !c.parentId && (type === null || c.type === type),
    );
  }

  /**
   * Children of a given parent ID.
   * @param {string} parentId
   * @returns {object[]}
   */
  children(parentId) {
    return this.#store.getState().categories.filter(
      (c) => c.parentId === parentId,
    );
  }

  /**
   * Root categories that are relevant for a given type — i.e. the root itself
   * matches the type, OR it owns at least one matching child. Mirrors the
   * visibility rule used by CategoryOptionRenderer so the picker and the old
   * dropdowns agree on what is reachable.
   * @param {'expense'|'income'|'transfer'|null} [type]
   * @returns {object[]} sorted by name
   */
  visibleRoots(type = null, list = null) {
    const cats  = list || this.#store.getState().categories;
    const match = (c) => !type || c.type === type;
    return cats
      .filter((c) => !c.parentId)
      .filter((root) => match(root) || cats.some((c) => c.parentId === root.id && match(c)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Children of a parent, filtered by type and sorted by name.
   * @param {string} parentId
   * @param {'expense'|'income'|'transfer'|null} [type]
   * @returns {object[]}
   */
  visibleChildren(parentId, type = null) {
    const match = (c) => !type || c.type === type;
    return this.children(parentId)
      .filter(match)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Subcategories whose parent no longer exists — these would otherwise be
   * unreachable from a parent-first picker, so callers surface them under an
   * "Ungrouped" bucket.
   * @param {'expense'|'income'|'transfer'|null} [type]
   * @returns {object[]}
   */
  orphans(type = null, list = null) {
    const cats  = list || this.#store.getState().categories;
    const ids   = new Set(cats.map((c) => c.id));
    const match = (c) => !type || c.type === type;
    return cats
      .filter((c) => c.parentId && !ids.has(c.parentId) && match(c))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Flat search across the whole tree — matches on the category's own name and
   * on its "Parent / Child" full name, so typing a parent name surfaces all of
   * its children.
   * @param {string} query
   * @param {'expense'|'income'|'transfer'|null} [type]
   * @param {number} [limit=60]
   * @returns {object[]}
   */
  search(query, type = null, limit = 60) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];
    const cats  = this.#store.getState().categories;
    const match = (c) => !type || c.type === type;
    return cats
      .filter(match)
      .filter((c) => this.fullName(c.id, cats).toLowerCase().includes(q))
      .sort((a, b) => {
        // Prefix matches on the leaf name rank first, then alphabetical.
        const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        return ap - bp || this.fullName(a.id, cats).localeCompare(this.fullName(b.id, cats));
      })
      .slice(0, limit);
  }

  /**
   * True when a category has at least one type-matching child, meaning it acts
   * as a group header rather than a directly-assignable category.
   * @param {string} id
   * @param {'expense'|'income'|'transfer'|null} [type]
   * @returns {boolean}
   */
  hasChildren(id, type = null) {
    return this.visibleChildren(id, type).length > 0;
  }

  /**
   * Derive an icon + colour for a category from its name, so quick-add flows
   * (picker, CSV import) produce something better than a grey generic tag.
   * @param {string} name
   * @param {'expense'|'income'|'transfer'} [type='expense']
   * @returns {{icon:string, color:string}}
   */
  guessAppearance(name, type = 'expense') {
    const n = (name || '').toLowerCase();
    for (const def of CATEGORY_APPEARANCE_DEFAULTS) {
      if (def.keys.some((k) => n.includes(k))) return { icon: def.icon, color: def.color };
    }
    if (type === 'income')   return { icon: 'banknote',         color: '#22c55e' };
    if (type === 'transfer') return { icon: 'arrow-right-left', color: '#737373' };
    return { icon: 'tag', color: CategoryService.colorForName(name) };
  }

  /**
   * Stable, deterministic colour for a name (same name → same colour).
   * @param {string} name
   * @returns {string} hex colour
   */
  static colorForName(name) {
    let h = 0;
    for (const c of (name || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return NAME_COLOR_PALETTE[h % NAME_COLOR_PALETTE.length];
  }

  // ── Mutations ────────────────────────────────────────────────────────

  /**
   * Create a new category.
   * @param {object} data
   * @returns {object}
   */
  create(data) {
    const cat = {
      id:          IdGenerator.generate('cat'),
      name:        data.name,
      icon:        data.icon  || 'tag',
      color:       data.color || '#737373',
      type:        data.type  || 'expense',
      parentId:    data.parentId   || null,
      budgetLimit: data.budgetLimit || null,
    };
    this.#store.getState().categories.push(cat);
    this.#store.flush();
    return cat;
  }

  /**
   * Create a category from just a name — icon and colour are derived from the
   * name. Used by the inline "add" rows in CategoryPickerSheet.
   *
   * @param {string} name
   * @param {object} [opts]
   * @param {string|null} [opts.parentId=null]
   * @param {'expense'|'income'|'transfer'} [opts.type='expense']
   * @returns {{ok:true, category:object}|{ok:false, reason:string}}
   */
  quickCreate(name, { parentId = null, type = 'expense' } = {}) {
    const clean = (name || '').trim();
    if (!clean) return { ok: false, reason: 'Enter a name' };

    const siblings = this.#store.getState().categories.filter(
      (c) => (c.parentId || null) === (parentId || null),
    );
    const dupe = siblings.find((c) => c.name.toLowerCase() === clean.toLowerCase());
    if (dupe) return { ok: false, reason: `"${dupe.name}" already exists here` };

    const look = this.guessAppearance(clean, type);
    return { ok: true, category: this.create({ name: clean, parentId, type, ...look }) };
  }

  /**
   * Update an existing category.
   * @param {string} id
   * @param {object} changes
   * @returns {object|null}
   */
  update(id, changes) {
    const cat = this.find(id);
    if (!cat) return null;
    Object.assign(cat, changes);
    this.#store.flush();
    return cat;
  }

  /**
   * Delete a category (and unlink its children).
   * @param {string} id
   */
  delete(id) {
    const state = this.#store.getState();
    // Orphan children rather than cascade-delete them
    state.categories.forEach((c) => { if (c.parentId === id) c.parentId = null; });
    state.categories = state.categories.filter((c) => c.id !== id);
    state.transactions.forEach((t) => {
      if (t.categoryId === id) t.categoryId = null;
      // Split legs carry their own categoryId. Leaving them pointing at a
      // deleted category made that spend vanish from budgets and reports
      // without appearing anywhere as uncategorised.
      if (Array.isArray(t.splits)) {
        for (const sp of t.splits) if (sp.categoryId === id) sp.categoryId = null;
      }
    });
    this.#store.flush();
  }

  /**
   * How many transactions reference a category, counting split legs.
   * The delete guard used to check only `t.categoryId`, so a category used
   * exclusively inside splits deleted "cleanly" and silently broke those rows.
   * @param {string} id
   * @returns {number}
   */
  usageCount(id) {
    return this.#store.getState().transactions.filter((t) =>
      t.categoryId === id ||
      (Array.isArray(t.splits) && t.splits.some((s) => s.categoryId === id)),
    ).length;
  }
}
