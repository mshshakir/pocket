/**
 * PlanCard — "Your plan" in Settings: what the person has, what it covers,
 * their AI allowance, the way to download their data, and the plans on offer.
 *
 * Purely a renderer: it is given the Entitlements, the price list and (when
 * online payment is open) what's for sale, and returns HTML. Buy buttons call
 * window.__app.buy(product); while payment is off the card lists the plans
 * and says payment is coming.
 */
import { Html } from '../../core/Html.js';

export class PlanCard {
  /**
   * @param {import('../../domain/billing/Entitlements.js').Entitlements} plan
   * @param {object[]|null} catalogue  rows of the plans table, or null while loading
   * @param {{products: object[]}|null} [offers]  from the payments function, or null while loading / off
   * @param {string|null} [buying]  the product being paid for right now
   * @param {string} [coupon]  the code typed so far
   * @param {{term?: 'month'|'year', couponOpen?: boolean, highlight?: string|null}} [ui]
   *   the Monthly/Yearly choice, whether the code box is open, a plan to point out
   */
  html(plan, catalogue, offers = null, buying = null, coupon = '', ui = {}) {
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
        ${this.#offers(plan, catalogue, offers, buying, coupon, ui)}
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

  /**
   * The plans on offer: a Monthly / Yearly switch, then one card per plan with
   * its price for that term, what it includes, and one button. The trial is a
   * small link on the plan that has one. Without online payment the cards
   * still show prices, and say payment is coming.
   */
  #offers(plan, catalogue, offers, buying, coupon, ui) {
    if (plan.isLifetime) return '';
    if (catalogue === null) return '<div class="text-xs text-zinc-400 mt-3">Loading plans…</div>';
    const paid = catalogue.filter((p) => p.code !== 'free' && (p.monthly_paise != null || p.yearly_paise != null));
    if (!paid.length) return '';
    const selling = !!(plan.paymentsOpen && offers);
    const term = ui.term === 'month' ? 'month' : 'year';
    const save = Math.max(0, ...paid.map((p) => PlanCard.#saving(p)));
    const tab = (t, label) => `<button class="plan-term ${term === t ? 'on' : ''}" onclick="window.__app.setPlanTerm('${t}')">${label}</button>`;
    const switching = plan.state === 'active' && plan.isPaid && plan.term !== 'trial';
    return `
      <div class="mt-4">
        <div class="flex items-center justify-between gap-2 mb-2">
          <div class="text-sm font-medium">${plan.isPaid && plan.state === 'active' ? 'Plans' : 'Choose a plan'}</div>
          <div class="plan-terms">${tab('month', 'Monthly')}${tab('year', `Yearly${save ? ` <span class="plan-save">save ${save}%</span>` : ''}`)}</div>
        </div>
        ${paid.map((p) => this.#planBox(p, plan, term, selling ? offers : null, buying, ui.highlight)).join('')}
        ${this.#aiPack(plan, selling ? offers : null, buying)}
        ${selling ? this.#couponField(coupon, ui.couponOpen) : ''}
        <div class="text-[11px] text-zinc-400 leading-relaxed mt-2">${selling
          ? `One-time payment through Razorpay (UPI, cards, net banking). Nothing renews by itself, and payments aren\'t refundable (<a href="refunds.html" target="_blank" class="underline">policy</a>). Paying again for your plan adds to its end date.${switching ? ' Switching plans starts the new one today; time left on the old one isn\'t carried over.' : ''}`
          : 'Online payment is coming soon.'}</div>
      </div>`;
  }

  /** One plan: name, price for the chosen term, what it includes, one button, and the trial link. */
  #planBox(p, plan, term, offers, buying, highlight) {
    const current = plan.plan === p.code && plan.state === 'active' && plan.term !== 'trial';
    const product = offers?.products.find((o) => o.plan === p.code && o.term === term);
    const listPaise = term === 'month' ? p.monthly_paise : p.yearly_paise;
    const price = product ? PlanCard.#price(product) : listPaise != null ? PlanCard.#inr(listPaise) : null;
    const perMonth = term === 'year' && listPaise != null ? PlanCard.#inr(Math.round((product?.amountPaise ?? listPaise) / 1200) * 100) : null;
    const save = term === 'year' ? PlanCard.#saving(p) : 0;
    const features = [
      p.sync && 'Cloud sync on all your devices',
      p.telegram && 'Log by Telegram, voice or receipt scan',
      p.sharing && `Share with up to ${p.seats - 1} family members`,
      p.sharing && 'Daily, monthly and yearly family summaries',
    ].filter(Boolean);
    const verb = current ? `Add 1 ${term}` : plan.isPaid && plan.state === 'active' && plan.term !== 'trial' ? `Switch to ${Html.escape(p.name)}` : `Get ${Html.escape(p.name)}`;
    const button = !offers ? ''
      : !product ? `<div class="text-xs text-zinc-400 mt-3">Not sold ${term === 'month' ? 'monthly' : 'yearly'}.</div>`
      : !product.available && product.reason === 'lifetime' ? ''
      : this.#button(product, `${verb} · ${PlanCard.#inr(product.amountPaise)}`, buying, true, 'w-full justify-center mt-3');
    const trial = this.#trialLink(p, plan, offers, buying);
    const popular = p.sharing && !current;
    return `
      <div class="plan-box ${current ? 'plan-current' : ''} ${highlight === p.code ? 'plan-highlight' : ''}" id="plan-${Html.escape(p.code)}">
        <div class="flex items-start justify-between gap-2">
          <div>
            <div class="font-semibold flex items-center gap-2 flex-wrap">${Html.escape(p.name)}
              ${current ? '<span class="plan-tag plan-tag-current">Your plan</span>' : popular ? '<span class="plan-tag">Best for families</span>' : ''}</div>
            ${save ? `<div class="plan-save mt-1 inline-block">save ${save}% vs monthly</div>` : ''}
          </div>
          <div class="text-right">
            ${price ? `<div class="plan-price">${price}<span class="plan-per">/${term}</span></div>` : '<div class="text-xs text-zinc-400">—</div>'}
            ${perMonth ? `<div class="text-[11px] text-zinc-500">about ${perMonth} a month</div>` : ''}
          </div>
        </div>
        <ul class="plan-features">${features.map((f) => `<li><i data-lucide="check"></i>${Html.escape(f)}</li>`).join('')}</ul>
        ${button}
        ${trial}
      </div>`;
  }

  /** "or try it for 14 days for ₹50" — a link while buying is open, plain text otherwise. */
  #trialLink(p, plan, offers, buying) {
    if (p.trial_paise == null || !p.trial_days || !plan.trialAvailable) return '';
    if (plan.state === 'active' && plan.isPaid) return '';
    const product = offers?.products.find((o) => o.plan === p.code && o.term === 'trial');
    if (offers && (!product || !product.available)) return '';
    const text = `or try it for ${p.trial_days} days for ${product ? PlanCard.#price(product) : PlanCard.#inr(p.trial_paise)}`;
    if (!product) return `<div class="text-xs text-zinc-500 mt-2 text-center">${text}</div>`;
    return `<div class="mt-2 text-center"><button class="plan-trial" ${buying ? 'disabled' : ''} onclick="window.__app.buy('${Html.escape(product.product)}')">${buying === product.product ? 'Opening…' : text}</button></div>`;
  }

