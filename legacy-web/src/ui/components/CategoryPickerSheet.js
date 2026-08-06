/**
 * CategoryPickerSheet — Full-screen, two-step category picker.
 *
 * Replaces the single long <select> that forced the user to scroll through
 * every subcategory at once. The flow is:
 *
 *   Step 1 (parents)   →   Step 2 (subcategories of the chosen parent)
 *   ───────────────────────────────────────────────────────────────────
 *   Food & Drink   ›       ← Food & Drink
 *   Transport      ›         Coffee
 *   Bills          ›         Groceries
 *   ＋ New parent            ＋ New subcategory in Food & Drink
 *
 * A search box at the top short-circuits both steps: typing matches against
 * "Parent / Child" full names and lets the user jump straight to a leaf.
 *
 * Modes
 *  • 'single' — one pick closes the sheet. A parent that owns subcategories is
 *    a group header only; the user must drill down to a leaf. A parent with no
 *    subcategories is itself selectable.
 *  • 'multi'  — checkboxes; parents ARE tickable (a budget on a parent covers
 *    its whole subtree) and a footer "Done" button commits.
 *
 * Extends OverlaySheet, so it renders above the open modal and the half-filled
 * transaction form underneath keeps every value the user has typed.
 */
import { OverlaySheet }         from './OverlaySheet.js';
import { Store }                from '../../core/Store.js';
import { CategoryService }      from '../../domain/services/CategoryService.js';
import { SharedCategorySource } from '../../domain/services/SharedCategorySource.js';

export class CategoryPickerSheet extends OverlaySheet {
  /** @type {Store} */           #store;
  /** @type {CategoryService} */ #categories;

  // The tree currently being browsed. Normally the local CategoryService; when
  // contributing to an account someone shared with you it is a read-only
  // SharedCategorySource over the OWNER's categories, so the id picked here is
  // meaningful in the book the transaction actually lands in.
  /** @type {CategoryService|SharedCategorySource} */ #source;

  // ── Per-open session state ────────────────────────────────────────────
  #mode      = 'single';              // 'single' | 'multi'
  #type      = null;                  // 'expense' | 'income' | 'transfer' | null
  #title     = 'Choose category';
  #allowAdd  = true;
  #onSelect  = null;                  // (ids: string[]) => void
  #selected  = /** @type {Set<string>} */ (new Set());
  #parentId  = null;                  // null → step 1 (parents)
  #query     = '';
  #adding    = false;                 // inline add row visible?

  /**
   * @param {object} [deps]
   * @param {Store}           [deps.store]
   * @param {CategoryService} [deps.categoryService]
   */
  constructor({ store, categoryService } = {}) {
    super({ id: 'catPickerRoot' });
    this.#store      = store           || Store.getInstance();
    this.#categories = categoryService || new CategoryService();
    this.#source     = this.#categories;
  }

  // ── Public API ────────────────────────────────────────────────────────

