/**
 * DebtsView — what you owe and what's owed to you.
 *
 * "I owe" gathers everything you have to pay (OwedService): loans you took
 * (with instalments when set), credit cards, bills due, and delivery vendors.
 * Each row opens its own screen and pays through its own flow, so nothing is
 * copied. In someone else's space only their shared debts show, as before.
 */
import { BaseView }        from './BaseView.js';
import { DeliveryPlan }    from '../../domain/services/DeliveryPlan.js';
import { BillService }     from '../../domain/services/BillService.js';
import { LoanInstalments } from '../../domain/services/LoanInstalments.js';
import { DateService }     from '../../domain/services/DateService.js';

export class DebtsView extends BaseView {
  constructor() {
    super();
  }

  render() {
    const { state, homeCurrency: home } = this;
    const today  = DateService.todayIso();
    const debts  = state.debts || [];
    const active = debts.filter((d) => d.status !== 'paid');
    const paid   = debts.filter((d) => d.status === 'paid');
    const lent   = active.filter((d) => d.type === 'lent');
    const borrowed = active.filter((d) => d.type === 'borrowed');
    const owedToYou = lent.reduce((s, d) => s + this.convert(this.#remaining(d, state), d.currency, home), 0);

    // At home, "I owe" also covers cards, bills and deliveries.
    const owed = this.inGuestSpace ? null : window.__app?.owed?.summary?.(today) ?? null;
    const youOwe = owed ? owed.totals.all
      : borrowed.reduce((s, d) => s + this.convert(this.#remaining(d, state), d.currency, home), 0);
    const nothing = !active.length && !(owed && (owed.cards.length || owed.bills.length || owed.vendors.length));

    return `
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">Debts${this.helpButton('debts')}</h1>${this.helpHint('debts')}
          <div class="text-xs text-zinc-500 mt-0.5">${this.inGuestSpace
             ? `Debts on the accounts shared with you · ${this.escapeHtml(this.space.label)}`
             : 'Track loans, repayments and IOUs · all linked to your accounts'}</div>
        </div>
        ${this.inGuestSpace ? '' : `
        <button class="btn btn-primary" onclick="window.__app.openModal('debt')">
          <i data-lucide="plus"></i> New debt
        </button>`}
      </div>

      <div class="grid grid-cols-2 gap-4 mb-6">
        <div class="card p-5 owe-total">
          <div class="text-xs text-zinc-500 mb-1 flex items-center gap-1.5">
            <i data-lucide="arrow-down-left" class="text-rose-500"></i> You owe
          </div>
          <div class="text-2xl font-semibold text-rose-500">${this.formatMoney(youOwe, home)}</div>
          <div class="text-xs text-zinc-500 mt-1">${owed ? this.#breakdown(owed) : `${borrowed.length} active`}</div>
        </div>
        <div class="card p-5">
          <div class="text-xs text-zinc-500 mb-1 flex items-center gap-1.5">
            <i data-lucide="arrow-up-right" class="text-emerald-500"></i> Owed to you
          </div>
          <div class="text-2xl font-semibold text-emerald-500">${this.formatMoney(owedToYou, home)}</div>
          <div class="text-xs text-zinc-500 mt-1">${lent.length} active</div>
        </div>
      </div>

      ${nothing
        ? `<div class="card p-10 text-center">${this.emptyState('Nothing owed', 'Record money you have borrowed or lent. Credit cards, bills due and delivery dues show here too.')}</div>`
        : `
          ${this.#section('Loans', 'owe-loans', borrowed.length ? `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">${borrowed.map((d) => this.#debtCard(d, state, today)).join('')}</div>` : '')}
          ${owed ? this.#section('Credit cards', 'owe-cards', this.#cards(owed.cards)) : ''}
          ${owed ? this.#section('Bills', 'owe-bills', this.#bills(owed.bills, state)) : ''}
          ${owed ? this.#section('Deliveries', 'owe-vendors', this.#vendors(owed.vendors)) : ''}
          ${this.#section('Owed to you', 'owed-to-you', lent.length ? `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">${lent.map((d) => this.#debtCard(d, state, today)).join('')}</div>` : '')}
        `}

      ${paid.length ? `
        <div class="text-xs uppercase tracking-wider text-zinc-500 mb-2">Paid off</div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${paid.map((d) => this.#debtCard(d, state, today)).join('')}
        </div>` : ''}
    `;
  }

  // ── "I owe" groups ────────────────────────────────────────────────────

  #section(title, cls, body) {
    if (!body) return '';
    return `<div class="${cls} mb-6"><div class="text-xs uppercase tracking-wider text-zinc-500 mb-2">${title}</div>${body}</div>`;
  }

  /** "Loans ₹a · Cards ₹b · Bills ₹c · Deliveries ₹d" — only the non-zero ones. */
  #breakdown(owed) {
    const h = owed.home, t = owed.totals;
    const parts = [['Loans', t.loans], ['Cards', t.cards], ['Bills', t.bills], ['Deliveries', t.vendors]]
      .filter(([, v]) => v > 0).map(([k, v]) => `${k} ${this.formatMoney(v, h)}`);
    return parts.length ? parts.join(' · ') : 'Nothing right now';
  }

  #cards(cards) {
    if (!cards.length) return '';
    return `<div class="card divide-y divide-zinc-100 dark:divide-zinc-800">${cards.map(({ account: a, cycle: c }) => {
      const cur  = a.currency;
      const tag  = { overdue: '<span class="bill-tag bill-late">overdue</span>', soon: '<span class="bill-tag bill-today">due soon</span>', paid: '<span class="text-xs text-emerald-600">bill paid ✓</span>' }[c.status] || '';
      const line = c.status === 'none' ? `${this.formatMoney(c.owed, cur)} owed · <a class="underline" href="#" onclick="event.preventDefault();window.__app.openModal('account',{id:'${a.id}'})">add statement & due days</a>`
        : c.billLeft > 0 ? `${this.formatMoney(c.billLeft, cur)} due ${c.dueDate ? DeliveryPlan.shortDate(c.dueDate) : ''}`
        : `${this.formatMoney(c.owed, cur)} owed`;
      const bar = c.limit ? `<div class="progress mt-2"><div style="width:${c.usedPct}%;background:${c.usedPct >= 100 ? '#ef4444' : c.usedPct >= 80 ? '#f59e0b' : '#6366f1'}"></div></div>
          <div class="text-xs text-zinc-500 mt-1">${this.formatMoney(c.owed, cur)} used · ${this.formatMoney(Math.max(0, c.available), cur)} left of ${this.formatMoney(c.limit, cur)}</div>` : '';
      return `
        <div class="p-4 owe-card" data-card="${a.id}">
          <div class="flex items-center gap-3">
            <button class="icon-pill" style="background:${a.color}22;color:${a.color}" onclick="window.__app.openAccountDetail('${a.id}')"><i data-lucide="credit-card"></i></button>
            <button class="flex-1 min-w-0 text-left" onclick="window.__app.openAccountDetail('${a.id}')">
              <div class="font-medium truncate">${this.escapeHtml(a.name)} ${tag}</div>
              <div class="text-sm">${line}</div>
              ${c.unbilled > 0 && c.status !== 'none' ? `<div class="text-xs text-zinc-500">+ ${this.formatMoney(c.unbilled, cur)} spent since the statement</div>` : ''}
            </button>
            <button class="btn btn-primary btn-sm" onclick="window.__app.payCardBill('${a.id}')">Pay</button>
          </div>
          ${bar}
        </div>`;
    }).join('')}</div>`;
  }

  #bills(bills, state) {
    if (!bills.length) return '';
    const now  = bills.filter((b) => b.counted);
    const soon = bills.filter((b) => !b.counted);
    const row = (b) => `
      <div class="flex items-center gap-3 p-3 owe-bill ${b.counted ? '' : 'opacity-70'}">
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium truncate">${this.escapeHtml(BillService.nameOf(b.template, state))}</div>
          <div class="text-xs text-zinc-500">${b.overdue ? '<span class="bill-tag bill-late">overdue</span> ' : b.today ? '<span class="bill-tag bill-today">today</span> ' : ''}${DeliveryPlan.shortDate(b.date)} · last ${this.formatMoney(b.lastAmount || 0, b.currency)}</div>
        </div>
        <button class="btn ${b.counted ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="window.__app.openModal('payBill',{templateId:'${this.escapeHtml(b.template.id)}',date:'${b.date}'})">Pay</button>
      </div>`;
    return `<div class="card divide-y divide-zinc-100 dark:divide-zinc-800">
        ${now.map(row).join('')}
        ${soon.length ? `<div class="px-3 pt-3 pb-1 text-xs text-zinc-500">Coming up this week · not counted yet</div>${soon.map(row).join('')}` : ''}
      </div>`;
  }

  #vendors(vendors) {
    if (!vendors.length) return '';
    return `<div class="card divide-y divide-zinc-100 dark:divide-zinc-800">${vendors.map((v) => `
      <div class="flex items-center gap-3 p-3 owe-vendor">
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium truncate">${this.escapeHtml(v.vendor)}</div>
          <div class="text-xs text-zinc-500">${this.formatMoney(v.amount, v.currency)} for deliveries</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="window.__app.openModal('settle',{vendor:${this.escapeHtml(JSON.stringify(v.vendor))}})">Pay</button>
      </div>`).join('')}</div>`;
  }

  // ── Private ───────────────────────────────────────────────────────────

  #debtCard(d, state, today = DateService.todayIso()) {
    const acc        = state.accounts.find((a) => a.id === d.accountId);
    const rem        = this.#remaining(d, state);
    const paidAmt    = this.#paidAmount(d, state);
    const pct        = d.principal === 0 ? 100 : Math.min(100, Math.round(100 * paidAmt / d.principal));
    const isBorrowed = d.type === 'borrowed';
    const typeColor  = isBorrowed ? '#ef4444' : '#10b981';
    const typeLabel  = isBorrowed ? 'You owe' : 'Owed to you';
    const typeIcon   = isBorrowed ? 'arrow-down-left' : 'arrow-up-right';
    const due        = d.dueDate ? new Date(d.dueDate + 'T12:00:00') : null;
    const now        = new Date();
    const daysUntilDue = due ? Math.ceil((due - now) / 86400000) : null;
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
          ${this.#instalmentLine(d, paidAmt, today)}
          ${d.note ? `<div class="text-xs text-zinc-500 mt-2">${this.escapeHtml(d.note)}</div>` : ''}
        </div>
      </div>`;
  }

  /** "8 of 24 paid · next ₹5,000 on 5 Dec", or how much is behind, with a Pay button. */
  #instalmentLine(d, paidAmt, today) {
    const i = LoanInstalments.of(d, paidAmt, today);
    if (!i) return '';
    const cur = d.currency;
    const text = i.status === 'done' ? `All ${i.count} instalments paid`
      : i.status === 'overdue' ? `<span class="text-rose-500">Behind ${this.formatMoney(i.behind, cur)}</span> · ${i.paidCount} of ${i.count} paid`
      : `${i.paidCount} of ${i.count} paid · next ${this.formatMoney(i.amount, cur)} on ${DeliveryPlan.shortDate(i.nextDate)}`;
    const canPay = i.status !== 'done' && !this.inGuestSpace;
    return `
          <div class="loan-instalments flex items-center gap-2 mt-3 text-xs">
            <i data-lucide="calendar-clock" style="width:13px;height:13px" class="text-zinc-400"></i>
            <span class="flex-1">${text}</span>
            ${canPay ? `<button class="btn ${i.status === 'overdue' || i.status === 'soon' ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="window.__app.payLoanInstalment('${d.id}')">Pay ${this.formatMoney(i.dueNow, cur)}</button>` : ''}
          </div>`;
  }

  /** Remaining balance = principal − sum of payment transactions (cross-currency aware) */
  #remaining(d, state) {
    // Filter matches DebtModal.#debtRemaining — use only initialTxId exclusion,
    // not a broad type filter that could double-count non-payment txs (Bug 14).
    const payments = state.transactions.filter(
      t => t.debtId === d.id && t.id !== d.initialTxId,
    );
    const paid = payments.reduce((sum, t) => {
      const fromCcy = t.currency || d.currency;
      return sum + this.convert(t.amount, fromCcy, d.currency);
    }, 0);
    return Math.max(0, d.principal - paid);
  }

  /** Total amount paid back so far */
  #paidAmount(d, state) {
    const payments = state.transactions.filter((t) => t.debtId === d.id && t.id !== d.initialTxId);
    return payments.reduce((s, t) => s + this.convert(t.amount, t.currency || d.currency, d.currency), 0);
  }
}
