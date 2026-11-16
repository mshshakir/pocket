/**
 * FreeRequestsView — requests to use Pocket free instead of the ₹30-a-month
 * promise (migration 0047). Approve (for 6 months) or decline. Shows only
 * what the person wrote and their email, never anything from their book.
 */
import { AdminView } from './AdminView.js';
import { Format } from '../Format.js';

export class FreeRequestsView extends AdminView {
  /** [status, label, tone] */
  static #STATUSES = [
    ['pending', 'Waiting', 'warn'],
    ['approved', 'Approved', 'good'],
    ['declined', 'Declined', 'bad'],
  ];

  #data = { counts: {}, items: [] };
  #filter = 'pending';

  get title() { return 'Free requests'; }

  async load() { this.#data = await this.api.freeRequests(null); }

  html() {
    const counts = this.#data.counts || {};
    const total = Object.values(counts).reduce((s, n) => s + Number(n || 0), 0);
    const items = (this.#data.items || []).filter((r) => this.#filter === 'all' || r.status === this.#filter);
    const chip = (key, label, n) => `<button data-action="fr-filter" data-status="${key}" class="btn ${this.#filter === key ? '' : 'btn-soft'} btn-sm">${label} <span class="sub">${n}</span></button>`;
    const rows = items.map((r) => {
      const st = FreeRequestsView.#STATUSES.find(([k]) => k === r.status) || FreeRequestsView.#STATUSES[0];
      const until = r.status === 'approved' && r.validUntil ? ` · free until ${Format.dateTime(r.validUntil)}` : '';
      const buttons = r.status === 'pending'
        ? `<button data-action="fr-set" data-id="${r.id}" data-status="approved" class="btn btn-sm">Approve for 6 months</button>
           <button data-action="fr-set" data-id="${r.id}" data-status="declined" class="btn btn-soft btn-sm">Decline</button>`
        : '';
      return `
        <div class="card fr-item" style="margin-bottom:10px">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            ${Format.pill(st[1], st[2])}
            <b>${Format.esc(r.name)}</b>
            <span class="sub">${Format.esc(r.email || '—')} · ${Format.dateTime(r.at)}${until}</span>
          </div>
          <div style="white-space:pre-wrap;margin:10px 0">${Format.esc(r.reason)}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${buttons}
            ${r.email ? `<a class="btn btn-soft btn-sm" href="mailto:${encodeURIComponent(r.email)}?subject=${encodeURIComponent('Your request to use Pocket free')}">Reply by email</a>` : ''}
          </div>
        </div>`;
    }).join('');
    return `
      <p class="muted small">People who asked to use Pocket instead of paying ₹30 a month. While a request waits they can add up to 20 entries; an approval lasts 6 months.</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 12px">
        ${chip('all', 'All', total)}
        ${FreeRequestsView.#STATUSES.map(([k, label]) => chip(k, label, counts[k] || 0)).join('')}
      </div>
      ${rows || '<p class="muted">Nothing here.</p>'}`;
  }

  async act(action, el) {
    if (action === 'fr-filter') { this.#filter = el.dataset.status; return true; }
    if (action === 'fr-set') {
      const id = Number(el.dataset.id), status = el.dataset.status;
      const res = await this.api.setFreeRequest(id, status);
      const item = (this.#data.items || []).find((r) => r.id === id);
      if (item) {
        const c = this.#data.counts || (this.#data.counts = {});
        c[item.status] = Math.max(0, (c[item.status] || 1) - 1);
        item.status = res?.status || status;
        item.validUntil = res?.validUntil ?? null;
        c[item.status] = (c[item.status] || 0) + 1;
      }
      this.host.toast(status === 'approved' ? 'Approved for 6 months' : 'Declined');
      return true;
    }
    return false;
  }
}
