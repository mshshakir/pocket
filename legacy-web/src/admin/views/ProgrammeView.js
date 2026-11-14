/**
 * ProgrammeView — the habit programme: applications and the waitlist (with
 * each person's profile), batches, and the coach's tracker for a batch (the
 * daily "did you record today?" answers and notes from the weekly calls).
 *
 * The tracker is the coach's own record; it holds nothing from Pocket.
 */
import { AdminView } from './AdminView.js';
import { Format } from '../Format.js';

export class ProgrammeView extends AdminView {
  static STATUSES = ['waitlisted', 'offered', 'confirmed', 'completed', 'withdrawn'];
  static #TONE = { waitlisted: 'warn', offered: 'accent', confirmed: 'good', completed: 'good', withdrawn: 'quiet' };

  #data = null;
  #part = 'applications';   // applications | batches | tracker
  #filter = 'waitlisted';
  #batchId = null;          // tracker's batch
  #tracker = null;
  #callFor = null;          // application id with the call form open

  get title() { return 'Programme'; }

  async load() {
    this.#data = await this.api.programme();
    if (this.#part === 'tracker' && this.#batchId) this.#tracker = await this.api.tracker(this.#batchId);
  }

  html() {
    if (!this.#data) return '<p class="muted">Loading…</p>';
    const count = (s) => this.#data.applications.filter((a) => a.status === s).length;
    const tab = (key, label) => `<button data-action="part" data-part="${key}" class="subtab ${this.#part === key ? 'on' : ''}">${label}</button>`;
    const body = this.#part === 'batches' ? this.#batches() : this.#part === 'tracker' ? this.#trackerHtml() : this.#applications();
    return `
      <div class="subtabs">
        ${tab('applications', `Applications <span class="count">${this.#data.applications.length}</span>`)}
        ${tab('batches', `Batches <span class="count">${this.#data.batches.length}</span>`)}
        ${tab('tracker', 'Tracker')}
        <span class="muted small">Waitlist ${count('waitlisted')} · offered ${count('offered')} · confirmed ${count('confirmed')}</span>
      </div>
      ${body}`;
  }

  // ── applications ────────────────────────────────────────────────────

  #applications() {
    const list = this.#data.applications.filter((a) => this.#filter === 'all' || a.status === this.#filter)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const chips = ['waitlisted', 'offered', 'confirmed', 'completed', 'withdrawn', 'all']
      .map((s) => `<button data-action="filter" data-status="${s}" class="chip ${this.#filter === s ? 'on' : ''}">${s}</button>`).join('');
    const cards = list.map((a, i) => this.#card(a, this.#filter === 'waitlisted' ? i + 1 : null)).join('');
    return `
      <div class="chips">${chips}</div>
      ${this.#filter === 'waitlisted' ? '<p class="muted small">In the order they applied. Offer a place in a batch; they then pay on the programme page (or mark it paid if they paid another way).</p>' : ''}
      <div class="cards">${cards || '<p class="muted">Nobody here.</p>'}</div>`;
  }

  #card(a, position) {
    const batch = this.#data.batches.find((b) => b.id === a.batch_id);
    const wa = Format.whatsapp(a.whatsapp);
    const openBatches = this.#data.batches.filter((b) => b.status !== 'done');
    const batchOpts = openBatches.map((b) => `<option value="${b.id}">${Format.esc(b.name)} · ${b.confirmed + b.offered}/${b.capacity}</option>`).join('');
    const field = (label, v) => (v || v === 0 ? `<div><span class="label">${label}</span> ${Format.esc(v)}</div>` : '');
    const actions = [];
    if (a.status === 'waitlisted' || a.status === 'offered') {
      actions.push(openBatches.length
        ? `<form data-form="offer" data-id="${a.id}" class="inline"><select name="batch" class="input input-sm">${batchOpts}</select><button class="btn btn-sm">${a.status === 'offered' ? 'Move place' : 'Offer a place'}</button></form>`
        : '<span class="muted small">Create a batch to offer places.</span>');
    }
    if (a.status === 'offered') {
      actions.push(`<button data-action="app" data-do="confirm" data-id="${a.id}" class="btn btn-soft btn-sm">Mark paid (outside Razorpay)</button>`);
      actions.push(`<button data-action="app" data-do="waitlist" data-id="${a.id}" class="btn btn-soft btn-sm">Back to waitlist</button>`);
    }
    if (a.status === 'confirmed') actions.push(`<button data-action="app" data-do="complete" data-id="${a.id}" class="btn btn-soft btn-sm">Mark completed</button>`);
    if (a.status === 'withdrawn') actions.push(`<button data-action="app" data-do="waitlist" data-id="${a.id}" class="btn btn-soft btn-sm">Back to waitlist</button>`);
    if (a.status !== 'withdrawn' && a.status !== 'completed') actions.push(`<button data-action="app" data-do="withdraw" data-id="${a.id}" class="btn btn-danger btn-sm">Withdraw</button>`);
    return `
      <div class="card">
        <div class="card-head">
          <div>${position ? `<span class="pos">#${position}</span> ` : ''}<span class="strong">${Format.esc(a.full_name)}</span> ${Format.pill(a.status, ProgrammeView.#TONE[a.status])}
            ${batch ? `<span class="sub">· ${Format.esc(batch.name)}</span>` : ''}</div>
          <div class="sub">applied ${Format.date(a.created_at)}</div>
        </div>
        <div class="card-grid">
          <div><span class="label">WhatsApp</span> ${wa ? `<a href="${wa}" target="_blank" rel="noopener">${Format.esc(a.whatsapp)}</a>` : Format.esc(a.whatsapp)}</div>
          ${field('Email', a.email)}
          ${field('Telegram', a.telegram)}
          ${field('Records with', a.household)}
          ${field('Tracks money today by', a.current_method)}
          ${field('Days recorded last week', a.baseline_days)}
          ${field('Language', a.language)}
          ${field('Best time', a.preferred_time)}
          ${a.goal ? `<div class="wide"><span class="label">Goal</span> ${Format.esc(a.goal)}</div>` : ''}
        </div>
        <form data-form="notes" data-id="${a.id}" class="notes">
          <input name="notes" class="input input-sm" placeholder="Your notes" value="${Format.esc(a.admin_notes ?? '')}"><button class="btn btn-soft btn-sm">Save note</button>
        </form>
        <div class="card-actions">${actions.join('')}</div>
      </div>`;
  }

  // ── batches ─────────────────────────────────────────────────────────

  #batches() {
    const statuses = ['planned', 'open', 'running', 'done'];
    const rows = this.#data.batches.map((b) => `
      <form data-form="batch" data-id="${b.id}" class="batch-row">
        <label>Name<input name="name" class="input" value="${Format.esc(b.name)}"></label>
        <label>Starts<input name="starts_on" type="date" class="input" value="${b.starts_on ?? ''}"></label>
        <label>Places<input name="capacity" type="number" min="1" class="input" value="${b.capacity}"></label>
        <label>Price ₹<input name="price" class="input" value="${Format.rupees(b.price_paise)}"></label>
        <label>Status<select name="status" class="input">${statuses.map((s) => `<option ${b.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <span class="muted small">${b.confirmed} confirmed · ${b.offered} offered</span>
        <button class="btn btn-sm">Save</button>
        <button type="button" data-action="open-tracker" data-id="${b.id}" class="btn btn-soft btn-sm">Tracker</button>
      </form>`).join('');
    return `
      <div class="panel">
        <h3>Batches</h3>
        ${rows || '<p class="muted">No batches yet.</p>'}
      </div>
      <div class="panel">
        <h3>New batch</h3>
        <form data-form="batch" class="batch-row">
          <label>Name<input name="name" class="input" required placeholder="e.g. Batch 1 · January"></label>
          <label>Starts<input name="starts_on" type="date" class="input"></label>
          <label>Places<input name="capacity" type="number" min="1" class="input" value="10"></label>
          <label>Price ₹<input name="price" class="input" value="5000"></label>
          <label>Status<select name="status" class="input">${statuses.map((s) => `<option>${s}</option>`).join('')}</select></label>
          <button class="btn btn-sm">Create batch</button>
        </form>
      </div>`;
  }

  // ── tracker ─────────────────────────────────────────────────────────

  #trackerHtml() {
    const options = this.#data.batches.map((b) => `<option value="${b.id}" ${b.id === this.#batchId ? 'selected' : ''}>${Format.esc(b.name)}</option>`).join('');
    const pick = `<form data-form="pick-batch" class="toolbar"><select name="batch" class="input">${options}</select><button class="btn btn-soft">Show</button></form>`;
    const batch = this.#data.batches.find((b) => b.id === this.#batchId);
    if (!batch) return `${pick}<p class="muted">${this.#data.batches.length ? 'Choose a batch.' : 'Create a batch first.'}</p>`;
    if (!batch.starts_on) return `${pick}<p class="muted">Give ${Format.esc(batch.name)} a start date first (Batches).</p>`;
    const people = this.#data.applications.filter((a) => a.batch_id === batch.id && (a.status === 'confirmed' || a.status === 'completed'));
    if (!people.length) return `${pick}<p class="muted">Nobody is confirmed in ${Format.esc(batch.name)} yet.</p>`;

    const days = Array.from({ length: 42 }, (_, i) => ProgrammeView.#shift(batch.starts_on, i));
    const ticks = new Map((this.#tracker?.days ?? []).map((d) => [`${d.applicationId}|${d.day}`, d.recorded]));
    const today = new Date().toISOString().slice(0, 10);
    const head = days.map((d, i) => `<th class="day ${i % 7 === 0 ? 'wk' : ''} ${d === today ? 'today' : ''}" title="${d}">${i % 7 === 0 ? `W${i / 7 + 1}<br>` : '<br>'}${Number(d.slice(8))}</th>`).join('');
    const rows = people.map((a) => {
      const cells = days.map((d, i) => {
        const v = ticks.get(`${a.id}|${d}`);
        const mark = v === true ? '✓' : v === false ? '✗' : '';
        const next = v === true ? 'false' : v === false ? 'null' : 'true';
        return `<td class="tick ${i % 7 === 0 ? 'wk' : ''} ${v === true ? 'yes' : v === false ? 'no' : ''}" data-action="tick" data-id="${a.id}" data-day="${d}" data-next="${next}">${mark}</td>`;
      }).join('');
      const weeks = Array.from({ length: 6 }, (_, w) => days.slice(w * 7, w * 7 + 7).filter((d) => ticks.get(`${a.id}|${d}`) === true).length);
      return `<tr><th class="who">${Format.esc(a.full_name)}<div class="sub">${weeks.map((n, w) => `W${w + 1} ${n}/7`).join(' · ')}</div></th>${cells}</tr>`;
    }).join('');

    const calls = people.map((a) => this.#calls(a)).join('');
    return `
      ${pick}
      <div class="panel">
        <h3>Did they record today? <span class="muted small">tap a day: ✓ yes → ✗ no → blank</span></h3>
        <div class="table-wrap"><table class="tracker"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
      </div>
      <div class="panel"><h3>Weekly calls</h3>${calls}</div>`;
  }

  #calls(a) {
    const mine = (this.#tracker?.calls ?? []).filter((c) => c.application_id === a.id);
    const list = mine.map((c) => `
      <div class="call">
        <span class="strong">Week ${c.week}</span> <span class="sub">${Format.date(c.held_on)}${c.days_recorded != null ? ` · ${c.days_recorded}/7 days` : ''}</span>
        ${c.win ? `<div><span class="label">Win</span> ${Format.esc(c.win)}</div>` : ''}
        ${c.miss ? `<div><span class="label">Miss</span> ${Format.esc(c.miss)}</div>` : ''}
        ${c.commitment ? `<div><span class="label">Commitment</span> ${Format.esc(c.commitment)}</div>` : ''}
        ${c.notes ? `<div><span class="label">Notes</span> ${Format.esc(c.notes)}</div>` : ''}
      </div>`).join('');
    const open = this.#callFor === a.id;
    const nextWeek = Math.min(6, mine.reduce((m, c) => Math.max(m, c.week), 0) + (mine.length ? 1 : 0));
    const form = open ? `
      <form data-form="call" data-id="${a.id}" class="form-grid call-form">
        <label>Week<select name="week" class="input">${[0, 1, 2, 3, 4, 5, 6].map((w) => `<option value="${w}" ${w === nextWeek ? 'selected' : ''}>${w === 0 ? 'Setup' : `Week ${w}`}</option>`).join('')}</select></label>
        <label>Date<input name="held_on" type="date" class="input" value="${new Date().toISOString().slice(0, 10)}"></label>
        <label>Days recorded (of 7)<input name="days_recorded" type="number" min="0" max="7" class="input"></label>
        <label class="wide">One win<input name="win" class="input"></label>
        <label class="wide">One miss<input name="miss" class="input"></label>
        <label class="wide">Their commitment, in their words<input name="commitment" class="input"></label>
        <label class="wide">Notes<input name="notes" class="input"></label>
        <div class="wide"><button class="btn btn-sm">Save call</button> <button type="button" data-action="call-close" class="btn btn-soft btn-sm">Cancel</button></div>
      </form>` : `<button data-action="call-open" data-id="${a.id}" class="btn btn-soft btn-sm">Add call notes</button>`;
    return `<div class="person"><div class="strong">${Format.esc(a.full_name)}</div>${list}${form}</div>`;
  }

  static #shift(iso, days) {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // ── actions ─────────────────────────────────────────────────────────

  async act(action, el, form) {
    const id = el.dataset.id ? Number(el.dataset.id) : null;
    switch (action) {
      case 'part':
        this.#part = el.dataset.part;
        if (this.#part === 'tracker') {
          this.#batchId ??= this.#data.batches.find((b) => b.status === 'running' || b.status === 'open')?.id ?? this.#data.batches[0]?.id ?? null;
          if (this.#batchId) this.#tracker = await this.api.tracker(this.#batchId);
        }
        return true;
      case 'filter': this.#filter = el.dataset.status; return true;
      case 'offer': {
        const batchId = Number(form.get('batch'));
        this.#data = await this.api.application(id, 'offer', { batchId });
        this.host.toast('Place offered. Send them the programme page link on WhatsApp to pay.');
        return true;
      }
      case 'app': {
        const what = el.dataset.do;
        const ask = { withdraw: 'Withdraw this application?', confirm: 'Mark as paid outside Razorpay and confirm the place?', complete: 'Mark as completed?' }[what];
        if (ask && !confirm(ask)) return false;
        this.#data = await this.api.application(id, what, {});
        this.host.toast('Saved');
        return true;
      }
      case 'notes':
        this.#data = await this.api.application(id, 'notes', { notes: AdminView.text(form, 'notes') });
        this.host.toast('Note saved');
        return true;
      case 'batch': {
        this.#data = await this.api.saveBatch({
          id: id ?? '', name: AdminView.text(form, 'name'), starts_on: AdminView.text(form, 'starts_on'),
          capacity: AdminView.text(form, 'capacity'), price_paise: Format.paise(AdminView.text(form, 'price')),
          status: AdminView.text(form, 'status'),
        });
        this.host.toast(id ? 'Batch saved' : 'Batch created');
        return true;
      }
      case 'open-tracker':
        this.#part = 'tracker';
        this.#batchId = id;
        this.#tracker = await this.api.tracker(id);
        return true;
      case 'pick-batch':
        this.#batchId = Number(form.get('batch'));
        this.#tracker = await this.api.tracker(this.#batchId);
        return true;
      case 'tick': {
        const next = el.dataset.next === 'null' ? null : el.dataset.next === 'true';
        await this.api.setDay(id, el.dataset.day, next);
        this.#tracker = await this.api.tracker(this.#batchId);
        return true;
      }
      case 'call-open': this.#callFor = id; return true;
      case 'call-close': this.#callFor = null; return true;
      case 'call':
        await this.api.saveCall({
          application_id: id, week: AdminView.text(form, 'week'), held_on: AdminView.text(form, 'held_on'),
          days_recorded: AdminView.text(form, 'days_recorded'), win: AdminView.text(form, 'win'), miss: AdminView.text(form, 'miss'),
          commitment: AdminView.text(form, 'commitment'), notes: AdminView.text(form, 'notes'),
        });
        this.#callFor = null;
        this.#tracker = await this.api.tracker(this.#batchId);
        this.host.toast('Call saved');
        return true;
      default:
        return false;
    }
  }
}
