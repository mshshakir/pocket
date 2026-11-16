/**
 * AppNotices — two things the person should know about, shown small:
 *
 *   network  Whether the device has internet.
 *   backup   Google Drive backups are on a schedule: how fresh the last one is.
 *
 * Each has an icon (in the phone's top bar and the desktop sidebar) that
 * is always there, and a box above the page that explains it. The network
 * icon is green while online; offline it turns amber and shades towards red
 * the longer the device has been without internet (over OFFLINE_DAYS).
 * The backup icon is green right after a backup and turns gradually to amber
 * as the next one comes due, then towards red the longer it is overdue (a dot
 * is added once due, so it doesn't rely on colour alone):
 *
 *   - The offline box shows the first time only. Once closed (or once the
 *     device has been back online), going offline shows just the icon.
 *   - The backup box shows each time a backup becomes due. Closed, it stays
 *     away for that backup — but comes back after REMIND_DAYS if the backup
 *     still hasn't been made.
 *   - Tapping an icon opens its box again (for the backup: when the last one
 *     was, when the next is due, and Back up now); every box has a close button.
 *
 * What was closed is remembered on the device (pocket.v1.notices).
 */
import { Html } from '../../core/Html.js';

export class AppNotices {
  static #KEY = 'pocket.v1.notices';
  static REMIND_DAYS = 3;
  /** Offline this long = the network icon is fully red. */
  static OFFLINE_DAYS = 7;
  static #GREEN = 142;
  static #AMBER = 38;
  static #RED = 4;

  #el;
  #iconEls;
  #storage;
  #now;
  /** Boxes opened by tapping their icon; they stay until closed. */
  #opened = { offline: false, backup: false };
  /**
   * backupOn: a schedule is set; backupProgress: 0 = just backed up, 1 = due, 2 = a period overdue;
   * backupAsk: false while automatic backups are looking after a due backup (no box needed).
   * @type {{online: boolean, syncs: boolean, backupOn: boolean, backupProgress: number|null, backupDaysLeft: number|null, backupDue: boolean, backupBusy: boolean, lastAt: string|null}}
   */
  #state = { online: true, syncs: false, backupOn: false, backupProgress: null, backupDaysLeft: null, backupDue: false, backupAsk: true, backupBusy: false, lastAt: null };

  /**
   * @param {HTMLElement|null} el  where the boxes go
   * @param {object} [deps]
   * @param {Iterable<HTMLElement>} [deps.icons]  where the icons go (top bar, sidebar)
   * @param {{getItem: Function, setItem: Function}|null} [deps.storage]  null = remembered for this visit only
   * @param {() => Date} [deps.now]
   */
  constructor(el, { icons = [], storage = null, now = () => new Date() } = {}) {
    this.#el = el;
    this.#iconEls = [...icons];
    this.#storage = storage || AppNotices.#memory();
    this.#now = now;
  }

