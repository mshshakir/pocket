/**
 * PaymentMethodSheet — manage the payment-method list in place.
 *
 * Reached from "⚙ Manage methods…" in the payment dropdown, so a typo can be
 * fixed in the moment it's noticed rather than by abandoning the transaction
 * and going to Settings. Like CategoryPickerSheet it stacks above the modal, so
 * the half-filled form underneath survives.
 *
 *   Card                    ✎  🗑
 *   Cash          in use 12 ✎
 *   Amex                    ✎  🗑
 *   ＋ New method
 *
 * Delete is offered only when nothing references the method; a method still in
 * use shows its transaction count instead, matching the category delete rule.
 * Renaming migrates every transaction that used the old name — see
 * PaymentTypeService.rename().
 */
import { OverlaySheet } from './OverlaySheet.js';
import { Html }         from '../../core/Html.js';

export class PaymentMethodSheet extends OverlaySheet {
  /** @type {import('../../domain/services/PaymentTypeService.js').PaymentTypeService} */
  #service;

  // ── Per-open session state ────────────────────────────────────────────
  #editing  = null;   // name currently being renamed
  #adding   = false;
  #error    = '';
  #onClose  = null;   // (renames: Map<string,string>) => void
  /** old name → new name, so the caller can follow a rename it had selected. */
  #renames  = new Map();

  /**
   * @param {object} deps
   * @param {import('../../domain/services/PaymentTypeService.js').PaymentTypeService} deps.paymentTypeService
   */
  constructor({ paymentTypeService }) {
    super({ id: 'paymentSheetRoot' });
    this.#service = paymentTypeService;
  }

  // ── Public API ────────────────────────────────────────────────────────

  /**
   * @param {object} [cfg]
   * @param {(renames: Map<string,string>) => void} [cfg.onClose]
   *   Called once the sheet closes, with every rename applied while it was
   *   open, so the caller can re-point a selection at its new name.
   */
  open({ onClose } = {}) {
    this.#editing = null;
    this.#adding  = false;
    this.#error   = '';
    this.#renames = new Map();
    this.#onClose = typeof onClose === 'function' ? onClose : null;
    this.show();
  }