  /**
   * Open the picker.
   *
   * @param {object}   cfg
   * @param {'single'|'multi'} [cfg.mode='single']
   * @param {string|null}      [cfg.type=null]        type filter
   * @param {string[]}         [cfg.selected=[]]      pre-selected category IDs
   * @param {string}           [cfg.title]
   * @param {boolean}          [cfg.allowAdd=true]    show the inline add rows
   * @param {object[]|null}    [cfg.categories=null]  browse THIS list instead of
   *   the local book — the owner's categories when contributing to a shared
   *   account. Implies allowAdd:false (you can't create in someone else's book).
   * @param {(ids:string[]) => void} cfg.onSelect     called with the chosen IDs
   */
  open({ mode = 'single', type = null, selected = [], title, allowAdd = true, categories = null, onSelect } = {}) {
    // Point the sheet at the right tree BEFORE anything reads from it.
    this.#source   = categories ? new SharedCategorySource(categories) : this.#categories;
    this.#mode     = mode === 'multi' ? 'multi' : 'single';
    this.#type     = type || null;
    this.#title    = title || (this.#mode === 'multi' ? 'Choose categories' : 'Choose category');
    this.#allowAdd = allowAdd !== false && !categories;
    this.#onSelect = typeof onSelect === 'function' ? onSelect : null;
    this.#selected = new Set((selected || []).filter(Boolean));
    this.#query    = '';
    this.#adding   = false;

    // Deep-link straight into the parent that owns the current selection, so
    // re-opening the picker lands where the user last was. Skipped when the
    // selection doesn't match the current type filter — e.g. the form switched
    // from expense to income and the old category is no longer reachable.
    this.#parentId = null;
    const first = [...this.#selected][0];
    if (first) {
      const cat = this.#source.find(first);
      if (cat?.parentId && (!this.#type || cat.type === this.#type)) this.#parentId = cat.parentId;
    }

    this.show();
    this.focusLater('[data-cat-search]', 30);
  }

  /**
   * @override — drop the callback so a stray close can't fire it later, and
   * fall back to the local book so the next open can't inherit a stale owner's
   * tree if it forgets to pass one.
   */
  onClosed() { this.#onSelect = null; this.#source = this.#categories; }

  // ── Interaction handlers (called from inline onclick in the sheet) ─────

  /** Drill into a parent's subcategories. @param {string} id */
  openParent(id) { this.#parentId = id; this.#query = ''; this.#adding = false; this.render(); }

  /** Return to the parent list. */
  back() { this.#parentId = null; this.#adding = false; this.render(); }

  /** Live-filter as the user types. @param {string} q */
  setQuery(q) {
    this.#query  = q || '';
    this.#adding = false;
    this.#renderBody(); // patch the list only — never re-create the focused input
  }

  /**
   * Pick a category. In single mode this commits and closes; in multi mode it
   * toggles the checkbox.
   * @param {string} id
   */
  choose(id) {
    if (this.#mode === 'multi') {
      if (this.#selected.has(id)) this.#selected.delete(id);
      else                        this.#selected.add(id);
      this.#renderBody();
      this.#renderFootCount();
      return;
    }
    const cb = this.#onSelect;
    this.#selected = new Set([id]);
    this.close();
    cb?.([id]);
  }

  /** Clear the selection (single mode → "Uncategorised"). */
  chooseNone() {
    const cb = this.#onSelect;
    this.#selected.clear();
    if (this.#mode === 'multi') { this.#renderBody(); this.#renderFootCount(); return; }
    this.close();
    cb?.([]);
  }

  /** Commit the multi-select and close. */
  done() {
    const cb  = this.#onSelect;
    const ids = [...this.#selected];
    this.close();
    cb?.(ids);
  }

  /** Show / hide the inline "new category" input. @param {boolean} on */
  toggleAdd(on) {
    this.#adding = !!on;
    this.#renderBody();
    if (on) this.focusLater('[data-cat-new]');
  }

  /**
   * Create a category from the inline add row. Creates a parent when on step 1
   * and a subcategory of the open parent when on step 2. In single mode the new
   * category is selected immediately — the common case is "the category I want
   * doesn't exist yet".
   */
  submitAdd() {
    const input = this.find('[data-cat-new]');
    const name  = input?.value || '';
    const type  = this.#type || 'expense';
    const res   = this.#source.quickCreate(name, { parentId: this.#parentId, type });

    if (!res.ok) {
      const err = this.find('[data-cat-add-error]');
      if (err) err.textContent = res.reason;
      input?.focus();
      return;
    }

    this.#adding = false;

    // A brand-new parent has no children yet, so in single mode selecting it
    // straight away is the useful behaviour; in multi mode just tick it.
    if (this.#mode === 'multi') {
      this.#selected.add(res.category.id);
      this.#renderBody();
      this.#renderFootCount();
    } else if (this.#parentId) {
      this.choose(res.category.id);
    } else {
      // Created a parent from step 1 — drop the user into it so they can add
      // its first subcategory, rather than silently selecting a bare parent.
      this.openParent(res.category.id);
    }
  }

  /** Enter submits the inline add row. @param {KeyboardEvent} e */
  onAddKey(e) {
    if (e.key === 'Enter')  { e.preventDefault(); this.submitAdd(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.toggleAdd(false); }
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  /** @override */
  renderContent() {
    const parent = this.#parentId ? this.#source.find(this.#parentId) : null;

    return `
      <div class="sheet-head">
        <div class="flex items-center gap-2 mb-2">
          ${parent
            ? `<button type="button" class="btn btn-ghost px-2" onclick="window.__app.catPicker.back()" aria-label="Back">
                 <i data-lucide="chevron-left"></i>
               </button>`
            : ''}
          <div class="flex-1 min-w-0">
            <div class="text-base font-semibold truncate">${parent ? this.esc(parent.name) : this.esc(this.#title)}</div>
            ${parent ? `<div class="sheet-note">Choose a subcategory</div>` : ''}
          </div>
          <button type="button" class="btn btn-ghost px-2" onclick="window.__app.catPicker.close()" aria-label="Close">
            <i data-lucide="x"></i>
          </button>
        </div>
        <input class="input" data-cat-search type="search" autocomplete="off"
               placeholder="Search all categories…"
               value="${this.esc(this.#query)}"
               oninput="window.__app.catPicker.setQuery(this.value)">
      </div>
      <div class="sheet-body" data-cat-body>${this.#bodyHtml()}</div>
      ${this.#footHtml()}`;
  }

  #footHtml() {
    if (this.#mode !== 'multi') return '';
    return `
      <div class="sheet-foot">
        <div class="text-xs text-zinc-500" data-cat-count>${this.#countLabel()}</div>
        <div class="flex-1"></div>
        <button type="button" class="btn btn-ghost" onclick="window.__app.catPicker.chooseNone()">Clear</button>
        <button type="button" class="btn btn-primary" onclick="window.__app.catPicker.done()">
          <i data-lucide="check"></i> Done
        </button>
      </div>`;
  }

  #countLabel() {
    const n = this.#selected.size;
    return n === 0 ? 'None selected' : `${n} selected`;
  }

  #renderFootCount() {
    const el = this.find('[data-cat-count]');
    if (el) el.textContent = this.#countLabel();
  }

  #bodyHtml() {
    return this.#query.trim()
      ? this.#searchHtml()
      : (this.#parentId ? this.#childrenHtml() : this.#parentsHtml());
  }

  #renderBody() {
    this.patch('[data-cat-body]', this.#bodyHtml());
  }

  // ── Step 1: parents ───────────────────────────────────────────────────

  #parentsHtml() {
    const roots   = this.#source.visibleRoots(this.#type);
    const orphans = this.#source.orphans(this.#type);

    const rows = roots.map((root) => {
      const kids = this.#source.visibleChildren(root.id, this.#type);
      // A parent that owns subcategories is a group header — drill in.
      // A childless parent is directly selectable.
      const action = kids.length
        ? `window.__app.catPicker.openParent('${this.js(root.id)}')`
        : `window.__app.catPicker.choose('${this.js(root.id)}')`;
      const selectedHere = kids.length
        ? kids.some((k) => this.#selected.has(k.id)) || this.#selected.has(root.id)
        : this.#selected.has(root.id);
      const pickedCount = kids.filter((k) => this.#selected.has(k.id)).length;

      const trailing = kids.length
        ? `<span class="sheet-row-meta">${pickedCount ? `${pickedCount} of ${kids.length}` : kids.length}</span>
           <i data-lucide="chevron-right" class="text-zinc-400" style="width:15px;height:15px"></i>`
        : this.#tick(this.#selected.has(root.id));

      return `
        <button type="button" class="sheet-row ${selectedHere ? 'is-selected' : ''}" onclick="${action}">
          <span class="sheet-dot" style="background:${this.esc(root.color || '#a1a1aa')}"></span>
          <span class="sheet-row-name">${this.esc(root.name)}</span>
          ${trailing}
        </button>`;
    }).join('');

    const orphanRows = orphans.length
      ? `<div class="sheet-crumb mt-2 px-1">Ungrouped</div>` +
        orphans.map((c) => this.#leafRow(c, false)).join('')
      : '';

    const none = this.#mode === 'single'
      ? `<button type="button" class="sheet-row" onclick="window.__app.catPicker.chooseNone()">
           <span class="sheet-dot" style="background:#d4d4d8"></span>
           <span class="sheet-row-name text-zinc-500">Uncategorised</span>
           ${this.#tick(this.#selected.size === 0)}
         </button>`
      : '';

    const empty = (!roots.length && !orphans.length)
      ? `<div class="sheet-empty">No categories yet — add your first one below.</div>`
      : '';

    return none + rows + orphanRows + empty + this.#addHtml('parent');
  }

  // ── Step 2: subcategories ─────────────────────────────────────────────

  #childrenHtml() {
    const parent = this.#source.find(this.#parentId);
    if (!parent) { this.#parentId = null; return this.#parentsHtml(); }

    const kids = this.#source.visibleChildren(this.#parentId, this.#type);

    // Multi-select (budgets) keeps the "whole group" option, because a budget
    // on a parent is meant to cover its entire subtree. Single-select does not:
    // a transaction belongs to a leaf.
    const wholeGroup = (this.#mode === 'multi')
      ? `<button type="button" class="sheet-row ${this.#selected.has(parent.id) ? 'is-selected' : ''}"
                 onclick="window.__app.catPicker.choose('${this.js(parent.id)}')">
           <span class="sheet-dot" style="background:${this.esc(parent.color || '#a1a1aa')}"></span>
           <span class="sheet-row-name">Whole group · ${this.esc(parent.name)}</span>
           ${this.#tick(this.#selected.has(parent.id))}
         </button>
         <div class="sheet-crumb px-1 mt-1">Or pick specific subcategories</div>`
      : '';

    const rows = kids.map((c) => this.#leafRow(c, false)).join('') ||
      `<div class="sheet-empty">No subcategories in ${this.esc(parent.name)} yet.</div>`;

    return wholeGroup + rows + this.#addHtml('child', parent.name);
  }

  // ── Search results ────────────────────────────────────────────────────

  #searchHtml() {
    const hits = this.#source.search(this.#query, this.#type);
    if (!hits.length) {
      return `<div class="sheet-empty">Nothing matches “${this.esc(this.#query.trim())}”.</div>`;
    }
    // A parent with children is not directly assignable in single mode — offer
    // it as a shortcut into its subcategory list instead.
    return hits.map((c) => {
      const isGroup = !c.parentId && this.#source.hasChildren(c.id, this.#type);
      if (isGroup && this.#mode === 'single') {
        return `
          <button type="button" class="sheet-row" onclick="window.__app.catPicker.openParent('${this.js(c.id)}')">
            <span class="sheet-dot" style="background:${this.esc(c.color || '#a1a1aa')}"></span>
            <span class="sheet-row-name">${this.esc(c.name)}</span>
            <span class="sheet-row-meta">group</span>
            <i data-lucide="chevron-right" class="text-zinc-400" style="width:15px;height:15px"></i>
          </button>`;
      }
      return this.#leafRow(c, true);
    }).join('');
  }

  // ── Shared row + add-row builders ─────────────────────────────────────

  /**
   * One selectable category row.
   * @param {object}  c
   * @param {boolean} showPath  prefix with the parent name (search results)
   */
  #leafRow(c, showPath) {
    const parent = c.parentId ? this.#source.find(c.parentId) : null;
    const label  = showPath && parent
      ? `<span class="text-zinc-500">${this.esc(parent.name)} / </span>${this.esc(c.name)}`
      : this.esc(c.name);
    return `
      <button type="button" class="sheet-row ${this.#selected.has(c.id) ? 'is-selected' : ''}"
              onclick="window.__app.catPicker.choose('${this.js(c.id)}')">
        <span class="sheet-dot" style="background:${this.esc(c.color || '#a1a1aa')}"></span>
        <span class="sheet-row-name">${label}</span>
        ${this.#tick(this.#selected.has(c.id))}
      </button>`;
  }

  #tick(on) {
    return on
      ? `<i data-lucide="check" style="width:15px;height:15px" class="text-emerald-500"></i>`
      : `<span style="width:15px;height:15px;flex-shrink:0"></span>`;
  }

  /**
   * The inline quick-add row. Name only — icon and colour are derived from the
   * name by CategoryService.guessAppearance(), so adding never interrupts the
   * transaction the user is in the middle of entering.
   * @param {'parent'|'child'} kind
   * @param {string} [parentName]
   */
  #addHtml(kind, parentName = '') {
    if (!this.#allowAdd) return '';
    const label = kind === 'parent'
      ? 'New parent category'
      : `New subcategory in ${this.esc(parentName)}`;

    if (!this.#adding) {
      return `
        <button type="button" class="sheet-row text-zinc-500 mt-1" onclick="window.__app.catPicker.toggleAdd(true)">
          <i data-lucide="plus" style="width:15px;height:15px"></i>
          <span class="sheet-row-name">${label}</span>
        </button>`;
    }

    return `
      <div class="px-1 pt-2">
        <div class="sheet-note mb-1">${label}</div>
        <div class="sheet-inline-form">
          <input class="input" data-cat-new placeholder="Name" autocomplete="off"
                 onkeydown="window.__app.catPicker.onAddKey(event)">
          <button type="button" class="btn btn-primary" onclick="window.__app.catPicker.submitAdd()">Add</button>
          <button type="button" class="btn btn-ghost" onclick="window.__app.catPicker.toggleAdd(false)">Cancel</button>
        </div>
        <div class="sheet-note text-rose-500 mt-1" data-cat-add-error></div>
      </div>`;
  }
}
