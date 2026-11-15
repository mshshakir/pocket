/**
 * SortableList — drag rows to reorder, with a mouse or a finger.
 *
 * Mark up a list once and it works after every re-render (the listener sits
 * on the document, so nothing has to be re-attached):
 *
 *   <div data-sort-list="group-1">
 *     <div data-sort-id="acc_1"> <button data-sort-handle>⋮⋮</button> … </div>
 *     <div data-sort-id="acc_2"> … </div>
 *   </div>
 *
 * Dragging a handle moves its row; it swaps with a neighbour once the pointer
 * passes that neighbour's middle. On release, `onDrop(listKey, ids)` gets the
 * new order. Only the handle starts a drag, so the page still scrolls.
 */
export class SortableList {
  /** @type {(listKey: string, ids: string[]) => void} */ #onDrop;
  /** @type {Document} */ #doc;
  /** @type {null|{row:HTMLElement, list:HTMLElement, handle:HTMLElement, startY:number, id:number}} */ #drag = null;

  /**
   * @param {{onDrop: (listKey: string, ids: string[]) => void, doc?: Document}} opts
   */
  constructor({ onDrop, doc = document }) {
    this.#onDrop = onDrop;
    this.#doc    = doc;
    this.#doc.addEventListener('pointerdown', (e) => this.#start(e));
  }

  /** The ids of a list's rows, top to bottom. */
  static order(list) {
    return [...list.children].filter((el) => el.dataset?.sortId).map((el) => el.dataset.sortId);
  }

  // ── Private ──────────────────────────────────────────────────────────

  #start(e) {
    const handle = e.target?.closest?.('[data-sort-handle]');
    const row    = handle?.closest('[data-sort-id]');
    const list   = row?.parentElement;
    if (!row || !list?.dataset?.sortList) return;
    e.preventDefault();
    this.#drag = { row, list, handle, startY: e.clientY, id: e.pointerId };
    row.classList.add('sorting');
    row.style.position = 'relative';
    row.style.zIndex = '10';
    try { handle.setPointerCapture(e.pointerId); } catch { /* not supported: moves still arrive on the handle */ }
    const move = (ev) => this.#move(ev);
    const end  = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      this.#end();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  #move(e) {
    const d = this.#drag;
    if (!d) return;
    const y = e.clientY;
    const next = this.#sibling(d.row, 'next');
    const prev = this.#sibling(d.row, 'prev');
    if (next && y > SortableList.#middle(next)) {
      d.list.insertBefore(next, d.row);
      d.startY += next.offsetHeight || 0;
    } else if (prev && y < SortableList.#middle(prev)) {
      d.list.insertBefore(d.row, prev);
      d.startY -= prev.offsetHeight || 0;
    }
    d.row.style.transform = `translateY(${y - d.startY}px)`;
  }

  #end() {
    const d = this.#drag;
    this.#drag = null;
    if (!d) return;
    d.row.classList.remove('sorting');
    d.row.style.transform = d.row.style.position = d.row.style.zIndex = '';
    this.#onDrop(d.list.dataset.sortList, SortableList.order(d.list));
  }

  #sibling(row, dir) {
    let el = dir === 'next' ? row.nextElementSibling : row.previousElementSibling;
    while (el && !el.dataset?.sortId) el = dir === 'next' ? el.nextElementSibling : el.previousElementSibling;
    return el;
  }

  static #middle(el) {
    const r = el.getBoundingClientRect();
    return r.top + r.height / 2;
  }
}
