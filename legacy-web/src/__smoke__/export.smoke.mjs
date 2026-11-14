/**
 * export.smoke.mjs — exporting reports (PDF, Excel, CSV) with filters.
 *
 *   F  ExportFilter: periods, custom dates, sub-categories, transfers matched
 *      by either account, search
 *   L  LedgerEntries: split → one row per slice; transfer → one row
 *   T  Transactions report: chosen columns in order, grouping with
 *      subtotals, totals that leave transfers out, labels never read as dates
 *   C  Category report: main categories with their sub-categories, shares
 *   M  Month report: Gregorian and Hijri months
 *   A  Account report: each account in its own currency, transfers both ways
 *   K  The layout survives any filter change, and both are remembered
 *   W  CSV (BOM, formula guard) and Excel sheet (frozen header, number cells,
 *      the real writer accepts it)
 *
 * The PDF writer runs in a real browser (see the delta of this session's
 * notes); its layout rules are covered by T (same table model).
 *
 * Run: node src/__smoke__/export.smoke.mjs
 */
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { ExportFilter } from '../domain/export/ExportFilter.js';
import { ExportFormat } from '../domain/export/ExportFormat.js';
import { LedgerEntries } from '../domain/export/LedgerEntries.js';
import { ReportBuilder } from '../domain/export/ReportBuilder.js';
import { CellText } from '../domain/export/CellText.js';
import { CsvWriter } from '../domain/export/writers/CsvWriter.js';
import { XlsxWriter } from '../domain/export/writers/XlsxWriter.js';
import { RATES } from '../domain/services/FxRates.js';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};

// Fixed rates so conversions are exact: 1 USD = 80 INR.
Object.assign(RATES, { USD: 1, INR: 80 });
const TODAY = new Date(2026, 10, 14, 12);  // 14 Nov 2026

const tx = (id, over) => ({
  id, accountId: 'boi', categoryId: 'taxi', amount: 10000, currency: 'INR', type: 'expense',
  date: '2026-11-10', paymentType: 'online', note: '', payee: '', recordState: 'cleared', tags: [],
  hijriDate: { year: 1448, month: 4, day: 30, offset: 0 }, ...over,
});

const book = () => ({
  user: { homeCurrency: 'INR' },
  accounts: [
    { id: 'boi', name: 'BOI (Mufaddal)', currency: 'INR' },
    { id: 'cash', name: 'INR (Mufaddal)', currency: 'INR' },
    { id: 'usd', name: 'Dollar card', currency: 'USD' },
  ],
  categories: [
    { id: 'travel', name: 'Travel', type: 'expense', parentId: null },
    { id: 'taxi', name: 'Taxi', type: 'expense', parentId: 'travel' },
    { id: 'train', name: 'Train', type: 'expense', parentId: 'travel' },
    { id: 'food', name: 'Food', type: 'expense', parentId: null },
    { id: 'snacks', name: 'Snacks', type: 'expense', parentId: 'food' },
    { id: 'salary', name: 'Salary', type: 'income', parentId: null },
  ],
  transactions: [
    tx('t1', { note: 'grant road to gol deol', date: '2026-11-01' }),
    tx('t2', { categoryId: 'train', amount: 4000, accountId: 'cash', date: '2026-11-03', paymentType: 'cash' }),
    tx('t3', { categoryId: 'snacks', amount: 7000, date: '2026-10-20', note: '=SUM(A1)' }),
    tx('t4', { type: 'income', categoryId: 'salary', amount: 4500000, date: '2026-11-05', payee: 'Acme' }),
    // a split: 300 taxi on BOI + 200 snacks on cash
    tx('t5', { amount: 50000, categoryId: null, date: '2026-11-08', splits: [
      { accountId: 'boi', categoryId: 'taxi', amount: 30000 }, { accountId: 'cash', categoryId: 'snacks', amount: 20000 }] }),
    // a transfer BOI → Dollar card: 8,000 INR out, 100 USD in
    tx('o1', { type: 'transfer', categoryId: null, amount: 800000, transferPairId: 'i1', transferDir: 'out', date: '2026-11-09', paymentType: 'transfer' }),
    tx('i1', { type: 'transfer', categoryId: null, accountId: 'usd', amount: 10000, currency: 'USD', transferPairId: 'o1', transferDir: 'in', date: '2026-11-09', paymentType: 'transfer' }),
    // a USD expense on the dollar card: 5 USD = 400 INR
    tx('t6', { accountId: 'usd', currency: 'USD', amount: 500, categoryId: 'food', date: '2026-11-11' }),
  ],
});

