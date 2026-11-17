/**
 * AdminFormat — the admin bot's messages (Telegram HTML). Only account,
 * plan, payment and request details: never anything from a person's book.
 */
import type { AdminEvent, FreeRequest } from './AdminStore.ts';

export class AdminFormat {
  static readonly #PLANS: Record<string, string> = {
    family: 'Pocket Pro', group: 'Pocket Pro Group', promise: 'Promise', family_trial: '3-month offer',
    sync: 'Sync', sync_trial: 'Sync trial', lifetime: 'Lifetime',
  };
  static readonly #PRODUCTS: Record<string, string> = {
    family_month: 'Pocket Pro · 1 month', family_year: 'Pocket Pro · 1 year', family_trial: 'Pocket Pro · 3-month offer',
    group_year: 'Pocket Pro Group · 1 year', drive_backup: 'Pocket Plus', ai_pack: 'AI pack', promise_month: 'Promise · 1 month',
    programme: 'Habit programme (in full)', programme_half: 'Habit programme (first half)', programme_rest: 'Habit programme (second half)',
    sync_month: 'Sync · 1 month', sync_year: 'Sync · 1 year',
  };

  static esc(s: unknown): string {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  static inr(paise: number): string {
    return (paise / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: paise % 100 ? 2 : 0 });
  }

  static usd(cents: number): string {
    return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }

  /** "₹1,149 + $24.99", "₹0" */
  static money(paise: number, cents: number): string {
    return cents ? `${AdminFormat.inr(paise)} + ${AdminFormat.usd(cents)}` : AdminFormat.inr(paise);
  }

  static product(code: string): string {
    return AdminFormat.#PRODUCTS[code] ?? code;
  }

  static stats(s: Record<string, any>, speed: Record<string, any> | null, now = new Date()): string {
    const n = (x: unknown) => Number(x ?? 0).toLocaleString('en-IN');
    const when = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    const plans = Object.entries(s.plans ?? {}).sort((a, b) => Number(b[1]) - Number(a[1]))
      .map(([k, v]) => `${AdminFormat.#PLANS[k] ?? AdminFormat.esc(k)} ${n(v)}`);
    if (Number(s.plus)) plans.push(`Pocket Plus ${n(s.plus)}`);
    const prog = Object.entries(s.programme ?? {}).map(([k, v]) => `${AdminFormat.esc(k)} ${n(v)}`).join(' · ');
    const auto = s.auto ?? { used: 0, limit: 0 };
    const reply = speed && Number(speed.count24)
      ? `${speed.avg24} s average (90% within ${speed.p90_24} s) over ${n(speed.count24)} messages in 24 h`
      : speed && Number(speed.count3d) ? `${speed.avg3d} s average over ${n(speed.count3d)} messages in 3 days`
      : 'no messages in the last 3 days';
    const failed = speed && Number(speed.failed3d) ? ` · <b>${n(speed.failed3d)} not handled</b>` : '';
    return [
      `<b>📊 Pocket</b> · ${AdminFormat.esc(when)}`,
      '',
      `<b>Users</b> ${n(s.users)} · today +${n(s.newToday)} · 7 days +${n(s.new7)} · 30 days +${n(s.new30)}`,
      `<b>Active</b> ${n(s.active7)} signed in, ${n(s.recorded7)} recorded (7 days)`,
      `<b>Plans</b> ${plans.length ? plans.join(' · ') : 'none yet'}`,
      `<b>Ending in 7 days</b> ${n(s.expiring7)}`,
      `<b>Free use</b> ${n(s.freeApproved)} approved · ${n(s.freeWaiting)} waiting · automatic ${n(auto.used)} of ${n(auto.limit)}`,
      '',
      `<b>Money today</b> ${AdminFormat.money(Number(s.todayInr), Number(s.todayUsd))} (${n(s.paymentsToday)} payments)`,
      `<b>This month</b> ${AdminFormat.money(Number(s.monthInr), Number(s.monthUsd))}`,
      '',
      `<b>Pocket bot</b> ${n(s.telegram)} linked · replies ${reply}${failed}`,
      `<b>AI uses</b> ${n(s.aiUses30)} (30 days)`,
      prog ? `<b>Programme</b> ${prog}` : '',
      '',
      `<b>Waiting for you</b> ${n(s.freeWaiting)} free requests · ${n(s.feedbackNew)} feedback`,
    ].filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== '')).join('\n').trim();
  }

  static request(r: FreeRequest): string {
    return `🆓 <b>Free request waiting</b> · ${AdminFormat.esc(r.name)} (${AdminFormat.esc(r.email)})\n“${AdminFormat.esc(String(r.reason).slice(0, 600))}”`;
  }

  /** One alert, and its buttons if it needs a decision. */
  static event(e: AdminEvent): { html: string; buttons: { text: string; callback_data: string }[][] | null } {
    const p = e.payload as Record<string, any>;
    switch (e.kind) {
      case 'payment': {
        const amount = p.currency === 'USD' && Number.isInteger(p.chargedMinor) ? AdminFormat.usd(p.chargedMinor) : AdminFormat.inr(Number(p.amountPaise ?? 0));
        return { html: `💳 <b>Payment</b> · ${amount} · ${AdminFormat.esc(AdminFormat.product(String(p.product)))}${p.coupon ? ` · code ${AdminFormat.esc(p.coupon)}` : ''}\n${AdminFormat.esc(p.email ?? '')}`, buttons: null };
      }
      case 'free_request':
        if (p.status === 'pending') {
          return { html: AdminFormat.request({ id: p.id, name: p.name, email: p.email, reason: p.reason, at: e.at }), buttons: AdminFormat.requestButtons(Number(p.id)) };
        }
        return { html: `🆓 <b>Free use ${p.auto ? 'approved automatically' : AdminFormat.esc(p.status)}</b> · ${AdminFormat.esc(p.name)} (${AdminFormat.esc(p.email)})\n“${AdminFormat.esc(String(p.reason ?? '').slice(0, 600))}”`, buttons: null };
      case 'programme':
        return { html: `🌱 <b>Programme application</b> · ${AdminFormat.esc(p.name)} (${AdminFormat.esc(p.email)}) · ${AdminFormat.esc(p.status)}`, buttons: null };
      case 'feedback':
        return { html: `💬 <b>Feedback</b>${p.kind ? ` (${AdminFormat.esc(p.kind)})` : ''} · ${AdminFormat.esc(p.email ?? '')}\n${AdminFormat.esc(p.message ?? '')}`, buttons: null };
      default:
        return { html: `• ${AdminFormat.esc(e.kind)}`, buttons: null };
    }
  }

  static requestButtons(id: number) {
    return [[{ text: '✅ Approve for 6 months', callback_data: `fr:a:${id}` }, { text: 'Decline', callback_data: `fr:d:${id}` }]];
  }

  static help(): string {
    return [
      '<b>Pocket admin</b>',
      '/stats — users, plans, money, bot reply time',
      '/requests — free requests waiting, with Approve / Decline',
      '/auto — automatic approvals: /auto 80 sets the limit, /auto reset starts the count again',
      '',
      'Alerts come here by themselves: payments, free requests, programme applications and feedback, and a summary every evening.',
    ].join('\n');
  }
}
