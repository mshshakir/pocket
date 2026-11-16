/**
 * AppNotices — two short notes above every page, shown only when they apply:
 *
 *   offline     The device has no internet. Says entries are safe here (and,
 *               for people who sync, that they'll go up once back online).
 *   backup due  A scheduled Google Drive backup is due. One tap saves it
 *               (Google's window needs a tap, so it can't start by itself).
 *               "Later" hides it until Pocket is next opened.
 */
import { Html } from '../../core/Html.js';

export class AppNotices {
  #el;
  #backupHidden = false;
  /** @type {{online: boolean, syncs: boolean, backupDue: boolean, backupBusy: boolean, lastAt: string|null}} */
  #state = { online: true, syncs: false, backupDue: false, backupBusy: false, lastAt: null };

  /** @param {HTMLElement|null} el */
  constructor(el) {
    this.#el = el;
  }

  /** @param {Partial<{online: boolean, syncs: boolean, backupDue: boolean, backupBusy: boolean, lastAt: string|null}>} state */
  show(state) {
    this.#state = { ...this.#state, ...state };
    if (!this.#el) return;
    this.#el.innerHTML = this.html();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  /** Hide the backup note until the app is next opened. */
  hideBackup() {
    this.#backupHidden = true;
    this.show({});
  }

  html() {
    const s = this.#state;
    return (s.online ? '' : this.#offline(s)) + (s.backupDue && !this.#backupHidden ? this.#backup(s) : '');
  }

  #offline(s) {
    return `
      <div class="plan-banner app-notice-offline" role="status">
        <i data-lucide="wifi-off" class="plan-banner-icon"></i>
        <div class="flex-1 min-w-0">
          <div class="font-semibold">You're offline</div>
          <div class="plan-banner-text">
            Keep going — what you add is saved on this device${s.syncs ? ' and will sync when you\'re back online' : ''}.
          </div>
        </div>
      </div>`;
  }

  #backup(s) {
    const last = s.lastAt ? `Last backup: ${Html.escape(AppNotices.day(s.lastAt))}.` : 'No backup has been saved yet.';
    return `
      <div class="plan-banner app-notice-backup" role="status">
        <i data-lucide="cloud-upload" class="plan-banner-icon" style="color:#2563eb"></i>
        <div class="flex-1 min-w-0">
          <div class="font-semibold">Your Google Drive backup is due</div>
          <div class="plan-banner-text">${last}${s.online ? '' : ' It needs internet — try again when you\'re online.'}</div>
          <div class="flex flex-wrap gap-2 mt-2">
            <button class="btn btn-primary text-sm" onclick="window.__app.driveBackupNow()" ${s.backupBusy || !s.online ? 'disabled style="opacity:.5;cursor:default"' : ''}>
              <i data-lucide="cloud-upload"></i> ${s.backupBusy ? 'Backing up…' : 'Back up now'}
            </button>
            <button class="btn btn-outline text-sm" onclick="window.__app.hideBackupNotice()">Later</button>
          </div>
        </div>
      </div>`;
  }

  /** e.g. "16 Nov 2026, 8:16 am" */
  static day(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
}