console.log('\nexport suite');

// ═══ F — filter ═══════════════════════════════════════════════════════════
{
  console.log('\n F — filters');
  const r = (p, extra = {}) => new ExportFilter({ period: p, ...extra }).range(TODAY);
  ok('F1 this month', JSON.stringify(r('this-month')) === '{"from":"2026-11-01","to":"2026-11-14"}', JSON.stringify(r('this-month')));
  ok('F1 last month', JSON.stringify(r('last-month')) === '{"from":"2026-10-01","to":"2026-10-31"}', JSON.stringify(r('last-month')));
  ok('F1 last 30 days includes today', r('30').from === '2026-10-16' && r('30').to === '2026-11-14', JSON.stringify(r('30')));
  ok('F1 all time is open', r('all').from === null && r('all').to === null);
  ok('F2 custom dates entered backwards are swapped', JSON.stringify(r('custom', { from: '2026-11-10', to: '2026-11-01' })) === '{"from":"2026-11-01","to":"2026-11-10"}');
  ok('F2 a bad saved value falls back', new ExportFilter({ period: 'nope', types: ['expense', 'evil'] }).period === 'this-month'
     && new ExportFilter({ types: ['expense', 'evil'] }).types.join() === 'expense');

  const s = book();
  const rows = new LedgerEntries(s).all();
  const pick = (f) => rows.filter(new ExportFilter(f).matcher(s.categories, TODAY)).map((e) => e.id).sort().join(',');
  ok('F3 a main category includes its sub-categories (and split slices)', pick({ period: 'all', categoryIds: ['travel'] }) === 't1,t2,t5#1', pick({ period: 'all', categoryIds: ['travel'] }));
  ok('F4 an account filter catches transfers into it', pick({ period: 'all', accountIds: ['usd'] }) === 'o1,t6', pick({ period: 'all', accountIds: ['usd'] }));
  ok('F5 type and payment filters', pick({ period: 'all', types: ['expense'], paymentTypes: ['cash'] }) === 't2');
  ok('F6 search looks at notes', pick({ period: 'all', search: 'GOL DEOL' }) === 't1');
  ok('F7 period limits dates', pick({ period: 'last-month' }) === 't3');
}

// ═══ L — ledger rows ══════════════════════════════════════════════════════
{
  console.log('\n L — ledger rows');
  const rows = new LedgerEntries(book()).all();
  const split = rows.filter((e) => e.txId === 't5');
  ok('L1 a split gives one row per slice', split.length === 2 && split[0].amount === 30000 && split[1].accountId === 'cash');
  const transfers = rows.filter((e) => e.type === 'transfer');
  ok('L2 a transfer gives one row, from → to', transfers.length === 1 && transfers[0].accountName === 'BOI (Mufaddal) → Dollar card');
  ok('L3 signed home amounts: income +, expense −, transfer 0',
     rows.find((e) => e.id === 't4').signedHome === 4500000 && rows.find((e) => e.id === 't1').signedHome === -10000 && transfers[0].signedHome === 0);
  ok('L4 foreign amounts are converted to the home currency', rows.find((e) => e.id === 't6').homeAmount === 40000, String(rows.find((e) => e.id === 't6').homeAmount));
}

