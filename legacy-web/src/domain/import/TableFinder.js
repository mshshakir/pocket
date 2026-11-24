/**
 * TableFinder — finds the separate tables in each sheet (owner, 24 Nov 2026).
 *
 * People often keep entries, budgets and transfers in one tab with a blank
 * line between them, or side by side with a blank column. Each block of filled
 * cells becomes one table: its first row is the header. A lone line of text
 * just above a block ("Budgets – Nov") is kept as the table's title, a hint
 * for the AI. A block with no header of its own (a stray blank line in the
 * middle of entries) is told apart by the AI and read with the table above.
 * "Total" / "Balance" rows are taken out and listed as skipped.
 *
 * All of this is done here, without the AI; the AI only says what each table
 * is and which column means what.
 */
export class TableFinder {
  static #TOTAL = /^\s*(grand\s+)?(sub\s*)?totals?\b|^\s*(closing|opening)?\s*balance\b|^\s*sum\b/i;

  /**
   * @param {{name: string, grid: string[][]}[]} sheets
   * @returns {{id: string, sheet: string, title: string, firstRow: number, lastRow: number,
   *   columns: string[], head: {n: number, cells: string[]}, rows: {n: number, cells: string[]}[], skipped: {n: number, text: string}[]}[]}
   *   firstRow / lastRow / n are the sheet's own row numbers (1 = first row)
   */
  static find(sheets) {
    const tables = [];
    for (const sheet of sheets) {
      for (const block of TableFinder.#blocks(sheet.grid)) {
        const t = TableFinder.#table(sheet.name, block);
        if (t) tables.push({ id: `t${tables.length + 1}`, ...t });
      }
    }
    return tables;
  }

  static #filled(v) { return String(v ?? '').trim() !== ''; }

  /** Runs of filled rows, each split again by fully blank columns. */
  static #blocks(grid) {
    const out = [];
    let start = -1;
    for (let r = 0; r <= grid.length; r++) {
      const has = r < grid.length && (grid[r] || []).some(TableFinder.#filled);
      if (has && start < 0) start = r;
      if (!has && start >= 0) {
        out.push(...TableFinder.#byColumns(grid, start, r - 1));
        start = -1;
      }
    }
    return out;
  }

  static #byColumns(grid, from, to) {
    const width = Math.max(...grid.slice(from, to + 1).map((r) => (r || []).length));
    const used = Array.from({ length: width }, (_, c) => grid.slice(from, to + 1).some((r) => TableFinder.#filled(r?.[c])));
    const spans = [];
    let s = -1;
    for (let c = 0; c <= width; c++) {
      if (c < width && used[c] && s < 0) s = c;
      if ((c === width || !used[c]) && s >= 0) { spans.push([s, c - 1]); s = -1; }
    }
    return spans.map(([c0, c1]) => {
      const rows = [];
      for (let r = from; r <= to; r++) {
        const cells = (grid[r] || []).slice(c0, c1 + 1).map((v) => String(v ?? '').trim());
        while (cells.length < c1 - c0 + 1) cells.push('');
        if (cells.some((v) => v !== '')) rows.push({ n: r + 1, cells });
      }
      return rows;
    }).filter((rows) => rows.length);
  }

  static #table(sheet, block) {
    let rows = block;
    let title = '';
    // A single filled cell on the first line of a block with more below is a title.
    if (rows.length > 1 && rows[0].cells.filter(TableFinder.#filled).length === 1 && rows[1].cells.filter(TableFinder.#filled).length > 1) {
      title = rows[0].cells.find(TableFinder.#filled);
      rows = rows.slice(1);
    }
    if (rows.length === 1 && rows[0].cells.filter(TableFinder.#filled).length <= 1) {
      return null; // a stray note, not a table
    }
    const header = rows[0];
    const columns = TableFinder.#labels(header.cells);
    const body = [], skipped = [];
    for (const row of rows.slice(1)) {
      const first = row.cells.find(TableFinder.#filled) || '';
      if (TableFinder.#TOTAL.test(first)) skipped.push({ n: row.n, text: first });
      else body.push(row);
    }
    return { sheet, title, firstRow: header.n, lastRow: rows[rows.length - 1].n, columns, head: { n: header.n, cells: header.cells }, rows: body, skipped };
  }

  /** Header names, with "Column B" for blanks and "(2)" for repeats. */
  static #labels(cells) {
    const seen = new Map();
    return cells.map((v, i) => {
      let name = String(v || '').replace(/\s+/g, ' ').trim().slice(0, 60) || `Column ${TableFinder.letter(i)}`;
      const k = name.toLowerCase();
      const n = (seen.get(k) || 0) + 1;
      seen.set(k, n);
      if (n > 1) name = `${name} (${n})`;
      return name;
    });
  }

  /** 0 → A, 25 → Z, 26 → AA. */
  static letter(i) {
    let s = '';
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }
}
