/** AuditView — every change made from the dashboard: when, by whom, what. */
import { AdminView } from './AdminView.js';
import { Format } from '../Format.js';

export class AuditView extends AdminView {
  #rows = [];

  get title() { return 'Audit log'; }

  async load() { this.#rows = await this.api.audit(300); }

  html() {
    const rows = this.#rows.map((r) => `
      <tr><td>${Format.dateTime(r.at)}</td><td>${Format.esc(r.admin ?? '—')}</td><td>${Format.esc(r.action)}</td>
      <td>${Format.esc(r.target ?? '')}</td><td class="sub mono">${Format.esc(JSON.stringify(r.detail ?? {}))}</td></tr>`).join('');
    return `
      <p class="muted small">Changes to plans, prices, offers, people's plans and credits, and the programme. Newest first.</p>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>When</th><th>Who</th><th>What</th><th>On</th><th>Details</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="muted">Nothing yet.</td></tr>'}</tbody>
      </table></div>`;
  }
}
