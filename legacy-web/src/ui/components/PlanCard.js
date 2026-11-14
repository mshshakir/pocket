/**
 * PlanCard — "Your plan" in Settings: what the person has, what it covers,
 * their AI allowance, the way to download their data, and the plans on offer.
 *
 * Purely a renderer: it is given the Entitlements and the price list and
 * returns HTML. Online payment comes in a later phase; until then the card
 * lists the options and says so.
 */
import { Html } from '../../core/Html.js';

export class PlanCard {
  /**
   * @param {import('../../domain/billing/Entitlements.js').Entitlements} plan
   * @param {object[]|null} catalogue  rows of the plans table, or null while loading
   */
  html(plan, catalogue) {
    return `
      <div class="card-muted p-3 mb-3" id="planCard">
        <div class="flex items-center justify-between gap-2 mb-1">
          <div class="text-sm font-medium">Your plan</div>
          <span class="chip ${this.#chipClass(plan)}">${Html.escape(this.#title(plan))}</span>
        </div>
        <div class="text-xs text-zinc-500 leading-relaxed">${this.#status(plan)}</div>
        ${this.#details(plan)}
        <div class="grid grid-cols-1 gap-2 mt-3">
          <button class="btn ${plan.state === 'grace' ? 'btn-primary' : 'btn-outline'} justify-center" onclick="window.__app.downloadMyData()">
            <i data-lucide="download"></i> Download my data
          </button>
        </div>
        ${this.#offers(plan, catalogue)}
      </div>`;
  }

  #title(plan) {
    if (plan.isLifetime) return `${plan.planName} · for life`;
    if (plan.state === 'grace') return `${plan.planName} · ended`;
    if (plan.state === 'lapsed') return 'Free · plan ended';
    return plan.planName;
  }

  #chipClass(plan) {
    if (plan.state === 'grace') return 'plan-chip-warn';
    return plan.isPaid ? 'plan-chip-paid' : '';
  }

  #status(plan) {
    const day = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    switch (plan.state) {
      case 'active':
        if (plan.isLifetime) return 'Everything in your plan is included, with no end date.';
        if (plan.term === 'trial') return `Trial until ${day(plan.endsAt)}.`;
        return plan.endsAt ? `${plan.toJSON().autoRenew ? 'Renews' : 'Active until'} ${day(plan.endsAt)}.` : 'Active.';
      case 'grace':
        return `Ended ${plan.endsAt ? `on ${day(plan.endsAt)}` : ''}. Your cloud copy is read-only until `
          + `<strong>${day(plan.graceUntil)}</strong>. Please download your data before then.`;
      case 'lapsed':
        return 'Pocket keeps working on this device, with every export. Cloud sync and Telegram are paused; '
          + 'your cloud copy is kept and comes back when you renew.';
      default:
        return 'Pocket works fully on this device, with every export. Cloud sync, Telegram and sharing with '
          + 'family come with Sync and Family.';
    }
  }

  #details(plan) {
    const rows = [];
    if (plan.can('sharing') || plan.isReadOnly && plan.canSee('sharing')) {
      rows.push(['People', `${plan.seatsUsed} of ${plan.seats}, you included`]);
    }
    for (const c of plan.coveredBy) {
      rows.push(['Shared space', `${Html.escape(c.ownerEmail)}'s Family plan${c.access === 'read' ? ' (ended, read-only)' : ''}`]);
    }
    rows.push(['AI scans & voice', this.#ai(plan)]);
    return `
      <div class="mt-2 divide-y divide-zinc-200/70 dark:divide-zinc-800 text-xs">
        ${rows.map(([k, v]) => `
          <div class="flex justify-between gap-3 py-1.5">
            <span class="text-zinc-500">${k}</span><span class="text-right">${v}</span>
          </div>`).join('')}
      </div>`;
  }

  #ai(plan) {
    if (plan.aiUnlimited) return 'Unlimited';
    const own = plan.aiCredits;
    const pools = plan.coveredBy.filter((c) => c.access === 'write' && (c.aiUnlimited || c.aiCredits > 0));
    const parts = [`${own.toLocaleString()} credit${own === 1 ? '' : 's'}${plan.can('sharing') ? ' (family pool)' : ''}`];
    for (const c of pools) parts.push(`${c.aiUnlimited ? 'unlimited' : c.aiCredits.toLocaleString()} in ${Html.escape(c.ownerEmail)}'s space`);
    return parts.join(' · ');
  }

  #offers(plan, catalogue) {
    if (plan.isLifetime) return '';
    if (catalogue === null) return '<div class="text-xs text-zinc-400 mt-3">Loading plans…</div>';
    const paid = catalogue.filter((p) => p.code !== 'free');
    if (!paid.length) return '';
    const inr = (paise) => (paise / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: paise % 100 ? 2 : 0 });
    const what = (p) => [p.sync && 'cloud sync', p.telegram && 'Telegram', p.sharing && `sharing with up to ${p.seats - 1} family members`]
      .filter(Boolean).join(', ');
    return `
      <div class="mt-3 text-xs">
        <div class="field-label">Plans</div>
        ${paid.map((p) => `
          <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 p-2.5 mb-2 ${plan.plan === p.code && plan.state === 'active' ? 'plan-current' : ''}">
            <div class="flex items-baseline justify-between gap-2">
              <span class="font-semibold text-sm">${Html.escape(p.name)}</span>
              <span class="tx-amount">${p.monthly_paise != null ? `${inr(p.monthly_paise)}/month` : ''}${p.yearly_paise != null ? ` · ${inr(p.yearly_paise)}/year` : ''}</span>
            </div>
            <div class="text-zinc-500 mt-0.5">${Html.escape(what(p))}.</div>
            ${p.trial_paise != null && plan.trialAvailable ? `<div class="text-zinc-500 mt-0.5">Try it: ${inr(p.trial_paise)} for ${p.trial_days} days.</div>` : ''}
          </div>`).join('')}
        <div class="text-zinc-400">Online payment is coming soon.</div>
      </div>`;
  }
}
