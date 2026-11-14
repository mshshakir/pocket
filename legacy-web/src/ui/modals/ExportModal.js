/**
 * ExportModal — export a report as PDF, Excel or CSV.
 *
 *   Report   transactions · by category · by month · by account
 *   Period   presets or custom dates
 *   Filters  accounts, categories (sub-categories included), types, payment
 *            methods, search
 *   Layout   columns and their order, grouping, calendar, orientation, paper,
 *            title, totals
 *
 * The layout and the filters are saved with the user's settings, separately:
 * changing a filter never touches the layout, and both are remembered for
 * next time. The preview below is built from the same table the files are
 * written from, in a box that scrolls sideways, so a wide table never runs
 * off the screen.
 */
import { Store } from '../../core/Store.js';
import { Html } from '../../core/Html.js';
import { ExportFilter } from '../../domain/export/ExportFilter.js';
import { ExportFormat } from '../../domain/export/ExportFormat.js';
import { ReportBuilder } from '../../domain/export/ReportBuilder.js';
import { ReportExporter } from '../../domain/export/ReportExporter.js';
import { CellText } from '../../domain/export/CellText.js';

export class ExportModal {
  static #PREVIEW_ROWS = 150;

  /** Modal width: wider than the usual sheet, for the preview table. */
  maxWidth = '760px';

  #store;
  #cells = new CellText();
  /** @type {ExportFilter} */ #filter = new ExportFilter();
  /** @type {ExportFormat} */ #format = new ExportFormat();
  #busy = null;

  constructor({ store = Store.getInstance() } = {}) {
    this.#store = store;
  }

  onOpen() {
    const saved = this.#store.getState().user?.exportPrefs || {};
    this.#filter = new ExportFilter(saved.filter);
    this.#format = new ExportFormat(saved.format);
    this.#busy = null;
  }

  // ── Changes (called through window.__app, which re-renders) ─────────────

  /** @param {'filter'|'format'} scope */
  set(scope, field, value) {
    if (scope === 'filter') this.#filter = this.#filter.with(field, value);
    else this.#format = this.#format.with(field, field === 'showTotals' ? !!value : value);
    this.#save();
  }

  toggle(scope, field, value) {
    if (scope === 'filter') this.#filter = this.#filter.toggle(field, value);
    else if (field === 'columns') this.#format = this.#format.toggleColumn(value);
    this.#save();
  }

  moveColumn(key, step) {
    this.#format = this.#format.moveColumn(key, step);
    this.#save();
  }

  clearFilters() {
    this.#filter = new ExportFilter({ period: this.#filter.period, from: this.#filter.from, to: this.#filter.to });
    this.#save();
  }