  /** Percent saved by paying yearly instead of 12 monthly payments (0 when it can't be worked out). */
  static #saving(p) {
    if (!p.monthly_paise || !p.yearly_paise) return 0;
    return Math.max(0, Math.round((1 - p.yearly_paise / (12 * p.monthly_paise)) * 100));
  }

  #aiPack(plan, offers, buying) {
    if (plan.aiUnlimited || !plan.paymentsOpen || !offers) return '';
    const pack = offers.products.find((o) => o.product === 'ai_pack' && o.available);
    if (!pack) return '';
    return `
      <div class="plan-box plan-box-slim">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="font-semibold text-sm flex items-center gap-1.5"><i data-lucide="sparkles" style="width:14px;height:14px"></i> AI pack</div>
            <div class="text-xs text-zinc-500 mt-0.5">${pack.aiCredits.toLocaleString()} receipt scans or voice entries, valid for a year</div>
          </div>
          ${this.#button(pack, PlanCard.#price(pack), buying, false)}
        </div>
      </div>`;
  }

  /** @param {string} label  safe HTML (built here from numbers and fixed words) */
  #button(o, label, buying, primary, extra = '') {
    const busy = buying === o.product;
    return `<button class="btn ${primary ? 'btn-primary' : 'btn-outline'} plan-buy ${extra}" ${buying ? 'disabled' : ''}
      onclick="window.__app.buy('${Html.escape(o.product)}')">${busy ? 'Opening…' : label}</button>`;
  }

  /** "Have a code?" — opens a box for a coupon code, applied to whatever is bought next. */
  #couponField(coupon, open) {
    if (!open && !coupon) {
      return '<div class="mt-2"><button class="plan-trial" onclick="window.__app.openCoupon()">Have a code?</button></div>';
    }
    return `
      <div class="flex items-center gap-2 mt-2">
        <input class="input plan-coupon" placeholder="Code" maxlength="32" autocomplete="off"
          value="${Html.escape(coupon)}" oninput="window.__app.setCoupon(this.value)">
        <span class="text-[11px] text-zinc-500 whitespace-nowrap">used at checkout</span>
      </div>`;
  }

  /** "₹1,499", or with a running sale "<s>₹1,499</s> ₹1,199" and the sale's name as a tooltip. */
  static #price(o) {
    const now = PlanCard.#inr(o.amountPaise);
    if (!o.listPaise || o.listPaise <= o.amountPaise) return now;
    return `<s class="plan-was" title="${Html.escape(o.sale ?? 'Offer')}">${PlanCard.#inr(o.listPaise)}</s> ${now}`;
  }

  static #inr(paise) {
    return (paise / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: paise % 100 ? 2 : 0 });
  }
}
