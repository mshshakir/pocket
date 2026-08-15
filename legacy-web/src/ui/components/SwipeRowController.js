/**
 * SwipeRowController — reveal-then-tap swipe actions for list rows.
 *
 * Replaces the previous "swipe far enough left and the row is destroyed"
 * behaviour, which fired `confirm('Delete this transaction?')` during ordinary
 * vertical scrolling. Two separate defects caused that:
 *
 *  1. The touchend handler compared the raw horizontal displacement WITHOUT
 *     consulting the axis lock the move handler had already computed. A thumb
 *     scrolling a long list travels in an arc; the arc easily drifts 55px
 *     sideways; on lift, that drift was read as a delete gesture.
 *  2. There was no time or velocity component, so a slow three-second scroll
 *     was indistinguishable from a deliberate flick.
 *
 * Fixing the thresholds alone would only make an accidental delete less likely.
 * Revealing a button instead makes it impossible: the gesture no longer has a
 * destructive outcome at all. The row slides open, stays open, and waits for a
 * deliberate tap on an 80px target. Scrolling, tapping elsewhere, opening
 * another row or re-rendering all just close it again.
 *
 * The controller owns gesture state and DOM positioning only. It never decides
 * what deleting means — that arrives as the `onDelete` callback.
 */

/** Movement before the gesture commits to an axis. */
const AXIS_LOCK_PX = 8;
/** Horizontal travel that opens the row. */
const OPEN_PX = 45;
/** How far the row slides — must match .tx-delete-bg's width in app.html. */
const REVEAL_PX = 80;

export class SwipeRowController {
  /** @type {(row: {id: string, shareIndex: number, isOwnContrib: boolean}) => void} */
  #onDelete;

  /**
   * The currently revealed row, if any.
   * @type {{id: string, shareIndex: number, isOwnContrib: boolean, wrapper: HTMLElement}|null}
   */
  #open = null;

  /**
   * State for the touch currently in flight.
   * @type {{id: string, shareIndex: number, isOwnContrib: boolean, wrapper: HTMLElement,
   *         startX: number, startY: number, dx: number, axis: ('x'|'y'|null)}|null}
   */
  #touch = null;

  #documentBound = false;

  /** @param {{onDelete: Function}} deps */
  constructor({ onDelete }) {
    this.#onDelete = onDelete;
  }

  /** @returns {string|null} id of the revealed row, for renderers that care */
  get openId() {
    return this.#open?.id ?? null;
  }

  // ── Gesture ──────────────────────────────────────────────────────────

