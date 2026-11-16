/**
 * BackupFiles — the two files one backup is made of, and how they are named,
 * paired up again and read back.
 *
 *   Pocket book 2026-11-16 081605.json         the whole book; Pocket restores from this
 *                                              (the same file as Settings → Export JSON)
 *   Pocket transactions 2026-11-16 081605.csv  every transaction, for any spreadsheet
 *                                              (the same columns as Import CSV)
 *
 * The date and time in the name pair a book with its CSV.
 */
import { Repository } from '../../core/Repository.js';

export class BackupFiles {
  static #BOOK = 'Pocket book';
  static #CSV = 'Pocket transactions';
  static #NAME = /^Pocket (book|transactions) (\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})(\d{2})?\.(json|csv)$/;

  /**
   * The files for a backup made now.
   * @param {object} state  the book
   * @param {string} csv    every transaction as CSV text
   * @param {Date} [now]
   * @returns {{stamp: string, files: Array<{kind: 'book'|'csv', name: string, mime: string, body: string}>}}
   */
  static make(state, csv, now = new Date()) {
    const stamp = BackupFiles.#stamp(now);
    return {
      stamp,
      files: [
        { kind: 'book', name: `${BackupFiles.#BOOK} ${stamp}.json`, mime: 'application/json',
          body: JSON.stringify(Repository.stripTransient(state)) },
        { kind: 'csv', name: `${BackupFiles.#CSV} ${stamp}.csv`, mime: 'text/csv', body: csv },
      ],
    };
  }

  /**
   * Pair a folder's files into backups, newest first. Files Pocket didn't name are left out.
   * @param {Array<{id: string, name: string, size: number, createdTime: string}>} files
   * @returns {Array<{stamp: string, at: Date, book: object|null, csv: object|null, fileIds: string[]}>}
   */
  static group(files) {
    const byStamp = new Map();
    for (const f of files || []) {
      const m = BackupFiles.#NAME.exec(f.name || '');
      if (!m) continue;
      const stamp = `${m[2]}-${m[3]}-${m[4]} ${m[5]}${m[6]}${m[7] || ''}`;
      if (!byStamp.has(stamp)) {
        byStamp.set(stamp, {
          stamp,
          at: new Date(Number(m[2]), Number(m[3]) - 1, Number(m[4]), Number(m[5]), Number(m[6]), Number(m[7] || 0)),
          book: null, csv: null, fileIds: [],
        });
      }
      const group = byStamp.get(stamp);
      if (m[1] === 'book' && !group.book) group.book = f;
      if (m[1] === 'transactions' && !group.csv) group.csv = f;
      group.fileIds.push(f.id);
    }
    return [...byStamp.values()].sort((a, b) => b.at - a.at);
  }

  /**
   * Read a book file back.
   * @param {string} text
   * @returns {object} the book
   * @throws {Error} when it isn't a Pocket book
   */
  static parseBook(text) {
    let book;
    try { book = JSON.parse(text); } catch (_) { throw new Error('That file is not a Pocket book'); }
    if (!book || !Array.isArray(book.accounts) || !Array.isArray(book.transactions)) {
      throw new Error('That file is not a Pocket book');
    }
    return book;
  }

  /** e.g. "2026-11-16 081605" (local time; seconds keep two backups in one minute apart). */
  static #stamp(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }
}
