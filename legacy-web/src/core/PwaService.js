/**
 * PwaService — what makes Pocket an app you can install:
 *
 *   - registers the service worker (sw.js), which keeps the app's files on the
 *     device so it opens offline;
 *   - holds the browser's "install" offer until the person taps Install;
 *   - asks the browser to keep this site's storage (the book) permanently,
 *     instead of clearing it when the device runs low on space;
 *   - says whether the device is online.
 *
 * Used by the app (Settings, the offline note) and by the homepage's Install
 * button. Everything is optional: a browser without one of these simply
 * reports it as unavailable.
 */
export class PwaService {
  #win;
  #onChange;
  /** The browser's saved install offer (BeforeInstallPromptEvent), if any. */
  #offer = null;
  #installedNow = false;
  #started = false;

  /**
   * @param {object} [deps]
   * @param {Window} [deps.win]
   * @param {() => void} [deps.onChange]  called when install or online state changes
   */
  constructor({ win = globalThis, onChange = () => {} } = {}) {
    this.#win = win;
    this.#onChange = onChange;
  }

  /** Listen for the browser's events and register the worker. Safe to call once per page. */
  start({ worker = 'sw.js' } = {}) {
    if (this.#started) return this;
    this.#started = true;
    const w = this.#win;
    w.addEventListener?.('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.#offer = e;
      this.#onChange();
    });
    w.addEventListener?.('appinstalled', () => {
      this.#offer = null;
      this.#installedNow = true;
      this.#onChange();
    });
    w.addEventListener?.('online', () => this.#onChange());
    w.addEventListener?.('offline', () => this.#onChange());
    this.#register(worker);
    return this;
  }

  /** True when the browser has offered to install and the person hasn't answered yet. */
  get canInstall() { return !!this.#offer; }

  /** True when Pocket is running as an installed app (or was installed just now). */
  get installed() {
    if (this.#installedNow) return true;
    try {
      if (this.#win.matchMedia?.('(display-mode: standalone)')?.matches) return true;
    } catch (_) { /* no matchMedia */ }
    return this.#win.navigator?.standalone === true;
  }

  /** iPhone and iPad never offer to install; people add the app from the Share menu. */
  get isIos() {
    const nav = this.#win.navigator || {};
    return /iphone|ipad|ipod/i.test(nav.userAgent || '')
      || (/mac/i.test(nav.platform || '') && Number(nav.maxTouchPoints) > 1);
  }

  get online() { return this.#win.navigator?.onLine !== false; }

  /** How to install by hand, for when the browser made no offer. */
  get manualSteps() {
    return this.isIos
      ? 'In Safari, tap Share, then "Add to Home Screen".'
      : 'Open your browser\'s menu (⋮) and choose "Install app" or "Add to Home screen".';
  }

  /**
   * Show the browser's install window.
   * @returns {Promise<'accepted'|'dismissed'|'unavailable'>}
   */
  async install() {
    const offer = this.#offer;
    if (!offer) return 'unavailable';
    this.#offer = null;
    try {
      await offer.prompt();
      const choice = await offer.userChoice;
      this.#onChange();
      return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
    } catch (_) {
      this.#onChange();
      return 'unavailable';
    }
  }

  /**
   * Ask the browser not to clear this site's storage on its own.
   * @returns {Promise<boolean>} whether storage is now kept
   */
  async keepStorage() {
    try {
      const storage = this.#win.navigator?.storage;
      if (!storage?.persist) return false;
      if (await storage.persisted?.()) return true;
      return await storage.persist();
    } catch (_) {
      return false;
    }
  }

  #register(worker) {
    const nav = this.#win.navigator;
    const secure = this.#win.isSecureContext !== false;
    if (!worker || !secure || !nav?.serviceWorker?.register) return;
    const go = () => nav.serviceWorker.register(worker).catch((e) => console.warn('[PwaService] offline support not set up:', e));
    if (this.#win.document?.readyState === 'complete') go();
    else this.#win.addEventListener?.('load', go, { once: true });
  }
}