  /**
   * @param {TouchEvent} event
   * @param {string}  id            transaction id
   * @param {number}  shareIndex    index into _sharedData, -1 for an owned row
   * @param {boolean} isOwnContrib  true when this is the member's own contribution
   */
  start(event, id, shareIndex = -1, isOwnContrib = false) {
    this.#bindDocument();
    // A second finger means a pinch or a scroll assist, never a row action.
    if (event.touches.length !== 1) { this.#touch = null; return; }

    // Touching a different row dismisses whatever was revealed. Touching the
    // open row itself is left alone so the Delete button stays reachable.
    if (this.#open && this.#open.id !== id) this.closeOpen();

    const t = event.touches[0];
    this.#touch = {
      id,
      shareIndex,
      isOwnContrib: !!isOwnContrib,
      wrapper: event.currentTarget,
      startX: t.clientX,
      startY: t.clientY,
      dx:     0,
      axis:   null,
    };
  }

  /** @param {TouchEvent} event */
  move(event) {
    const g = this.#touch;
    if (!g || event.touches.length !== 1) return;

    const t  = event.touches[0];
    const dx = t.clientX - g.startX;
    const dy = t.clientY - g.startY;

    if (!g.axis) {
      if (Math.abs(dx) > AXIS_LOCK_PX || Math.abs(dy) > AXIS_LOCK_PX) {
        g.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      }
      return;
    }
    // The gesture is a scroll. Crucially, `dx` is NOT recorded — the old code
    // kept accumulating horizontal drift here and then read it at touchend,
    // which is what turned a curved scroll into a delete.
    if (g.axis !== 'x') return;

    g.dx = dx;
    if (dx < 0) {
      event.preventDefault();
      this.#slide(g.wrapper, Math.max(dx, -REVEAL_PX), { animate: false });
    } else if (this.#open?.id === g.id) {
      // Dragging a revealed row back to the right closes it.
      this.#slide(g.wrapper, Math.min(0, -REVEAL_PX + dx), { animate: false });
    }
  }

  /** Finger lifted. */
  end() {
    const g = this.#touch;
    this.#touch = null;
    if (!g) return;

    // The single guard the old implementation was missing.
    if (g.axis !== 'x') { this.#restore(g); return; }

    if (this.#open?.id === g.id) {
      // Already open: a rightward drag past half the reveal closes it.
      if (g.dx > REVEAL_PX / 2) this.closeOpen();
      else this.#slide(g.wrapper, -REVEAL_PX, { animate: true });
      return;
    }

    if (g.dx <= -OPEN_PX) {
      this.closeOpen();
      this.#open = { id: g.id, shareIndex: g.shareIndex, isOwnContrib: g.isOwnContrib, wrapper: g.wrapper };
      this.#slide(g.wrapper, -REVEAL_PX, { animate: true });
      g.wrapper?.classList?.add('is-open');
    } else {
      this.#slide(g.wrapper, 0, { animate: true });
    }
  }

  /**
   * The browser took the touch away (system back-gesture from the screen edge,
   * notification shade, a second finger). Without this the old code left
   * `#swipeTxId` and the wrapper reference dangling at a DOM node a later
   * re-render had already replaced.
   */
  cancel() {
    const g = this.#touch;
    this.#touch = null;
    if (g) this.#restore(g);
  }

  // ── Reveal state ─────────────────────────────────────────────────────

  /** Slide the revealed row shut, if there is one. */
  closeOpen() {
    const open = this.#open;
    this.#open = null;
    if (!open) return;
    open.wrapper?.classList?.remove('is-open');
    this.#slide(open.wrapper, 0, { animate: true });
  }

  /**
   * Forget any revealed row without animating. Called after a re-render, when
   * the wrapper element this controller is holding no longer exists.
   */
  reset() {
    this.#open  = null;
    this.#touch = null;
  }

  /**
   * Delete the revealed row. Reachable only from the button the swipe exposes,
   * so the tap IS the confirmation — no dialog.
   */
  commitDelete() {
    const open = this.#open;
    if (!open) return;
    this.#open = null;
    const content = open.wrapper?.querySelector('.tx-row-content');
    if (content) {
      content.style.transition = 'transform .15s ease, opacity .18s ease';
      content.style.transform  = `translateX(-${REVEAL_PX}px)`;
      content.style.opacity    = '0';
    }
    this.#onDelete({ id: open.id, shareIndex: open.shareIndex, isOwnContrib: open.isOwnContrib });
  }

  // ── Internals ────────────────────────────────────────────────────────

  /** @param {{wrapper: HTMLElement, id: string}} g */
  #restore(g) {
    // A row that was already revealed stays revealed; anything else snaps shut.
    if (this.#open?.id === g.id) this.#slide(g.wrapper, -REVEAL_PX, { animate: true });
    else this.#slide(g.wrapper, 0, { animate: true });
  }

  /**
   * @param {HTMLElement|null} wrapper
   * @param {number} px           translateX offset, 0 for closed
   * @param {{animate: boolean}} opts
   */
  #slide(wrapper, px, { animate }) {
    const content = wrapper?.querySelector?.('.tx-row-content');
    if (!content) return;
    // Suppressing the transition while a finger is down keeps the row glued to
    // the thumb; re-enabling it for the release gives the snap.
    content.style.transition = animate ? '' : 'none';
    content.style.transform  = px ? `translateX(${px}px)` : '';
  }

  /**
   * A revealed row must not swallow the rest of the UI. One capture-phase pair
   * of document listeners closes it on the next interaction anywhere else, and
   * cancels a tap that lands on the row body while it is open — otherwise
   * reaching for Delete and missing would open the edit modal instead.
   */
  #bindDocument() {
    if (this.#documentBound) return;
    if (typeof document === 'undefined') return;
    this.#documentBound = true;

    document.addEventListener('touchstart', (e) => {
      if (!this.#open) return;
      if (this.#open.wrapper?.contains?.(e.target)) return;
      this.closeOpen();
    }, { capture: true, passive: true });

    document.addEventListener('click', (e) => {
      if (!this.#open) return;
      if (e.target?.closest?.('[data-swipe-delete]')) return; // let Delete through
      if (this.#open.wrapper?.contains?.(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
      this.closeOpen();
    }, { capture: true });
  }
}
