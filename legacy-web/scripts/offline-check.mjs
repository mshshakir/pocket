/**
 * offline-check.mjs — proves, in a real Chrome, that the installed app opens
 * with no internet and picks up a new release.
 *
 *   npm run smoke:offline          (CHROME_PATH=/path/to/chrome optional)
 *
 * It builds the site the way the deploy does (stamps ?v= on the modules, runs
 * scripts/precache.mjs), serves it at /pocket/ on a local port, and stands in
 * for the CDNs with a local HTTPS server (so no internet is needed and the
 * cross-site copies are exercised too). Then:
 *
 *   O1  first visit: the service worker installs and copies every listed file
 *   O2  servers stopped (no internet at all): the app still opens — demo and
 *       the real app, the homepage, an export library
 *   O3  the manifest and icons are served and valid for installing
 *   O4  the website answering "not found" for everything (closed or moved): the installed app still opens
 *   O5  a new release replaces the old copy
 */
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { PrecacheManifest } from './precache.mjs';

/** The site as the deploy publishes it, in a temporary folder. */
class BuiltSite {
  #source; #dir;

  constructor(source) {
    this.#source = source;
    this.#dir = mkdtempSync(join(tmpdir(), 'pocket-site-'));
  }

  get dir() { return this.#dir; }

  /** Copy legacy-web and stamp it like .github/workflows/pages.yml does. */
  build(version) {
    rmSync(this.#dir, { recursive: true, force: true });
    cpSync(this.#source, this.#dir, { recursive: true, filter: (p) => !/node_modules|__smoke__/.test(p) });
    const sh = (cmd) => execFileSync('sh', ['-c', cmd], { cwd: this.#dir, stdio: 'pipe' });
    sh(`find src -name '*.js' -print0 | xargs -0 sed -i -E "s#(from '\\.{1,2}/[^'?]+\\.js)'#\\1?v=${version}'#g"`);
    sh(`sed -i -E "s#(from '\\./src/[^'?]+\\.js)'#\\1?v=${version}'#g; s#src=\\"bundle\\.js\\"#src=\\"bundle.js?v=${version}\\"#g; s#src=\\"src/app\\.js\\"#src=\\"src/app.js?v=${version}\\"#g" *.html`);
    return new PrecacheManifest(this.#dir, version).write();
  }

  remove() { rmSync(this.#dir, { recursive: true, force: true }); }
}

/** Serves a folder under /pocket/, and can be stopped to mean "no internet". */
class LocalServer {
  static #TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.ttf': 'font/ttf' };
  #root; #port; #server = null; #sockets = new Set();
  /** True = answer 404 to everything, as a site that has been taken down does. */
  gone = false;

  constructor(root, port) { this.#root = root; this.#port = port; }

  get base() { return `http://localhost:${this.#port}/pocket`; }

  async start() {
    this.#server = createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      if (this.gone) { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>404</h1>'); return; }
      if (!url.pathname.startsWith('/pocket/')) { res.writeHead(404); res.end(); return; }
      const rel = normalize(decodeURIComponent(url.pathname.slice('/pocket/'.length))) || 'index.html';
      const file = join(this.#root, rel === '.' ? 'index.html' : rel);
      if (!file.startsWith(this.#root) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': LocalServer.#TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'max-age=600' });
      res.end(readFileSync(file));
    });
    this.#server.on('connection', (s) => { this.#sockets.add(s); s.on('close', () => this.#sockets.delete(s)); });
    await new Promise((ok) => this.#server.listen(this.#port, '127.0.0.1', ok));
  }

  async stop() {
    for (const s of this.#sockets) s.destroy();
    await new Promise((ok) => this.#server.close(ok));
    this.#server = null;
  }
}

/** Stands in for every CDN the app page loads: tiny scripts, sent with CORS like the real ones. */
class FakeCdn {
  #port; #server = null; #sockets = new Set(); #dir;
  hits = 0;

  constructor(port) {
    this.#port = port;
    this.#dir = mkdtempSync(join(tmpdir(), 'pocket-cdn-'));
  }

  get port() { return this.#port; }

  async start() {
    const key = join(this.#dir, 'key.pem'); const cert = join(this.#dir, 'cert.pem');
    if (!existsSync(key)) {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=cdn.test'], { stdio: 'pipe' });
    }
    this.#server = createHttpsServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
      this.hits++;
      const css = /fonts\.googleapis|\.css/.test(`${req.headers.host}${req.url}`);
      res.writeHead(200, { 'content-type': css ? 'text/css' : 'text/javascript', 'access-control-allow-origin': '*' });
      res.end(css ? '/* fonts */' : FakeCdn.#script(req.headers.host || '', req.url || ''));
    });
    this.#server.on('connection', (s) => { this.#sockets.add(s); s.on('close', () => this.#sockets.delete(s)); });
    await new Promise((ok) => this.#server.listen(this.#port, '127.0.0.1', ok));
  }

  async stop() {
    for (const s of this.#sockets) s.destroy();
    await new Promise((ok) => this.#server.close(ok));
    this.#server = null;
  }

  remove() { rmSync(this.#dir, { recursive: true, force: true }); }

  static #script(host, url) {
    if (/lucide/.test(url)) return 'window.lucide = { createIcons() {} };';
    if (/chart/.test(url)) return 'window.Chart = function () { return { destroy() {}, update() {} }; };';
    if (/tailwind/.test(host)) return 'window.tailwind = window.tailwind || {};';
    return '/* stub */';
  }
}

class OfflineCheck {
  #passed = 0; #failed = 0;

  ok(label, cond, extra = '') {
    if (cond) { this.#passed++; console.log(`  ✓ ${label}`); }
    else { this.#failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
  }

  async run() {
    console.log('\nOffline (service worker) check');
    const here = dirname(fileURLToPath(import.meta.url));
    const site = new BuiltSite(join(here, '..'));
    const web = new LocalServer(site.dir, 5197);
    const cdn = new FakeCdn(5198);
    const list = site.build('aaaa1111');
    await web.start(); await cdn.start();
    const browser = await chromium.launch({
      executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--ignore-certificate-errors', '--no-proxy-server',
        `--host-resolver-rules=MAP cdn.tailwindcss.com 127.0.0.1:${cdn.port}, MAP cdn.jsdelivr.net 127.0.0.1:${cdn.port}, MAP unpkg.com 127.0.0.1:${cdn.port}, MAP fonts.googleapis.com 127.0.0.1:${cdn.port}, MAP fonts.gstatic.com 127.0.0.1:${cdn.port}`],
    });
    try {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));

      // O1 — first visit
      await page.goto(`${web.base}/app.html?demo`, { waitUntil: 'load' });
      await page.waitForSelector('.demo-banner', { timeout: 20000 });
      const cached = await this.#waitForCopy(page, 'pocket-aaaa1111', list.files.length);
      this.ok(`O1 the worker copied all ${list.files.length} listed files (${cached.count} kept)`, cached.count >= list.files.length + list.external.length, JSON.stringify(cached));
      this.ok('O1 the list has the app page, its modules with the deploy stamp, vendor files, icons and the manifest',
        list.files.includes('app.html') && list.files.includes('src/app.js?v=aaaa1111') && list.files.includes('vendor/jspdf.umd.min.js')
        && list.files.includes('img/icons/icon-192.png') && list.files.includes('manifest.webmanifest')
        && !list.files.some((f) => /admin|__smoke__|bundle\.js/.test(f)));
      this.ok('O1 the CDN scripts app.html loads are listed', list.external.length >= 4 && list.external.some((u) => /tailwind/.test(u)) && list.external.some((u) => /lucide/.test(u)), list.external.join(' '));
      this.ok('O1 CDN copies are ordinary responses, not opaque ones', cached.opaque === 0, `${cached.opaque} opaque`);

      // O3 — installable
      const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
      const icons = await page.evaluate(async (srcs) => Promise.all(srcs.map(async (s) => (await fetch(s)).ok)), manifest.icons.map((i) => i.src));
      this.ok('O3 manifest: name, standalone, starts at the app, 192 and 512 icons (one maskable), all served',
        manifest.short_name === 'Pocket' && manifest.display === 'standalone' && manifest.start_url === 'app.html'
        && manifest.icons.some((i) => i.sizes === '192x192') && manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')
        && icons.every(Boolean));

      // O2 — no internet at all
      await web.stop(); await cdn.stop();
      await ctx.setOffline(true);
      await page.reload({ waitUntil: 'load' });
      const demoOffline = await page.waitForSelector('.demo-banner', { timeout: 20000 }).then(() => true, () => false);
      this.ok('O2 offline: the demo opens from the copy', demoOffline);
      this.ok('O2 offline: the "You\'re offline" box shows the first time, with its icon in the top bar', await page.evaluate(() => /You're offline/.test(document.querySelector('.app-notice-offline')?.textContent || '') && !!document.querySelector('.status-icons .status-icon-offline')));
      await page.goto(`${web.base}/app.html`, { waitUntil: 'load' });
      const appOffline = await page.waitForFunction(() => !!window.__app && document.getElementById('viewContent')?.children.length > 0, null, { timeout: 20000 }).then(() => true, () => false);
      this.ok('O2 offline: the real app opens and draws a page', appOffline);
      const lib = await page.evaluate(async () => { const r = await fetch('vendor/jspdf.umd.min.js'); return r.ok && (await r.text()).length > 1000; });
      this.ok('O2 offline: an export library is there', lib);
      await page.goto(`${web.base}/`, { waitUntil: 'load' });
      this.ok('O2 offline: the site address opens the homepage', await page.evaluate(() => !!document.getElementById('installBtn')));
      this.ok('O2 no page errors while offline', errors.length === 0, errors.slice(0, 3).join(' | '));

      // O4 — the website is gone (answers 404), the device is online
      web.gone = true;
      await web.start();
      await ctx.setOffline(false);
      await page.goto(`${web.base}/app.html`, { waitUntil: 'load' });
      const goneOpens = await page.waitForFunction(() => !!window.__app && document.getElementById('viewContent')?.children.length > 0, null, { timeout: 20000 }).then(() => true, () => false);
      const goneLib = await page.evaluate(async () => (await fetch('vendor/write-excel-file.min.js')).ok);
      const goneWorker = await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active);
      this.ok('O4 website closed (404 for everything): the installed app still opens, with its export library and its worker', goneOpens && goneLib && goneWorker);
      await web.stop();
      web.gone = false;

      // O5 — a new release
      site.build('bbbb2222');
      await web.start(); await cdn.start();
      await page.goto(`${web.base}/app.html?demo`, { waitUntil: 'load' });
      await page.waitForSelector('.demo-banner', { timeout: 20000 });
      const next = await this.#waitForCopy(page, 'pocket-bbbb2222', list.files.length);
      const names = await this.#waitForOnly(page, 'pocket-bbbb2222');
      this.ok('O5 a new release is copied and the old copy removed', next.count >= list.files.length && names.join() === 'pocket-bbbb2222', names.join());
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('.demo-banner', { timeout: 20000 });
      const stamp = await page.evaluate(() => document.querySelector('script[src^="src/app.js"]')?.getAttribute('src'));
      this.ok('O5 the page now runs the new release', stamp === 'src/app.js?v=bbbb2222', stamp);
    } finally {
      await browser.close();
      await web.stop().catch(() => {}); await cdn.stop().catch(() => {});
      site.remove(); cdn.remove();
    }
    console.log(`\n${this.#passed} passed, ${this.#failed} failed`);
    return this.#failed === 0;
  }

  /** Wait until the named cache holds at least `want` files. */
  async #waitForCopy(page, name, want) {
    let last = { count: 0, opaque: 0 };
    for (let i = 0; i < 80; i++) {
      last = await page.evaluate(async (n) => {
        if (!(await caches.has(n))) return { count: 0, opaque: 0 };
        const cache = await caches.open(n);
        const keys = await cache.keys();
        let opaque = 0;
        for (const k of keys) if ((await cache.match(k))?.type === 'opaque') opaque++;
        return { count: keys.length, opaque };
      }, name);
      if (last.count >= want) return last;
      await new Promise((r) => setTimeout(r, 250));
    }
    return last;
  }

  async #waitForOnly(page, name) {
    let names = [];
    for (let i = 0; i < 40; i++) {
      names = await page.evaluate(() => caches.keys());
      if (names.length === 1 && names[0] === name) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    return names;
  }
}

const passed = await new OfflineCheck().run();
process.exit(passed ? 0 : 1);
