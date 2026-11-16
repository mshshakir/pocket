/**
 * pwa.smoke.mjs — install as an app, the offline file list, the notes above the page.
 * (The service worker itself is checked in a real browser: npm run smoke:offline.)
 *
 *   P1  PwaService: holds the browser's install offer; install() shows it once; installed / iPhone / online
 *   P2  PwaService: asks the browser to keep storage; registers sw.js only where it can
 *   M1  manifest: installable (name, standalone, start page, icons that exist); pages link it
 *   L1  precache list: pages, stamped modules, vendor, icons; CDN scripts from app.html; no admin; sw.js stamped
 *   A1  Settings → General: Install card with a button when offered, steps when not, gone once installed
 *   A2  network icon: green online; offline amber shading to red over a week; the offline box the first time
 *       only, with a close button; tap the icon to reopen
 *
 * Run: node src/__smoke__/pwa.smoke.mjs
 */
import { JSDOM } from 'jsdom';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PwaService } from '../core/PwaService.js';
import { PrecacheManifest } from '../../scripts/precache.mjs';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nInstall & offline suite');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const root = fileURLToPath(new URL('../../', import.meta.url));

const ios_ua = () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari';

/** A window with just what PwaService touches. */
class FakeWindow {
  listeners = {};
  registered = [];
  persistAsked = 0;
  isSecureContext = true;
  document = { readyState: 'complete' };
  standalone = false;
  navigator = {
    onLine: true, userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130', platform: 'Linux', maxTouchPoints: 5,
    serviceWorker: { register: (url) => { this.registered.push(url); return Promise.resolve({}); } },
    storage: { persisted: async () => false, persist: async () => { this.persistAsked++; return true; } },
  };
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  matchMedia = (q) => ({ matches: this.standalone && /standalone/.test(q) });
  fire(type, event = {}) { for (const fn of this.listeners[type] || []) fn(event); }
}

