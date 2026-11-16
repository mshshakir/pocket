/**
 * precache.mjs — run by the deploy (pages.yml) on the assembled site.
 *
 * Writes precache.json, the list of files the service worker (sw.js) copies
 * onto the device so the app opens offline, and stamps the release into sw.js
 * so each deploy gets a fresh copy.
 *
 *   node scripts/precache.mjs <site folder> <version>
 *
 * Listed: the pages, every module under src/ (with the deploy's ?v= stamp,
 * exactly as the pages ask for them), vendor/, the icons and the manifest,
 * plus the CDN scripts and styles app.html loads. Not listed: the admin
 * dashboard, the homepage pictures and bundle.js (no page loads it).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export class PrecacheManifest {
  static #PAGES = ['app.html', 'index.html', 'privacy.html', 'terms.html', 'refunds.html', 'contact.html', 'programme.html'];
  static #FOLDERS = ['src', 'vendor', 'img/icons'];
  static #SKIP = [/^src\/admin\//, /^src\/__smoke__\//, /\.(LICENSE|txt|md)$/i];
  static #EXTRA = ['manifest.webmanifest'];

  #root;
  #version;

  /** @param {string} root the site folder  @param {string} version the deploy stamp */
  constructor(root, version) {
    this.#root = root;
    this.#version = String(version || '').trim();
    if (!this.#version) throw new Error('A version is needed');
  }

  /** @returns {{version: string, files: string[], external: string[]}} */
  build() {
    const files = [
      ...PrecacheManifest.#PAGES.filter((p) => this.#exists(p)),
      ...PrecacheManifest.#EXTRA.filter((p) => this.#exists(p)),
      ...PrecacheManifest.#FOLDERS.flatMap((dir) => this.#walk(dir)).map((p) => this.#stamped(p)),
    ];
    return { version: this.#version, files, external: this.#external() };
  }

  /** Write precache.json and stamp sw.js. @returns {object} the list */
  write() {
    const list = this.build();
    writeFileSync(join(this.#root, 'precache.json'), JSON.stringify(list));
    const swPath = join(this.#root, 'sw.js');
    const sw = readFileSync(swPath, 'utf8');
    const stamped = sw.replace(/const BUILD = '[^']*';/, `const BUILD = '${this.#version}';`);
    if (stamped === sw && !sw.includes(`'${this.#version}'`)) throw new Error('sw.js has no BUILD line to stamp');
    writeFileSync(swPath, stamped);
    return list;
  }

  /** Modules are asked for with the deploy stamp; everything else by its plain path. */
  #stamped(path) {
    return path.startsWith('src/') && path.endsWith('.js') ? `${path}?v=${this.#version}` : path;
  }

  /** CDN scripts and stylesheets the app page loads. */
  #external() {
    if (!this.#exists('app.html')) return [];
    const html = readFileSync(join(this.#root, 'app.html'), 'utf8');
    const found = [...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="(https:\/\/[^"]+)"[^>]*>/g)]
      .filter((m) => !/rel="preconnect"/.test(m[0]))
      .map((m) => m[1]);
    return [...new Set(found)];
  }

  #walk(dir) {
    const start = join(this.#root, dir);
    if (!this.#exists(dir)) return [];
    const out = [];
    const visit = (folder) => {
      for (const name of readdirSync(folder).sort()) {
        const full = join(folder, name);
        if (statSync(full).isDirectory()) { visit(full); continue; }
        const path = relative(this.#root, full).split(sep).join('/');
        if (!PrecacheManifest.#SKIP.some((re) => re.test(path))) out.push(path);
      }
    };
    visit(start);
    return out;
  }

  #exists(path) {
    try { statSync(join(this.#root, path)); return true; } catch (_) { return false; }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [root, version] = process.argv.slice(2);
  if (!root || !version) {
    console.error('Usage: node scripts/precache.mjs <site folder> <version>');
    process.exit(1);
  }
  const list = new PrecacheManifest(root, version).write();
  console.log(`precache.json: ${list.files.length} files + ${list.external.length} CDN, version ${list.version}`);
}
