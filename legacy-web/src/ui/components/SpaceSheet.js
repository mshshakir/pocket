/**
 * SpaceSheet — pick which book you are looking at.
 *
 * Lists the home space plus one entry per person sharing accounts with you.
 * Selecting one re-points the whole view layer through `BaseView.state`; there
 * is no per-screen switching, which is the point of the space model.
 *
 * A guest space can be renamed locally. The label defaults to `share.sharedBy`
 * — the owner's own display name, republished on every push — and the override
 * lives in the MEMBER's book (`user.spaceLabels`), so the owner's next push
 * cannot overwrite what you called them.
 */
import { OverlaySheet } from './OverlaySheet.js';

export class SpaceSheet extends OverlaySheet {
  /** @type {object} */ #spaces;
  /** @type {string|null} space id currently being renamed */
  #renaming = null;

  /** @param {{spaceRegistry: object}} deps */
  constructor({ spaceRegistry }) {
    super({ id: 'spaceSheetRoot' });
    this.#spaces = spaceRegistry;
  }

  open() {
    this.#renaming = null;
    this.render();
    this.show();
  }

  /** @param {string|null} spaceId */
  beginRename(spaceId) {
    this.#renaming = spaceId;
    this.render();
    this.focusLater('#spaceLabelInput');
  }

  /** @param {string} spaceId */
  commitRename(spaceId) {
    const input = this.find('#spaceLabelInput');
    this.#spaces.setLabel(spaceId, input?.value ?? '');
    this.#renaming = null;
    this.render();
    window.__app?.refreshAfterSpaceChange?.();
  }

  cancelRename() {
    this.#renaming = null;
    this.render();
  }

  renderContent() {
    const activeId = this.#spaces.activeId;
    const rows = this.#spaces.all().map((space) => {
      const isActive = (space.id ?? null) === activeId;
      const count    = space.accounts.length;
      const sub = space.isHome
        ? `${count} account${count === 1 ? '' : 's'} · your own book`
        : `${count} account${count === 1 ? '' : 's'} shared with you`;

      if (this.#renaming && this.#renaming === space.id) {
        return `
          <div class="p-2">
            <label class="text-xs text-zinc-500">Name this space</label>
            <input id="spaceLabelInput" class="input w-full mt-1"
                   value="${this.esc(space.label)}"
                   placeholder="${this.esc(space.share?.sharedBy || 'Shared with me')}"
                   onkeydown="if(event.key==='Enter'){event.preventDefault();window.__app.commitSpaceRename('${this.js(space.id)}')}">
            <div class="flex gap-2 mt-2">
              <button class="btn btn-primary flex-1"
                      onclick="window.__app.commitSpaceRename('${this.js(space.id)}')">Save</button>
              <button class="btn btn-outline" onclick="window.__app.cancelSpaceRename()">Cancel</button>
            </div>
            <div class="text-xs text-zinc-500 mt-2">Leave it empty to go back to the name they set.</div>
          </div>`;
      }

      // Every field below can originate from ANOTHER user's snapshot, so it is
      // escaped for the sink it lands in (audit H1).
      return `
        <div class="flex items-center gap-1">
          <button class="sheet-row flex-1" onclick="window.__app.switchSpace(${space.id ? `'${this.js(space.id)}'` : 'null'})">
            <div class="icon-pill" style="background:${space.isHome ? '#0ea5e922' : '#818cf822'};color:${space.isHome ? '#0ea5e9' : '#818cf8'}">
              <i data-lucide="${space.isHome ? 'wallet' : 'users'}"></i>
            </div>
            <div class="flex-1 min-w-0">
              <div class="font-medium truncate">${this.esc(space.label)}</div>
              <div class="text-xs text-zinc-500 truncate">${this.esc(sub)}</div>
            </div>
            ${isActive ? '<i data-lucide="check" style="width:16px;height:16px"></i>' : ''}
          </button>
          ${space.isHome ? '' : `
            <button class="btn btn-ghost" title="Rename"
                    onclick="window.__app.beginSpaceRename('${this.js(space.id)}')">
              <i data-lucide="pencil" style="width:14px;height:14px"></i>
            </button>`}
        </div>`;
    }).join('');

    return `
      <div class="sheet-head">
        <div class="flex items-center justify-between">
          <div class="font-semibold">Spaces</div>
          <button class="btn btn-ghost" onclick="window.__app.closeSpaceSheet()"><i data-lucide="x"></i></button>
        </div>
        <div class="text-xs text-zinc-500 mt-1">
          Switch between your own money and the accounts others share with you.
        </div>
      </div>
      <div class="sheet-body">${rows}</div>`;
  }
}
