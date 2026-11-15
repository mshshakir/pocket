/**
 * NotifyField — "Who gets the Telegram message?" for a delivery check-in or a
 * bill reminder:
 *   all    everyone with access (you, and family members who can add to the account)
 *   one    one person, chosen from you and your family members
 *   group  the Telegram family group tied to a shared space holding the account
 *   off    no messages
 * Each person must have linked Telegram (/link in the bot) to receive it.
 *
 * Renders form fields named `<prefix>To` and `<prefix>Email`.
 */
import { Html } from '../../core/Html.js';

export class NotifyField {
  static CHOICES = Object.freeze([
    ['all',   'Everyone'],
    ['one',   'One person'],
    ['group', 'Family group'],
    ['off',   'Nobody'],
  ]);

  /**
   * @param {{prefix: string, value?: string, email?: string|null, me?: string|null, family?: object[], label?: string}} o
   */
  static render({ prefix, value = 'all', email = null, me = null, family = [], label = 'Telegram message goes to' }) {
    const v = NotifyField.CHOICES.some(([k]) => k === value) ? value : 'all';
    const people = [
      ...(me ? [{ email: me, name: 'Me' }] : []),
      ...family.filter((f) => f?.email).map((f) => ({ email: String(f.email).toLowerCase(), name: f.name || f.email })),
    ].filter((p, i, all) => all.findIndex((q) => q.email === p.email) === i);
    const toggle = `this.form.querySelector('[data-notify-one=${prefix}]').hidden = this.value !== 'one'`;
    return `
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-xs text-zinc-500">${Html.escape(label)}</label>
          <select class="select" name="${prefix}To" onchange="${toggle}">
            ${NotifyField.CHOICES.map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <div data-notify-one="${prefix}" ${v === 'one' ? '' : 'hidden'}>
          <label class="text-xs text-zinc-500">Person</label>
          <select class="select" name="${prefix}Email">
            ${people.length ? people.map((p) => `<option value="${Html.escape(p.email)}" ${String(email || '').toLowerCase() === p.email ? 'selected' : ''}>${Html.escape(p.name)}</option>`).join('')
              : '<option value="">Add family members first</option>'}
          </select>
        </div>
      </div>`;
  }

  /**
   * Telegram settings for someone whose plan doesn't include Telegram: shown
   * greyed out (still saved as they are, so nothing chosen is lost) with a
   * note on how to get it.
   * @param {string} html  the settings
   */
  static gate(html) {
    const plan = window.__app?.getPlan?.();
    if (!plan || plan.can?.('telegram')) return html;
    return `
      <div class="tg-locked" aria-disabled="true">${html}</div>
      <div class="text-[11px] text-zinc-500 mt-1">
        <i data-lucide="lock" style="width:11px;height:11px;display:inline"></i>
        Telegram messages are part of the Sync and Family plans —
        <button type="button" class="underline" onclick="window.__app.closeModal();window.__app.openModal('settings')">see plans</button>.
      </div>`;
  }

  /** The two values from a form, tidy: { to, email }. */
  static read(fd, prefix) {
    const to = String(fd.get(`${prefix}To`) || 'all');
    const valid = NotifyField.CHOICES.some(([k]) => k === to) ? to : 'all';
    const email = valid === 'one' ? String(fd.get(`${prefix}Email`) || '').trim().toLowerCase() || null : null;
    return { to: valid === 'one' && !email ? 'all' : valid, email };
  }
}
