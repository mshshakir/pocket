/**
 * screenshots.mjs — pictures of the app for the homepage, taken from the
 * sample book in demo mode (app.html?demo=…), so they always match the app.
 *
 *   npm run shots                      (uses Chrome and the app's usual CDNs)
 *   CHROME_PATH=/path/to/chrome npm run shots
 *   ASSETS_DIR=/dir npm run shots      (no internet: serve the CDN files from a
 *                                       folder holding app.css (built Tailwind),
 *                                       chart.umd.min.js and lucide.min.js)
 *
 * Writes img/app/<name>.webp (phone screens at 2×, plus one desktop view).
 * Rerun after a screen changes and commit the images with it.
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

/** Serves legacy-web/ on a local port while the pictures are taken. */
class StaticSite {
  static #TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ttf': 'font/ttf' };
  #root; #server = null;

  constructor(root) { this.#root = root; }

  async start(port = 5199) {
    this.#server = createServer(async (req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
      const file = join(this.#root, path || 'index.html');
      if (!file.startsWith(this.#root) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': StaticSite.#TYPES[extname(file)] || 'application/octet-stream' });
      res.end(await readFile(file));
    });
    await new Promise((ok) => this.#server.listen(port, ok));
    return `http://localhost:${port}`;
  }

  stop() { this.#server?.close(); }
}

/** Takes each picture: opens the demo on a screen, tidies it, captures it. */
class Shooter {
  /** name, demo screen, optional step before the picture, optional scroll target */
  static PHONE = Object.freeze([
    { name: 'dashboard', demo: 'dashboard' },
    { name: 'budgets', demo: 'budgets' },
    { name: 'budget-detail', demo: 'budgets', step: (p) => p.evaluate(() => document.querySelectorAll('[onclick^="window.__app.openBudgetDetail"]')[1]?.click()) },
    { name: 'debts', demo: 'debts' },
    { name: 'reimbursements', demo: 'debts', scroll: 'text=Reimbursements >> nth=-1' },
    { name: 'investments', demo: 'investments' },
    { name: 'bills', demo: 'bills' },
    { name: 'deliveries', demo: 'deliveries' },
    { name: 'habits', demo: 'habits' },
    { name: 'accounts', demo: 'accounts' },
    { name: 'transactions', demo: 'transactions' },
    { name: 'reports', demo: 'reports' },
  ]);
  static DESKTOP = Object.freeze([{ name: 'desktop-dashboard', demo: 'dashboard' }]);

  #browser; #base; #assets; #out;

  constructor({ browser, base, assets, out }) {
    this.#browser = browser; this.#base = base; this.#assets = assets; this.#out = out;
  }

  async all() {
    for (const s of Shooter.PHONE) await this.#take(s, { width: 390, height: 844 }, true);
    for (const s of Shooter.DESKTOP) await this.#take(s, { width: 1280, height: 820 }, false);
  }

  async #take(shot, viewport, mobile) {
    const ctx = await this.#browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile,
      colorScheme: 'light', locale: 'en-IN', timezoneId: 'Asia/Kolkata' });
    if (this.#assets) await this.#offline(ctx);
    const page = await ctx.newPage();
    await page.goto(`${this.#base}/app.html?demo=${shot.demo}`, { waitUntil: 'load' });
    await page.waitForSelector('.demo-banner', { timeout: 15000 });
    // The pictures show the app itself: no demo strip, no first-visit hints.
    await page.addStyleTag({ content: '.demo-banner,.help-hint{display:none!important}' });
    if (shot.step) { await shot.step(page); await page.waitForTimeout(300); await page.addStyleTag({ content: '.demo-banner,.help-hint{display:none!important}' }); }
    if (shot.scroll) await page.locator(shot.scroll).scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(600); // icons and charts settle
    const cdp = await ctx.newCDPSession(page);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'webp', quality: 82 });
    await writeFile(join(this.#out, `${shot.name}.webp`), Buffer.from(data, 'base64'));
    console.log(`  ✓ ${shot.name}`);
    await ctx.close();
  }

  /** Without internet: the CDN files from ASSETS_DIR, fonts from the system. */
  async #offline(ctx) {
    const css = await readFile(join(this.#assets, 'app.css'), 'utf8');
    const file = (name) => readFile(join(this.#assets, name));
    // Playwright tries the newest route first, so the catch-all goes in first.
    await ctx.route(/^https:\/\//, (r) => r.abort());
    await ctx.route(/^https:\/\/cdn\.tailwindcss\.com/, (r) => r.fulfill({ contentType: 'text/javascript',
      body: `window.tailwind={};document.head.insertAdjacentHTML('beforeend',${JSON.stringify(`<style>${css}</style>`)});` }));
    await ctx.route('**/chart.umd.min.js', async (r) => r.fulfill({ contentType: 'text/javascript', body: await file('chart.umd.min.js') }));
    await ctx.route('**/lucide.min.js', async (r) => r.fulfill({ contentType: 'text/javascript', body: await file('lucide.min.js') }));
    await ctx.route('**/supabase.min.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.supabase={createClient(){return {}}};' }));
    await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const root = normalize(join(here, '..'));
const out = join(root, 'img', 'app');
await mkdir(out, { recursive: true });
const site = new StaticSite(root);
const base = await site.start();
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
try {
  await new Shooter({ browser, base, assets: process.env.ASSETS_DIR || null, out }).all();
} finally {
  await browser.close();
  site.stop();
}
