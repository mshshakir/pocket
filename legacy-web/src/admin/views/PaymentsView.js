/** PaymentsView — every order: who, what, how much, with which offer, paid or not. */
import { AdminView } from './AdminView.js';
import { Format } from '../Format.js';

export class PaymentsView extends AdminView {
  #orders = [];
  #paidOnly = true;

  get title() { return 'Payments'; }

  async load() { this.#orders = await this.api.payments(500); }

  html() {
    const shown = this.#paidOnly ? this.#orders.filter((o) => o.status === 'paid') : this.#orders;
    const total = shown.filter((o) => o.status === 'paid').reduce((n, o) => n + o.amountPaise, 0);
    const rows = shown.map((o) => `
      <tr>
        <td>${Format.dateTime(o.paidAt ?? o.createdAt)}</td>
        <td>${Format.esc(o.email ?? '—')}</td>
        <td>${Format.esc(o.product)}</td>
        <td class="num">${o.listPaise && o.listPaise > o.amountPaise ? `<s class="muted">${Format.inr(o.listPaise)}</s> ` : ''}${Format.inr(o.amountPaise)}</td>
        <td>${o.coupon ? Format.pill(o.coupon, 'accent') : ''}</td>
        <td>${o.status === 'paid' ? Format.pill('paid', 'good') : Format.pill('not paid', 'quiet')}</td>
        <td class="sub">${Format.esc(o.paymentId ?? o.id)}</td>
      </tr>`).join('');
    return `
      <div class="toolbar">
        <label class="check"><input type="checkbox" data-action="paid-only" ${this.#paidOnly ? 'checked' : ''}> Paid only</label>
        <button data-action="csv" class="btn btn-soft">Download CSV</button>
        <span class="muted">${shown.length} orders · ${Format.inr(total)} paid</span>
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>When</th><th>Who</th><th>Product</th><th class="num">Amount</th><th>Code</th><th>Status</th><th>Reference</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="muted">No payments yet.</td></tr>'}</tbody>
      </table></div>
      <p class="muted small">Refunds are made in the Razorpay dashboard. A payment with "not paid" was started but not completed.</p>`;
  }

  async act(action) {
    if (action === 'paid-only') { this.#paidOnly = !this.#paidOnly; return true; }
    if (action === 'csv') {
      Format.downloadCsv(`pocket-payments-${new Date().toISOString().slice(0, 10)}.csv`,
        ['created', 'paid', 'email', 'product', 'amount_inr', 'list_inr', 'coupon', 'status', 'payment_id', 'order_id'],
        this.#orders.map((o) => [o.createdAt, o.paidAt, o.email, o.product, o.amountPaise / 100, (o.listPaise ?? o.amountPaise) / 100,
          o.coupon, o.status, o.paymentId, o.id]));
    }
    return false;
  }
}
