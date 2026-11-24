import { Html } from '../../core/Html.js';
import { AiImportService } from '../../domain/import/AiImportService.js';

/**
 * ImportModal — Import with AI (owner, 24 Nov 2026). Screens:
 *
 *   choose     pick a CSV or Excel file (first import free up to 5,000 rows)
 *   busy       reading the file / the AI is working
 *   tables     the tables found (one sheet can hold several); untick any
 *   preview    counts, first entries, accounts, rows to check; type changes
 *   attention  rows Pocket won't guess: fix or skip each
 *   done       what was imported, with "Undo this import"
 *
 * Every control calls window.__app.importAction(action, …args); act() returns
 * false when nothing needs re-drawing (typing) and a Promise while working.
 */
export class ImportModal {
  #hooks;
  /** @type {AiImportService|null} */ #svc = null;
  #step = 'choose';
  #busy = '';
  #note = '';
  #reply = '';
  #said = '';
  #typed = '';
  #result = null;
  #pending = {};

  /**
   * @param {object} hooks
   * @param {(prompt: string, meta: object) => Promise<string>} hooks.ask
   * @param {() => object} hooks.book
   * @param {() => boolean} hooks.firstImport  no import made in this book yet
   * @param {(draft: object, file: string) => object|null} hooks.write  null when the entry limit stopped it
   * @param {(id: string) => object|null} hooks.undo
   */
  constructor(hooks) {
    this.#hooks = hooks;
  }

  onOpen() {
    this.#svc = null;
    this.#step = 'choose';
    this.#busy = this.#note = this.#reply = this.#said = this.#typed = '';
    this.#result = null;
    this.#pending = {};
  }

  render() {
    const body = this.#busy ? this.#busyScreen() : ({
      choose: () => this.#choose(), tables: () => this.#tables(), preview: () => this.#preview(),
      attention: () => this.#attention(), done: () => this.#done(),
    }[this.#step] ?? (() => this.#choose()))();
    return `<div class="p-5" style="min-width:300px;max-width:520px">${body}</div>`;
  }

  act(action, a, b) {
    switch (action) {
      case 'file': return this.#start(a);
      case 'table': this.#svc?.setTable(String(a), !!b); return true;
      case 'go': this.#note = ''; this.#step = String(a); return true;
      case 'type': this.#typed = String(a ?? '').slice(0, 600); return false;
      case 'send': return this.#send();
      case 'undoChange': this.#svc?.undoChange(); this.#reply = 'Went back to before your last change.'; this.#said = ''; return true;
      case 'pendAmount': this.#pending[a] = { amount: String(b ?? '') }; return false;
      case 'pendDate': this.#pending[a] = { date: String(b ?? '') }; return false;
      case 'fix': {
        const p = this.#pending[a];
        if (p?.amount && Number(String(p.amount).replace(/[,\s]/g, '')) > 0) this.#svc?.fix(a, { amount: p.amount });
        else if (p?.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) this.#svc?.fix(a, { date: p.date });
        else { this.#note = 'Enter a value first, or skip the row.'; return true; }
        this.#note = '';
        return true;
      }
      case 'setType': this.#svc?.fix(a, { type: String(b) }); return true;
      case 'skip': this.#svc?.skip(a); return true;
      case 'import': return this.#import();
      case 'undoImport': {
        const r = this.#result && this.#hooks.undo(this.#result.id);
        if (r) { this.#result = { ...this.#result, undone: true }; }
        return true;
      }
      default: return true;
    }
  }

  // ── working ──────────────────────────────────────────────────────────

  async #start(input) {
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return true;
    this.#svc = new AiImportService({ ask: this.#hooks.ask, book: this.#hooks.book });
    this.#note = '';
    try {
      this.#busy = 'Reading your file…';
      window.__app?.refreshImport?.();
      await this.#svc.load(file);
      this.#busy = 'Working out the columns…';
      window.__app?.refreshImport?.();
      await this.#svc.understand();
      this.#step = 'tables';
    } catch (e) {
      this.#note = e?.code === 'signed_out' ? 'Please sign in to import with AI.' : (e?.message || 'That file couldn\'t be read.');
      this.#step = 'choose';
    }
    this.#busy = '';
    return true;
  }

  async #send() {
    const text = this.#typed.trim();
    if (!text || !this.#svc) return true;
    this.#said = text;
    this.#typed = '';
    this.#busy = 'Updating the plan…';
    window.__app?.refreshImport?.();
    try {
      this.#reply = await this.#svc.change(text);
    } catch (e) {
      this.#reply = `That didn't work: ${e?.message || 'the AI is unavailable'}. Nothing was changed.`;
    }
    this.#busy = '';
    return true;
  }

  #import() {
    const draft = this.#svc?.draft;
    if (!draft || (!draft.entries.length && !draft.budgets.length)) { this.#note = 'Nothing to import.'; return true; }
    const r = this.#hooks.write(draft, this.#svc.file);
    if (!r) return false; // the entry limit took over the screen
    this.#result = { ...r, skipped: draft.attention.length + draft.skipped.length, duplicates: draft.duplicates };
    this.#step = 'done';
    return true;
  }

  // ── screens ──────────────────────────────────────────────────────────

  #head(title, step) {
    return `<div class="flex items-center gap-2 mb-4">
      ${step > 1 && step < 4 ? `<button class="btn btn-ghost" aria-label="Back" onclick="window.__app.importAction('go','${step === 3 ? 'tables' : 'choose'}')"><i data-lucide="chevron-left"></i></button>` : ''}
      <h3 class="text-lg font-semibold flex-1">${Html.escape(title)}</h3>
      <span class="text-xs text-zinc-500">${step} of 4</span>
      <button class="btn btn-ghost" aria-label="Close" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>
    </div>`;
  }

