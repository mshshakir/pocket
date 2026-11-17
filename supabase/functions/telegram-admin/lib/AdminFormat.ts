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
    const b = (x: unknown) => `<b>${n(x)}</b>`;
    const when = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    const section = (title: string, lines: string[]) => [title, ...lines.filter(Boolean)].join('\n');

    const plans = Object.entries(s.plans ?? {}).sort((a, z) => Number(z[1]) - Number(a[1]))
      .map(([k, v]) => `${AdminFormat.#PLANS[k] ?? AdminFormat.esc(k)} ${b(v)}`);
    if (Number(s.plus)) plans.push(`Pocket Plus ${b(s.plus)}`);
    const auto = s.auto ?? { used: 0, limit: 0 };
    const stage = (k: string) => ({ waitlisted: 'Waitlist', offered: 'Offered', confirmed: 'Confirmed', completed: 'Completed', withdrawn: 'Withdrawn' } as Record<string, string>)[k] ?? AdminFormat.esc(k);
    const prog = Object.entries(s.programme ?? {}).filter(([, v]) => Number(v)).map(([k, v]) => `${stage(k)} ${b(v)}`);
    const reply = speed && Number(speed.count24)
      ? `Avg reply <b>${speed.avg24} s</b> · 90% under ${speed.p90_24} s\n<i>${n(speed.count24)} messages in the last 24 h</i>`
      : speed && Number(speed.count3d) ? `Avg reply <b>${speed.avg3d} s</b>\n<i>${n(speed.count3d)} messages in the last 3 days</i>`
      : '<i>No messages in the last 3 days</i>';
    const waiting = [Number(s.freeWaiting) ? `${b(s.freeWaiting)} free request${Number(s.freeWaiting) === 1 ? '' : 's'} · /requests` : '',
                     Number(s.feedbackNew) ? `${b(s.feedbackNew)} feedback` : ''].filter(Boolean);

    return [
      `📊 <b>Pocket</b> · ${AdminFormat.esc(when)}`,
      section('👥 <b>People</b>', [
        `Total ${b(s.users)}`,
        `New: +${n(s.newToday)} today · +${n(s.new7)} this week · +${n(s.new30)} in 30 days`,
        `Last 7 days: ${b(s.active7)} signed in · ${b(s.recorded7)} recorded`,
      ]),
      section('💳 <b>Plans</b>', [
        plans.length ? plans.join(' · ') : '<i>No paid plans yet</i>',
        Number(s.expiring7) ? `⚠️ ${b(s.expiring7)} ending in the next 7 days` : '',
      ]),
      section('💰 <b>Money</b>', [
        `Today ${'<b>' + AdminFormat.money(Number(s.todayInr), Number(s.todayUsd)) + '</b>'} · ${n(s.paymentsToday)} payment${Number(s.paymentsToday) === 1 ? '' : 's'}`,
        `This month <b>${AdminFormat.money(Number(s.monthInr), Number(s.monthUsd))}</b>`,
      ]),
      section('🆓 <b>Free use</b>', [
        `${b(s.freeApproved)} approved · automatic ${n(auto.used)} of ${n(auto.limit)} used`,
      ]),
      section('🤖 <b>Pocket bot</b>', [
        `${b(s.telegram)} people linked`,
        reply,
        speed && Number(speed.failed3d) ? `⚠️ <b>${n(speed.failed3d)}</b> message${Number(speed.failed3d) === 1 ? '' : 's'} not handled (3 days)` : '',
        `AI uses: ${b(s.aiUses30)} in 30 days`,
      ]),
      prog.length ? section('🌱 <b>Programme</b>', [prog.join(' · ')]) : '',
      waiting.length ? section('⏳ <b>Needs you</b>', waiting) : '✅ <b>Nothing waiting for you</b>',
    ].filter(Boolean).join('\n\n');
  }

  static request(r: FreeRequest): string {
    return `🆓 <b>Free request waiting</b>\n${AdminFormat.esc(r.name)} · ${AdminFormat.esc(r.email)}\n<i>“${AdminFormat.esc(String(r.reason).slice(0, 600))}”</i>`;
  }

  /** One alert, and its buttons if it needs a decision. */
  static event(e: AdminEvent): { html: string; buttons: { text: string; callback_data: string }[][] | null } {
    const p = e.payload as Record<string, any>;
    switch (e.kind) {
      case 'payment': {
        const amount = p.currency === 'USD' && Number.isInteger(p.chargedMinor) ? AdminFormat.usd(p.chargedMinor) : AdminFormat.inr(Number(p.amountPaise ?? 0));
        return { html: `💳 <b>${amount}</b> · ${AdminFormat.esc(AdminFormat.product(String(p.product)))}\n${AdminFormat.esc(p.email ?? '')}${p.coupon ? ` · code <code>${AdminFormat.esc(p.coupon)}</code>` : ''}`, buttons: null };
      }
      case 'free_request':
        if (p.status === 'pending') {
          return { html: AdminFormat.request({ id: p.id, name: p.name, email: p.email, reason: p.reason, at: e.at }), buttons: AdminFormat.requestButtons(Number(p.id)) };
        }
        return { html: `🆓 <b>Free use ${p.auto ? 'approved automatically' : AdminFormat.esc(p.status)}</b>\n${AdminFormat.esc(p.name)} · ${AdminFormat.esc(p.email)}\n<i>“${AdminFormat.esc(String(p.reason ?? '').slice(0, 600))}”</i>`, buttons: null };
      case 'programme':
        return { html: `🌱 <b>Programme application</b> · ${AdminFormat.esc(p.status)}\n${AdminFormat.esc(p.name)} · ${AdminFormat.esc(p.email)}`, buttons: null };
      case 'feedback':
        return { html: `💬 <b>Feedback</b>${p.kind ? ` · ${AdminFormat.esc(p.kind)}` : ''}\n${AdminFormat.esc(p.email ?? '')}\n<i>${AdminFormat.esc(p.message ?? '')}</i>`, buttons: null };
      default:
        return { html: `• ${AdminFormat.esc(e.kind)}`, buttons: null };
    }
  }

  static requestButtons(id: number) {
    return [[{ text: '✅ Approve for 6 months', callback_data: `fr:a:${id}` }, { text: 'Decline', callback_data: `fr:d:${id}` }]];
  }

  static help(): string {
    return [
      '🛠 <b>Pocket admin</b>',
      '',
      '/stats · people, plans, money, bot speed',
      '/requests · free requests waiting',
      '/auto · automatic approvals',
      '    <code>/auto 80</code> sets the limit',
      '    <code>/auto reset</code> starts the count again',
      '',
      '<i>Alerts arrive here by themselves: payments, free requests, programme applications and feedback, plus a summary at 9:30 pm.</i>',
    ].join('\n');
  }
}