// ═══ T — transactions report ══════════════════════════════════════════════
const cells = new CellText();
const textOf = (table, row) => table.columns.map((c) => cells.text(c, row));
{
  console.log('\n T — transactions report');
  const s = book();
  const format = new ExportFormat({ columns: ['note', 'date', 'category', 'amount'] });
  const t = ReportBuilder.build(s, new ExportFilter({ period: 'this-month' }), format, TODAY);
  ok('T1 columns are the chosen ones, in the chosen order', t.columns.map((c) => c.key).join() === 'note,date,category,amount');
  ok('T1 amount header names the home currency', t.columns[3].label === 'Amount (INR)');
  ok('T2 rows are oldest first and every entry is there', t.rowCount === 7 && t.sections[0].rows[0].date === '2026-11-01', String(t.rowCount));
  ok('T3 the total is income − expenses, transfers left out',
     t.total.amount === 4500000 - (10000 + 4000 + 50000 + 40000), String(t.total.amount));
  ok('T3 a transfer row is marked and not negative', t.sections[0].rows.some((r) => r._transfer && r.amount === 800000));
  ok('T3 the notes say transfers are not counted', t.notes.some((n) => n.includes('Transfers (1)')));

  const byMonth = ReportBuilder.build(s, new ExportFilter({ period: 'all' }), format.with('groupBy', 'month'), TODAY);
  ok('T4 grouped by month: one section per month, oldest first', byMonth.sections.map((x) => x.label).join('|').includes('October 2026|November 2026'),
     byMonth.sections.map((x) => x.label).join('|'));
  ok('T4 each group has a subtotal', byMonth.sections.every((x) => x.subtotal && Number.isFinite(x.subtotal.amount)));
  const dateFirst = ReportBuilder.build(s, new ExportFilter({ period: 'all' }), new ExportFormat({ columns: ['date', 'amount'], groupBy: 'month' }), TODAY);
  ok('T5 a subtotal label in a date column is text, not "Invalid Date"',
     cells.text(dateFirst.columns[0], dateFirst.sections[0].subtotal).startsWith('Subtotal'), cells.text(dateFirst.columns[0], dateFirst.sections[0].subtotal));
  ok('T6 money cells show the currency symbol', textOf(t, t.total)[3].includes('₹') || textOf(t, t.total)[3].includes('INR'), textOf(t, t.total)[3]);
  const noTotals = ReportBuilder.build(s, new ExportFilter({ period: 'all' }), format.with('showTotals', false), TODAY);
  ok('T7 totals can be switched off', noTotals.total === null);
  ok('T8 the file is named after the report and the period', t.fileName('pdf') === 'pocket-transactions-2026-11-01-to-2026-11-14.pdf', t.fileName('pdf'));
  const custom = ReportBuilder.build(s, new ExportFilter({ period: 'all' }), format.with('title', 'Trip costs'), TODAY);
  ok('T9 a custom title is used', custom.title === 'Trip costs');
}

// ═══ C / M / A — summaries ════════════════════════════════════════════════
{
  console.log('\n C / M / A — summaries');
  const s = book();
  const all = new ExportFilter({ period: 'all' });
  const cat = ReportBuilder.build(s, all, new ExportFormat({ report: 'categories' }), TODAY);
  const exp = cat.sections.find((x) => x.label === 'Expenses');
  const travel = exp.rows.find((r) => r.category === 'Travel');
  ok('C1 a main category sums its sub-categories (and split slices)', travel.amount === 10000 + 4000 + 30000 && travel._strong, String(travel?.amount));
  ok('C1 its sub-categories follow, indented', exp.rows[exp.rows.indexOf(travel) + 1]._level === 1);
  ok('C2 shares of the section add up to 100%',
     Math.abs(exp.rows.filter((r) => !r._level).reduce((n, r) => n + r.share, 0) - 1) < 1e-9);
  ok('C3 income is its own section; transfers are left out', cat.sections.some((x) => x.label === 'Income') && cat.rowCount === exp.rows.length + 1);

  const months = ReportBuilder.build(s, all, new ExportFormat({ report: 'months' }), TODAY);
  ok('M1 one row per month, oldest first', months.sections[0].rows.map((r) => r.month).join('|') === 'October 2026|November 2026',
     months.sections[0].rows.map((r) => r.month).join('|'));
  ok('M1 net = income − expense, total sums the months', months.total.net === months.total.income - months.total.expense
     && months.total.expense === 7000 + 10000 + 4000 + 50000 + 40000);
  const hijri = ReportBuilder.build(s, all, new ExportFormat({ report: 'months', calendar: 'hijri' }), TODAY);
  ok('M2 Hijri months come from the stored Hijri date', hijri.sections[0].rows.length >= 1 && /1448/.test(hijri.sections[0].rows[0].month), hijri.sections[0].rows[0]?.month);

  const acc = ReportBuilder.build(s, all, new ExportFormat({ report: 'accounts' }), TODAY);
  const row = (name) => acc.sections[0].rows.find((r) => r.account === name);
  ok('A1 BOI: expenses out, the transfer out in INR', row('BOI (Mufaddal)').moneyOut === 10000 + 7000 + 30000 && row('BOI (Mufaddal)').transferOut === 800000);
  ok('A2 Dollar card: the transfer in as received (USD), its expense in USD', row('Dollar card').transferIn === 10000 && row('Dollar card').moneyOut === 500 && row('Dollar card').currency === 'USD');
  ok('A3 net change per account', row('Dollar card').net === 10000 - 500);
  ok('A4 money cells use each row\'s currency', cells.text(acc.columns[2], row('Dollar card')).includes('$') || cells.text(acc.columns[6], row('Dollar card')).includes('USD'),
     cells.text(acc.columns[6], row('Dollar card')));
  const onlyUsd = ReportBuilder.build(s, new ExportFilter({ period: 'all', accountIds: ['usd'] }), new ExportFormat({ report: 'accounts' }), TODAY);
  ok('A5 filtering to one account doesn\'t list the other side of its transfers', onlyUsd.sections[0].rows.map((r) => r.account).join() === 'Dollar card',
     onlyUsd.sections[0].rows.map((r) => r.account).join());
}

