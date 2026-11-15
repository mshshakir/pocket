/**
 * FeedbackView — feedback and feature ideas sent from the app (migration 0035).
 * Filter by status, and move each message along: Read · Planned · Done · Won't do.
 * Only what the person wrote, their email and the screen they were on —
 * never anything from their book.
 */
import { AdminView } from './AdminView.js';
import { Format } from '../Format.js';

export class FeedbackView extends AdminView {
  /** [status, label, tone] */
  static #STATUSES = [
    ['new', 'New', 'accent'],
    ['read', 'Read', 'quiet'],
    ['planned', 'Planned', 'warn'],
    ['done', 'Done', 'good'],
    ['wontdo', "Won't do", 'bad'],
  ];

  #data = { counts: {}, items: [] };
  #filter = 'new';
  #kind = 'all';

  get title() { return 'Feedback'; }

  async load() { this.#data = await this.api.feedback(null); }

  html() {
    const counts = this.#data.counts || {};
    const total = Object.values(counts).reduce((s, n) => s + Number(n || 0), 0);
    const items = (this.#data.items || [])
      .filter((f) => this.#filter === 'all' || f.status === this.#filter)
      .filter((f) => this.#kind === 'all' || f.kind === this.#kind);
    const chip = (key, label, n) => `<button data-action="fb-filter" data-status="${key}" class="btn ${this.#filter === key ? '' : 'btn-soft'} btn-sm">${label} <span class="sub">${n}</span></button>`;
    const kindChip = (key, label) => `<button data-action="fb-kind" data-kind="${key}" class="btn ${this.#kind === key ? '' : 'btn-soft'} btn-sm">${label}</button>`;
    const rows = items.map((f) => {
      const st = FeedbackView.#STATUSES.find(([k]) => k === f.status) || FeedbackView.#STATUSES[0];
      return `
        <div class="card fb-item" style="margin-bottom:10px">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            ${Format.pill(f.kind === 'feature' ? 'Feature idea' : 'Feedback', f.kind === 'feature' ? 'accent' : 'quiet')}
            ${Format.pill(st[1], st[2])}
            <span class="sub">${Format.esc(f.email || '—')} · ${Format.dateTime(f.at)}${f.page ? ` · from ${Format.esc(f.page)}` : ''}</span>
          </div>
          <div style="white-space:pre-wrap;margin:10px 0">${Format.esc(f.message)}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${FeedbackView.#STATUSES.filter(([k]) => k !== 'new' && k !== f.status).map(([k, label]) =>
              `<button data-action="fb-status" data-id="${f.id}" data-status="${k}" class="btn btn-soft btn-sm">${label}</button>`).join('')}
            ${f.email ? `<a class="btn btn-soft btn-sm" href="mailto:${encodeURIComponent(f.email)}?subject=${encodeURIComponent('About your Pocket ' + (f.kind === 'feature' ? 'idea' : 'feedback'))}">Reply by email</a>` : ''}
          </div>
        </div>`;
    }).join('');
    return `
      <p class="muted small">What people send from Settings → Help, or More → Feedback. Newest first.</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">
        ${chip('all', 'All', total)}
        ${FeedbackView.#STATUSES.map(([k, label]) => chip(k, label, counts[k] || 0)).join('')}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px">
        ${kindChip('all', 'Both')}${kindChip('feedback', 'Feedback')}${kindChip('feature', 'Feature ideas')}
      </div>
      ${rows || '<p class="muted">Nothing here.</p>'}`;
  }

  async act(action, el) {
    if (action === 'fb-filter') { this.#filter = el.dataset.status; return true; }
    if (action === 'fb-kind') { this.#kind = el.dataset.kind; return true; }
    if (action === 'fb-status') {
      const id = Number(el.dataset.id), status = el.dataset.status;
      const res = await this.api.setFeedback(id, status);
      const item = (this.#data.items || []).find((f) => f.id === id);
      if (item) {
        const was = item.status;
        item.status = res?.status || status;
        const c = this.#data.counts || (this.#data.counts = {});
        c[was] = Math.max(0, (c[was] || 1) - 1);
        c[item.status] = (c[item.status] || 0) + 1;
      }
      this.host.toast('Updated');
      return true;
    }
    return false;
  }
}
