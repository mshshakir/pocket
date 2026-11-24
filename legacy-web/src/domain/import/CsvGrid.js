/**
 * CsvGrid — CSV text to a grid of cells, keeping blank rows (they separate
 * tables in one sheet). Quotes, doubled quotes and line breaks inside quotes
 * are handled; the separator (comma, semicolon or tab) is worked out from the
 * first lines.
 */
export class CsvGrid {
  /**
   * @param {string} text
   * @returns {string[][]} rows of trimmed cells; trailing blank rows dropped
   */
  static parse(text) {
    let s = String(text || '');
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    const sep = CsvGrid.#separator(s);
    const rows = [];
    let cur = [], field = '', inQ = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i], nx = s[i + 1];
      if (inQ) {
        if (c === '"' && nx === '"') { field += '"'; i++; }
        else if (c === '"') inQ = false;
        else field += c;
      } else if (c === '"') inQ = true;
      else if (c === sep) { cur.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && nx === '\n') i++;
        cur.push(field); field = '';
        rows.push(cur.map((v) => v.trim()));
        cur = [];
      } else field += c;
    }
    if (field !== '' || cur.length) { cur.push(field); rows.push(cur.map((v) => v.trim())); }
    while (rows.length && rows[rows.length - 1].every((v) => v === '')) rows.pop();
    return rows;
  }

  /** The separator used most often outside quotes in the first few lines. */
  static #separator(s) {
    const head = s.slice(0, 4000);
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let inQ = false;
    for (const c of head) {
      if (c === '"') inQ = !inQ;
      else if (!inQ && c in counts) counts[c]++;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
      ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
  }
}
