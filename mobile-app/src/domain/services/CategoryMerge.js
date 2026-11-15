/**
 * CategoryMerge — move everything from one category into another, then
 * remove the first. Also used by Delete when the category is still in use.
 *
 * What moves (every place a category id is kept in the book):
 *   transactions[].categoryId and splits[].categoryId · budgets[].categoryIds
 *   (+ legacy categoryId) · regularItems[].categoryId · habits[].categoryIds ·
 *   merchantCategories (payee → category) · user.collapsedCategories.
 *
 * Sub-categories of the source move under the target; one whose name matches
 * a sub-category already there (any case) is merged into it as well.
 * The target keeps its own name, colour, icon and budget limit.
 *
 * Undo works from a snapshot of every object that changed, looked up again by
 * id on revert — a sync may have swapped the arrays in between.
 *
 * Pure: works on the state object it is given; no DOM, no Store.
 */
export class CategoryMerge {
  /** @type {object} */ #state;

  /** @param {object} state  the book (Store.getState()) */
  constructor(state) {
    this.#state = state;
  }

  // ── Queries ──────────────────────────────────────────────────────────

  /**
   * Where a category could be merged into: same type, not itself, not one of
   * its own sub-categories. A category with sub-categories can only go into a
   * main category (the tree is two levels deep).
   * @param {string} sourceId
   * @returns {object[]} sorted by full name
   */
  targets(sourceId) {
    const src = this.#find(sourceId);
    if (!src) return [];
    return this.#cats()
      .filter((c) => this.check(sourceId, c.id).ok)
      .sort((a, b) => this.#fullName(a).localeCompare(this.#fullName(b)));
  }

  /**
   * @param {string} sourceId
   * @param {string} targetId
   * @returns {{ok:true}|{ok:false, reason:string}}
   */
  check(sourceId, targetId) {
    const src = this.#find(sourceId), tgt = this.#find(targetId);
    if (!src || !tgt) return { ok: false, reason: 'Category not found' };
    if (src.id === tgt.id) return { ok: false, reason: 'Pick a different category' };
    if (src.type !== tgt.type) return { ok: false, reason: `${tgt.name} is a ${tgt.type} category` };
    if (tgt.parentId === src.id) return { ok: false, reason: `${tgt.name} is inside ${src.name}` };
    if (this.#children(src.id).length && tgt.parentId) {
      return { ok: false, reason: `${src.name} has sub-categories, so it can only go into a main category` };
    }
    return { ok: true };
  }

  /**
   * What a merge would change, for the confirm line.
   * @param {string} sourceId
   * @param {string} targetId
   * @returns {{entries:number, regulars:number, budgets:number, habits:number, movedSubs:string[], mergedSubs:string[]}}
   */
  preview(sourceId, targetId) {
    const map  = this.#idMap(sourceId, targetId);
    const from = new Set(map.keys());
    const movedSubs = [], mergedSubs = [];
    for (const ch of this.#children(sourceId)) (map.has(ch.id) ? mergedSubs : movedSubs).push(ch.name);
    return {
      entries:  this.#list('transactions').filter((t) => this.#txUses(t, from)).length,
      regulars: this.#list('regularItems').filter((i) => from.has(i.categoryId)).length,
      budgets:  this.#list('budgets').filter((b) => this.#budgetIds(b).some((id) => from.has(id))).length,
      habits:   this.#list('habits').filter((h) => (h.categoryIds || []).some((id) => from.has(id))).length,
      movedSubs,
      mergedSubs,
    };
  }

  /**
   * How much of the book uses a category (and its sub-categories). Zero means
   * it can simply be deleted.
   * @param {string} id
   * @returns {number}
   */
  usage(id) {
    const ids = new Set([id, ...this.#children(id).map((c) => c.id)]);
    return this.#list('transactions').filter((t) => this.#txUses(t, ids)).length
      + this.#list('regularItems').filter((i) => ids.has(i.categoryId)).length
      + this.#list('budgets').filter((b) => this.#budgetIds(b).some((x) => ids.has(x))).length
      + this.#list('habits').filter((h) => (h.categoryIds || []).some((x) => ids.has(x))).length;
  }

  // ── Mutations ────────────────────────────────────────────────────────

  /**
   * Merge source into target.
   * @param {string} sourceId
   * @param {string} targetId
   * @returns {{ok:true, summary:object, undo:object}|{ok:false, reason:string}}
   */
  apply(sourceId, targetId) {
    const can = this.check(sourceId, targetId);
    if (!can.ok) return can;
    const summary = this.preview(sourceId, targetId);
    const map     = this.#idMap(sourceId, targetId);
    const undo    = { objects: [], removed: [], merchant: null, collapsed: null };
    const keep    = (coll, obj) => undo.objects.push({ coll, id: obj.id, copy: CategoryMerge.#copy(obj) });
    const to      = (id) => map.get(id) ?? id;

    for (const t of this.#list('transactions')) {
      if (!this.#txUses(t, map)) continue;
      keep('transactions', t);
      if (map.has(t.categoryId)) t.categoryId = to(t.categoryId);
      if (Array.isArray(t.splits)) for (const s of t.splits) if (map.has(s.categoryId)) s.categoryId = to(s.categoryId);
    }
    for (const i of this.#list('regularItems')) {
      if (!map.has(i.categoryId)) continue;
      keep('regularItems', i);
      i.categoryId = to(i.categoryId);
    }
    for (const b of this.#list('budgets')) {
      if (!this.#budgetIds(b).some((id) => map.has(id))) continue;
      keep('budgets', b);
      b.categoryIds = CategoryMerge.#unique(this.#budgetIds(b).map(to));
      b.categoryId  = b.categoryIds[0] ?? null;
    }
    for (const h of this.#list('habits')) {
      if (!(h.categoryIds || []).some((id) => map.has(id))) continue;
      keep('habits', h);
      h.categoryIds = CategoryMerge.#unique(h.categoryIds.map(to));
    }
    const merchant = this.#state.merchantCategories;
    if (merchant && Object.values(merchant).some((id) => map.has(id))) {
      undo.merchant = { ...merchant };
      for (const k of Object.keys(merchant)) merchant[k] = to(merchant[k]);
    }
    const collapsed = this.#state.user?.collapsedCategories;
    if (Array.isArray(collapsed) && collapsed.some((id) => map.has(id))) {
      undo.collapsed = collapsed.slice();
      this.#state.user.collapsedCategories = collapsed.filter((id) => !map.has(id));
    }

    // Sub-categories that aren't merged move under the target.
    for (const ch of this.#children(sourceId)) {
      if (map.has(ch.id)) continue;
      keep('categories', ch);
      ch.parentId = targetId;
    }
    // Remove every merged category (the source, and matched sub-categories).
    this.#state.categories = this.#cats().filter((c) => {
      if (!map.has(c.id)) return true;
      undo.removed.push(CategoryMerge.#copy(c));
      return false;
    });

    return { ok: true, summary, undo };
  }

  /**
   * Put a merge back.
   * @param {object} undo  from apply()
   */
  revert(undo) {
    if (!undo) return;
    const cats = this.#cats();
    for (const c of undo.removed) if (!cats.some((x) => x.id === c.id)) cats.push(CategoryMerge.#copy(c));
    for (const { coll, id, copy } of undo.objects) {
      const obj = this.#list(coll).find((x) => x.id === id);
      if (!obj) continue;
      for (const k of Object.keys(obj)) if (!(k in copy)) delete obj[k];
      Object.assign(obj, CategoryMerge.#copy(copy));
    }
    if (undo.merchant) this.#state.merchantCategories = { ...undo.merchant };
    if (undo.collapsed && this.#state.user) this.#state.user.collapsedCategories = undo.collapsed.slice();
  }

  // ── Private ──────────────────────────────────────────────────────────

  /** source → target, plus each source sub-category → same-named target sub-category */
  #idMap(sourceId, targetId) {
    const map = new Map([[sourceId, targetId]]);
    const theirs = new Map(this.#children(targetId).map((c) => [CategoryMerge.#key(c.name), c.id]));
    for (const ch of this.#children(sourceId)) {
      const match = theirs.get(CategoryMerge.#key(ch.name));
      if (match) map.set(ch.id, match);
    }
    return map;
  }

  /** @param {{has:(id:string)=>boolean}} ids  a Set or a Map */
  #txUses(t, ids) {
    return ids.has(t.categoryId) || (Array.isArray(t.splits) && t.splits.some((s) => ids.has(s.categoryId)));
  }

  #budgetIds(b) {
    if (Array.isArray(b.categoryIds) && b.categoryIds.length) return b.categoryIds;
    return b.categoryId ? [b.categoryId] : [];
  }

  #cats()           { return this.#state.categories || (this.#state.categories = []); }
  #list(coll)       { return coll === 'categories' ? this.#cats() : (this.#state[coll] || []); }
  #find(id)         { return this.#cats().find((c) => c.id === id); }
  #children(id)     { return this.#cats().filter((c) => c.parentId === id); }
  #fullName(c) {
    const p = c.parentId ? this.#find(c.parentId) : null;
    return p ? `${p.name} / ${c.name}` : c.name;
  }

  /** Plain book data, so a JSON copy is exact (structuredClone isn't everywhere). */
  static #copy(v)     { return JSON.parse(JSON.stringify(v)); }
  static #key(name)   { return (name || '').trim().toLowerCase(); }
  static #unique(arr) { return [...new Set(arr.filter(Boolean))]; }
}
