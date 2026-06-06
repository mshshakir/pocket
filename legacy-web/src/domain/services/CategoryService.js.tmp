/**
 * CategoryService — Category CRUD, hierarchy helpers, subcategory resolution.
 *
 * Manages the two-level category tree (root + one level of subcategories).
 * No DOM, no state side-effects.
 */
import { Store }       from '../../core/Store.js';
import { IdGenerator } from './IdGenerator.js';

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
   * Return an array of [parentId, ...childIds] for a given parent.
   * @param {string} catId
   * @returns {string[]}
   */
  descendants(catId) {
    const ids = [catId];
    this.#store.getState().categories.forEach((c) => {
      if (c.parentId === catId) ids.push(c.id);
    });
    return ids;
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
    });
    this.#store.flush();
  }
}
