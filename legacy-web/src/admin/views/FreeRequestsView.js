/**
 * FreeRequestsView — requests to use Pocket free instead of the ₹30-a-month
 * promise (migration 0047). Approve (for 6 months) or decline. Shows only
 * what the person wrote and their email, never anything from their book.
 * The first requests up to a limit are approved straight away (0060); the
 * limit and its counter are set here, and an automatic approval can be revoked.
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
        : r.status === 'approved' && r.auto
        ? `<button data-action="fr-set" data-id="${r.id}" data-status="declined" class="btn btn-soft btn-sm">Revoke</button>`
        : '';
      return `
        <div class="card fr-item" style="margin-bottom:10px">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            ${Format.pill(st[1], st[2])}
            ${r.auto ? Format.pill('automatic', 'quiet') : ''}
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
      ${this.#autoBox()}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 12px">
        ${chip('all', 'All', total)}
        ${FreeRequestsView.#STATUSES.map(([k, label]) => chip(k, label, counts[k] || 0)).join('')}
      </div>
      ${rows || '<p class="muted">Nothing here.</p>'}`;
  }

  /** The auto-approve allowance: how many used, the limit, and Reset. */
  #autoBox() {
    const a = this.#data.auto;
    if (!a) return '';
    const left = Math.max(0, a.limit - a.used);
    return `
      <div class="card fr-auto" style="margin:8px 0 12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <b>Approve automatically</b>
        <span class="sub">${a.used} of ${a.limit} used · ${left ? `${left} left, then requests wait for you` : 'used up: new requests wait for you'}</span>
        <span style="flex:1"></span>
        <label class="sub">Limit <input data-fr-limit type="number" min="0" step="1" value="${a.limit}" style="width:80px"></label>
        <button data-action="fr-auto-save" class="btn btn-sm">Save</button>
        <button data-action="fr-auto-reset" class="btn btn-soft btn-sm">Reset count</button>
      </div>`;
  }

  async act(action, el) {
    if (action === 'fr-filter') { this.#filter = el.dataset.status; return true; }
    if (action === 'fr-auto-save' || action === 'fr-auto-reset') {
      const box = el.closest('.fr-auto');
      const raw = box?.querySelector('[data-fr-limit]')?.value;
      const limit = action === 'fr-auto-save' ? Math.max(0, Math.floor(Number(raw))) : null;
      if (action === 'fr-auto-save' && !Number.isFinite(limit)) { this.host.toast('Enter a number'); return false; }
      this.#data.auto = await this.api.setFreeAuto(limit, action === 'fr-auto-reset');
      this.host.toast(action === 'fr-auto-reset' ? 'Count reset to 0' : `Limit set to ${this.#data.auto.limit}`);
      return true;
    }
    if (action === 'fr-set') {
      const id = Number(el.dataset.id), status = el.dataset.status;
      const res = await this.api.setFreeRequest(id, status);
      const item = (this.#data.items || []).find((r) => r.id === id);
      const revoked = item?.status === 'approved' && status === 'declined';
      if (item) {
        const c = this.#data.counts || (this.#data.counts = {});
        c[item.status] = Math.max(0, (c[item.status] || 1) - 1);
        item.status = res?.status || status;
        item.validUntil = res?.validUntil ?? null;
        c[item.status] = (c[item.status] || 0) + 1;
      }
      this.host.toast(status === 'approved' ? 'Approved for 6 months' : revoked ? 'Revoked' : 'Declined');
      return true;
    }
    return false;
  }
}