  /** Make and save a file. @returns {Promise<string>} a message for the toast */
  async run(type) {
    if (this.#busy) return 'Already preparing a file…';
    this.#busy = type;
    try {
      const { blob, fileName, rows } = await ReportExporter.make(this.#data(), this.#filter, this.#format, type);
      ReportExporter.download(blob, fileName);
      return `Saved ${fileName} · ${rows.toLocaleString()} row${rows === 1 ? '' : 's'}`;
    } finally {
      this.#busy = null;
    }
  }

  get busy() {
    return this.#busy;
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  render() {
    const data = this.#data();
    const table = ReportBuilder.build(data, this.#filter, this.#format);
    const f = this.#filter;
    const fm = this.#format;
    return `
      <div class="p-5">
        <div class="sheet-header flex items-center justify-between">
          <h3 class="text-lg font-semibold">Export report</h3>
          <button class="btn btn-ghost px-2.5" onclick="window.__app.closeModal()" aria-label="Close" title="Close">
            <i data-lucide="x"></i>
          </button>
        </div>

        <div class="seg mb-4" style="grid-template-columns:repeat(${ExportFormat.REPORTS.length},minmax(0,1fr))" role="tablist">
          ${ExportFormat.REPORTS.map(([k, l]) => `
            <button type="button" role="tab" aria-selected="${fm.report === k}" class="${fm.report === k ? 'on' : ''}"
                    onclick="window.__app.exportSet('format','report','${k}')">${l}</button>`).join('')}
        </div>

        ${this.#periodSection(f)}
        ${this.#filterSection(data, f)}
        ${this.#layoutSection(fm)}
        ${this.#preview(table)}

        <div class="form-footer flex flex-wrap items-center gap-2 mt-4">
          ${ReportExporter.FILE_TYPES.map(([type, label, icon], i) => `
            <button type="button" class="btn ${i === 0 ? 'btn-primary' : 'btn-outline'} flex-1 justify-center py-2.5"
                    onclick="window.__app.exportRun('${type}')" ${this.#busy ? 'disabled' : ''}>
              <i data-lucide="${icon}"></i> ${this.#busy === type ? 'Preparing…' : label}
            </button>`).join('')}
          <button type="button" class="w-full text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 pt-1"
                  onclick="window.__app.exportCsv('all')" title="All transactions in the import template's columns">
            Backup CSV for re-import (all transactions)
          </button>
        </div>
      </div>`;
  }

  #periodSection(f) {
    const { from, to } = f.range();
    return `
      <div class="mb-3">
        <label class="field-label" for="expPeriod">Period</label>
        <div class="flex flex-wrap gap-2 items-center">
          <select id="expPeriod" class="select w-auto" onchange="window.__app.exportSet('filter','period',this.value)">
            ${ExportFilter.PERIODS.map(([k, l]) => `<option value="${k}" ${f.period === k ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          ${f.period === 'custom' ? `
            <input class="input w-auto" type="date" value="${f.from}" aria-label="From"
                   onchange="window.__app.exportSet('filter','from',this.value)">
            <span class="text-zinc-400 text-sm">to</span>
            <input class="input w-auto" type="date" value="${f.to}" aria-label="To"
                   onchange="window.__app.exportSet('filter','to',this.value)">`
            : `<span class="text-xs text-zinc-500">${from ? this.#esc(from) : 'Beginning'} → ${to ? this.#esc(to) : 'today'}</span>`}
        </div>
      </div>`;
  }

  #filterSection(data, f) {
    const accounts = (data.accounts || []).filter((a) => !a.archived || f.accountIds.includes(a.id));
    const cats = data.categories || [];
    const mains = cats.filter((c) => !c.parentId || !cats.some((p) => p.id === c.parentId));
    const catOptions = mains.sort((a, b) => a.name.localeCompare(b.name)).flatMap((m) => [
      { id: m.id, label: m.name },
      ...cats.filter((c) => c.parentId === m.id).sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ id: c.id, label: `${m.name} / ${c.name}` })),
    ]);
    const catLabel = (id) => catOptions.find((o) => o.id === id)?.label || id;
    const payments = [...new Set((data.transactions || []).map((t) => t.paymentType).filter(Boolean))].sort();
    const n = f.activeCount;

    return `
      <details class="more-options card-muted px-3 mb-3" ${n ? 'open' : ''}>
        <summary class="flex items-center gap-1.5 py-2.5 text-sm font-medium">
          <i data-lucide="chevron-right" class="more-chevron transition-transform" style="width:15px;height:15px"></i>
          Filters
          ${n ? `<span class="chip" style="font-size:.7rem;padding:.05rem .45rem">${n}</span>
                 <button type="button" class="ml-auto text-xs text-zinc-500 hover:text-rose-500" onclick="event.preventDefault();window.__app.exportClearFilters()">Clear</button>`
              : '<span class="text-xs font-normal text-zinc-400">accounts, categories, types…</span>'}
        </summary>
        <div class="pb-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          ${this.#multiPicker('Accounts', 'accountIds', f.accountIds, accounts.map((a) => ({ id: a.id, label: a.name })), (id) => accounts.find((a) => a.id === id)?.name || id, 'Any account')}
          ${this.#multiPicker('Categories', 'categoryIds', f.categoryIds, catOptions, catLabel, 'Any category')}
          <div>
            <span class="field-label">Types</span>
            <div class="chip-scroll">${ExportFilter.TYPES.map(([k, l]) => this.#chip(l, f.types.includes(k), `window.__app.exportToggle('filter','types','${k}')`)).join('')}</div>
          </div>
          <div>
            <span class="field-label">Payment</span>
            <div class="chip-scroll">${payments.length
              ? payments.map((p) => this.#chip(p[0].toUpperCase() + p.slice(1), f.paymentTypes.includes(p), `window.__app.exportToggle('filter','paymentTypes','${Html.js(p)}')`)).join('')
              : '<span class="text-xs text-zinc-400">None recorded</span>'}</div>
          </div>
          <div class="sm:col-span-2">
            <label class="field-label" for="expSearch">Search payee, note, category or account</label>
            <input id="expSearch" class="input" value="${this.#esc(f.search)}" placeholder="e.g. taxi"
                   onchange="window.__app.exportSet('filter','search',this.value)">
          </div>
        </div>
      </details>`;
  }

  #layoutSection(fm) {
    const isTx = fm.report === 'transactions';
    const usesCalendar = fm.report === 'months' || (isTx && fm.groupBy === 'month');
    const select = (label, field, list, value) => `
      <div>
        <label class="field-label">${label}</label>
        <select class="select" onchange="window.__app.exportSet('format','${field}',this.value)">
          ${list.map(([k, l]) => `<option value="${k}" ${value === k ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>`;
    return `
      <details class="more-options card-muted px-3 mb-3">
        <summary class="flex items-center gap-1.5 py-2.5 text-sm font-medium">
          <i data-lucide="chevron-right" class="more-chevron transition-transform" style="width:15px;height:15px"></i>
          Layout
          <span class="text-xs font-normal text-zinc-400">${isTx ? 'columns, grouping, ' : ''}page, title</span>
        </summary>
        <div class="pb-3">
          ${isTx ? this.#columnPicker(fm) : ''}
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            ${isTx ? select('Group by', 'groupBy', ExportFormat.GROUPS, fm.groupBy) : ''}
            ${usesCalendar ? select('Months', 'calendar', ExportFormat.CALENDARS, fm.calendar) : ''}
            ${select('PDF page', 'orientation', ExportFormat.ORIENTATIONS, fm.orientation)}
            ${select('Paper', 'paper', ExportFormat.PAPERS, fm.paper)}
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
            <div>
              <label class="field-label" for="expTitle">Title</label>
              <input id="expTitle" class="input" value="${this.#esc(fm.title)}" placeholder="Default title"
                     onchange="window.__app.exportSet('format','title',this.value)">
            </div>
            <label class="flex items-center gap-2 text-sm pb-2">
              <input type="checkbox" ${fm.showTotals ? 'checked' : ''} onchange="window.__app.exportSet('format','showTotals',this.checked)">
              Totals
            </label>
          </div>
          <div class="text-[11px] text-zinc-500 mt-2">Your layout is kept when you change the filters, and remembered for next time.</div>
        </div>
      </details>`;
  }

  #columnPicker(fm) {
    const shown = fm.columns;
    const hidden = ExportFormat.TX_COLUMNS.filter(([k]) => !shown.includes(k));
    return `
      <span class="field-label">Columns, in order</span>
      <div class="flex flex-wrap gap-1.5 mb-2">
        ${shown.map((k, i) => `
          <span class="inline-flex items-center rounded-full border border-zinc-300 dark:border-zinc-700 text-sm overflow-hidden">
            <button type="button" class="px-1.5 py-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30"
                    ${i === 0 ? 'disabled' : ''} onclick="window.__app.exportMoveColumn('${k}',-1)" aria-label="Move left">‹</button>
            <span class="py-1">${this.#esc(ExportFormat.label(ExportFormat.TX_COLUMNS, k))}</span>
            <button type="button" class="px-1.5 py-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30"
                    ${i === shown.length - 1 ? 'disabled' : ''} onclick="window.__app.exportMoveColumn('${k}',1)" aria-label="Move right">›</button>
            <button type="button" class="pr-2 pl-0.5 py-1 text-zinc-400 hover:text-rose-500 disabled:opacity-30" ${shown.length === 1 ? 'disabled' : ''}
                    onclick="window.__app.exportToggle('format','columns','${k}')" aria-label="Hide column">×</button>
          </span>`).join('')}
      </div>
      ${hidden.length ? `
        <div class="flex flex-wrap gap-1.5 mb-3">
          ${hidden.map(([k, l]) => `
            <button type="button" class="px-2.5 py-1 rounded-full border border-dashed border-zinc-300 dark:border-zinc-700 text-sm text-zinc-500"
                    onclick="window.__app.exportToggle('format','columns','${k}')">＋ ${this.#esc(l)}</button>`).join('')}
        </div>` : '<div class="mb-3"></div>'}`;
  }

  #preview(table) {
    const cols = table.columns;
    const shown = [];
    let budget = ExportModal.#PREVIEW_ROWS;
    for (const s of table.sections) {
      if (budget <= 0) break;
      if (s.label) shown.push({ section: s.label });
      for (const r of s.rows.slice(0, budget)) shown.push({ row: r });
      budget -= s.rows.length;
      if (s.subtotal && budget >= 0) shown.push({ row: s.subtotal, sub: true });
    }
    const more = table.rowCount - Math.min(table.rowCount, ExportModal.#PREVIEW_ROWS);
    const cell = (c, r, i) => {
      const right = CellText.isNumeric(c);
      const nowrap = CellText.keepsOneLine(c) && !CellText.isLabel(c, r);
      const pad = r._level && i === 0 ? 'padding-left:1.25rem;' : '';
      const text = this.#esc(this.#cells.text(c, r));
      return `<td class="px-2.5 py-1.5 align-top ${right ? 'text-right tx-amount whitespace-nowrap' : ''} ${nowrap ? 'whitespace-nowrap' : ''}"
                  style="${pad}${c.weight >= 2 ? 'min-width:14rem;' : ''}">${text}</td>`;
    };

    return `
      <div class="mb-1 flex items-baseline justify-between gap-2">
        <span class="field-label mb-0">Preview</span>
        <span class="text-xs text-zinc-500">${table.rowCount.toLocaleString()} row${table.rowCount === 1 ? '' : 's'}${more > 0 ? ` · first ${ExportModal.#PREVIEW_ROWS} shown` : ''}</span>
      </div>
      <div class="text-sm font-semibold">${this.#esc(table.title)}</div>
      <div class="text-xs text-zinc-500 mb-1">${this.#esc(table.subtitle)}</div>
      ${table.notes.map((n) => `<div class="text-xs text-zinc-500">${this.#esc(n)}</div>`).join('')}
      <div class="export-preview mt-2 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-auto" style="max-height:340px">
        ${table.isEmpty
          ? '<div class="p-6 text-center text-sm text-zinc-500">No entries match these filters.</div>'
          : `<table class="text-xs w-full" style="border-collapse:separate;border-spacing:0">
          <thead>
            <tr>${cols.map((c) => `<th class="px-2.5 py-2 font-semibold whitespace-nowrap ${c.align === 'right' || c.kind === 'money' ? 'text-right' : 'text-left'}">${this.#esc(c.label)}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${shown.map((x) => x.section
              ? `<tr class="export-section"><td colspan="${cols.length}" class="px-2.5 py-1.5 font-semibold">${this.#esc(x.section)}</td></tr>`
              : `<tr class="${x.row._strong ? 'font-semibold' : ''} ${x.sub ? 'export-subtotal' : ''}">${cols.map((c, i) => cell(c, x.row, i)).join('')}</tr>`).join('')}
          </tbody>
          ${table.total ? `<tfoot><tr class="font-semibold">${cols.map((c, i) => cell(c, table.total, i)).join('')}</tr></tfoot>` : ''}
        </table>`}
      </div>`;
  }

  #multiPicker(label, field, selected, options, labelOf, placeholder) {
    const remaining = options.filter((o) => !selected.includes(o.id));
    return `
      <div>
        <span class="field-label">${label}</span>
        ${selected.length ? `<div class="flex flex-wrap gap-1.5 mb-1.5">${selected.map((id) => `
          <span class="chip">${this.#esc(labelOf(id))}
            <button type="button" class="ml-1 opacity-60" aria-label="Remove"
                    onclick="window.__app.exportToggle('filter','${field}','${Html.js(id)}')">×</button></span>`).join('')}</div>` : ''}
        <select class="select" onchange="if(this.value){window.__app.exportToggle('filter','${field}',this.value)}">
          <option value="">${selected.length ? '＋ Add…' : placeholder}</option>
          ${remaining.map((o) => `<option value="${this.#esc(o.id)}">${this.#esc(o.label)}</option>`).join('')}
        </select>
      </div>`;
  }

  #chip(label, on, onclick) {
    return `<button type="button" onclick="${onclick}" class="px-3 py-1 rounded-full border text-sm ${on
      ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-zinc-900'
      : 'border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'}">${this.#esc(label)}</button>`;
  }

  /** The book the user is looking at: their own, or a shared space's view of the owner's. */
  #data() {
    const space = window.__app?.spaces?.active?.();
    return space ? space.project() : this.#store.getState();
  }

  /** Remember the layout and filters with the user's settings (synced). */
  #save() {
    const state = this.#store.getState();
    state.user.exportPrefs = { filter: this.#filter.toJSON(), format: this.#format.toJSON() };
    this.#store.persist();
  }

  #esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, (m) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }
}
