/**
 * CategoriesView — Two-level collapsible category list grouped by type.
 */
import { BaseView } from './BaseView.js';

export class CategoriesView extends BaseView {
  constructor() {
    super();
  }

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
        <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">Categories</h1>
        <div class="flex items-center gap-2">
          ${collapsibleParents.length ? `
            ${anyExpanded  ? `<button class="btn btn-ghost text-sm" onclick="window.__app.collapseAllCategories()" title="Collapse every parent"><i data-lucide="chevrons-down-up" style="width:14px;height:14px"></i><span class="hidden md:inline ml-1">Collapse all</span></button>` : ''}
            ${anyCollapsed ? `<button class="btn btn-ghost text-sm" onclick="window.__app.expandAllCategories()" title="Expand every parent"><i data-lucide="chevrons-up-down" style="width:14px;height:14px"></i><span class="hidden md:inline ml-1">Expand all</span></button>` : ''}
          ` : ''}
          <button class="btn btn-primary" onclick="window.__app.openModal('category')">
            <i data-lucide="plus"></i> New category
          </button>
        </div>
      </div>

      ${sections.map((sec) => this.#section(sec, state.categories, collapsed)).join('')}
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
        <button onclick="window.__app.openModal('category',{id:'${p.id}'})"
                class="flex-1 flex items-center gap-3 py-3 text-left">
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
      <button onclick="window.__app.openModal('category',{id:'${c.id}'})"
              class="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900 pl-12">
        <div class="icon-pill" style="background:${c.color}22;color:${c.color};width:28px;height:28px">
          <i data-lucide="${c.icon}" style="width:14px;height:14px"></i>
        </div>
        <div class="flex-1 font-medium text-sm">${this.escapeHtml(c.name)}</div>
        <span class="chip" style="font-size:.65rem">sub</span>
        <i data-lucide="chevron-right" class="text-zinc-400"></i>
      </button>`;
  }
}
