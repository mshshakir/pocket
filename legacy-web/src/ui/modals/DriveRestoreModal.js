/**
 * DriveRestoreModal — pick a Google Drive backup to restore.
 *
 * Lists the backups in the person's "Pocket backups" folder, newest first.
 * Restoring replaces the book on this device with the one in the backup (the
 * app asks first). The list is fetched when the window opens.
 */
import { Html }       from '../../core/Html.js';
import { AppNotices } from '../components/AppNotices.js';

export class DriveRestoreModal {
  /** @type {() => Promise<Array<{stamp: string, at: Date, book: {id: string, size: number}, csv: object|null}>>} */
  #load;
  /** @type {() => void} */
  #redraw;
  /** 'loading' | 'ready' | 'error' */
  #phase = 'loading';
  #backups = [];
  #error = '';
  /** The backup being restored right now (its book file id), or null. */
  #restoring = null;

  /**
   * @param {object} deps
   * @param {() => Promise<Array>} deps.load     the backups in Drive
   * @param {() => void} deps.redraw             re-draw this window
   */
  constructor({ load, redraw }) {
    this.#load = load;
    this.#redraw = redraw;
  }

  /** Called by the app when the window opens: fetch the list. */
  async open() {
    this.#phase = 'loading';
    this.#backups = [];
    this.#error = '';
    this.#restoring = null;
    try {
      this.#backups = await this.#load();
      this.#phase = 'ready';
    } catch (e) {
      this.#error = e?.message || 'Could not read your Google Drive backups';
      this.#phase = 'error';
    }
    this.#redraw();
  }

  /** @param {string|null} fileId */
  set restoring(fileId) {
    this.#restoring = fileId;
    this.#redraw();
  }

  render() {
    return `
      <div class="p-5 drive-restore">
        <div class="sheet-header flex items-center justify-between">
          <h3 class="text-lg font-semibold">Restore from Google Drive</h3>
          <button class="btn btn-ghost px-2.5" onclick="window.__app.closeModal()" aria-label="Close" title="Close">
            <i data-lucide="x"></i>
          </button>
        </div>
        <div class="text-xs text-zinc-500 mt-1 mb-3 leading-relaxed">
          Restoring swaps the book on this device for the one in the backup. Anything added after that backup is lost,
          so back up first if you're unsure.
        </div>
        ${this.#body()}
      </div>`;
  }

  #body() {
    if (this.#phase === 'loading') return '<div class="text-sm text-zinc-500 py-6 text-center">Looking in your Google Drive…</div>';
    if (this.#phase === 'error') {
      return `
        <div class="text-sm text-rose-600 py-3">${Html.escape(this.#error)}</div>
        <button class="btn btn-outline w-full justify-center" onclick="window.__app.openDriveRestore()">
          <i data-lucide="refresh-cw"></i> Try again
        </button>`;
    }
    if (!this.#backups.length) {
      return '<div class="text-sm text-zinc-500 py-6 text-center">No backups in your Google Drive yet. Tap <b>Back up now</b> in Settings to save the first one.</div>';
    }
    return this.#backups.map((b) => `
      <div class="flex items-center gap-3 py-2.5 border-t border-zinc-100 dark:border-zinc-800 drive-restore-row">
        <i data-lucide="file-clock" style="width:18px;height:18px" class="text-zinc-400"></i>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium">${Html.escape(AppNotices.day(b.at.toISOString()))}</div>
          <div class="text-xs text-zinc-500">${DriveRestoreModal.#size(b.book.size)}${b.csv ? ' · with CSV' : ''}</div>
        </div>
        <button class="btn btn-outline text-xs" ${this.#restoring ? 'disabled' : ''}
                onclick="window.__app.driveRestore('${Html.escape(b.book.id)}')">
          ${this.#restoring === b.book.id ? 'Restoring…' : 'Restore'}
        </button>
      </div>`).join('');
  }

  static #size(bytes) {
    if (!bytes) return 'Book';
    return bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
  }
}
