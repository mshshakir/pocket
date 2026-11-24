/**
 * AiImportService — one Import with AI, from the file to the preview
 * (owner, 24 Nov 2026):
 *
 *   load(file)      read it on the device and find its tables (no AI)
 *   understand()    the AI reads the column names and samples and writes rules
 *   change(text)    the person types a correction; the AI updates the rules
 *   undoChange()    back to the rules before the last correction
 *   fix / skip      a row Pocket couldn't read: fixed by hand, or left out
 *   draft           every row as it would land in Pocket (ImportDraft)
 *
 * All AI calls of one import share a session id: the server charges once per
 * import (the first import of an account is free up to FREE_ROWS rows) and
 * the corrections that follow are free.
 */
import { SheetReader } from './SheetReader.js';
import { TableFinder } from './TableFinder.js';
import { ImportPrompt } from './ImportPrompt.js';
import { ImportMapping } from './ImportMapping.js';
import { ImportDraft } from './ImportDraft.js';

export class AiImportService {
  static FREE_ROWS = 5000;
  static MAX_ROWS = 20000;

  #ask;
  #book;
  /** @type {string} */ file = '';
  /** @type {object[]} */ tables = [];
  /** @type {object|null} */ mapping = null;
  /** @type {object[]} */ #history = [];
  /** @type {Object<string, object>} */ fixes = {};
  /** @type {Set<string>} tables the person unticked */ #off = new Set();
  #session;
  #draft = null;

  /**
   * @param {object} deps
   * @param {(prompt: string, meta: {session: string, rows: number}) => Promise<string>} deps.ask
   * @param {() => object} deps.book  the current book state
   */
  constructor({ ask, book }) {
    this.#ask = ask;
    this.#book = book;
    this.#session = AiImportService.#uuid();
  }

  get rows() { return this.tables.reduce((n, t) => n + t.rows.length, 0); }
  get changes() { return this.#history.length; }
  get session() { return this.#session; }

  /** @returns {Promise<number>} how many tables were found */
  async load(file) {
    const { name, sheets } = await SheetReader.read(file);
    this.file = name;
    this.tables = TableFinder.find(sheets);
    if (!this.tables.length) throw new Error('No tables found in that file.');
    if (this.rows > AiImportService.MAX_ROWS) {
      throw new Error(`That file has ${this.rows.toLocaleString('en-IN')} rows. Pocket can import up to ${AiImportService.MAX_ROWS.toLocaleString('en-IN')} at a time — please split it.`);
    }
    return this.tables.length;
  }

  async understand() {
    const text = await this.#ask(ImportPrompt.first(this.tables, this.#book()), this.#meta());
    this.mapping = ImportMapping.parse(text, this.tables);
    this.#history = [];
    this.#draft = null;
    return this.mapping;
  }

  /** @returns {Promise<string>} what the AI says it changed */
  async change(message) {
    const msg = String(message || '').trim();
    if (!msg || !this.mapping) return '';
    const text = await this.#ask(ImportPrompt.change(this.tables, this.#book(), this.mapping, this.draft, msg), this.#meta());
    const next = ImportMapping.parse(text, this.tables);
    this.#history.push(this.mapping);
    this.mapping = next;
    this.#draft = null;
    return next.reply || 'Done.';
  }

  undoChange() {
    if (!this.#history.length) return false;
    this.mapping = this.#history.pop();
    this.#draft = null;
    return true;
  }

  /** Tick / untick a table on the "what we found" screen. */
  setTable(id, on) {
    if (on) this.#off.delete(id); else this.#off.add(id);
    this.#draft = null;
  }

  isOn(id) { return !this.#off.has(id) && this.mapping?.tables.find((t) => t.id === id)?.kind !== 'skip'; }

  /** A row the person fixed by hand: { amount } | { type } | { date } | { account, to }. */
  fix(key, value) {
    this.fixes[key] = { ...(this.fixes[key] || {}), ...value };
    this.#draft = null;
  }

  skip(key) { this.fix(key, { skip: true }); }

  get draft() {
    if (!this.#draft && this.mapping) {
      const mapping = { ...this.mapping, tables: this.mapping.tables.map((t) => (this.#off.has(t.id) ? { ...t, kind: 'skip' } : t)) };
      this.#draft = new ImportDraft({ tables: this.tables, mapping, book: this.#book(), fixes: this.fixes });
    }
    return this.#draft;
  }

  #meta() { return { session: this.#session, rows: this.rows }; }

  static #uuid() {
    return globalThis.crypto?.randomUUID?.()
      ?? 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
  }
}