  /** @param {Partial<{online: boolean, syncs: boolean, backupOn: boolean, backupProgress: number|null, backupDaysLeft: number|null, backupDue: boolean, backupBusy: boolean, lastAt: string|null}>} state */
  show(state) {
    const wasOffline = !this.#state.online;
    this.#state = { ...this.#state, ...state };
    if (this.#state.online) this.#noteOnline();
    // Back online after an offline spell: the explanation has been seen.
    if (wasOffline && this.#state.online) { this.#remember({ offlineSeen: true }); this.#opened.offline = false; }
    if (!this.#state.backupOn) this.#opened.backup = false;
    for (const el of this.#iconEls) el.innerHTML = this.iconsHtml();
    if (this.#el) this.#el.innerHTML = this.html();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  /** Close a box. @param {'offline'|'backup'} kind */
  dismiss(kind) {
    if (kind === 'offline' && !this.#state.online) this.#remember({ offlineSeen: true });
    if (kind === 'backup' && this.#state.backupDue) this.#remember({ backupClosed: { lastAt: this.#state.lastAt || null, at: this.#now().toISOString() } });
    this.#opened[kind] = false;
    this.show({});
  }

  /** Open a box again (its icon was tapped); a second tap closes it. @param {'offline'|'backup'} kind */
  toggle(kind) {
    if (this.#boxShown(kind)) { this.dismiss(kind); return false; }
    this.#opened[kind] = true;
    this.show({});
    return true;
  }

  /** The boxes above the page. */
  html() {
    const s = this.#state;
    return (this.#boxShown('offline') ? this.#offline(s) : '') + (this.#boxShown('backup') ? this.#backup(s) : '');
  }

  /** The icons for the top bar: one per thing that applies now. */
  iconsHtml() {
    const s = this.#state;
    const icon = (kind, name, label, color, dot = false) => `
      <button type="button" class="btn btn-ghost px-2 status-icon status-icon-${kind}" title="${label}" aria-label="${label}"
              style="position:relative" onclick="window.__app.toggleNotice('${kind}')">
        <i data-lucide="${name}" style="width:18px;height:18px;color:${color}"></i>
        ${dot ? `<span class="status-dot" style="position:absolute;top:5px;right:4px;width:7px;height:7px;border-radius:9999px;background:${color}"></span>` : ''}
      </button>`;
    return (s.online
      ? icon('offline', 'wifi', 'You\'re online', AppNotices.backupColor(0))
      : icon('offline', 'wifi-off', this.#offlineLabel(), AppNotices.offlineColor(this.#offlineProgress()), true))
      + (s.backupOn ? icon('backup', s.backupDue ? 'cloud-upload' : 'cloud-check', this.#backupLabel(s), AppNotices.backupColor(s.backupProgress), s.backupDue) : '');
  }

  /**
   * The backup icon's colour: green just after a backup, shading to amber as
   * the next one comes due, then to red over one more period.
   * @param {number|null} progress  0 = just backed up, 1 = due, 2+ = long overdue
   * @returns {string} a CSS colour
   */
  static backupColor(progress) {
    const p = Math.min(2, Math.max(0, Number(progress) || 0));
    const [green, amber, red] = [AppNotices.#GREEN, AppNotices.#AMBER, AppNotices.#RED];
    const hue = p <= 1 ? green + (amber - green) * p : amber + (red - amber) * (p - 1);
    const light = p <= 1 ? 36 + 8 * p : 44 + 4 * (p - 1);
    return `hsl(${Math.round(hue)} 78% ${Math.round(light)}%)`;
  }

  /**
   * The network icon's colour while offline: amber at first, shading to red.
   * @param {number} progress  0 = just went offline, 1 = offline for OFFLINE_DAYS or more
   * @returns {string} a CSS colour
   */
  static offlineColor(progress) {
    const p = Math.min(1, Math.max(0, Number(progress) || 0));
    return `hsl(${Math.round(AppNotices.#AMBER + (AppNotices.#RED - AppNotices.#AMBER) * p)} 78% ${Math.round(44 + 4 * p)}%)`;
  }

  /** How long the device has been offline, as a share of OFFLINE_DAYS (0–1). */
  #offlineProgress() {
    const since = new Date(this.#remembered().lastOnlineAt || NaN);
    if (Number.isNaN(since.getTime())) return 0;
    return Math.min(1, Math.max(0, (this.#now() - since) / (AppNotices.OFFLINE_DAYS * 86_400_000)));
  }

  /** "You're offline · last online 14 Nov 2026, 9:02 am" */
  #offlineLabel() {
    const since = this.#remembered().lastOnlineAt;
    return since ? `You're offline · last online ${AppNotices.day(since)}` : 'You\'re offline';
  }

  /** Remember when the device was last seen online (at most one write a minute). */
  #noteOnline() {
    const last = new Date(this.#remembered().lastOnlineAt || NaN);
    if (Number.isNaN(last.getTime()) || this.#now() - last > 60_000) this.#remember({ lastOnlineAt: this.#now().toISOString() });
  }

  /** "Backed up … · next due in 5 days", for the icon's tooltip and the box. */
  #backupLabel(s) {
    if (s.backupDue) return 'Google Drive backup is due';
    const left = Number(s.backupDaysLeft) || 0;
    return `Backed up to Google Drive · next due ${left <= 1 ? 'tomorrow' : `in ${left} days`}`;
  }

  #boxShown(kind) {
    const s = this.#state;
    const seen = this.#remembered();
    if (kind === 'offline') return this.#opened.offline || (!s.online && !seen.offlineSeen);
    return s.backupOn && (this.#opened.backup || (s.backupDue && s.backupAsk !== false && !this.#backupClosed(seen.backupClosed)));
  }

  /** Closed for this same due backup, and not long enough ago to remind again. */
  #backupClosed(closed) {
    if (!closed || (closed.lastAt || null) !== (this.#state.lastAt || null)) return false;
    const days = (this.#now() - new Date(closed.at)) / 86_400_000;
    return days >= 0 && days < AppNotices.REMIND_DAYS;
  }

  #close(kind) {
    return `
        <button class="btn btn-ghost px-2 app-notice-close" aria-label="Close" title="Close" onclick="window.__app.dismissNotice('${kind}')">
          <i data-lucide="x"></i>
        </button>`;
  }

  #offline(s) {
    if (s.online) {
      return `
      <div class="plan-banner app-notice-online" role="status">
        <i data-lucide="wifi" class="plan-banner-icon" style="color:${AppNotices.backupColor(0)}"></i>
        <div class="flex-1 min-w-0">
          <div class="font-semibold">You're online</div>
          <div class="plan-banner-text">
            ${s.syncs ? 'What you add syncs as you go.' : 'Everything is saved on this device.'}
            Pocket also works without internet — this icon changes colour when you're offline.
          </div>
        </div>${this.#close('offline')}
      </div>`;
    }
    const since = this.#remembered().lastOnlineAt;
    return `
      <div class="plan-banner app-notice-offline" role="status">
        <i data-lucide="wifi-off" class="plan-banner-icon" style="color:${AppNotices.offlineColor(this.#offlineProgress())}"></i>
        <div class="flex-1 min-w-0">
          <div class="font-semibold">You're offline</div>
          <div class="plan-banner-text">
            Keep going — what you add is saved on this device${s.syncs ? ' and will sync when you\'re back online' : ''}.
            ${since ? `Last online: ${Html.escape(AppNotices.day(since))}.` : ''}
            The icon at the top shows when you're offline.
          </div>
        </div>${this.#close('offline')}
      </div>`;
  }

  #backup(s) {
    const last = s.lastAt ? `Last backup: ${Html.escape(AppNotices.day(s.lastAt))}.` : 'No backup has been saved yet.';
    const left = Number(s.backupDaysLeft) || 0;
    const next = s.backupDue ? '' : ` The next one is due ${left <= 1 ? 'tomorrow' : `in ${left} days`}.`;
    return `
      <div class="plan-banner app-notice-backup" role="status">
        <i data-lucide="${s.backupDue ? 'cloud-upload' : 'cloud-check'}" class="plan-banner-icon" style="color:${AppNotices.backupColor(s.backupProgress)}"></i>
        <div class="flex-1 min-w-0">
          <div class="font-semibold">${s.backupDue ? 'Your Google Drive backup is due' : 'Your Google Drive backup is up to date'}</div>
          <div class="plan-banner-text">${last}${next}${s.online ? '' : ' Backing up needs internet — try again when you\'re online.'}</div>
          <div class="flex flex-wrap gap-2 mt-2">
            <button class="btn btn-primary text-sm" onclick="window.__app.driveBackupNow()" ${s.backupBusy || !s.online ? 'disabled style="opacity:.5;cursor:default"' : ''}>
              <i data-lucide="cloud-upload"></i> ${s.backupBusy ? 'Backing up…' : 'Back up now'}
            </button>
            ${s.backupDue ? `<button class="btn btn-outline text-sm" onclick="window.__app.dismissNotice('backup')">Later</button>` : ''}
          </div>
        </div>${this.#close('backup')}
      </div>`;
  }

  #remembered() {
    try { return JSON.parse(this.#storage.getItem(AppNotices.#KEY) || '{}') || {}; } catch (_) { return {}; }
  }

  #remember(change) {
    try { this.#storage.setItem(AppNotices.#KEY, JSON.stringify({ ...this.#remembered(), ...change })); } catch (_) { /* storage full or private mode */ }
  }

  static #memory() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
  }

  /** e.g. "16 Nov 2026, 8:16 am" */
  static day(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
}
