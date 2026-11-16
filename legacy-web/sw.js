/**
 * Pocket's service worker — keeps a copy of the app's own files on the device
 * so Pocket opens with no internet.
 *
 * What it keeps
 *   - The app's files listed in precache.json (written at deploy time by
 *     scripts/precache.mjs): pages, every module, the export libraries, icons,
 *     and the few CDN scripts app.html loads.
 *   - Anything else of the app's it is asked for along the way.
 *
 * What it never touches
 *   - The book. That lives in the page's own storage, as before.
 *   - Supabase, Google or any other request that isn't a plain GET for one of
 *     the app's files or its CDN scripts. Those go straight to the network.
 *
 * How a request is answered
 *   - A file with a deploy stamp (?v=…) never changes: copy first, else network.
 *   - Pages and unstamped files: network first (so a new release shows at
 *     once), falling back to the copy when offline or the network is too slow.
 *   - CDN scripts and fonts: the copy at once, refreshed in the background.
 *
 * BUILD is stamped by the deploy; each release gets its own cache and the old
 * one is removed once the new one is complete.
 */
const BUILD = 'dev';

class OfflineFiles {
  static #PREFIX = 'pocket-';
  static #CDN_HOSTS = new Set([
    'cdn.tailwindcss.com', 'cdn.jsdelivr.net', 'unpkg.com',
    'fonts.googleapis.com', 'fonts.gstatic.com',
  ]);
  /** Never answered from here: the worker itself and its file list. */
  static #SKIP = /\/(sw\.js|precache\.json)$/;
  static #SLOW_MS = 4000;

  #scope;
  #cacheName;

  /** @param {ServiceWorkerGlobalScope} scope @param {string} build */
  constructor(scope, build) {
    this.#scope = scope;
    this.#cacheName = `${OfflineFiles.#PREFIX}${build}`;
  }

  start() {
    this.#scope.addEventListener('install', (e) => e.waitUntil(this.#install()));
    this.#scope.addEventListener('activate', (e) => e.waitUntil(this.#activate()));
    this.#scope.addEventListener('fetch', (e) => {
      const answer = this.#answer(e.request);
      if (answer) e.respondWith(answer);
    });
  }

  // ── Install / activate ───────────────────────────────────────────────

  /** Copy every listed file. One of the app's own files failing stops the install, so a half copy never takes over. */
  async #install() {
    const list = await this.#fileList();
    const cache = await caches.open(this.#cacheName);
    await Promise.all(list.files.map(async (path) => {
      const res = await fetch(new Request(path, { cache: 'reload' }));
      if (!res.ok) throw new Error(`precache ${path}: HTTP ${res.status}`);
      await cache.put(path, res);
    }));
    await Promise.all(list.external.map((url) => this.#refresh(cache, new Request(url)).catch(() => null)));
    await this.#scope.skipWaiting();
  }

  /** @returns {Promise<{files: string[], external: string[]}>} empty when there's no list (a local copy of the site) */
  async #fileList() {
    try {
      const res = await fetch('precache.json', { cache: 'no-store' });
      if (!res.ok) return { files: [], external: [] };
      const json = await res.json();
      return { files: json.files || [], external: json.external || [] };
    } catch (_) {
      return { files: [], external: [] };
    }
  }

  async #activate() {
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => n.startsWith(OfflineFiles.#PREFIX) && n !== this.#cacheName)
      .map((n) => caches.delete(n)));
    await this.#scope.clients.claim();
  }

  // ── Requests ─────────────────────────────────────────────────────────

  /** @returns {Promise<Response>|null} null = leave it to the browser */
  #answer(request) {
    if (request.method !== 'GET') return null;
    const url = new URL(request.url);
    if (url.origin === this.#scope.location.origin) {
      if (!url.pathname.startsWith(new URL(this.#scope.registration.scope).pathname)) return null;
      if (OfflineFiles.#SKIP.test(url.pathname)) return null;
      if (url.searchParams.has('v')) return this.#copyFirst(request);
      return this.#networkFirst(request);
    }
    if (OfflineFiles.#CDN_HOSTS.has(url.hostname)) return this.#copyThenRefresh(request);
    return null;
  }

  async #copyFirst(request) {
    const cache = await caches.open(this.#cacheName);
    const hit = await cache.match(request);
    if (hit) return hit;
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  }

  async #networkFirst(request) {
    const cache = await caches.open(this.#cacheName);
    const copy = () => this.#copyOf(cache, request);
    try {
      const res = await this.#withinTime(fetch(request), copy);
      if (res.ok && res.type === 'basic') cache.put(request, res.clone());
      return res;
    } catch (_) {
      return (await copy()) || Response.error();
    }
  }

  /**
   * The saved copy of a page or file. A page is found whatever follows the
   * "?" (app.html?demo); the site's address alone is the homepage; any other
   * page falls back to the app.
   */
  async #copyOf(cache, request) {
    const exact = await cache.match(request);
    if (exact) return exact;
    const loose = await cache.match(request, { ignoreSearch: true });
    if (loose) return loose;
    if (request.mode !== 'navigate') return undefined;
    const home = new URL(request.url).pathname.endsWith('/') ? await cache.match('index.html') : undefined;
    return home || cache.match('app.html');
  }

  /** The network's answer, unless it takes too long and there is a copy to show instead. */
  #withinTime(network, copy) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(async () => {
        const hit = await copy();
        if (hit) resolve(hit);
      }, OfflineFiles.#SLOW_MS);
      network.then((res) => { clearTimeout(timer); resolve(res); }, (err) => { clearTimeout(timer); reject(err); });
    });
  }

  async #copyThenRefresh(request) {
    const cache = await caches.open(this.#cacheName);
    const hit = await cache.match(request.url);
    const fresh = this.#refresh(cache, request);
    if (hit) { fresh.catch(() => null); return hit; }
    return fresh;
  }

  /**
   * Fetch a CDN file and keep it. Asked for with CORS first, so the copy is an
   * ordinary response; a browser counts an opaque one as several megabytes
   * against the site's storage.
   */
  async #refresh(cache, request) {
    let res;
    try {
      res = await fetch(new Request(request.url, { mode: 'cors', credentials: 'omit' }));
    } catch (_) {
      res = await fetch(new Request(request.url, { mode: 'no-cors' }));
    }
    if (res.ok || res.type === 'opaque') await cache.put(request.url, res.clone());
    return res;
  }
}

new OfflineFiles(self, BUILD).start();
