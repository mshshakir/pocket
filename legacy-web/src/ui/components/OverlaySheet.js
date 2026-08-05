/**
 * OverlaySheet — base class for full-height sheets that stack ABOVE the modal.
 *
 * Modal shows one modal at a time and re-renders it from scratch, so anything
 * that opens "on top of" a half-filled form has to live outside it. This base
 * owns that plumbing — its own backdrop, escape handling, icon refresh and
 * shared stylesheet — so subclasses only describe their content:
 *
 *   class MySheet extends OverlaySheet {
 *     constructor() { super({ id: 'mySheetRoot' }); }
 *     renderContent() { return `<div class="sheet-head">…</div>`; }
 *   }
 *
 * Subclass hooks:
 *   renderContent()  → required; the sheet's inner HTML
 *   onClosed()       → optional; called after the sheet hides
 *
 * Subclasses are dependency-injected and never reach for the Application
 * singleton; inline handlers inside the markup dispatch through window.__app.
 */
import { Html } from '../../core/Html.js';

/** Injected once for all sheets. */
const SHEET_CSS = `
.sheet-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.5); backdrop-filter:blur(2px); z-index:70; display:none; }
.sheet-backdrop.open { display:flex; align-items:flex-end; justify-content:center; }
@media (min-width:640px) { .sheet-backdrop.open { align-items:center; } }
.sheet { background:#fff; color:#09090b; width:100%; max-width:520px; height:88vh; max-height:88vh;
         border-radius:18px 18px 0 0; display:flex; flex-direction:column; overflow:hidden; }
@media (min-width:640px) { .sheet { border-radius:18px; height:70vh; } }
html.dark .sheet { background:#0c0c0f; color:#fafafa; border:1px solid #27272a; }
.sheet-head { padding:.85rem 1rem .6rem; border-bottom:1px solid #e4e4e7; flex-shrink:0; }
html.dark .sheet-head { border-color:#1f1f23; }
.sheet-body { flex:1; overflow-y:auto; overscroll-behavior:contain; padding:.5rem; }
.sheet-foot { padding:.7rem 1rem; border-top:1px solid #e4e4e7; flex-shrink:0; display:flex; align-items:center; gap:.5rem; }
html.dark .sheet-foot { border-color:#1f1f23; }
.sheet-row { width:100%; display:flex; align-items:center; gap:.7rem; padding:.6rem .65rem; border-radius:12px;
             text-align:left; font-size:.9rem; cursor:pointer; background:transparent; border:none; color:inherit; }
.sheet-row:hover { background:#f4f4f5; }
html.dark .sheet-row:hover { background:#18181b; }
.sheet-row.is-selected { background:#f4f4f5; font-weight:600; }
html.dark .sheet-row.is-selected { background:#1c1c20; }
.sheet-row-static { cursor:default; }
.sheet-row-static:hover { background:transparent; }
.sheet-dot { width:10px; height:10px; border-radius:9999px; flex-shrink:0; }
.sheet-row-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sheet-row-meta { font-size:.7rem; color:#71717a; flex-shrink:0; }
.sheet-note { font-size:.72rem; color:#71717a; }
.sheet-empty { padding:1.4rem .75rem; text-align:center; font-size:.82rem; color:#71717a; }
.sheet-crumb { display:flex; align-items:center; gap:.4rem; font-size:.75rem; color:#71717a; margin-bottom:.5rem; }
.sheet-inline-form { display:flex; gap:.4rem; margin-top:.4rem; }
/* Sheets sit above the modal (z-50); lift the toast above the sheet so
   messages raised while a sheet is open remain visible. */
.toast { z-index:90; }
`;

export class OverlaySheet {
  /** @type {HTMLElement|null} */ #backdrop = null;
  /** @type {HTMLElement|null} */ #sheet    = null;
  /** @type {boolean} */          #open     = false;
  /** @type {string} */           #id;

