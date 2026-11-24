/**
 * ai-import.smoke.mjs — Import with AI (owner, 24 Nov 2026).
 *
 *   R   CSV and Excel files read as grids (blank rows kept; Excel dates)
 *   T   one sheet with three tables separated by blank lines; totals left out
 *   V   dates and amounts as people type them
 *   M   the AI's plan is cleaned: made-up columns and tables are dropped
 *   D   the draft: types, transfers, budgets, categories, rows to check,
 *       fixes, duplicates, a block with no header read with the table above
 *   P   the prompt carries headers, samples and values, never every row
 *   W   writing tags every row with the import; Undo takes only that out
 *   S   the service: one session for every AI call; corrections; undo change
 *   G   the gateway sends the session and row count for imports
 *   U   the screens: choose → tables → preview → attention → done → undo
 *
 * Run: node src/__smoke__/ai-import.smoke.mjs
 */
import { deflateRawSync } from 'node:zlib';
import { CsvGrid } from '../domain/import/CsvGrid.js';
import { XlsxReader } from '../domain/import/XlsxReader.js';
import { SheetReader } from '../domain/import/SheetReader.js';
import { TableFinder } from '../domain/import/TableFinder.js';
import { CellValue } from '../domain/import/CellValue.js';
import { ImportMapping } from '../domain/import/ImportMapping.js';
import { ImportDraft } from '../domain/import/ImportDraft.js';
import { ImportPrompt } from '../domain/import/ImportPrompt.js';
import { ImportWriter } from '../domain/import/ImportWriter.js';
import { AiImportService } from '../domain/import/AiImportService.js';
import { AiGateway } from '../domain/services/AiGateway.js';
import { ImportModal } from '../ui/modals/ImportModal.js';

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\nImport with AI suite');

const CSV = [
  'Date,Details,Amount,Type,Category,Account',
  '12/11/2025,Swiggy,349,Dr,Food,HDFC',
  '12/11/2025,Auto,60,Dr,Travel,Cash',
  '10/11/2025,Salary,"62,000",Cr,Salary,HDFC',
  '09/11/2025,Rent,,Dr,Home,HDFC',
  '31/02/2025,Phone bill,499,Dr,Bills,HDFC',
  '08/11/2025,Ali 2000,2000,?,Misc,Cash',
  'Total,,64908,,,',
  '',
  'Budgets – Nov',
  'Category,Monthly limit',
  'Food,8000',
  'Travel,3000',
  'Total,11000',
  '',
  'Date,From,To,Amount',
  '08/11/2025,HDFC,Cash,5000',
  '',
  '07/11/2025,Zomato,280,Dr,Food,HDFC',
].join('\n');

