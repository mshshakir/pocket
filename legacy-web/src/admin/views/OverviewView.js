/** OverviewView — the numbers at a glance: people, plans, money, programme. */
import { AdminView } from './AdminView.js';
import { BarChart } from '../BarChart.js';
import { Format } from '../Format.js';

export class OverviewView extends AdminView {
  #s = null;

  get title() { return 'Overview'; }

  async load() { this.#s = await this.api.stats(); }

  html() {
    const s = this.#s;
    if (!s) return '<p class="muted">Loading…</p>';
    const plans = s.plans ?? {};
    const paying = Object.entries(plans).filter(([k]) => k.endsWith(':active')).reduce((n, [, v]) => n + v, 0);
    const prog = s.programme ?? {};
    const tile = (label, value, note = '') => `
      <div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div>${note ? `<div class="tile-note">${note}</div>` : ''}</div>`;
    // Dates come as 'YYYY-MM-DD'; read them as calendar days, not as UTC instants.
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = (iso) => MONTHS.at(Number(String(iso).slice(5, 7)) - 1);
    const weeks = (s.signupsByWeek ?? []).map((w) => ({ label: `${Number(String(w.week).slice(8, 10))} ${month(w.week)}`, value: w.count }));
    const months = (s.revenueByMonth ?? []).map((m) => ({ label: month(m.month), value: m.paise }));
    const planRows = Object.entries(plans).sort((a, b) => b[1] - a[1])
      .map(([k, n]) => { const [plan, state = ''] = k.split(':'); return `<tr><td>${Format.esc(plan)}</td><td>${Format.esc(state || '—')}</td><td class="num">${n}</td></tr>`; }).join('');
    return `
      ${s.paymentsOpen ? '' : '<div class="notice">Online payment is <b>off</b>. Turn it on in Pricing → Settings once Razorpay is set up.</div>'}
      <h2 class="section">People</h2>
      <div class="tiles">
        ${tile('Signed up', Format.number(s.users), `${s.new7} this week · ${s.new30} in 30 days`)}
        ${tile('Signed in, last 7 days', Format.number(s.active7))}
        ${tile('Recorded something, last 7 days', Format.number(s.loggedEntries7), 'people with cloud entries')}
        ${tile('Telegram linked', Format.number(s.telegramLinked), `${s.groups} family groups`)}
      </div>
      <h2 class="section">Plans and money</h2>
      <div class="tiles">
        ${tile('On a paid plan', Format.number(paying), `${s.lifetime} for life · ${s.trials} on trial`)}
        ${tile('Ending in 7 days', Format.number(s.expiring7))}
        ${tile('Revenue, 30 days', Format.inr(s.revenue30), `${Format.inr(s.revenueTotal)} in all`)}
        ${tile('AI uses, 30 days', Format.number(s.aiUses30))}
      </div>
      <h2 class="section">Habit programme</h2>
      <div class="tiles">
        ${tile('Waitlist', Format.number(prog.waitlisted ?? 0))}
        ${tile('Offered, not paid', Format.number(prog.offered ?? 0))}
        ${tile('Confirmed', Format.number(prog.confirmed ?? 0))}
        ${tile('Completed', Format.number(prog.completed ?? 0))}
      </div>
      <div class="grid2">
        <div class="panel"><h3>Sign-ups per week</h3>${BarChart.svg(weeks, { title: 'Sign-ups per week' })}</div>
        <div class="panel"><h3>Revenue per month</h3>${BarChart.svg(months, { title: 'Revenue per month', format: (v) => Format.inr(v) })}</div>
      </div>
      <div class="panel"><h3>Everyone by plan</h3>
        <table class="table"><thead><tr><th>Plan</th><th>State</th><th class="num">People</th></tr></thead><tbody>${planRows}</tbody></table>
      </div>`;
  }
}