  /**
   * @param {object} cfg
   * @param {string} cfg.id  DOM id for the backdrop element
   */
  constructor({ id }) {
    this.#id = id;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  /**
   * Create the overlay and inject the shared stylesheet. Call once, after
   * Modal.mount(), so the sheet's node sits after the modal in document order.
   * @param {HTMLElement} [container=document.body]
   */
  mount(container = document.body) {
    if (!document.getElementById('overlaySheetStyles')) {
      const style = document.createElement('style');
      style.id          = 'overlaySheetStyles';
      style.textContent = SHEET_CSS;
      document.head.appendChild(style);
    }

    this.#backdrop = document.createElement('div');
    this.#backdrop.id        = this.#id;
    this.#backdrop.className = 'sheet-backdrop';
    this.#backdrop.addEventListener('click', (e) => {
      if (e.target === this.#backdrop) this.close();
    });

    this.#sheet = document.createElement('div');
    this.#sheet.className = 'sheet';
    this.#sheet.addEventListener('click', (e) => e.stopPropagation());

    this.#backdrop.appendChild(this.#sheet);
    container.appendChild(this.#backdrop);

    // Capture phase: Escape closes the sheet before it reaches the modal.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.#open) { e.stopPropagation(); this.close(); }
    }, true);
  }

  /** @returns {boolean} */
  get isOpen() { return this.#open; }

  /** @returns {HTMLElement|null} the inner sheet element */
  get element() { return this.#sheet; }

  /** Show the sheet and paint it. Subclasses call this from their own open(). */
  show() {
    this.#open = true;
    this.#backdrop?.classList.add('open');
    this.render();
  }

  /** Hide the sheet and clear its content. */
  close() {
    if (!this.#open) return;
    this.#open = false;
    this.#backdrop?.classList.remove('open');
    if (this.#sheet) this.#sheet.innerHTML = '';
    this.onClosed();
  }

  /** Repaint the whole sheet from renderContent(). */
  render() {
    if (!this.#sheet) return;
    this.#sheet.innerHTML = this.renderContent();
    this.refreshIcons();
  }

  // ── Subclass hooks ────────────────────────────────────────────────────

  /** @returns {string} the sheet's inner HTML — subclasses must override. */
  renderContent() { return ''; }

  /** Called after the sheet hides. Override to release per-open state. */
  onClosed() {}

  // ── Helpers for subclasses ────────────────────────────────────────────

  /**
   * Replace one region of the sheet without re-creating the rest — used to
   * patch a list while the user is typing in a search box above it, so the
   * focused input is never torn down.
   * @param {string} selector
   * @param {string} html
   */
  patch(selector, html) {
    const el = this.#sheet?.querySelector(selector);
    if (!el) return;
    el.innerHTML = html;
    this.refreshIcons();
  }

  /** @param {string} selector @returns {HTMLElement|null} */
  find(selector) { return this.#sheet?.querySelector(selector) ?? null; }

  /** Re-run Lucide icon replacement inside the sheet. */
  refreshIcons() {
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  /**
   * Move focus into the sheet once the browser has painted it.
   * @param {string} selector
   */
  focusLater(selector, delay = 20) {
    setTimeout(() => this.find(selector)?.focus(), delay);
  }

  /**
   * Escape for text and quoted-attribute content.
   * NOT safe for inline handler arguments — use js() there.
   * @param {*} s @returns {string}
   */
  esc(s) { return Html.escape(s); }

  /**
   * Escape a value interpolated into a single-quoted JS string inside an inline
   * handler, e.g. onclick="fn('${this.js(name)}')".
   *
   * esc() is wrong here: the HTML parser decodes character references in
   * attribute values before the value becomes the handler body, so an escaped
   * &#39; turns back into a real quote and terminates the string early.
   * @param {*} s @returns {string}
   */
  js(s) { return Html.js(s); }

  /**
   * Validate a CSS hex colour, falling back to a neutral grey.
   * @param {*} c @param {string} [fallback] @returns {string}
   */
  safeColor(c, fallback = '#71717a') { return Html.color(c, fallback); }

  /**
   * Validate a Lucide icon slug, falling back to a safe default.
   * @param {*} name @param {string} [fallback] @returns {string}
   */
  safeIcon(name, fallback = 'circle') { return Html.icon(name, fallback); }
}
