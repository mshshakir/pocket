/**
 * XlsxReader — reads the cells of every tab of an Excel (.xlsx) file as text,
 * on the device, with no library: an .xlsx is a zip of XML files.
 *
 * Dates stored as Excel day numbers come out as YYYY-MM-DD when the cell is
 * formatted as a date; other numbers come out as plain digits. Formulas give
 * their last saved value.
 */
export class XlsxReader {
  static MAX_ROWS = 25000;
  /** Built-in Excel number formats that are dates. */
  static #DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

  #bytes;
  /** @type {Map<string, {offset: number, method: number, size: number}>} */
  #entries = new Map();

  /** @param {Uint8Array} bytes */
  constructor(bytes) {
    this.#bytes = bytes;
  }

  /** @returns {Promise<{name: string, grid: string[][]}[]>} */
  async read() {
    this.#index();
    if (!this.#entries.has('xl/workbook.xml')) throw new Error('This doesn\'t look like an Excel file.');
    const strings = this.#sharedStrings(await this.#text('xl/sharedStrings.xml'));
    const dateStyles = this.#dateStyles(await this.#text('xl/styles.xml'));
    const sheets = [];
    for (const { name, path } of this.#sheets(await this.#text('xl/workbook.xml'), await this.#text('xl/_rels/workbook.xml.rels'))) {
      const xml = await this.#text(path);
      if (xml) sheets.push({ name, grid: this.#grid(xml, strings, dateStyles) });
    }
    return sheets;
  }

  // ── zip ──────────────────────────────────────────────────────────────

  #u16(o) { return this.#bytes[o] | (this.#bytes[o + 1] << 8); }
  #u32(o) { return (this.#u16(o) | (this.#u16(o + 2) << 16)) >>> 0; }

  /** Reads the zip's central directory. */
  #index() {
    const b = this.#bytes;
    let end = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
      if (this.#u32(i) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw new Error('This doesn\'t look like an Excel file.');
    const count = this.#u16(end + 10);
    let p = this.#u32(end + 16);
    const dec = new TextDecoder();
    for (let n = 0; n < count && this.#u32(p) === 0x02014b50; n++) {
      const method = this.#u16(p + 10);
      const size = this.#u32(p + 20);
      const nameLen = this.#u16(p + 28), extraLen = this.#u16(p + 30), commentLen = this.#u16(p + 32);
      const local = this.#u32(p + 42);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
      const offset = local + 30 + this.#u16(local + 26) + this.#u16(local + 28);
      this.#entries.set(name, { offset, method, size });
      p += 46 + nameLen + extraLen + commentLen;
    }
  }

  async #text(path) {
    const e = this.#entries.get(path);
    if (!e) return '';
    const raw = this.#bytes.subarray(e.offset, e.offset + e.size);
    if (e.method === 0) return new TextDecoder().decode(raw);
    if (e.method !== 8) throw new Error('This Excel file is compressed in a way that can\'t be read.');
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  }

  // ── XML ──────────────────────────────────────────────────────────────

  static #decode(s) {
    return String(s).replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) => {
      const k = e.toLowerCase();
      if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'amp') return '&';
      if (k === 'quot') return '"'; if (k === 'apos') return '\'';
      return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
    });
  }

  static #attr(tag, name) {
    const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
    return m ? XlsxReader.#decode(m[1]) : null;
  }

  /** The text of every <t> inside a piece of XML (rich text has several). */
  static #texts(xml) {
    let out = '';
    for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += XlsxReader.#decode(m[1]);
    return out;
  }

  #sharedStrings(xml) {
    return [...String(xml).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => XlsxReader.#texts(m[1]));
  }

  /** Style index → is a date format. */
  #dateStyles(xml) {
    const custom = new Map();
    for (const m of String(xml).matchAll(/<numFmt\s[^>]*>/g)) {
      const id = Number(XlsxReader.#attr(m[0], 'numFmtId'));
      const code = (XlsxReader.#attr(m[0], 'formatCode') || '').replace(/"[^"]*"|\[[^\]]*\]/g, '').toLowerCase();
      custom.set(id, /[dy]/.test(code) || (/m/.test(code) && !/[hs]/.test(code) && /\d|m{2,}/.test(code)));
    }
    const xfs = String(xml).match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] || '';
    return [...xfs.matchAll(/<xf\s[^>]*?\/?>/g)].map((m) => {
      const id = Number(XlsxReader.#attr(m[0], 'numFmtId') || 0);
      return XlsxReader.#DATE_IDS.has(id) || custom.get(id) === true;
    });
  }

  #sheets(workbook, rels) {
    const targets = new Map();
    for (const m of String(rels).matchAll(/<Relationship\s[^>]*>/g)) {
      targets.set(XlsxReader.#attr(m[0], 'Id'), XlsxReader.#attr(m[0], 'Target'));
    }
    return [...String(workbook).matchAll(/<sheet\s[^>]*>/g)].map((m) => {
      const t = targets.get(XlsxReader.#attr(m[0], 'r:id')) || '';
      const path = t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`;
      return { name: XlsxReader.#attr(m[0], 'name') || 'Sheet', path };
    });
  }

  static #col(ref) {
    const letters = String(ref || '').match(/^[A-Z]+/i)?.[0].toUpperCase() || '';
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  /** An Excel day number as YYYY-MM-DD. */
  static serialDate(serial) {
    const ms = Math.round((Number(serial) - 25569) * 86400000);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }

  #grid(xml, strings, dateStyles) {
    const grid = [];
    for (const row of xml.matchAll(/<row\s([^>]*)>([\s\S]*?)<\/row>|<row\s([^>]*)\/>/g)) {
      const r = Number(XlsxReader.#attr(` ${row[1] || row[3]}`, 'r')) - 1;
      if (!(r >= 0) || r >= XlsxReader.MAX_ROWS) continue;
      const cells = [];
      for (const c of (row[2] || '').matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = ` ${c[1]}`;
        const at = XlsxReader.#col(XlsxReader.#attr(tag, 'r'));
        if (at < 0 || at > 200) continue;
        cells[at] = this.#value(tag, c[2] || '', strings, dateStyles);
      }
      grid[r] = Array.from({ length: cells.length }, (_, i) => cells[i] ?? '');
    }
    for (let i = 0; i < grid.length; i++) grid[i] ??= [];
    while (grid.length && grid[grid.length - 1].every((v) => v === '')) grid.pop();
    return grid;
  }

  #value(tag, inner, strings, dateStyles) {
    const type = XlsxReader.#attr(tag, 't');
    const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    if (type === 's') return (strings[Number(v)] ?? '').trim();
    if (type === 'inlineStr') return XlsxReader.#texts(inner).trim();
    if (type === 'str' || type === 'e') return XlsxReader.#decode(v ?? '').trim();
    if (type === 'b') return v === '1' ? 'TRUE' : 'FALSE';
    if (v == null || v === '') return '';
    const num = Number(v);
    if (!Number.isFinite(num)) return XlsxReader.#decode(v).trim();
    if (dateStyles[Number(XlsxReader.#attr(tag, 's') || 0)] && num > 0 && num < 2958466) return XlsxReader.serialDate(num);
    return String(Math.round(num * 1e8) / 1e8);
  }
}