  /** @override */
  onClosed() {
    const cb = this.#onClose;
    this.#onClose = null;
    cb?.(this.#renames);
  }

  // ── Interaction handlers ──────────────────────────────────────────────

  /** Begin renaming a method. @param {string} name */
  edit(name) {
    this.#editing = name;
    this.#adding  = false;
    this.#error   = '';
    this.render();
    this.focusLater('[data-pm-input]');
  }

  /** Leave rename / add mode. */
  cancel() {
    this.#editing = null;
    this.#adding  = false;
    this.#error   = '';
    this.render();
  }

  /** Show the "new method" row. */
  startAdd() {
    this.#adding  = true;
    this.#editing = null;
    this.#error   = '';
    this.render();
    this.focusLater('[data-pm-input]');
  }

  /** Commit the rename or the addition, depending on which row is open. */
  submit() {
    const value = this.find('[data-pm-input]')?.value || '';

    if (this.#editing !== null) {
      const res = this.#service.rename(this.#editing, value);
      if (!res.ok) { this.#error = res.reason; this.render(); this.focusLater('[data-pm-input]'); return; }
      // Chain renames so A→B→C still maps the caller's original A to C.
      for (const [from, to] of this.#renames) if (to === this.#editing) this.#renames.set(from, res.name);
      if (![...this.#renames.values()].includes(res.name)) this.#renames.set(this.#editing, res.name);
      this.#editing = null;
      this.#error   = '';
      this.render();
      return;
    }

    const added = this.#service.addCustom(value);
    if (!added) { this.#error = 'Enter a name'; this.render(); this.focusLater('[data-pm-input]'); return; }
    this.#adding = false;
    this.#error  = '';
    this.render();
  }

  /**
   * Delete a method. Blocked while transactions still reference it; the reason
   * (with the count) is shown inline rather than as a transient toast.
   * @param {string} name
   */
  remove(name) {
    const res = this.#service.remove(name);
    this.#error = res.ok ? '' : res.reason;
    this.render();
  }

  /** Bring back every built-in the user has deleted. */
  restoreBuiltIns() {
    this.#service.restoreBuiltIns();
    this.#error = '';
    this.render();
  }

  /** @param {KeyboardEvent} e */
  onKey(e) {
    if (e.key === 'Enter')  { e.preventDefault(); this.submit(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.cancel(); }
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  /** @override */
  renderContent() {
    const types      = this.#service.allTypes();
    const hasDeleted = this.#service.hiddenTypes().length > 0;

    return `
      <div class="sheet-head">
        <div class="flex items-center gap-2">
          <div class="flex-1 min-w-0">
            <div class="text-base font-semibold">Payment methods</div>
            <div class="sheet-note">Rename or remove the methods you use</div>
          </div>
          <button type="button" class="btn btn-ghost px-2" onclick="window.__app.paymentSheet.close()" aria-label="Close">
            <i data-lucide="x"></i>
          </button>
        </div>
      </div>
      <div class="sheet-body">
        ${this.#error ? `<div class="sheet-note text-rose-500 px-2 pb-1">${this.esc(this.#error)}</div>` : ''}
        ${types.map((t) => this.#row(t)).join('')}
        ${this.#addHtml()}
        ${hasDeleted
          ? `<button type="button" class="sheet-row text-zinc-500 mt-2"
                     onclick="window.__app.paymentSheet.restoreBuiltIns()">
               <i data-lucide="rotate-ccw" style="width:15px;height:15px"></i>
               <span class="sheet-row-name">Restore deleted defaults</span>
             </button>`
          : ''}
      </div>
      <div class="sheet-foot">
        <div class="sheet-note">Renaming updates every transaction that used it</div>
        <div class="flex-1"></div>
        <button type="button" class="btn btn-primary" onclick="window.__app.paymentSheet.close()">Done</button>
      </div>`;
  }

  /** One method row — either its normal display or the open rename input. */
  #row(name) {
    if (this.#editing === name) return this.#inputRow(name);

    const used = this.#service.usageCount(name);
    // Method names are free text, so the handler argument needs JS-string
    // escaping, not HTML escaping: the parser decodes &#39; back to a literal
    // quote before the attribute becomes the handler body, which would break
    // "Wife's card" outright. Html.js() emits ', which survives decoding.
    const arg = Html.js(name);
    return `
      <div class="sheet-row sheet-row-static">
        <span class="sheet-row-name">${this.esc(this.#label(name))}</span>
        ${used ? `<span class="sheet-row-meta">in use ${used}</span>` : ''}
        <button type="button" class="btn btn-ghost px-2" title="Rename"
                onclick="window.__app.paymentSheet.edit('${arg}')">
          <i data-lucide="pencil" style="width:14px;height:14px"></i>
        </button>
        ${used
          ? `<span style="width:30px;flex-shrink:0"></span>`
          : `<button type="button" class="btn btn-ghost px-2 text-rose-500" title="Delete"
                     onclick="window.__app.paymentSheet.remove('${arg}')">
               <i data-lucide="trash-2" style="width:14px;height:14px"></i>
             </button>`}
      </div>`;
  }

  /** The shared rename / add input row. */
  #inputRow(value = '') {
    return `
      <div class="px-1 py-2">
        <div class="sheet-inline-form">
          <input class="input" data-pm-input autocomplete="off" placeholder="Method name"
                 value="${this.esc(value)}"
                 onkeydown="window.__app.paymentSheet.onKey(event)">
          <button type="button" class="btn btn-primary" onclick="window.__app.paymentSheet.submit()">Save</button>
          <button type="button" class="btn btn-ghost" onclick="window.__app.paymentSheet.cancel()">Cancel</button>
        </div>
      </div>`;
  }

  #addHtml() {
    if (this.#adding) return this.#inputRow('');
    if (this.#editing !== null) return '';
    return `
      <button type="button" class="sheet-row text-zinc-500 mt-1" onclick="window.__app.paymentSheet.startAdd()">
        <i data-lucide="plus" style="width:15px;height:15px"></i>
        <span class="sheet-row-name">New method</span>
      </button>`;
  }

  /** Built-ins are stored lowercase; show them capitalised like the dropdown. */
  #label(name) {
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
}
