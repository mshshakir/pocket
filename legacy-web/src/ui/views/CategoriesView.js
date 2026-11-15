/**
 * CategoriesView — Two-level collapsible category list grouped by type.
 */
import { BaseView } from './BaseView.js';

export class CategoriesView extends BaseView {
  /** Picking categories to merge: on/off, and which are ticked. */
  #picking = false;
  /** @type {Set<string>} */ #picked = new Set();

  constructor() {
    super();
  }

  // ── Selection (driven by Application) ────────────────────────────────

  get picking()   { return this.#picking; }
  get pickedIds() { return [...this.#picked]; }

  togglePicking() {
    this.#picking = !this.#picking;
    this.#picked.clear();
  }

  togglePick(id) {
    if (this.#picked.has(id)) this.#picked.delete(id);
    else this.#picked.add(id);
  }

  clearPicking() { this.#picking = false; this.#picked.clear(); }

  render() {
    const state   = this.state;
    const sections = ['expense', 'income', 'transfer'];

    if (!Array.isArray(state.user.collapsedCategories)) state.user.collapsedCategories = [];
    const collapsed = new Set(state.user.collapsedCategories);

    const collapsibleParents = state.categories.filter(
      (c) => !c.parentId && state.categories.some((ch) => ch.parentId === c.id),
    );
    const anyExpanded  = collapsibleParents.some((p) => !collapsed.has(p.id));
    const anyCollapsed = collapsibleParents.some((p) =>  collapsed.has(p.id));

    return `
      <div class="flex items-center justify-between mb-6 gap-2">
        <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">Categories${this.helpButton('categories')}</h1>${this.helpHint('categories')}
        <div class="flex items-center gap-2">
          ${collapsibleParents.length ? `
            ${anyExpanded  ? `<button class="btn btn-ghost text-sm" onclick="window.__app.collapseAllCategories()" title="Collapse every parent"><i data-lucide="chevrons-down-up" style="width:14px;height:14px"></i><span class="hidden md:inline ml-1">Collapse all</span></button>` : ''}
            ${anyCollapsed ? `<button class="btn btn-ghost text-sm" onclick="window.__app.expandAllCategories()" title="Expand every parent"><i data-lucide="chevrons-up-down" style="width:14px;height:14px"></i><span class="hidden md:inline ml-1">Expand all</span></button>` : ''}
          ` : ''}
          ${this.inGuestSpace ? '' : `
          <button class="btn ${this.#picking ? 'btn-primary' : 'btn-outline'} category-pick-toggle" onclick="window.__app.toggleCategoryPicking()" title="Pick categories to merge into one">
            <i data-lucide="${this.#picking ? 'x' : 'merge'}"></i><span class="${this.#picking ? '' : 'hidden md:inline'} ml-1">${this.#picking ? 'Cancel' : 'Merge'}</span>
          </button>
          ${this.#picking ? '' : `<button class="btn btn-primary" onclick="window.__app.openModal('category')">
            <i data-lucide="plus"></i> New category
          </button>`}`}
        </div>
      </div>

      ${this.#picking ? `<div class="text-sm text-zinc-500 mb-4 px-1">Tick the categories to merge, then pick where they go.</div>` : ''}
      ${sections.map((sec) => this.#section(sec, state.categories, collapsed)).join('')}
      ${this.#pickBar(state.categories)}
    `;
  }

  // ── Private ───────────────────────────────────────────────────────────

  #section(sec, categories, collapsed) {
    const list  = categories.filter((c) => c.type === sec);
    if (!list.length) return '';
    const roots = list.filter((c) => !c.parentId);

    return `
      <div class="mb-6">
        <div class="text-xs uppercase tracking-wider text-zinc-500 mb-2 px-1">${sec}</div>
        <div class="card divide-y divide-zinc-100 dark:divide-zinc-800">
          ${roots.map((p) => {
            const children    = list.filter((c) => c.parentId === p.id);
            const isCollapsed = collapsed.has(p.id);
            const showChildren = children.length > 0 && !isCollapsed;
            return this.#parentRow(p, children, isCollapsed) +
              (showChildren ? children.map((c) => this.#childRow(c)).join('') : '');
          }).join('')}
        </div>
      </div>`;
  }

  #parentRow(p, children, isCollapsed) {
    const hasChildren = children.length > 0;
    const toggleIcon  = !hasChildren ? '' : `
      <button type="button"
              onclick="event.stopPropagation();window.__app.toggleCategoryCollapse('${p.id}')"
              class="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 -my-1 -ml-1 mr-1 p-1"
              title="${isCollapsed ? 'Expand subcategories' : 'Collapse subcategories'}">
        <i data-lucide="${isCollapsed ? 'chevron-right' : 'chevron-down'}" style="width:16px;height:16px;display:inline"></i>
      </button>`;

    return `
      <div class="w-full flex items-center gap-2 px-2 hover:bg-zinc-50 dark:hover:bg-zinc-900">
        ${toggleIcon || '<span style="width:24px;display:inline-block"></span>'}
        <button ${this.#rowAction(p)}
                class="flex-1 flex items-center gap-3 py-3 text-left">
          ${this.#tick(p)}
          <div class="icon-pill" style="background:${p.color}22;color:${p.color}">
            <i data-lucide="${p.icon}"></i>
          </div>
          <div class="flex-1 font-medium">${this.escapeHtml(p.name)}</div>
          ${hasChildren ? `<span class="chip" style="font-size:.65rem">${children.length} sub${children.length === 1 ? '' : 's'}</span>` : ''}
          <i data-lucide="chevron-right" class="text-zinc-400"></i>
        </button>
      </div>`;
  }

  #childRow(c) {
    return `
      <button ${this.#rowAction(c)}
              class="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900 pl-12">
        ${this.#tick(c)}
        <div class="icon-pill" style="background:${c.color}22;color:${c.color};width:28px;height:28px">
          <i data-lucide="${c.icon}" style="width:14px;height:14px"></i>
        </div>
        <div class="flex-1 font-medium text-sm">${this.escapeHtml(c.name)}</div>
        <span class="chip" style="font-size:.65rem">sub</span>
        <i data-lucide="chevron-right" class="text-zinc-400"></i>
      </button>`;
  }

  // ── Picking ───────────────────────────────────────────────────────────

  /** Type of the first ticked category: others are greyed out until untick. */
  #pickType() {
    const first = this.#picked.values().next().value;
    return first ? this.state.categories.find((c) => c.id === first)?.type ?? null : null;
  }

  #rowAction(c) {
    if (!this.#picking) return `onclick="window.__app.openModal('category',{id:'${c.id}'})"`;
    const type = this.#pickType();
    if (type && c.type !== type) return 'disabled style="opacity:.4;cursor:not-allowed" title="Pick categories of one type"';
    return `onclick="window.__app.toggleCategoryPick('${c.id}')" data-pick="${c.id}"`;
  }

  #tick(c) {
    if (!this.#picking) return '';
    const on = this.#picked.has(c.id);
    return `<i data-lucide="${on ? 'check-square' : 'square'}" class="${on ? 'text-zinc-900 dark:text-white' : 'text-zinc-400'}" style="width:18px;height:18px;flex-shrink:0"></i>`;
  }

  #pickBar(categories) {
    if (!this.#picking) return '';
    const n     = [...this.#picked].filter((id) => categories.some((c) => c.id === id)).length;
    return `
      <div class="h-20"></div>
      <div class="fixed bottom-20 md:bottom-6 left-0 right-0 flex justify-center z-40 px-4">
        <div class="card flex items-center gap-2 px-3 py-3 shadow-2xl category-pick-bar" style="max-width:520px;width:100%">
          <span class="text-sm font-medium">${n} selected</span>
          <div class="flex-1"></div>
          <button class="btn btn-ghost text-sm" onclick="window.__app.toggleCategoryPicking()">Cancel</button>
          <button class="btn btn-primary text-sm" ${n ? '' : 'disabled'} onclick="window.__app.mergePickedCategories()">
            <i data-lucide="merge"></i> Merge into…
          </button>
        </div>
      </div>`;
  }
}