// ── R: reading ────────────────────────────────────────────────────────
{
  const g = CsvGrid.parse(CSV);
  ok('R1 CSV: blank rows kept, quoted "62,000" stays one cell', g.length === 19 && g[3][2] === '62,000' && g[8].every((c) => c === ''), String(g.length));
  ok('R2 CSV: semicolons and tabs are found', CsvGrid.parse('a;b;c\n1;2;3')[1][2] === '3' && CsvGrid.parse('a\tb\n1\t2')[1][1] === '2');
}
function zip(files) {
  const enc = new TextEncoder();
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameB = enc.encode(name), data = deflateRawSync(Buffer.from(text));
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt16LE(nameB.length, 26);
    locals.push(lh, nameB, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}
const XLSX = zip({
  'xl/workbook.xml': '<workbook><sheets><sheet name="Money" sheetId="1" r:id="rId1"/><sheet name="Empty" sheetId="2" r:id="rId2"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>Date</t></si><si><t>Details</t></si><si><t>Amount</t></si><si><r><t>Swig</t></r><r><t>gy &amp; co</t></r></si></sst>',
  'xl/styles.xml': '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="4"/></cellXfs></styleSheet>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>'
    + '<row r="2"><c r="A2" s="1"><v>45973</v></c><c r="B2" t="s"><v>3</v></c><c r="C2" s="2"><v>349.5</v></c></row>'
    + '<row r="4"><c r="A4" t="inlineStr"><is><t>note</t></is></c></row></sheetData></worksheet>',
  'xl/worksheets/sheet2.xml': '<worksheet><sheetData/></worksheet>',
});
{
  const sheets = await new XlsxReader(XLSX).read();
  const g = sheets[0].grid;
  ok('R3 Excel: tabs by name, shared and rich text, entities', sheets.length === 2 && sheets[0].name === 'Money' && g[1][1] === 'Swiggy & co');
  ok('R4 Excel: a date-formatted day number becomes YYYY-MM-DD; a number stays a number', g[1][0] === '2025-11-12' && g[1][2] === '349.5', JSON.stringify(g[1]));
  ok('R5 Excel: a skipped row stays blank (it can separate tables)', g.length === 4 && g[2].length === 0 && g[3][0] === 'note');
  const file = { name: 'book.xlsx', size: XLSX.length, arrayBuffer: async () => XLSX.buffer, text: async () => '' };
  const read = await SheetReader.read(file);
  ok('R6 SheetReader: empty tabs dropped', read.sheets.length === 1);
  let msg = '';
  try { await SheetReader.read({ name: 'old.xls', size: 10, text: async () => '' }); } catch (e) { msg = e.message; }
  ok('R7 an old .xls is refused with what to do', /save as \.xlsx or \.csv/.test(msg));
}

// ── T: tables ─────────────────────────────────────────────────────────
const tables = TableFinder.find([{ name: 'Sheet1', grid: CsvGrid.parse(CSV) }]);
{
  ok('T1 four blocks found', tables.length === 4, String(tables.length));
  const [t1, t2, t3, t4] = tables;
  ok('T2 entries: rows 1–8, "Total" left out', t1.firstRow === 1 && t1.rows.length === 6 && t1.skipped[0]?.n === 8, JSON.stringify(t1.skipped));
  ok('T3 a lone line above a block is its title, not its header', t2.title === 'Budgets – Nov' && t2.columns.join() === 'Category,Monthly limit' && t2.rows.length === 2);
  ok('T4 transfers table', t3.columns.join() === 'Date,From,To,Amount' && t3.rows.length === 1);
  ok('T5 a block with no header keeps its first line (for sameAs)', t4.head.cells[1] === 'Zomato' && t4.rows.length === 0);
  const side = TableFinder.find([{ name: 'S', grid: [['A', 'B', '', 'X', 'Y'], ['1', '2', '', '3', '4']] }]);
  ok('T6 tables side by side, split by a blank column', side.length === 2 && side[1].columns.join() === 'X,Y');
  ok('T7 blank and repeated headers get names', TableFinder.find([{ name: 'S', grid: [['Amount', '', 'Amount'], ['1', '2', '3']] }])[0].columns.join('|') === 'Amount|Column B|Amount (2)');
}

// ── V: values ─────────────────────────────────────────────────────────
{
  ok('V1 dates: DMY, MDY, ISO, words, 2-digit years, Excel numbers',
     CellValue.date('12/11/2025') === '2025-11-12' && CellValue.date('11/12/2025', 'MDY') === '2025-11-12'
     && CellValue.date('2025-11-12') === '2025-11-12' && CellValue.date('12 Nov 2025') === '2025-11-12'
     && CellValue.date('Nov 12, 2025') === '2025-11-12' && CellValue.date('12-11-25') === '2025-11-12'
     && CellValue.date('45973') === '2025-11-12');
  ok('V2 impossible dates are null, not rolled over', CellValue.date('31/02/2025') === null && CellValue.date('hello') === null);
  const a = (t) => CellValue.amount(t);
  ok('V3 amounts: ₹, Indian commas, Dr/Cr, brackets, trailing minus',
     a('₹1,23,456.50').value === 123456.5 && a('500 Dr').mark === 'dr' && a('(500)').sign === -1 && a('500-').sign === -1
     && a('Rs. 2,000').value === 2000 && a('-75').sign === -1 && a('abc') === null && a('') === null);
}

// ── M: the plan ───────────────────────────────────────────────────────
const AI_PLAN = {
  reply: 'Found entries, budgets and transfers.',
  tables: [
    { id: 't1', kind: 'entries', columns: { date: 'Date', payee: 'Details', amount: 'Amount', type: 'Type', category: 'Category', account: 'Account', made_up: 'X' },
      types: { expense: ['Dr'], income: ['Cr'] }, dateOrder: 'DMY' },
    { id: 't2', kind: 'budgets', columns: { category: 'Category', amount: 'Monthly limit' }, period: 'month' },
    { id: 't3', kind: 'transfers', columns: { date: 'Date', account: 'From', to: 'To', amount: 'Amount' }, dateOrder: 'DMY' },
    { id: 't4', kind: 'entries', sameAs: 't1' },
    { id: 't99', kind: 'entries' },
  ],
  categories: { Food: ['Food & Drink', 'Groceries'], Travel: ['Transport', 'Auto & cab'], Salary: ['Salary', ''], Home: ['Home', 'Rent'], Bills: ['Bills', 'Phone'] },
  accounts: { HDFC: 'HDFC Bank' },
  rules: [{ contains: 'Zomato', category: ['Food & Drink', 'Eating out'] }],
};
const mapping = ImportMapping.parse('Here you go:\n```json\n' + JSON.stringify(AI_PLAN) + '\n```', tables);
{
  ok('M1 JSON found inside prose and a code fence', mapping.reply.startsWith('Found'));
  ok('M2 made-up tables and keys dropped; types lower-cased', mapping.tables.length === 4 && !('made_up' in mapping.tables[0].columns) && mapping.tables[0].types.expense[0] === 'dr');
  ok('M3 a column that isn\'t in the table is dropped', ImportMapping.clean({ tables: [{ id: 't1', kind: 'entries', columns: { date: 'When' } }] }, tables).tables[0].columns.date === undefined);
  let threw = false;
  try { ImportMapping.parse('no json here', tables); } catch (_) { threw = true; }
  ok('M4 no JSON → a clear error', threw);
}

// ── D: the draft ──────────────────────────────────────────────────────
const book = () => ({
  user: { homeCurrency: 'INR', defaultAccountId: 'a1' },
  accounts: [{ id: 'a1', name: 'HDFC Bank', type: 'bank' }, { id: 'a2', name: 'Cash', type: 'cash' }],
  categories: [{ id: 'c1', name: 'Food & Drink', type: 'expense', parentId: null }, { id: 'c2', name: 'Groceries', type: 'expense', parentId: 'c1' }],
  transactions: [{ id: 'x', accountId: 'a2', type: 'expense', date: '2025-11-12', amount: 6000, currency: 'INR' }],
  budgets: [],
});
{
  const d = new ImportDraft({ tables, mapping, book: book() });
  const c = d.counts;
  ok('D1 the auto already in the book is a duplicate', c.duplicates === 1, JSON.stringify(c));
  ok('D2 counts: 2 expenses (Swiggy, Zomato), 1 income, 1 transfer, 2 budgets', c.expenses === 2 && c.incomes === 1 && c.transfers === 1 && c.budgets === 2, JSON.stringify(c));
  const why = d.attention.map((r) => r.problem).sort().join();
  ok('D3 not guessed: no amount, impossible date, unknown type', why === 'amount,date,type', why);
  const swiggy = d.entries.find((e) => e.payee === 'Swiggy');
  ok('D4 categories and accounts mapped by the plan', swiggy.main === 'Food & Drink' && swiggy.sub === 'Groceries' && swiggy.account === 'HDFC Bank' && swiggy.amount === 349);
  const zomato = d.entries.find((e) => e.payee === 'Zomato');
  ok('D5 a block with no header read with the table above (sameAs)', zomato && zomato.date === '2025-11-07' && zomato.main === 'Food & Drink');
  const tr = d.entries.find((e) => e.type === 'transfer');
  ok('D6 transfer from HDFC Bank to Cash', tr.account === 'HDFC Bank' && tr.to === 'Cash' && tr.amount === 5000);
  ok('D7 budgets mapped to Pocket categories', d.budgets[0].main === 'Food & Drink' && d.budgets[0].amount === 8000 && d.budgets[0].period === 'month');
  ok('D8 accounts: both match existing ones; new categories listed', d.accounts.every((a) => a.existing) && d.categories.some((x) => x.main === 'Transport' && !x.existing));
  const keyOf = (p) => d.attention.find((r) => r.problem === p).key;
  const fixed = new ImportDraft({ tables, mapping, book: book(), fixes: { [keyOf('amount')]: { amount: '15000' }, [keyOf('type')]: { type: 'income' }, [keyOf('date')]: { skip: true } } });
  ok('D9 fixes: amount typed, type picked, a row skipped', fixed.attention.length === 0 && fixed.entries.some((e) => e.payee === 'Rent' && e.amount === 15000) && fixed.entries.some((e) => e.payee === 'Ali 2000' && e.type === 'income'));
  const signed = ImportMapping.clean({ tables: [{ id: 't1', kind: 'entries', columns: { date: 'D', amount: 'A', payee: 'P' }, sign: 'negative_expense' }] }, [{ id: 't1', columns: ['D', 'A', 'P'] }]);
  const sd = new ImportDraft({ tables: [{ id: 't1', columns: ['D', 'A', 'P'], head: { n: 1, cells: ['D', 'A', 'P'] }, rows: [{ n: 2, cells: ['2025-01-02', '-50', 'Tea'] }, { n: 3, cells: ['2025-01-03', '900', 'Refund'] }], skipped: [] }], mapping: signed, book: book() });
  ok('D10 signed amounts: minus is money out', sd.entries[0].type === 'expense' && sd.entries[1].type === 'income' && sd.entries[0].account === 'HDFC Bank');
  ok('D11 entries with no category are listed for rules', new ImportDraft({ tables: [{ id: 't1', columns: ['D', 'A', 'P'], rows: sd.entries.length ? [{ n: 2, cells: ['2025-01-02', '-50', 'Tea'] }] : [], skipped: [] }], mapping: signed, book: book() }).uncategorisedTop()[0][0] === 'Tea');
}

// ── P: the prompt ─────────────────────────────────────────────────────
{
  const many = { ...tables[0], rows: Array.from({ length: 900 }, (_, i) => ({ n: i + 2, cells: ['01/01/2025', `Shop ${i}`, '10', 'Dr', 'Food', 'HDFC'] })) };
  const p = ImportPrompt.first([many, tables[1]], book());
  ok('P1 the prompt has the headers, the book\'s categories and accounts', p.includes('columns: Date | Details | Amount | Type | Category | Account') && p.includes('Food & Drink (spending): Groceries') && p.includes('POCKET ACCOUNTS: HDFC Bank, Cash'));
  ok('P2 never every row: 900 rows → a few samples, under the size limit', !p.includes('Shop 500 |') && p.length <= ImportPrompt.MAX_CHARS && (p.match(/Shop \d+ \|/g) || []).length <= 8);
  ok('P3 most used values of text columns are listed', /Type \(1 different\): Dr \(900\)/.test(p));
  const d = new ImportDraft({ tables, mapping, book: book() });
  const ch = ImportPrompt.change(tables, book(), mapping, d, 'Zomato is Eating out');
  ok('P4 a change carries the current plan, the preview and what they said', ch.includes('CURRENT PLAN:') && ch.includes('THE PERSON SAYS: Zomato is Eating out') && ch.includes('1 transfers'));
}

// ── W: writing and undo ───────────────────────────────────────────────
{
  const state = book();
  state.transactions.push({ id: 'mine', accountId: 'a1', type: 'expense', date: '2025-01-01', amount: 100, currency: 'INR' });
  const d = new ImportDraft({ tables, mapping, book: state });
  const fx = { toMinor: (a) => Math.round(a * 100), convert: (m) => m };
  const writer = new ImportWriter({ state, fx, hijri: { toHijri: () => null }, look: () => ({ icon: 'tag', color: '#777777' }) });
  const r = writer.write(d, { file: 'expenses.csv', now: '2025-11-24T10:00:00Z' });
  const mine = state.transactions.filter((t) => t.importId === r.id);
  ok('W1 every written row carries the import id (a transfer is two rows)', r.entries === 4 && mine.length === 5 && state.budgets.every((b) => b.importId === r.id));
  const pair = mine.filter((t) => t.type === 'transfer');
  ok('W2 transfer pair linked both ways', pair.length === 2 && pair[0].transferPairId === pair[1].id && pair[1].transferPairId === pair[0].id && pair[0].transferDir === 'out');
  ok('W3 categories reused or made; amounts in minor units', mine.find((t) => t.payee === 'Swiggy').categoryId === 'c2' && mine.find((t) => t.payee === 'Swiggy').amount === 34900 && state.categories.some((c) => c.name === 'Transport' && c.importId === r.id));
  ok('W4 the import is recorded in the book', state.imports.length === 1 && state.imports[0].file === 'expenses.csv' && state.imports[0].entries === 4);
  const u = writer.undo(r.id);
  ok('W5 Undo takes out only what the import added', state.transactions.map((t) => t.id).sort().join() === 'mine,x' && !state.budgets.length && state.categories.length === 2 && state.accounts.length === 2 && !state.imports.length, JSON.stringify(u));
  ok('W6 account type from a name', ImportWriter.accountType('ICICI Credit Card') === 'card' && ImportWriter.accountType('Paytm') === 'cash' && ImportWriter.accountType('SBI') === 'bank');
}

// ── S: the service ────────────────────────────────────────────────────
{
  const calls = [];
  const plan2 = { ...AI_PLAN, reply: 'Zomato is now Eating out.', categories: { ...AI_PLAN.categories, Food: ['Food & Drink', 'Eating out'] } };
  const answers = [JSON.stringify(AI_PLAN), JSON.stringify(plan2)];
  const svc = new AiImportService({ ask: async (prompt, meta) => { calls.push(meta); return answers[calls.length - 1]; }, book });
  await svc.load({ name: 'expenses.csv', size: CSV.length, text: async () => CSV });
  await svc.understand();
  ok('S1 load + understand: tables and a plan', svc.tables.length === 4 && svc.mapping.tables[0].kind === 'entries' && svc.rows === 9);
  const before = svc.draft.entries.find((e) => e.payee === 'Swiggy').sub;
  const reply = await svc.change('Food is Eating out');
  ok('S2 a correction updates the plan and says what changed', reply === 'Zomato is now Eating out.' && svc.draft.entries.find((e) => e.payee === 'Swiggy').sub === 'Eating out' && before === 'Groceries');
  ok('S3 every AI call of one import shares one session and sends the row count', calls.length === 2 && calls[0].session === calls[1].session && /^[0-9a-f-]{36}$/.test(calls[0].session) && calls[0].rows === 9);
  svc.undoChange();
  ok('S4 Undo last change', svc.draft.entries.find((e) => e.payee === 'Swiggy').sub === 'Groceries' && svc.changes === 0);
  svc.setTable('t2', false);
  ok('S5 an unticked table is left out', svc.draft.budgets.length === 0 && !svc.isOn('t2'));
  let msg = '';
  try { await new AiImportService({ ask: async () => '{}', book }).load({ name: 'x.csv', size: 5, text: async () => '\n\n' }); } catch (e) { msg = e.message; }
  ok('S6 an empty file says so', /No tables/.test(msg));
}

// ── G: gateway ────────────────────────────────────────────────────────
{
  const sent = [];
  const g = new AiGateway(() => async (name, opts) => { sent.push(opts.body); return { data: { text: '{}', chargedTo: 'own', cost: 0 }, error: null }; });
  await g.generate({ kind: 'import', book: 'b1', parts: [{ text: 'p' }], session: 's-1', rows: 12 });
  await g.generate({ kind: 'receipt', book: 'b1', parts: [{ text: 'p' }], session: 's-1', rows: 12 });
  ok('G1 imports send their session and row count; other kinds don\'t', sent[0].session === 's-1' && sent[0].rows === 12 && !('session' in sent[1]));
}

// ── U: screens ────────────────────────────────────────────────────────
{
  globalThis.window = { __app: { refreshImport() {} } };
  const state = book();
  const fx = { toMinor: (a) => Math.round(a * 100), convert: (m) => m };
  const writer = new ImportWriter({ state, fx, hijri: { toHijri: () => null }, look: () => ({ icon: 'tag', color: '#777777' }) });
  const m = new ImportModal({
    ask: async () => JSON.stringify(AI_PLAN), book: () => state,
    firstImport: () => !(state.imports || []).length,
    write: (d, f) => writer.write(d, { file: f }), undo: (id) => writer.undo(id),
  });
  m.onOpen();
  ok('U1 choose: the free first import is offered', /Free<\/span>Your first import, up to 5,000 rows/.test(m.render()));
  await m.act('file', { files: [{ name: 'expenses.csv', size: CSV.length, text: async () => CSV }], value: 'x' });
  const t = m.render();
  ok('U2 tables: 4 tables in one sheet, with their kinds', /4 tables<\/h4>|4 tables in one sheet/.test(t) && t.includes('Budgets') && t.includes('Transfers') && t.includes('continues the table above'), t.slice(0, 200));
  m.act('go', 'preview');
  const p = m.render();
  ok('U3 preview: counts, first entries, accounts, rows to check, import button', p.includes('2 expenses') && p.includes('Swiggy') && p.includes('Match yours') && p.includes('3 rows need your attention') && p.includes('Import 6 items'), p.match(/Import \d+ items?/)?.[0]);
  m.act('go', 'attention');
  const a = m.render();
  ok('U4 attention: one card per row with the right control', (a.match(/Row \d+/g) || []).length === 3 && a.includes('type="date"') && a.includes('>Income<'));
  m.act('setType', 't1:7', 'income');
  m.act('pendAmount', 't1:5', '15000'); m.act('fix', 't1:5');
  m.act('skip', 't1:6');
  m.act('go', 'preview');
  ok('U5 after fixing: nothing left to check, more to import', !m.render().includes('need your attention') && m.render().includes('Import 8 items'));
  m.act('import');
  const done = m.render();
  ok('U6 done: entries imported, with Undo', /6 entries imported/.test(done) && done.includes('Undo this import') && state.imports.length === 1, done.match(/\d+ entr\w+ imported/)?.[0]);
  m.act('undoImport');
  ok('U7 Undo this import: the book is back as it was', m.render().includes('Import undone') && state.transactions.length === 1 && !state.imports.length);
  state.imports = [{ id: 'imp_old', entries: 3 }];
  m.onOpen();
  ok('U8 after an import, the next one says it uses credits', m.render().includes('5 credits</span>Per import'));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
