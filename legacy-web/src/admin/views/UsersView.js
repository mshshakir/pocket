/**
 * UsersView — everyone who has signed up: plan, AI credits, Telegram, family,
 * last activity and what they've paid; and changing a person's plan or credits.
 * It never shows what anyone has recorded.
 */
import { AdminView } from './AdminView.js';
import { Format } from '../Format.js';

export class UsersView extends AdminView {
  #users = [];
  #search = '';
  #open = null;   // the email whose actions are shown
  #plans = ['sync', 'family'];

  get title() { return 'Users'; }

  async load() {
    this.#users = await this.api.users(this.#search, 500, 0);
  }

  html() {
    const rows = this.#users.map((u) => this.#row(u)).join('');
    return `
      <form data-form="search" class="toolbar">
        <input name="q" class="input" placeholder="Search by email or name" value="${Format.esc(this.#search)}">
        <button class="btn">Search</button>
        <button type="button" data-action="csv" class="btn btn-soft">Download CSV</button>
        <span class="muted">${this.#users.length} shown</span>
      </form>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Person</th><th>Signed up</th><th>Plan</th><th>AI</th><th>Telegram</th><th>Family</th><th>Last entry</th><th class="num">Paid</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="9" class="muted">No one found.</td></tr>'}</tbody>
      </table></div>`;
  }

  #row(u) {
    const tone = { active: 'good', grace: 'warn', lapsed: 'bad', free: 'quiet' }[u.state] ?? 'quiet';
    const plan = u.state === 'free' ? Format.pill('Free') : Format.pill(`${u.plan} · ${u.term === 'lifetime' ? 'for life' : u.state}`, tone);
    const ends = u.endsAt && u.term !== 'lifetime' ? `<div class="sub">until ${Format.date(u.endsAt)}</div>` : '';
    const open = this.#open === u.email;
    return `
      <tr class="${open ? 'row-open' : ''}">
        <td><div class="strong">${Format.esc(u.name || u.email)}</div><div class="sub">${Format.esc(u.email)}</div></td>
        <td>${Format.date(u.signedUp)}<div class="sub">seen ${Format.ago(u.lastSignIn)}</div></td>
        <td>${plan}${ends}</td>
        <td>${u.aiUnlimited ? 'Unlimited' : Format.number(u.aiCredits)}</td>
        <td>${u.telegram ? '✓' : ''}</td>
        <td>${u.family ? u.family : ''}</td>
        <td>${Format.ago(u.lastEntry)}</td>
        <td class="num">${u.paidPaise ? Format.inr(u.paidPaise) : ''}</td>
        <td><button data-action="toggle" data-email="${Format.esc(u.email)}" class="btn btn-soft btn-sm">${open ? 'Close' : 'Manage'}</button></td>
      </tr>
      ${open ? `<tr class="row-panel"><td colspan="9">${this.#manage(u)}</td></tr>` : ''}`;
  }

  #manage(u) {
    const email = Format.esc(u.email);
    const planOpts = this.#plans.map((p) => `<option value="${p}" ${u.plan === p ? 'selected' : ''}>${p}</option>`).join('');
    return `
      <div class="manage">
        <form data-form="set_plan" data-email="${email}" class="mini">
          <div class="mini-title">Give a plan</div>
          <select name="plan" class="input">${planOpts}</select>
          <select name="term" class="input"><option value="month">1 month</option><option value="year">1 year</option><option value="trial">Trial</option><option value="lifetime">For life</option></select>
          <input name="endsAt" type="date" class="input" title="End date (optional; otherwise from the term)">
          <input name="note" class="input" placeholder="Note (why)">
          <button class="btn">Give plan</button>
        </form>
        <form data-form="grant_ai" data-email="${email}" class="mini">
          <div class="mini-title">AI credits</div>
          <input name="credits" type="number" class="input" placeholder="e.g. 500, or -100" required>
          <input name="note" class="input" placeholder="Note">
          <button class="btn">Add credits</button>
        </form>
        <div class="mini">
          <div class="mini-title">Other</div>
          <button data-action="ai_unlimited" data-email="${email}" data-on="${!u.aiUnlimited}" class="btn btn-soft" ${u.state === 'free' && !u.term ? 'disabled title="Give a plan first"' : ''}>${u.aiUnlimited ? 'Turn off unlimited AI' : 'Unlimited AI'}</button>
          ${u.state === 'active' ? `<button data-action="end_plan" data-email="${email}" class="btn btn-danger">End plan now</button>` : ''}
          ${u.note ? `<div class="sub">Note: ${Format.esc(u.note)}</div>` : ''}
        </div>
      </div>`;
  }

  async act(action, el, form) {
    const email = el.dataset.email;
    switch (action) {
      case 'search':
        this.#search = AdminView.text(form, 'q');
        await this.load();
        return true;
      case 'toggle':
        this.#open = this.#open === email ? null : email;
        return true;
      case 'csv':
        Format.downloadCsv(`pocket-users-${new Date().toISOString().slice(0, 10)}.csv`,
          ['email', 'name', 'signed_up', 'last_sign_in', 'plan', 'term', 'state', 'ends', 'ai', 'telegram', 'family', 'last_entry', 'paid_inr'],
          this.#users.map((u) => [u.email, u.name, u.signedUp, u.lastSignIn, u.plan, u.term, u.state, u.endsAt,
            u.aiUnlimited ? 'unlimited' : u.aiCredits, u.telegram ? 'yes' : '', u.family, u.lastEntry, u.paidPaise / 100]));
        return false;
      case 'set_plan': {
        const args = { plan: AdminView.text(form, 'plan'), term: AdminView.text(form, 'term'), note: AdminView.text(form, 'note') };
        const ends = AdminView.text(form, 'endsAt');
        if (ends) args.endsAt = `${ends}T23:59:59+05:30`;
        if (!confirm(`Give ${email} ${args.plan} (${args.term})?`)) return false;
        await this.api.userAction(email, 'set_plan', args);
        this.host.toast(`${email}: ${args.plan} given`);
        break;
      }
      case 'grant_ai': {
        const credits = Number(AdminView.text(form, 'credits'));
        if (!Number.isInteger(credits) || !credits) throw new Error('Enter a whole number of credits');
        await this.api.userAction(email, 'grant_ai', { credits, note: AdminView.text(form, 'note') });
        this.host.toast(`${email}: ${credits > 0 ? '+' : ''}${credits} AI credits`);
        break;
      }
      case 'ai_unlimited':
        await this.api.userAction(email, 'ai_unlimited', { on: el.dataset.on === 'true' });
        this.host.toast(`${email}: unlimited AI ${el.dataset.on === 'true' ? 'on' : 'off'}`);
        break;
      case 'end_plan':
        if (!confirm(`End ${email}'s plan now? They get the read-only period, then Free.`)) return false;
        await this.api.userAction(email, 'end_plan', { note: 'Ended in admin' });
        this.host.toast(`${email}: plan ended`);
        break;
      default:
        return false;
    }
    await this.load();
    return true;
  }
}