// ═══ K — layout is kept ═══════════════════════════════════════════════════
{
  console.log('\n K — layout kept across filters');
  globalThis.window = {};
  const { ExportModal } = await import('../ui/modals/ExportModal.js');
  const state = { ...book(), user: { homeCurrency: 'INR' } };
  let persisted = 0;
  const store = { getState: () => state, persist: () => { persisted++; } };
  const modal = new ExportModal({ store });
  modal.onOpen();
  modal.set('format', 'groupBy', 'category');
  modal.toggle('format', 'columns', 'payee');
  modal.moveColumn('amount', -1);
  modal.set('format', 'orientation', 'landscape');
  const layout = JSON.stringify(state.user.exportPrefs.format);
  modal.set('filter', 'period', 'all');
  modal.toggle('filter', 'categoryIds', 'travel');
  modal.set('filter', 'search', 'road');
  modal.clearFilters();
  ok('K1 changing and clearing filters leaves the layout exactly as it was', JSON.stringify(state.user.exportPrefs.format) === layout,
     `${layout} → ${JSON.stringify(state.user.exportPrefs.format)}`);
  ok('K2 the layout and filters are saved with the settings', persisted >= 8 && state.user.exportPrefs.filter.period === 'all');
  const reopened = new ExportModal({ store });
  reopened.onOpen();
  const html = reopened.render();
  ok('K3 reopening restores them', html.includes('value="category" selected') && html.includes('value="landscape" selected'));
  ok('K4 the preview table sits in a box that scrolls', /class="export-preview[^"]*overflow-auto/.test(html));
  ok('K5 an added column goes to its usual place and can be moved', state.user.exportPrefs.format.columns.join() === 'date,account,category,payee,note,amount,payment',
     state.user.exportPrefs.format.columns.join());
}

// ═══ W — writers ══════════════════════════════════════════════════════════
{
  console.log('\n W — files');
  const s = book();
  const t = ReportBuilder.build(s, new ExportFilter({ period: 'all' }), new ExportFormat({ columns: ['date', 'note', 'amount'], groupBy: 'month' }), TODAY);
  const csv = new CsvWriter().text(t);
  const lines = csv.trim().split('\r\n');
  ok('W1 CSV: title, header, then rows', lines[0] === t.title && lines.includes('Date,Note,Amount (INR)'));
  ok('W1 CSV: amounts are plain numbers, dates ISO', lines.some((l) => l === '2026-11-01,grant road to gol deol,-100.00'), lines.find((l) => l.startsWith('2026-11-01')));
  ok('W2 CSV: a note that looks like a formula is neutralised', lines.some((l) => l.includes("'=SUM(A1)")));
  const blob = await new CsvWriter().write(t, new ExportFormat());
  ok('W3 CSV starts with a UTF-8 byte-order mark', new Uint8Array(await blob.arrayBuffer())[0] === 0xEF);

  const { data, columns, headerIndex } = new XlsxWriter().sheet(t);
  ok('W4 Excel: the header row is the frozen row', data[headerIndex][0].value === 'Date' && data[headerIndex][0].fontWeight === 'bold');
  const firstRow = data.find((r) => r[0]?.type === Date);
  ok('W5 Excel: dates are dates and amounts are numbers with a format',
     firstRow && firstRow[2].type === Number && firstRow[2].format === '#,##0.00' && firstRow[2].value === -70, JSON.stringify(firstRow?.[2]));
  ok('W6 Excel: long text wraps, widths fit within limits', firstRow[1].wrap === true && columns.every((c) => c.width >= 8 && c.width <= 48));

  // The real library accepts this sheet.
  const ctx = { Blob, TextEncoder, URL, setTimeout, Promise, Uint8Array, Date };
  ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../../vendor/write-excel-file.min.js', import.meta.url), 'utf8'), ctx);
  const xblob = await ctx.writeXlsxFile(data, { columns, stickyRowsCount: headerIndex + 1, sheet: 'Transactions' }).toBlob();
  const head = new Uint8Array(await xblob.arrayBuffer()).slice(0, 2);
  ok('W7 Excel: the library writes a real .xlsx (a zip)', head[0] === 0x50 && head[1] === 0x4B && xblob.size > 2000, String(xblob.size));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
