/**
 * CategoryModal — New / edit category form.
 * Supports type selection, colour, icon picker, and optional parent category.
 */
import { Store } from '../../core/Store.js';

const ICONS = [
  'tag','utensils','car','shopping-bag','heart-pulse','home','film',
  'receipt','graduation-cap','banknote','briefcase','landmark','plane',
  'dumbbell','gift','baby','paw-print','wifi',
];

export class CategoryModal {
  /** @type {Store} */ #store;

  constructor() {
    this.#store = Store.getInstance();
  }

  render(opts = {}) {
    const { id } = opts;
    const state   = this.#store.getState();
    const editing = id ? state.categories.find((c) => c.id === id) : null;
    const c       = editing || { name: '', icon: 'tag', color: '#3b82f6', type: 'expense', parentId: null };

    return `
      <form onsubmit="window.__app.submitCategory(event,'${editing?.id || ''}')" class="p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">${editing ? 'Edit category' : 'New category'}</h3>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>
        </div>

        <div class="mb-3">
          <label class="text-xs text-zinc-500">Name</label>
          <input class="input" name="name" required value="${this.#esc(c.name)}" autofocus>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500">Type</label>
            <select class="select" name="type">
              ${['expense','income','transfer'].map((t) => `<option ${c.type===t?'selected':''}>${t}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="text-xs text-zinc-500">Colour</label>
            <input class="input h-10 p-1" type="color" name="color" value="${c.color}">
          </div>
        </div>

        <div class="mb-3">
          <label class="text-xs text-zinc-500">Parent (optional)</label>
          <select class="select" name="parentId">
            <option value="">— None (root category) —</option>
            ${state.categories
              .filter((p) => p.type === c.type && !p.parentId && p.id !== editing?.id)
              .map((p) => `<option value="${p.id}" ${c.parentId===p.id?'selected':''}>${this.#esc(p.name)}</option>`)
              .join('')}
          </select>
          <div class="text-xs text-zinc-500 mt-1">Up to one level deep. A budget on a parent category includes all its sub-categories.</div>
        </div>

        <div class="mb-4">
          <label class="text-xs text-zinc-500">Icon</label>
          <div class="grid grid-cols-9 gap-2 mt-1">
            ${ICONS.map((ic) => `
              <label class="cursor-pointer">
                <input type="radio" name="icon" value="${ic}" ${c.icon===ic?'checked':''} class="peer sr-only">
                <span class="icon-pill bg-zinc-100 dark:bg-zinc-800 peer-checked:bg-zinc-900 peer-checked:text-white dark:peer-checked:bg-white dark:peer-checked:text-zinc-900">
                  <i data-lucide="${ic}"></i>
                </span>
              </label>`).join('')}
          </div>
        </div>

        <div class="flex items-center gap-2">
          ${editing ? `<button type="button" class="btn btn-outline text-rose-500" onclick="window.__app.deleteCategory('${editing.id}')"><i data-lucide="trash-2"></i> Delete</button>` : ''}
          <div class="flex-1"></div>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary"><i data-lucide="check"></i> Save</button>
        </div>
      </form>`;
  }

  #esc(s) {
    return (s || '').toString().replace(
      /[&<>"']/g,
      (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]),
    );
  }
}
