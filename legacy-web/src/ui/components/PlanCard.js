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
        ${this.#groupCard(plan, ui.group)}
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
        if (plan.term === 'trial') return `Introductory offer until ${day(plan.endsAt)}.`;
        return plan.endsAt ? `${plan.toJSON().autoRenew ? 'Renews by auto-debit on' : 'Active until'} ${day(plan.endsAt)}.` : 'Active.';
      case 'grace':
        return `Ended ${plan.endsAt ? `on ${day(plan.endsAt)}` : ''}. Your cloud copy is read-only until `
          + `<strong>${day(plan.graceUntil)}</strong>. Please download your data before then.`;
      case 'lapsed':
        return 'Pocket keeps working on this device, with every export. Cloud sync and Telegram are paused; '
          + 'your cloud copy is kept and comes back when you renew.';
      default:
        return 'Pocket works fully on this device, with every export. Cloud sync, Telegram and sharing with '
          + 'family come with Pocket Pro.';
    }
  }

  #details(plan) {
    const rows = [];
    if (plan.can('sharing') || plan.isReadOnly && plan.canSee('sharing')) {
      rows.push(['People', `${plan.seatsUsed} of ${plan.seats}, you included`]);
    }
    for (const c of plan.coveredBy) {
      rows.push(['Shared space', `${Html.escape(c.ownerEmail)}'s Pocket Pro${c.access === 'read' ? ' (ended, read-only)' : ''}`]);
    }
    rows.push(['AI scans & voice', this.#ai(plan)]);
    if (plan.plan === 'promise' && plan.state === 'active') {
      rows.push(['Your ₹30 promise', plan.toJSON().autoRenew
        ? 'Auto-debit on · <button class="underline plan-stop" onclick="window.__app.stopAutoDebit()">Stop</button>'
        : 'Auto-debit stopped']);
    }
    const entries = plan.entries;
    if (entries.why === 'free' && entries.freeUntil) rows.push(['Using Pocket free', `until ${PlanCard.#day(entries.freeUntil)}`]);
    if (entries.why === 'waiting') rows.push(['Request to use free', 'waiting for a reply']);
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
    const soon = plan.aiExpiring;
    const expiry = soon ? `<div class="text-zinc-400 ai-expiring">${soon.credits.toLocaleString()} expire ${PlanCard.#day(soon.at)}</div>` : '';
    return parts.join(' · ') + expiry;
  }

  /** e.g. "16 Dec 2026" */
  static #day(d) {
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
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
        ${selling ? this.#couponField(coupon, ui) : ''}
        ${paid.map((p) => this.#planBox(p, plan, term, selling ? offers : null, buying, ui.highlight)).join('')}
        ${this.#backupAddon(plan, selling ? offers : null, buying)}
        ${this.#aiPack(plan, selling ? offers : null, buying)}
        <div class="text-[11px] text-zinc-400 leading-relaxed mt-2">${selling && !offers.products.some((o) => o.renews)
          ? `One-time payment through Razorpay (UPI, cards, net banking). Nothing renews by itself, and payments aren\'t refundable (<a href="refunds.html" target="_blank" class="underline">policy</a>). Paying again for your plan adds to its end date.${switching ? ' Switching plans carries your time left over as extra days on the new plan.' : ''}`
          : selling
          ? `Pocket Pro and Pocket Pro Group renew by auto-debit through Razorpay (UPI AutoPay or card). Stop it any time here; your plan runs to the end of what you've paid. Pocket Plus, AI packs and the 3-month offer are one-time payments. Payments aren\'t refundable (<a href="refunds.html" target="_blank" class="underline">policy</a>).${switching ? ' Switching plans carries your time left over as extra days on the new plan.' : ''}`
          : 'Online payment is coming soon.'}</div>
      </div>`;
  }

  /** One plan: name, price for the chosen term, what it includes, one button, and the trial link. */
  #planBox(p, plan, chosen, offers, buying, highlight) {
    // A plan sold yearly only shows its yearly price under Monthly too.
    const term = chosen === 'month' && p.monthly_paise == null && p.yearly_paise != null ? 'year' : chosen;
    const current = plan.plan === p.code && plan.state === 'active' && plan.term !== 'trial' && plan.group?.role !== 'member';
    const product = offers?.products.find((o) => o.plan === p.code && o.term === term);
    const listPaise = term === 'month' ? p.monthly_paise : p.yearly_paise;
    const price = product ? PlanCard.#price(product) : listPaise != null ? PlanCard.#inr(listPaise) : null;
    const perMonth = term === 'year' && listPaise != null ? PlanCard.#inr(Math.round((product?.amountPaise ?? listPaise) / 1200) * 100) : null;
    const save = term === 'year' ? PlanCard.#saving(p) : 0;
    const features = p.group_size ? [
      `For ${p.group_size} people, from any household: one pays, adds the others by email`,
      'Each person gets their own Pocket Pro, with a private book',
      'Sync, Telegram, scheduled backups and household sharing for each',
      'Yearly only',
    ] : [
      p.sync && 'Cloud sync on all your devices',
      p.telegram && 'Log by Telegram, voice or receipt scan',
      p.sharing && `Share a household book with your family (up to ${p.seats - 1} family members)`,
      p.sharing && 'Daily, monthly and yearly family summaries',
    ].filter(Boolean);
    const renewing = current && plan.toJSON().autoRenew;
    const verb = current ? (product?.renews ? 'Renew by auto-debit' : `Add 1 ${term}`) : plan.isPaid && plan.state === 'active' && plan.term !== 'trial' ? `Switch to ${Html.escape(p.name)}` : `Get ${Html.escape(p.name)}`;
    const down = !current && offers?.switches?.[p.code]?.lower ? offers.switches[p.code] : null;
    const button = !offers ? ''
      : renewing ? `<div class="plan-autodebit text-xs text-zinc-500 mt-3 flex items-center justify-between gap-2">
          <span><i data-lucide="repeat" style="width:13px;height:13px;vertical-align:-2px"></i> Auto-debit is on</span>
          <button class="btn btn-ghost text-xs plan-stop" ${buying ? 'disabled' : ''} onclick="window.__app.stopAutoDebit()">Stop auto-debit</button></div>`
      : down ? this.#switchDown(p, down, buying)
      : !product ? `<div class="text-xs text-zinc-400 mt-3">Not sold ${term === 'month' ? 'monthly' : 'yearly'}.</div>`
      : !product.available && product.reason === 'lifetime' ? ''
      : this.#button(product, `${verb} · ${PlanCard.#inr(product.amountPaise)}${product.renews ? `/${term}` : ''}`, buying, true, 'w-full justify-center mt-3')
        + (product.renews ? `<div class="text-[11px] text-zinc-400 mt-1 text-center plan-renews-note">Renews every ${term} by auto-debit. Stop any time.</div>` : '')
        + (product.switchDays ? `<div class="plan-switch-note">+ ${PlanCard.span(product.switchDays)} extra from the time left on your ${Html.escape(product.switchFrom ?? 'plan')}</div>` : '');
    const trial = this.#trialLink(p, plan, offers, buying);
    const popular = p.sharing && !p.group_size && !current;
    return `
      <div class="plan-box ${current ? 'plan-current' : ''} ${highlight === p.code ? 'plan-highlight' : ''}" id="plan-${Html.escape(p.code)}">
        <div class="flex items-start justify-between gap-2">
          <div>
            <div class="font-semibold flex items-center gap-2 flex-wrap">${Html.escape(p.name)}
              ${current ? '<span class="plan-tag plan-tag-current">Your plan</span>' : popular ? '<span class="plan-tag">Best for families</span>' : p.group_size ? `<span class="plan-tag">${p.group_size} people</span>` : ''}</div>
            ${save ? `<div class="plan-save mt-1 inline-block">save ${save}% vs monthly</div>` : ''}
          </div>
          <div class="text-right">
            ${price ? `<div class="plan-price">${price}<span class="plan-per">/${term}</span></div>` : '<div class="text-xs text-zinc-400">—</div>'}
            ${PlanCard.#codeNote(product)}
            ${perMonth ? `<div class="text-[11px] text-zinc-500">about ${perMonth} a month</div>` : ''}
          </div>
        </div>
        <ul class="plan-features">${features.map((f) => `<li><i data-lucide="check"></i>${Html.escape(f)}</li>`).join('')}</ul>
        ${button}
        ${trial}
      </div>`;
  }

  /**
   * Pocket Pro Group. Organiser: who is in the group (Joined / Waiting), add
   * by email, invite, remove, changes left. Member: who manages it, and Leave.
   * @param {import('../../domain/billing/Entitlements.js').Entitlements} plan
   * @param {object|null|undefined} g  pocket_group_state(), or null while loading
   */
  #groupCard(plan, g) {
    const role = plan.group?.role;
    if (!role) return '';
    if (role === 'member') {
      const who = plan.group;
      return `
        <div class="plan-box mt-3 group-member">
          <div class="flex items-center gap-2">
            <i data-lucide="user-check" style="width:16px;height:16px" class="text-zinc-500"></i>
            <div class="min-w-0">
              <div class="text-sm font-medium">Managed by ${Html.escape(who.ownerName || who.ownerEmail)}</div>
              <div class="text-xs text-zinc-500 truncate">${Html.escape(who.ownerEmail)}</div>
            </div>
          </div>
          <div class="text-xs text-zinc-500 mt-2 leading-relaxed">You're on Pocket Pro through their Pocket Pro Group. Your book is private: they can't see your entries.</div>
          <button class="btn btn-ghost w-full justify-center text-xs text-rose-500 mt-2 group-leave" onclick="window.__app.groupLeave()">Leave group</button>
        </div>`;
    }
    if (!g || g.role !== 'organiser') return '<div class="text-xs text-zinc-400 mt-3">Loading your group…</div>';
    const places = Math.max(0, (g.size || 3) - 1 - (g.members?.length || 0));
    const row = (m) => `
      <div class="flex items-center gap-2 py-2 border-t border-zinc-100 dark:border-zinc-800 group-row">
        <i data-lucide="${m.joined ? 'user-check' : 'clock'}" style="width:15px;height:15px" class="${m.joined ? 'text-emerald-600' : 'text-amber-500'}"></i>
        <div class="flex-1 min-w-0">
          <div class="text-xs truncate">${Html.escape(m.email)}</div>
          <div class="text-[11px] ${m.joined ? 'text-emerald-600' : 'text-amber-600'}">${m.joined ? 'Joined' : 'Waiting · not signed in yet'}</div>
        </div>
        ${m.joined ? '' : `<button class="btn btn-ghost px-2 group-invite" title="Send invite" aria-label="Send invite to ${Html.escape(m.email)}" onclick="window.__app.groupInvite('${Html.escape(m.email)}')"><i data-lucide="send"></i></button>`}
        <button class="btn btn-ghost px-2 group-remove" title="${m.joined ? 'Replace or remove' : 'Remove (free)'}" aria-label="Remove ${Html.escape(m.email)}" onclick="window.__app.groupRemove('${Html.escape(m.email)}', ${m.joined})"><i data-lucide="x"></i></button>
      </div>`;
    return `
      <div class="plan-box mt-3 group-organiser">
        <div class="flex items-center justify-between gap-2 mb-1">
          <div class="text-sm font-medium">Your group</div>
          <span class="text-[11px] text-zinc-500">${(g.members?.length || 0) + 1} of ${g.size || 3}</span>
        </div>
        <div class="flex items-center gap-2 py-2">
          <i data-lucide="crown" style="width:15px;height:15px" class="text-zinc-500"></i>
          <div class="text-xs flex-1">You · organiser</div>
        </div>
        ${(g.members || []).map(row).join('')}
        ${places > 0 ? `
        <form class="flex gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800 group-add" onsubmit="window.__app.groupAdd(event)">
          <input class="input text-sm" name="email" type="email" required placeholder="their.name@gmail.com" autocomplete="off">
          <button class="btn btn-primary text-xs" type="submit">Add</button>
        </form>
        <div class="text-[11px] text-zinc-500 mt-1">${places} place${places === 1 ? '' : 's'} left. They sign in to Pocket with this Google account to get Pocket Pro.</div>` : ''}
        <div class="text-[11px] text-zinc-400 mt-2">Changes left this year: ${g.changesLeft ?? 0}. A waiting place can be fixed for free; replacing someone who joined uses a change.</div>
      </div>`;
  }

  /** Moving to a cheaper plan: free, the time left becomes days on it. */
  #switchDown(p, down, buying) {
    const busy = buying === `switch:${p.code}`;
    return `
      <button class="btn btn-primary plan-buy w-full justify-center mt-3" ${buying ? 'disabled' : ''}
        onclick="window.__app.switchPlan('${Html.escape(p.code)}')">${busy ? 'Switching…' : `Switch to ${Html.escape(p.name)} · free`}</button>
      <div class="plan-switch-note">Your time left on ${Html.escape(down.fromName)} becomes ${PlanCard.span(down.days)} of ${Html.escape(p.name)}.</div>`;
  }

  /** 273 → "about 9 months"; 20 → "20 days". */
  static span(days) {
    const d = Math.max(0, Math.floor(days));
    if (d < 45) return `${d} day${d === 1 ? '' : 's'}`;
    const months = Math.round(d / 30.4375);
    if (months < 18) return `about ${months} months`;
    const years = Math.floor(months / 12), rest = months % 12;
    return `about ${years} year${years === 1 ? '' : 's'}${rest ? ` ${rest} month${rest === 1 ? '' : 's'}` : ''}`;
  }

  /** "or start with the first 3 months for ₹149" — a link while buying is open, plain text otherwise. */
  #trialLink(p, plan, offers, buying) {
    if (p.trial_paise == null || !p.trial_days || !plan.trialAvailable) return '';
    if (plan.state === 'active' && plan.isPaid) return '';
    const product = offers?.products.find((o) => o.plan === p.code && o.term === 'trial');
    if (offers && (!product || !product.available)) return '';
    const span = p.trial_days % 30 === 0 ? `${p.trial_days / 30} month${p.trial_days === 30 ? '' : 's'}` : `${p.trial_days} days`;
    const text = `or start with the first ${span} for ${product ? PlanCard.#price(product) : PlanCard.#inr(p.trial_paise)}`;
    if (!product) return `<div class="text-xs text-zinc-500 mt-2 text-center">${text}</div>`;
    return `<div class="mt-2 text-center"><button class="plan-trial" ${buying ? 'disabled' : ''} onclick="window.__app.buy('${Html.escape(product.product)}')">${buying === product.product ? 'Opening…' : text}</button></div>`;
  }

  /** Percent saved by paying yearly instead of 12 monthly payments (0 when it can't be worked out). */
  static #saving(p) {
    if (!p.monthly_paise || !p.yearly_paise) return 0;
    return Math.max(0, Math.round((1 - p.yearly_paise / (12 * p.monthly_paise)) * 100));
  }

  /** Pocket Plus: scheduled Google Drive backups, bought once (hidden once someone has it, or on Pocket Pro). */
  #backupAddon(plan, offers, buying) {
    if (plan.backup || !plan.paymentsOpen || !offers) return '';
    const item = offers.products.find((o) => o.product === 'drive_backup' && o.available);
    if (!item) return '';
    return `
      <div class="plan-box plan-box-slim" id="plan-plus">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="font-semibold text-sm flex items-center gap-1.5"><i data-lucide="cloud-upload" style="width:14px;height:14px"></i> Pocket Plus</div>
            <div class="text-xs text-zinc-500 mt-0.5">Google Drive backups daily, weekly or monthly, and automatic. Pay once, keep it.</div>
            ${PlanCard.#codeNote(item)}
          </div>
          ${this.#button(item, PlanCard.#price(item), buying, false)}
        </div>
      </div>`;
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
            <div class="text-xs text-zinc-500 mt-0.5 ai-pack-line">${pack.aiCredits.toLocaleString()} credits, valid for a year. ${Html.escape(plan.aiCostLine)}</div>
            ${PlanCard.#codeNote(pack)}
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

  /**
   * The coupon code: a "Have a code?" link, then a box with Apply. Once a
   * code is applied, it shows as a chip with Remove, and the plans below show
   * their final amounts with it.
   */
  #couponField(coupon, ui) {
    const applied = ui.couponApplied;
    if (applied) {
      return `
        <div class="plan-code-on">
          <i data-lucide="ticket-percent"></i>
          <span><b>${Html.escape(applied)}</b> applied</span>
          <button class="plan-trial ml-auto" onclick="window.__app.removeCoupon()">Remove</button>
        </div>`;
    }
    if (!ui.couponOpen && !coupon && !ui.couponError) {
      return '<div class="mb-2"><button class="plan-trial" onclick="window.__app.openCoupon()">Have a code?</button></div>';
    }
    const busy = !!ui.couponChecking;
    return `
      <div class="mb-2">
        <div class="flex items-center gap-2">
          <input class="input plan-coupon flex-1" placeholder="Code" maxlength="32" autocomplete="off" ${busy ? 'disabled' : ''}
            value="${Html.escape(coupon)}" oninput="window.__app.setCoupon(this.value)"
            onkeydown="if(event.key==='Enter'){event.preventDefault();window.__app.applyCoupon()}">
          <button class="btn btn-outline plan-buy" ${busy ? 'disabled' : ''} onclick="window.__app.applyCoupon()">${busy ? 'Checking…' : 'Apply'}</button>
        </div>
        ${ui.couponError ? `<div class="plan-code-error">${Html.escape(ui.couponError)}</div>` : ''}
      </div>`;
  }

  /** "You save ₹300 with LAUNCH20" under a price the code changed. */
  static #codeNote(o) {
    if (!o?.coupon || !o.listPaise || o.listPaise <= o.amountPaise) return '';
    return `<div class="plan-code-note">You save ${PlanCard.#inr(o.listPaise - o.amountPaise)} with ${Html.escape(o.coupon)}</div>`;
  }

  /** "₹1,499", or with a running sale "<s>₹1,499</s> ₹1,199" and the sale's name as a tooltip. */
  static #price(o) {
    const now = PlanCard.#inr(o.amountPaise);
    if (!o.listPaise || o.listPaise <= o.amountPaise) return now;
    return `<s class="plan-was" title="${Html.escape(o.coupon ? `Code ${o.coupon}` : o.sale ?? 'Offer')}">${PlanCard.#inr(o.listPaise)}</s> ${now}`;
  }

  static #inr(paise) {
    return (paise / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: paise % 100 ? 2 : 0 });
  }
}
