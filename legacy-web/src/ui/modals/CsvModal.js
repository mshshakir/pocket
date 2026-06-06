/**
 * CsvModal — Export transactions as CSV.
 * Presents four range presets (30 days, 90 days, all time, current report range).
 */
export class CsvModal {
  render() {
    return `
      <div class="p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">Export transactions</h3>
          <button class="btn btn-ghost" onclick="window.__app.closeModal()">
            <i data-lucide="x"></i>
          </button>
        </div>

        <div class="grid grid-cols-2 gap-2 mb-4">
          <button class="btn btn-outline justify-center"
                  onclick="window.__app.exportCsv('30')">Last 30 days</button>
          <button class="btn btn-outline justify-center"
                  onclick="window.__app.exportCsv('90')">Last 90 days</button>
          <button class="btn btn-outline justify-center"
                  onclick="window.__app.exportCsv('all')">All time</button>
          <button class="btn btn-primary  justify-center"
                  onclick="window.__app.exportCsv('current')">Current range</button>
        </div>

        <div class="text-xs text-zinc-500 text-center">
          CSV columns mirror the import template (Date, Type, Account, ToAccount,
          Category, Subcategory, Payee, Note, Amount, Currency, PaymentType, Tags,
          DueDate, DebtRef, SplitOf, CreatedAt, AddedBy). Split transactions emit
          one row per slice — all rows share the same <code>SplitOf</code> value
          (the parent transaction id). Re-importing the file rebuilds the splits.
        </div>
      </div>`;
  }

  downloadFailedRows(rows) {
    if (!rows?.length) return;
    const headers = Object.keys(rows[0]).filter(k => k !== '_error');
    const lines = [
      [...headers, '_Error'].join(','),
      ...rows.map(r => [
        ...headers.map(h => JSON.stringify(r[h] ?? '')),
        JSON.stringify(r._error || ''),
      ].join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: 'import_errors.csv' });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async #commitChunked(txDrafts, applyFn) {
    const CHUNK = 25;
    for (let i = 0; i < txDrafts.length; i += CHUNK) {
      txDrafts.slice(i, i + CHUNK).forEach(applyFn);
      await new Promise(r => setTimeout(r, 0));
    }
  }

  static normaliseType(raw) {
    let type = (raw || '').toLowerCase().trim();
    if (type === 'debit')                   type = 'expense';
    if (type === 'credit')                  type = 'income';
    if (type === 'borrow')                  type = 'borrowed';
    if (type === 'lend' || type === 'loan') type = 'lent';
    return type;
  }
}
