/**
 * SharedCategorySource — a read-only CategoryService stand-in over SOMEONE
 * ELSE's category list.
 *
 * When a family member contributes a transaction to an account shared with
 * them, the row is written into the OWNER's book. Its categoryId therefore has
 * to be one of the owner's category ids — a local id means nothing over there
 * and the owner sees the row as "Uncategorised".
 *
 * The owner's full category tree already travels in the family-share snapshot
 * (`share.categories`), so this class wraps that plain array in the exact query
 * surface CategoryPickerSheet relies on. Mutations are refused: you cannot
 * create a category in someone else's book.
 *
 * Mirrors mobile-app/src/state/categorySource.js so both platforms resolve a
 * shared account's categories the same way.
 */
export class SharedCategorySource {
  /** @type {object[]} */
  #cats;

  /** @param {object[]} list  the owner's categories, from the share snapshot */
  constructor(list) {
    this.#cats = Array.isArray(list) ? list : [];
  }

  /** The wrapped list — callers pass it to CategoryField for labelling. */
  get all() { return this.#cats; }

  /** @param {object} c @param {string|null} type */
  #match(c, type) { return !type || c.type === type; }

  // ── Queries (same signatures as CategoryService) ──────────────────────

  /** @param {string} id @returns {object|undefined} */
  find(id) { return this.#cats.find((c) => c.id === id); }

  /** @param {string} parentId @returns {object[]} */
  children(parentId) { return this.#cats.filter((c) => c.parentId === parentId); }

  /**
   * @param {string} parentId
   * @param {'expense'|'income'|'transfer'|null} [type]
   * @returns {object[]}
   */
  visibleChildren(parentId, type = null) {
    return this.children(parentId)
      .filter((c) => this.#match(c, type))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** @param {string} id @param {string|null} [type] @returns {boolean} */
  hasChildren(id, type = null) { return this.visibleChildren(id, type).length > 0; }

  /**
   * Roots that are reachable for a type — the root itself matches, or it owns
   * at least one matching child.
   * @param {'expense'|'income'|'transfer'|null} [type]
   * @returns {object[]}
   */
  visibleRoots(type = null) {
    return this.#cats
      .filter((c) => !c.parentId)
      .filter((root) => this.#match(root, type)
        || this.#cats.some((c) => c.parentId === root.id && this.#match(c, type)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Subcategories whose parent is missing from the snapshot — surfaced under
   * "Ungrouped" so they stay reachable.
   * @param {'expense'|'income'|'transfer'|null} [type]
   * @returns {object[]}
   */
  orphans(type = null) {
    const ids = new Set(this.#cats.map((c) => c.id));
    return this.#cats
      .filter((c) => c.parentId && !ids.has(c.parentId) && this.#match(c, type))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** @param {string} id @returns {string} "Parent / Child" */
  fullName(id) {
    const c = this.find(id);
    if (!c) return '';
    if (c.parentId) {
      const p = this.find(c.parentId);
      if (p) return `${p.name} / ${c.name}`;
    }
    return c.name;
  }

  /**
   * @param {string} query
   * @param {'expense'|'income'|'transfer'|null} [type]
   * @param {number} [limit=60]
   * @returns {object[]}
   */
  search(query, type = null, limit = 60) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];
    return this.#cats
      .filter((c) => this.#match(c, type))
      .filter((c) => this.fullName(c.id).toLowerCase().includes(q))
      .sort((a, b) => {
        const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        return ap - bp || this.fullName(a.id).localeCompare(this.fullName(b.id));
      })
      .slice(0, limit);
  }

  // ── Mutations — refused ───────────────────────────────────────────────

  /** @returns {{ok:false, reason:string}} */
  quickCreate() {
    return { ok: false, reason: 'You can’t add categories to a shared account' };
  }
}