  #noteLine() {
    return this.#note ? `<div class="mb-3 text-sm rounded-lg p-3" style="background:#fffbeb;color:#92400e">${Html.escape(this.#note)}</div>` : '';
  }

  #busyScreen() {
    return `<div class="flex flex-col items-center text-center gap-3 py-10">
      <i data-lucide="loader-2" class="animate-spin text-emerald-600" style="width:28px;height:28px"></i>
      <div class="font-medium">${Html.escape(this.#busy)}</div>
      <div class="text-xs text-zinc-500">Only the column names and a few sample rows go to the AI.</div>
    </div>`;
  }

  #choose() {
    const first = this.#hooks.firstImport();
    return `${this.#head('Import with AI', 1)}
      <p class="text-sm text-zinc-600 dark:text-zinc-400 mb-3">Bring your history from another app or a sheet you kept yourself. AI works out the columns, you check a preview, then it's imported.</p>
      ${this.#noteLine()}
      <label class="card-muted flex flex-col items-center text-center gap-2 p-6 mb-3 cursor-pointer" style="border:2px dashed #d4d4d8">
        <i data-lucide="upload" class="text-emerald-600" style="width:28px;height:28px"></i>
        <span class="font-medium">Choose a file</span>
        <span class="text-xs text-zinc-500">CSV or Excel (.xlsx), all tabs</span>
        <span class="btn btn-outline mt-1">Browse files</span>
        <input type="file" class="hidden" accept=".csv,.tsv,.txt,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
               onchange="window.__app.importAction('file', this)">
      </label>
      <div class="card-muted p-3 mb-3 text-sm">
        <div class="text-xs font-semibold text-zinc-500 uppercase mb-1">Works with</div>
        Money Manager, Walnut, Spendee, Splitwise, Google Sheets, Excel, and your own sheets
      </div>
      <div class="card-muted p-3 mb-3 text-sm flex flex-col gap-2">
        ${first
          ? `<div class="flex items-center gap-2"><span class="text-xs font-semibold rounded-full px-2 py-0.5" style="background:#ecfdf5;color:#047857">Free</span>Your first import, up to ${AiImportService.FREE_ROWS.toLocaleString('en-IN')} rows</div>`
          : '<div class="flex items-center gap-2"><span class="text-xs font-semibold rounded-full px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800">5 credits</span>Per import; changes you type are free</div>'}
        <div class="flex items-center gap-2 text-zinc-500"><span class="text-xs font-semibold rounded-full px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800">Soon</span>Bank statement PDFs</div>
      </div>
      <p class="text-xs text-zinc-500">Only the column names, a few sample rows and the most used words go to the AI. Every row is read by Pocket on your device.</p>`;
  }

  #tables() {
    const svc = this.#svc;
    const sheets = new Set(svc.tables.map((t) => t.sheet));
    const cards = svc.tables.map((t) => {
      const rule = svc.mapping.tables.find((x) => x.id === t.id);
      const label = { entries: 'Expenses and incomes', transfers: 'Transfers', budgets: 'Budgets', skip: 'Not used' }[rule.kind];
      const cols = Object.entries(rule.columns).map(([, v]) => v);
      const rows = rule.sameAs ? t.rows.length + 1 : t.rows.length;
      const what = rule.kind === 'budgets' ? `${rows} budget${rows === 1 ? '' : 's'}` : `${rows} row${rows === 1 ? '' : 's'}`;
      return `<label class="card-muted p-3 mb-2 flex items-start gap-3 cursor-pointer">
        <input type="checkbox" style="width:20px;height:20px;accent-color:#10b981;margin-top:2px" ${svc.isOn(t.id) ? 'checked' : ''} ${rule.kind === 'skip' ? 'disabled' : ''}
               onchange="window.__app.importAction('table','${Html.js(t.id)}', this.checked)">
        <span class="flex flex-col gap-1 flex-1">
          <span class="font-medium">${label}${rule.sameAs ? ' <span class="text-xs text-zinc-500">(continues the table above)</span>' : ''}</span>
          <span class="text-sm text-zinc-500">${sheets.size > 1 ? `${Html.escape(t.sheet)} · ` : ''}Rows ${t.firstRow}–${t.lastRow} · ${what}</span>
          ${rule.kind === 'skip' ? (rule.why ? `<span class="text-xs text-zinc-500">${Html.escape(rule.why)}</span>` : '') : `<span class="text-xs text-zinc-500">${cols.map((c) => Html.escape(c)).join(' · ')}</span>`}
        </span>
      </label>`;
    }).join('');
    const skipped = svc.tables.flatMap((t) => t.skipped.map((s) => `row ${s.n} (“${Html.escape(s.text)}”)`));
    const n = svc.tables.length;
    return `${this.#head('Check what we found', 2)}
      <div class="flex items-center gap-2 mb-2 text-sm"><i data-lucide="file-spreadsheet" style="width:16px;height:16px"></i><span class="font-medium">${Html.escape(svc.file)}</span></div>
      <h4 class="text-base font-semibold mb-1">${n === 1 ? '1 table' : `${n} tables`}${sheets.size === 1 ? ' in one sheet' : ` in ${sheets.size} sheets`}</h4>
      <p class="text-sm text-zinc-500 mb-3">${n > 1 ? 'They were separated by blank rows or columns. ' : ''}Untick any you don't want.</p>
      ${this.#noteLine()}
      ${cards}
      ${skipped.length ? `<div class="text-xs text-zinc-500 mb-3"><b>Left out:</b> ${skipped.slice(0, 6).join(', ')}${skipped.length > 6 ? ` and ${skipped.length - 6} more` : ''}: totals, not entries.</div>` : ''}
      <button class="btn btn-primary w-full justify-center mb-2" onclick="window.__app.importAction('go','preview')">Looks right, show preview</button>
      ${this.#askBox('Something\'s wrong? Tell AI…')}`;
  }

  #askBox(placeholder) {
    return `<div class="flex gap-2 items-center">
      <input class="input flex-1" aria-label="Tell AI what to change" placeholder="${Html.escape(placeholder)}" value="${Html.escape(this.#typed)}"
             oninput="window.__app.importAction('type', this.value)"
             onkeydown="if(event.key==='Enter'){event.preventDefault();window.__app.importAction('send')}">
      <button class="btn btn-primary" aria-label="Send to AI" onclick="window.__app.importAction('send')"><i data-lucide="send"></i></button>
    </div>`;
  }

  #money(amount, currency) {
    try {
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(amount);
    } catch (_) { return `${currency} ${amount}`; }
  }

  #chips(c) {
    const chip = (n, word) => (n ? `<span class="text-xs font-semibold rounded-full px-2 py-1 bg-zinc-100 dark:bg-zinc-800">${n.toLocaleString('en-IN')} ${word}</span>` : '');
    return `<div class="flex flex-wrap gap-1 mb-3">${chip(c.expenses, c.expenses === 1 ? 'expense' : 'expenses')}${chip(c.incomes, c.incomes === 1 ? 'income' : 'incomes')}${chip(c.transfers, c.transfers === 1 ? 'transfer' : 'transfers')}${chip(c.budgets, c.budgets === 1 ? 'budget' : 'budgets')}</div>`;
  }

  #preview() {
    const svc = this.#svc;
    const d = svc.draft;
    const c = d.counts;
    const conv = this.#said ? `
      <div class="flex justify-end mb-2"><div class="text-sm rounded-2xl px-3 py-2 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" style="max-width:85%">${Html.escape(this.#said)}</div></div>` : '';
    const reply = this.#reply ? `<div class="card-muted p-3 mb-3 text-sm">${Html.escape(this.#reply)}</div>` : '';
    const first = d.entries.slice(0, 5).map((e) => {
      const where = e.type === 'transfer' ? `${Html.escape(e.account)} → ${Html.escape(e.to)}` : [e.main && `${Html.escape(e.main)}${e.sub ? ` / ${Html.escape(e.sub)}` : ''}`, Html.escape(e.account)].filter(Boolean).join(' · ');
      const sign = e.type === 'income' ? '+' : e.type === 'expense' ? '−' : '';
      return `<div class="flex justify-between gap-3 py-2 border-t border-zinc-100 dark:border-zinc-800 text-sm first:border-t-0">
        <div class="min-w-0"><div class="truncate">${Html.escape(e.payee || e.note || (e.type === 'transfer' ? 'Transfer' : '—'))}</div><div class="text-xs text-zinc-500 truncate">${e.date} · ${where}</div></div>
        <div class="font-semibold whitespace-nowrap ${e.type === 'income' ? 'text-emerald-700' : ''}">${sign}${this.#money(e.amount, e.currency)}</div></div>`;
    }).join('');
    const matched = d.accounts.filter((a) => a.existing).map((a) => a.name);
    const made = d.accounts.filter((a) => !a.existing).map((a) => a.name);
    const newCats = d.categories.filter((x) => !x.existing).length;
    const total = d.entries.length + d.budgets.length;
    const notes = [
      c.duplicates ? `${c.duplicates.toLocaleString('en-IN')} already in Pocket, left out.` : '',
      c.uncategorised ? `${c.uncategorised.toLocaleString('en-IN')} entries have no category: type a rule below, e.g. “Swiggy is Eating out”.` : '',
      newCats ? `${newCats} new ${newCats === 1 ? 'category' : 'categories'} will be made.` : '',
    ].filter(Boolean);
    return `${this.#head('Preview', 3)}
      ${conv}${reply}
      ${this.#chips(c)}
      ${this.#noteLine()}
      ${first ? `<div class="card-muted p-3 mb-3"><div class="text-xs font-semibold text-zinc-500 uppercase mb-1">First entries</div>${first}</div>` : ''}
      ${d.accounts.length ? `<div class="card-muted p-3 mb-3 text-sm flex flex-col gap-2"><div class="text-xs font-semibold text-zinc-500 uppercase">Accounts</div>
        ${matched.length ? `<div class="flex items-center gap-2"><span class="flex-1">${matched.map(Html.escape).join(', ')}</span><span class="text-xs font-semibold rounded-full px-2 py-0.5" style="background:#ecfdf5;color:#047857">Match yours</span></div>` : ''}
        ${made.length ? `<div class="flex items-center gap-2"><span class="flex-1">${made.map(Html.escape).join(', ')}</span><span class="text-xs font-semibold rounded-full px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800">Will be created</span></div>` : ''}
      </div>` : ''}
      ${notes.length ? `<div class="text-xs text-zinc-500 mb-3">${notes.join(' ')}</div>` : ''}
      ${c.attention ? `<button class="w-full card-muted p-3 mb-3 flex items-center gap-2 text-left" style="background:#fffbeb;border:1px solid #fde68a" onclick="window.__app.importAction('go','attention')">
        <i data-lucide="alert-triangle" style="width:18px;height:18px;color:#b45309"></i>
        <span class="flex-1 font-medium text-sm" style="color:#78350f">${c.attention} row${c.attention === 1 ? ' needs' : 's need'} your attention</span>
        <span class="text-sm" style="color:#92400e">Review</span></button>` : ''}
      <div class="mb-2">${this.#askBox(svc.changes ? 'Anything else to change?' : 'e.g. Swiggy is Eating out')}</div>
      ${svc.changes ? `<div class="flex justify-between items-center mb-2 text-xs text-zinc-500"><span>Changes so far: ${svc.changes}</span><button class="btn btn-ghost text-xs" onclick="window.__app.importAction('undoChange')">Undo last change</button></div>` : ''}
      <button class="btn btn-primary w-full justify-center" ${total ? '' : 'disabled'} onclick="window.__app.importAction('import')">Import ${total.toLocaleString('en-IN')} ${total === 1 ? 'item' : 'items'}</button>`;
  }

  #attention() {
    const rows = this.#svc.draft.attention;
    const card = (r) => {
      const k = Html.js(r.key);
      let controls = '';
      if (r.problem === 'amount') {
        controls = `<input class="input flex-1" inputmode="decimal" placeholder="Amount" aria-label="Amount for row ${r.n}" oninput="window.__app.importAction('pendAmount','${k}', this.value)">
          <button class="btn btn-outline" onclick="window.__app.importAction('fix','${k}')">Save</button>`;
      } else if (r.problem === 'date') {
        controls = `<input class="input flex-1" type="date" aria-label="Date for row ${r.n}" oninput="window.__app.importAction('pendDate','${k}', this.value)">
          <button class="btn btn-outline" onclick="window.__app.importAction('fix','${k}')">Save</button>`;
      } else if (r.problem === 'type') {
        controls = `<button class="btn btn-outline" onclick="window.__app.importAction('setType','${k}','expense')">Expense</button>
          <button class="btn btn-outline" onclick="window.__app.importAction('setType','${k}','income')">Income</button>`;
      }
      return `<div class="card-muted p-3 mb-2">
        <div class="flex items-center gap-2 mb-1"><span class="text-xs font-semibold rounded-full px-2 py-0.5" style="background:#fffbeb;color:#92400e">Row ${r.n}</span><span class="text-sm font-medium truncate">${Html.escape(r.text)}</span></div>
        <div class="text-sm text-zinc-500 mb-2">${Html.escape(r.why)}</div>
        <div class="flex gap-2 flex-wrap">${controls}<button class="btn btn-ghost" onclick="window.__app.importAction('skip','${k}')">Skip</button></div>
      </div>`;
    };
    return `${this.#head('Needs your attention', 3)}
      <p class="text-sm text-zinc-500 mb-3">Pocket won't guess these. Fix them or skip them.</p>
      ${this.#noteLine()}
      ${rows.length ? rows.slice(0, 50).map(card).join('') : '<div class="card-muted p-3 mb-3 text-sm">All sorted.</div>'}
      ${rows.length > 50 ? `<div class="text-xs text-zinc-500 mb-3">and ${rows.length - 50} more. Skipped rows aren't imported.</div>` : ''}
      <button class="btn btn-primary w-full justify-center" onclick="window.__app.importAction('go','preview')">Back to preview</button>`;
  }

  #done() {
    const r = this.#result;
    if (r.undone) {
      return `${this.#head('Import undone', 4)}
        <p class="text-sm mb-4">Everything this import added has been taken out. Nothing else was changed.</p>
        <button class="btn btn-primary w-full justify-center" onclick="window.__app.closeModal()">Close</button>`;
    }
    const line = (label, n) => `<div class="flex justify-between py-2 border-t border-zinc-100 dark:border-zinc-800 first:border-t-0 text-sm"><span>${label}</span><span class="font-semibold">${Number(n).toLocaleString('en-IN')}</span></div>`;
    return `${this.#head('Import', 4)}
      <div class="flex flex-col items-start gap-3 mb-3">
        <div style="width:56px;height:56px;border-radius:18px;background:#ecfdf5;display:grid;place-items:center"><i data-lucide="check" style="width:28px;height:28px;color:#047857"></i></div>
        <h4 class="text-xl font-bold">${r.entries.toLocaleString('en-IN')} ${r.entries === 1 ? 'entry' : 'entries'} imported</h4>
      </div>
      <div class="card-muted p-3 mb-3">
        ${line('Entries', r.entries)}${r.budgets ? line('Budgets set up', r.budgets) : ''}${line('Accounts created', r.accounts)}${line('Categories created', r.categories)}
        ${r.duplicates ? line('Already in Pocket', r.duplicates) : ''}${r.skipped ? line('Rows left out', r.skipped) : ''}
      </div>
      <p class="text-xs text-zinc-500 mb-3">Changed your mind? Undo removes everything this import added and nothing else. You'll also find it in Settings → Data.</p>
      <button class="btn btn-primary w-full justify-center mb-2" onclick="window.__app.closeModal();window.__app.navigate&&window.__app.navigate('transactions')">See my entries</button>
      <button class="btn btn-outline w-full justify-center" onclick="window.__app.importAction('undoImport')">Undo this import</button>`;
  }
}