{
  const win = new FakeWindow();
  let changes = 0;
  const pwa = new PwaService({ win, onChange: () => changes++ }).start();
  ok('P1 before the browser offers: cannot install, not installed, steps mention the browser menu', !pwa.canInstall && !pwa.installed && /Install app/.test(pwa.manualSteps));
  ok('P1 install() with no offer says unavailable', await pwa.install() === 'unavailable');
  ok('P1 no offer yet (or already installed, when the browser stops offering): no Install button', !pwa.installable);
  let prevented = 0, prompted = 0;
  const offer = { preventDefault: () => prevented++, prompt: async () => { prompted++; }, userChoice: Promise.resolve({ outcome: 'accepted' }) };
  win.fire('beforeinstallprompt', offer);
  ok('P1 the offer is held (the browser\'s own bar is suppressed) and the page is told', pwa.canInstall && pwa.installable && prevented === 1 && changes === 1);
  ok('P1 install() shows the browser\'s window and reports the answer; the offer is used up', await pwa.install() === 'accepted' && prompted === 1 && !pwa.canInstall);
  win.fire('appinstalled');
  ok('P1 once installed it says so, and the Install button goes', pwa.installed && !pwa.installable);
  const dismissed = new FakeWindow();
  const p2 = new PwaService({ win: dismissed }).start();
  dismissed.fire('beforeinstallprompt', { preventDefault() {}, prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
  ok('P1 a declined offer reports dismissed', await p2.install() === 'dismissed');
  const standalone = new FakeWindow(); standalone.standalone = true;
  ok('P1 running from the home screen counts as installed', new PwaService({ win: standalone }).installed);
  const ios = new FakeWindow(); ios.navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari'; 
  const iosHome = new FakeWindow(); iosHome.navigator.userAgent = ios_ua(); iosHome.navigator.standalone = true;
  ok('P1 iPhone in Safari shows Install (done by hand); from the home screen it does not', new PwaService({ win: (() => { const x = new FakeWindow(); x.navigator.userAgent = ios_ua(); return x; })() }).installable && !new PwaService({ win: iosHome }).installable);
  ok('P1 iPhone: steps say Share → Add to Home Screen', new PwaService({ win: ios }).isIos && /Add to Home Screen/.test(new PwaService({ win: ios }).manualSteps));
  win.navigator.onLine = false; win.fire('offline');
  ok('P1 going offline is noticed and reported', !pwa.online && changes >= 3);

  ok('P2 sw.js is registered once', win.registered.join() === 'sw.js' && (pwa.start(), win.registered.length === 1));
  ok('P2 storage: asks the browser to keep it', await pwa.keepStorage() === true && win.persistAsked === 1);
  const plain = new FakeWindow(); plain.isSecureContext = false; plain.navigator.storage = undefined;
  const p3 = new PwaService({ win: plain }).start();
  ok('P2 an insecure page or an old browser: nothing registered, nothing thrown', plain.registered.length === 0 && await p3.keepStorage() === false);
}

{
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  ok('M1 manifest: Pocket, standalone, opens the app, stays inside the site',
    manifest.short_name === 'Pocket' && manifest.display === 'standalone' && manifest.start_url === 'app.html' && manifest.scope === './');
  ok('M1 icons: 192 and 512, one maskable, files exist',
    manifest.icons.some((i) => i.sizes === '192x192') && manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'any')
    && manifest.icons.some((i) => i.purpose === 'maskable') && manifest.icons.every((i) => existsSync(join(root, i.src))));
  const app = readFileSync(join(root, 'app.html'), 'utf8'); const home = readFileSync(join(root, 'index.html'), 'utf8');
  ok('M1 the app and the homepage link the manifest; the homepage has an Install button',
    /rel="manifest" href="manifest\.webmanifest"/.test(app) && /rel="manifest" href="manifest\.webmanifest"/.test(home) && /id="installBtn" hidden/.test(home) && /id="installIcon" hidden/.test(home) && /InstallButton/.test(home));
  const pages = ['terms.html', 'privacy.html', 'shipping.html', 'contact.html', 'refunds.html'];
  ok('M1 the homepage footer links the five policy pages a payment provider asks for, and each exists', pages.every((p) => home.includes(`href="${p}"`) && existsSync(join(root, p))));
  const contact = readFileSync(join(root, 'contact.html'), 'utf8');
  ok('M1 Contact Us has an email and a phone number, and nothing "To be added"', /mailto:/.test(contact) && /tel:\+91/.test(contact) && !/To be added/.test(contact));
  ok('M1 the app page has a place for the notes', /id="appNotices"/.test(app));
}

{
  const site = mkdtempSync(join(tmpdir(), 'pocket-precache-'));
  cpSync(root, site, { recursive: true, filter: (p) => !/node_modules/.test(p) });
  const list = new PrecacheManifest(site, 'abc12345').write();
  ok('L1 lists the pages, the manifest and the icons', ['app.html', 'index.html', 'privacy.html', 'shipping.html', 'manifest.webmanifest', 'img/icons/icon-512.png'].every((f) => list.files.includes(f)));
  ok('L1 every app module is listed with the deploy stamp', list.files.includes('src/app.js?v=abc12345') && list.files.includes('src/core/PwaService.js?v=abc12345') && list.files.filter((f) => f.startsWith('src/')).every((f) => f.endsWith('?v=abc12345')));
  ok('L1 export libraries and fonts are listed, unstamped', list.files.includes('vendor/jspdf.umd.min.js') && list.files.includes('vendor/fonts/NotoSans-Regular.ttf'));
  ok('L1 not listed: admin, tests, licences, bundle.js, homepage pictures', !list.files.some((f) => /admin|__smoke__|LICENSE|bundle\.js|img\/app/.test(f)));
  ok('L1 CDN scripts and the font stylesheet come from app.html (no preconnects)', list.external.length === 5 && list.external.every((u) => u.startsWith('https://')) && !list.external.includes('https://fonts.gstatic.com'), list.external.join(' '));
  ok('L1 precache.json is written and sw.js carries the release', JSON.parse(readFileSync(join(site, 'precache.json'), 'utf8')).version === 'abc12345' && /const BUILD = 'abc12345';/.test(readFileSync(join(site, 'sw.js'), 'utf8')));
  ok('L1 the repo\'s own sw.js stays unstamped', /const BUILD = 'dev';/.test(readFileSync(join(root, 'sw.js'), 'utf8')));
  let threw = false; try { new PrecacheManifest(site, ''); } catch (_) { threw = true; }
  ok('L1 a missing version is refused', threw);
  rmSync(site, { recursive: true, force: true });
}

const bundleSrc = readFileSync(join(root, 'bundle.js'), 'utf8');
function boot() {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
      <div id="planBanner"></div><div class="status-icons"></div><div id="appNotices"></div>
      <div id="viewContent"></div><div id="sidebarNav"></div><div id="bottomNav"></div><div id="authPill"></div><div id="app"></div>
    </body></html>`, { url: 'https://local.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  window.localStorage.setItem('pocket.v1', JSON.stringify({
    user: { homeCurrency: 'INR', defaultCurrency: 'INR', theme: 'light', showHijri: false, hijriOffset: 0, customPaymentTypes: [], hiddenPaymentTypes: [] },
    accounts: [{ id: 'a1', name: 'Bank', currency: 'INR', type: 'savings', color: '#3b82f6', icon: 'wallet', openingBalance: 0, balance: 0 }],
    categories: [], transactions: [], budgets: [], debts: [], family: [], merchantCategories: {}, accountGroups: [], regularItems: [],
  }));
  window.lucide = { createIcons() {} };
  window.Chart = function () { return { destroy() {} }; };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.fetch = () => Promise.reject(new Error('offline'));
  window.confirm = () => true;
  window.alert = () => {};
  window.eval(bundleSrc);
  return window;
}
{
  const w = boot();
  await wait(100);
  const app = w.__app;
  app.openModal('settings');
  await wait(10);
  const card = () => w.document.querySelector('[data-settings-tab="general"] .install-card');
  ok('A1 no offer from the browser: the card explains how to install by hand, no button', !!card() && !!card().querySelector('.install-steps') && !card().querySelector('.install-now'));
  let prompted = 0;
  const offer = new w.Event('beforeinstallprompt');
  offer.prompt = async () => { prompted++; };
  offer.userChoice = Promise.resolve({ outcome: 'accepted' });
  w.dispatchEvent(offer);
  await wait(10);
  ok('A1 the browser offers: the open Settings shows an Install Pocket button', !!card()?.querySelector('.install-now') && !card().querySelector('.install-steps'));
  ok('A1 and an install icon appears in the top bar', /installApp\(\)/.test(w.document.querySelector('.status-icons .status-icon-install')?.getAttribute('onclick') || ''));
  await app.installApp();
  ok('A1 Install Pocket opens the browser\'s window and confirms', prompted === 1 && /Pocket is installed/.test(w.document.getElementById('toast').textContent));
  w.dispatchEvent(new w.Event('appinstalled'));
  await wait(10);
  ok('A1 once installed the card and the top-bar icon are gone', !card() && !w.document.querySelector('.status-icon-install'));
  ok('A1 the General tab keeps its six settings', w.document.querySelectorAll('[data-settings-tab="general"] .grid.grid-cols-2 select').length === 6);
  app.closeModal();

  const note = () => w.document.querySelector('.app-notice-offline');
  const hueOf = (win) => Number(/hsl\((\d+)/.exec(win.document.querySelector('.status-icons .status-icon-offline')?.innerHTML || '')?.[1]);
  ok('A2 online: no box; a green network icon with no dot', !note() && hueOf(w) === 142 && !w.document.querySelector('.status-icon-offline .status-dot'));
  app.toggleNotice('offline');
  ok('A2 tapping the green icon says you are online; closing it does not use up the first offline explanation', /You're online/.test(w.document.querySelector('.app-notice-online')?.textContent || ''));
  app.dismissNotice('offline');
  Object.defineProperty(w.navigator, 'onLine', { value: false, configurable: true });
  w.dispatchEvent(new w.Event('offline'));
  const icon = () => w.document.querySelector('.status-icons .status-icon-offline');
  const net = (on) => { Object.defineProperty(w.navigator, 'onLine', { value: on, configurable: true }); w.dispatchEvent(new w.Event(on ? 'online' : 'offline')); };
  ok('A2 offline the first time: a box says entries are saved on this device, with a close button, and an icon in the top bar',
    !!note() && /saved on this device/.test(note().textContent) && !/will sync/.test(note().textContent) && !!note().querySelector('.app-notice-close') && !!icon()
    && hueOf(w) === 38 && !!icon().querySelector('.status-dot'), String(hueOf(w)));
  app.dismissNotice('offline');
  ok('A2 closed: the box goes, the icon stays while offline', !note() && !!icon());
  app.toggleNotice('offline');
  ok('A2 tapping the icon opens the box again', !!note());
  net(true);
  ok('A2 back online: the box goes and the icon is green again', !note() && hueOf(w) === 142);
  net(false);
  ok('A2 offline again: only the icon', !note() && hueOf(w) === 38);
  const remembered = JSON.parse(w.localStorage.getItem('pocket.v1.notices'));
  w.localStorage.setItem('pocket.v1.notices', JSON.stringify({ ...remembered, lastOnlineAt: new Date(Date.now() - 3.5 * 86_400_000).toISOString() }));
  w.dispatchEvent(new w.Event('offline'));
  const half = hueOf(w);
  w.localStorage.setItem('pocket.v1.notices', JSON.stringify({ ...remembered, lastOnlineAt: new Date(Date.now() - 20 * 86_400_000).toISOString() }));
  w.dispatchEvent(new w.Event('offline'));
  ok('A2 the longer offline, the redder: half-way after 3½ days, fully red after a week', half < 38 && half > 4 && hueOf(w) === 4 && /last online/.test(icon().getAttribute('title')), `${half} ${hueOf(w)}`);
  net(true);
  const fresh = boot();
  await wait(100);
  Object.defineProperty(fresh.navigator, 'onLine', { value: false, configurable: true }); fresh.dispatchEvent(new fresh.Event('offline'));
  ok('A2 a box left open counts as seen once the device is back online', !!fresh.document.querySelector('.app-notice-offline'));
  Object.defineProperty(fresh.navigator, 'onLine', { value: true, configurable: true }); fresh.dispatchEvent(new fresh.Event('online'));
  Object.defineProperty(fresh.navigator, 'onLine', { value: false, configurable: true }); fresh.dispatchEvent(new fresh.Event('offline'));
  ok('A2 so the next time offline shows just the icon', !fresh.document.querySelector('.app-notice-offline') && !!fresh.document.querySelector('.status-icon-offline'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
