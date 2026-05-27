/**
 * DebtsView — Debt and loan tracker with progress bars.
 * Shows "you owe" vs "owed to you" summary plus individual debt cards.
 */
import { BaseView } from './BaseView.js';

export class DebtsView extends BaseView {
  constructor() {
    super();
  }

  render() {
    const { state, homeCurrency: home } = this;
    const debts  = state.debts || [];
    const active = debts.filter((d) => d.status !== 'paid');
    const paid   = debts.filter((d) => d.status === 'paid');

    const youOwe    = active.filter((d) => d.type === 'borrowed')
      .reduce((s, d) => s + this.convert(this.#remaining(d, state), d.currency, home), 0);
    const owedToYou = active.filter((d) => d.type === 'lent')
      .reduce((s, d) => s + this.convert(this.#remaining(d, state), d.currency, home), 0);

    return `
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">Debts</h1>
          <div class="text-xs text-zinc-500 mt-0.5">Track loans, repayments and IOUs · all linked to your accounts</div>
        </div>
        <button class="btn btn-primary" onclick="window.__app.openModal('debt')">
          <i data-lucide="plus"></i> New debt
        </button>
      </div>

      <div class="grid grid-cols-2 gap-4 mb-6">
        <div class="card p-5">
          <div class="text-xs text-zinc-500 mb-1 flex items-center gap-1.5">
            <i data-lucide="arrow-down-left" class="text-rose-500"></i> You owe
          </div>
          <div class="text-2xl font-semibold text-rose-500">${this.formatMoney(youOwe, home)}</div>
          <div class="text-xs text-zinc-500 mt-1">${active.filter((d) => d.type === 'borrowed').length} active</div>
        </div>
        <div class="card p-5">
          <div class="text-xs text-zinc-500 mb-1 flex items-center gap-1.5">
            <i data-lucide="arrow-up-right" class="text-emerald-500"></i> Owed to you
          </div>
          <div class="text-2xl font-semibold text-emerald-500">${this.formatMoney(owedToYou, home)}</div>
          <div class="text-xs text-zinc-500 mt-1">${active.filter((d) => d.type === 'lent').length} active</div>
        </div>
      </div>

      ${active.length === 0
        ? `<div class="card p-10 text-center">${this.emptyState('No active debts', 'Record money you have borrowed or lent. The amount syncs straight to the linked account.')}</div>`
        : `<div class="text-xs uppercase tracking-wider text-zinc-500 mb-2">Active</div>
           <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
             ${active.map((d) => this.#debtCard(d, state)).join('')}
           </div>`}

      ${paid.length ? `
        <div class="text-xs uppercase tracking-wider text-zinc-500 mb-2">Paid off</div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${paid.map((d) => this.#debtCard(d, state)).join('')}
        </div>` : ''}
    `;
  }

  // ── Private ───────────────────────────────────────────────────────────

  #debtCard(d, state) {
    const acc        = state.accounts.find((a) => a.id === d.accountId);
    const rem        = this.#remaining(d, state);
    const paidAmt    = this.#paidAmount(d, state);
    const pct        = d.principal === 0 ? 100 : Math.min(100, Math.round(100 * paidAmt / d.principal));
    const isBorrowed = d.type === 'borrowed';
    const typeColor  = isBorrowed ? '#ef4444' : '#10b981';
    const typeLabel  = isBorrowed ? 'You owe' : 'Owed to you';
    const typeIcon   = isBorrowed ? 'arrow-down-left' : 'arrow-up-right';
    const due        = d.dueDate ? new Date(d.dueDate + 'T12:00:00') : null;
    const today      = new Date();
    const daysUntilDue = due ? Math.ceil((due - today) / 86400000) : null;
    const payTxs     = state.transactions.filter((t) => t.debtId === d.id && t.id !== d.initialTxId);

    return `
      <div class="card p-5 ${d.status === 'paid' ? 'opacity-60' : ''}">
        <div class="flex items-start gap-3">
          <div class="icon-pill" style="background:${typeColor}22;color:${typeColor}">
            <i data-lucide="${typeIcon}"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5 justify-between">
              <div class="font-semibold truncate">${this.escapeHtml(d.counterparty)}</div>
              <div class="flex gap-1">
                ${d.status !== 'paid' ? `<button class="btn btn-ghost" onclick="window.__app.openModal('debtPayment',{id:'${d.id}'})" title="Record payment"><i data-lucide="hand-coins"></i></button>` : ''}
                <button class="btn btn-ghost" onclick="window.__app.openModal('debt',{id:'${d.id}'})" title="Edit"><i data-lucide="pencil"></i></button>
              </div>
            </div>
            <div class="text-xs text-zinc-500">${typeLabel}${acc ? ` · ${this.escapeHtml(acc.name)}` : ''}</div>
          </div>
        </div>
        <div class="mt-4">
          <div class="flex items-baseline justify-between">
            <div class="text-lg font-semibold ${d.status === 'paid' ? 'text-zinc-500 line-through' : ''}">${this.formatMoney(rem, d.currency)}</div>
            <div class="text-sm text-zinc-500">/ ${this.formatMoney(d.principal, d.currency)}</div>
          </div>
          <div class="progress mt-2"><div style="width:${pct}%; background:${typeColor}"></div></div>
          <div class="flex items-center justify-between mt-2 text-xs">
            <span class="text-zinc-500">${pct}% repaid · ${payTxs.length} payment${payTxs.length === 1 ? '' : 's'}</span>
            ${d.status === 'paid'
              ? `<span class="text-emerald-500 inline-flex items-center gap-1"><i data-lucide="check-circle-2" style="width:11px;height:11px"></i> Paid off</span>`
              : (daysUntilDue !== null
                  ? (daysUntilDue < 0 ? `<span class="text-rose-500">Overdue ${-daysUntilDue}d</span>` : `<span class="text-zinc-500">Due in ${daysUntilDue}d</span>`)
                  : '<span class="text-zinc-500">No due date</span>')}
          </div>
          ${d.note ? `<div class="text-xs text-zinc-500 mt-2">${this.escapeHtml(d.note)}</div>` : ''}
        </div>
      </div>`;
  }

  /** Remaining balance = principal − sum of payment transactions */
  #remaining(d, state) {
    const payments = state.transactions.filter((t) => t.debtId === d.id && t.id !== d.initialTxId);
    const paid     = payments.reduce((s, t) => s + t.amount, 0);
    return Math.max(0, d.principal - paid);
  }

  /** Total amount paid back so far */
  #paidAmount(d, state) {
    const payments = state.transactions.filter((t) => t.debtId === d.id && t.id !== d.initialTxId);
    return payments.reduce((s, t) => s + t.amount, 0);
  }
}
