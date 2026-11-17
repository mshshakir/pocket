/**
 * ProgrammePage — programme.html: apply for the 6-week habit programme,
 * share a profile, follow the application, and pay when a place is offered.
 *
 *   signed out  → sign in with Google
 *   no application (or withdrawn) → the form
 *   waitlisted  → "you're on the waitlist", edit details, leave the waitlist
 *   offered     → the batch, a Pay button (Razorpay), or decline
 *   confirmed / completed → welcome
 *
 * We never see anyone's Pocket data; this page collects only what is
 * needed to run the programme.
 */
import { Html } from '../core/Html.js';
import { PaymentService } from '../domain/billing/PaymentService.js';
import { RazorpayCheckout } from '../domain/billing/RazorpayCheckout.js';
import { ProgrammeBatches } from './ProgrammeBatches.js';

export class ProgrammePage {
  static #FIELDS = ['fullName', 'whatsapp', 'telegram', 'household', 'currentMethod', 'goal', 'baselineDays', 'language', 'preferredTime'];

  #session;
  #root;
  #payments;
  #user = null;
  #app = null;
  #editing = false;
  #busy = false;
  #message = '';
  /** @type {ProgrammeBatches|null} */ #batches = null;
  #loadBatches;

  /**
   * @param {import('./PocketSession.js').PocketSession} session
   * @param {HTMLElement} root
   * @param {{open: Function}} [checkout]
   */
  constructor(session, root, checkout = new RazorpayCheckout(), loadBatches = () => ProgrammeBatches.load()) {
    this.#loadBatches = loadBatches;
    this.#session = session;
    this.#root = root;
    this.#payments = new PaymentService(() => (this.#user ? session.invoker() : null), checkout);
    root.addEventListener('click', (e) => this.#onClick(e));
    root.addEventListener('submit', (e) => this.#onSubmit(e));
  }

  async start() {
    // The batch banner doesn't need a sign-in; a failure just leaves it out.
    this.#batches = await Promise.resolve().then(this.#loadBatches).catch(() => null);
    this.#session.onChange((user) => { if ((user?.id ?? null) !== (this.#user?.id ?? null)) this.#load(user); });
    await this.#load(await this.#session.user());
  }

  async #load(user) {
    this.#user = user;
    this.#app = user ? await this.#session.rpc('pocket_programme_mine').catch(() => null) : null;
    // On the waitlist and a batch has room: the place is theirs now (held 48 hours to pay).
    if (this.#app?.status === 'waitlisted') {
      this.#app = await this.#session.rpc('pocket_programme_claim').catch(() => null) ?? this.#app;
    }
    this.#editing = false;
    this.#render();
  }

  // ── events ──────────────────────────────────────────────────────────

  async #onClick(e) {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action || this.#busy) return;
    if (action === 'sign-in') return this.#run(() => this.#session.signIn());
    if (action === 'sign-out') return this.#run(async () => { await this.#session.signOut(); await this.#load(null); });
    if (action === 'edit') { this.#editing = true; return this.#render(); }
    if (action === 'cancel-edit') { this.#editing = false; return this.#render(); }
    if (action === 'withdraw') {
      return this.#run(async () => { this.#app = await this.#session.rpc('pocket_programme_withdraw'); this.#message = 'Done. You can apply again any time.'; });
    }
    if (action === 'pay') return this.#pay(e.target.closest('[data-action]')?.dataset.product || 'programme');
  }

  async #onSubmit(e) {
    if (e.target.id !== 'programmeForm') return;
    e.preventDefault();
    const form = new FormData(e.target);
    const profile = Object.fromEntries(ProgrammePage.#FIELDS.map((k) => [k, String(form.get(k) ?? '').trim()]));
    profile.consent = form.get('consent') === 'on';
    await this.#run(async () => {
      const before = this.#app?.status;
      this.#app = await this.#session.rpc('pocket_programme_apply', { p: profile });
      this.#editing = false;
      this.#message = this.#app?.status === 'offered' && before !== 'offered'
        ? 'Thank you! A place is yours — choose how to pay below to confirm it.'
        : 'Saved. Thank you!';
    });
  }

  /** @param {'programme'|'programme_half'|'programme_rest'} product */
  async #pay(product) {
    const code = this.#root.querySelector('#programmeCode')?.value ?? '';
    await this.#run(async () => {
      try {
        await this.#payments.buy(product, { email: this.#user?.email, code });
        this.#message = product === 'programme_rest'
          ? 'Second half received — the programme is fully paid. Thank you!'
          : product === 'programme_half'
            ? 'First half received — your place is confirmed. The second half is due when the 6 weeks end. See you in week 1!'
            : 'Payment received — your place is confirmed. See you in week 1!';
      } catch (err) {
        if (err?.code === 'dismissed') return;
        throw err;
      }
      this.#app = await this.#session.rpc('pocket_programme_mine');
    });
  }

  async #run(job) {
    this.#busy = true;
    this.#message = '';
    this.#render();
    try {
      await job();
    } catch (err) {
      this.#message = `⚠️ ${err?.message || 'Something went wrong. Please try again.'}`;
    } finally {
      this.#busy = false;
      this.#render();
    }
  }

  // ── rendering ───────────────────────────────────────────────────────

  #render() {
    const body = !this.#user ? this.#signedOut()
      : !this.#app || this.#app.status === 'withdrawn' || this.#editing ? this.#form()
      : this.#status();
    this.#root.innerHTML = `${this.#banner()}${this.#message ? `<div class="mb-4 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm">${Html.escape(this.#message)}</div>` : ''}${body}`;
    globalThis.lucide?.createIcons?.();
  }

  /** Where the batches stand: open with places left, full, opening soon … (set in the admin dashboard). */
  #banner() {
    if (!this.#batches) return '';
    const m = this.#batches.message();
    const tone = m.state === 'open' ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : m.state === 'upcoming' ? 'border-sky-200 bg-sky-50 text-sky-900'
      : 'border-amber-200 bg-amber-50 text-amber-900';
    const icon = m.state === 'open' ? 'door-open' : m.state === 'upcoming' ? 'calendar-clock' : 'hourglass';
    return `
      <div class="programme-batch mb-4 rounded-xl border ${tone} px-4 py-3 flex items-start gap-3" data-state="${m.state}">
        <i data-lucide="${icon}" class="mt-0.5 shrink-0"></i>
        <div><div class="font-semibold">${Html.escape(m.title)}</div><div class="text-sm">${Html.escape(m.detail)}</div></div>
      </div>`;
  }

  #signedOut() {
    const action = this.#batches?.message().action ?? 'Apply';
    return `
      <div class="card p-6 text-center">
        <p class="text-zinc-600">Sign in with the Google account you use for Pocket (or will use) to ${action === 'Apply now' ? 'apply' : 'join the waitlist'}.</p>
        <button data-action="sign-in" class="mt-4 btn-main" ${this.#busy ? 'disabled' : ''}><i data-lucide="log-in"></i> Sign in with Google</button>
      </div>`;
  }

  #form() {
    const a = this.#app && this.#app.status !== 'withdrawn' ? this.#app : {};
    const v = (k) => Html.escape(a[k] ?? (k === 'fullName' ? this.#user?.user_metadata?.full_name ?? '' : ''));
    const days = Array.from({ length: 8 }, (_, d) => `<option value="${d}" ${String(a.baselineDays ?? '') === String(d) ? 'selected' : ''}>${d}</option>`).join('');
    return `
      <form id="programmeForm" class="card p-6 space-y-4">
        <div class="text-sm text-zinc-500">Signed in as <b>${Html.escape(this.#user.email)}</b> · <a href="#" data-action="sign-out" class="underline">not you?</a></div>
        ${this.#field('fullName', 'Your name', `<input name="fullName" class="field" required minlength="2" value="${v('fullName')}">`)}
        ${this.#field('whatsapp', 'WhatsApp number, with country code', `<input name="whatsapp" class="field" required placeholder="+91 98xxx xxxxx" value="${v('whatsapp')}">`, 'We call and message you here for your check-ins.')}
        ${this.#field('telegram', 'Telegram username (optional)', `<input name="telegram" class="field" placeholder="@name" value="${v('telegram')}">`, 'For logging entries with the Pocket bot.')}
        ${this.#field('household', 'Who else will record money with you? (optional)', `<input name="household" class="field" placeholder="e.g. my wife; just me" value="${v('household')}">`)}
        ${this.#field('currentMethod', 'How do you keep track of money today?', `<input name="currentMethod" class="field" placeholder="e.g. notebook, an app, I don't" value="${v('currentMethod')}">`)}
        ${this.#field('goal', 'What would you like to be different in 6 weeks?', `<textarea name="goal" class="field" rows="2">${v('goal')}</textarea>`)}
        <div class="grid sm:grid-cols-3 gap-4">
          ${this.#field('baselineDays', 'Days you recorded money last week', `<select name="baselineDays" class="field"><option value="">—</option>${days}</select>`)}
          ${this.#field('language', 'Language for calls', `<input name="language" class="field" placeholder="e.g. English, Hindi" value="${v('language')}">`)}
          ${this.#field('preferredTime', 'Best time to reach you', `<input name="preferredTime" class="field" placeholder="e.g. after 8 pm" value="${v('preferredTime')}">`)}
        </div>
        <label class="flex items-start gap-3 text-sm text-zinc-700">
          <input type="checkbox" name="consent" class="mt-1" required ${this.#app && this.#app.status !== 'withdrawn' ? 'checked' : ''}>
          <span>I agree to the programme terms: ₹5,000 for 6 weeks (₹4,500 if paid in full; or ₹2,500 now and ₹2,500 when the 6 weeks end), <b>not refundable once my place is confirmed</b>. If I pay half now, I will pay the second half when the 6 weeks end. Pocket's team never sees my Pocket data; I share only what I choose on calls and WhatsApp. My details here are used only to run the programme. (<a href="terms.html" target="_blank" class="underline">Terms</a>, <a href="refunds.html" target="_blank" class="underline">Refunds</a>, <a href="privacy.html" target="_blank" class="underline">Privacy</a>)</span>
        </label>
        <div class="flex flex-wrap gap-3">
          <button type="submit" class="btn-main" ${this.#busy ? 'disabled' : ''}>${this.#busy ? 'Saving…' : this.#editing ? 'Save my details' : (this.#batches?.open ? 'Apply now' : this.#batches ? 'Join the waitlist' : 'Apply')}</button>
          ${this.#editing ? '<button type="button" data-action="cancel-edit" class="btn-soft">Cancel</button>' : ''}
        </div>
        ${this.#editing ? '' : `<p class="text-xs text-zinc-500">Nothing is charged when you apply. ${this.#batches?.open
          ? `${Html.escape(this.#batches.headline.name)} has room: once you apply, you can pay straight away to take your place (held for you for 48 hours).`
          : 'If a batch has room, you can pay straight away to take your place; otherwise you join the waitlist and we tell you when a place opens.'}</p>`}
      </form>`;
  }

  #field(name, label, control, hint = '') {
    return `<label class="block"><span class="block text-sm font-medium mb-1">${label}</span>${control}${hint ? `<span class="block text-xs text-zinc-500 mt-1">${hint}</span>` : ''}</label>`;
  }

  /** A date and time, e.g. "19 November, 11:30 am". */
  static #when(iso) {
    return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
  }

  /** Split payment: the second half, until it is paid (due when the 6 weeks end; can be paid earlier). */
  #restDue() {
    const a = this.#app;
    if (a.payPlan !== 'split' || a.restPaid || !a.paymentsOpen) return '';
    const b = a.batch ?? {};
    const rest = b.restPaise ?? Math.ceil((b.pricePaise ?? 500000) / 2);
    const inr = (p) => (p / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
    const ended = !!b.endsOn && new Date() >= new Date(`${b.endsOn}T00:00:00`);
    const when = b.endsOn ? new Date(`${b.endsOn}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }) : 'the end of the programme';
    return `
      <div class="programme-rest mt-5 rounded-xl border ${ended ? 'border-amber-200 bg-amber-50' : 'border-zinc-200 bg-zinc-50'} p-4" data-due="${ended}">
        <div class="font-semibold">Second half: ${inr(rest)}</div>
        <p class="text-sm text-zinc-600 mt-1">${ended
          ? 'The 6 weeks are done — please pay the second half. Your 3 months of Pocket Pro start as soon as it\'s paid.'
          : `Due on ${when}, when the 6 weeks end. You can pay it earlier if you like.`}</p>
        <button data-action="pay" data-product="programme_rest" class="btn-main mt-3" ${this.#busy ? 'disabled' : ''}>${this.#busy ? 'Opening…' : `<i data-lucide="credit-card"></i> Pay ${inr(rest)}`}</button>
      </div>`;
  }

  #status() {
    const a = this.#app;
    const day = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : 'date to be confirmed');
    const inr = (p) => (p / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
    const head = (icon, title, text) => `
      <div class="flex items-start gap-3"><span class="w-10 h-10 rounded-xl grid place-items-center bg-emerald-50 text-emerald-700 shrink-0"><i data-lucide="${icon}"></i></span>
      <div><h2 class="text-lg font-bold">${title}</h2><p class="text-zinc-600 mt-1">${text}</p></div></div>`;
    let main = '';
    switch (a.status) {
      case 'waitlisted':
        main = head('hourglass', 'You\'re on the waitlist',
          'Thank you for applying. When a place opens in a batch, we\'ll message you on WhatsApp and you can pay here to confirm it.');
        break;
      case 'offered': {
        const b = a.batch ?? {};
        const full = b.fullPaise ?? b.pricePaise ?? 500000;
        const upfront = b.upfrontPaise ?? full;
        const half = b.halfPaise ?? Math.floor(full / 2);
        const rest = b.restPaise ?? full - half;
        const busy = this.#busy ? 'disabled' : '';
        main = head('party-popper', `A place is waiting for you in ${Html.escape(b.name ?? 'the next batch')}`,
          `It starts on <b>${day(b.startsOn)}</b>. Choose how to pay to confirm your place.${a.holdUntil ? ` <span class="programme-hold">We're holding it for you until <b>${ProgrammePage.#when(a.holdUntil)}</b>; after that it goes to the next person.</span>` : ''}`)
          + (a.paymentsOpen
            ? `<div class="mt-5 grid sm:grid-cols-2 gap-3">
                 <div class="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                   <div class="font-semibold">Pay in full</div>
                   <div class="text-2xl font-bold mt-1">${inr(upfront)}</div>
                   ${upfront < full ? `<div class="text-xs text-emerald-700 mt-0.5">Save ${inr(full - upfront)}</div>` : ''}
                   <button data-action="pay" data-product="programme" class="btn-main mt-3 w-full" ${busy}>${this.#busy ? 'Opening…' : `<i data-lucide="credit-card"></i> Pay ${inr(upfront)}`}</button>
                 </div>
                 <div class="rounded-xl border border-zinc-200 bg-white p-4">
                   <div class="font-semibold">Half now, half at the end</div>
                   <div class="text-2xl font-bold mt-1">${inr(half)} <span class="text-sm font-normal text-zinc-500">now</span></div>
                   <div class="text-xs text-zinc-500 mt-0.5">${inr(rest)} when the 6 weeks end${b.endsOn ? ` (${day(b.endsOn)})` : ''}</div>
                   <button data-action="pay" data-product="programme_half" class="btn-soft mt-3 w-full" ${busy}>${this.#busy ? 'Opening…' : `<i data-lucide="credit-card"></i> Pay ${inr(half)} now`}</button>
                 </div>
               </div>
               <div class="mt-3"><input id="programmeCode" class="field max-w-[12rem] uppercase" placeholder="Code (optional)" maxlength="32" autocomplete="off"></div>
               <p class="mt-2 text-xs text-zinc-500">Through Razorpay: UPI, cards or net banking. Not refundable once your place is confirmed. With half now, the 3 months of Pocket Pro start once the second half is paid.</p>`
            : '<p class="mt-4 text-sm text-zinc-600">We\'ll send you a way to pay on WhatsApp shortly.</p>');
        break;
      }
      case 'confirmed':
        main = head('circle-check', 'Your place is confirmed',
          `${Html.escape(a.batch?.name ?? 'Your batch')} starts on <b>${day(a.batch?.startsOn)}</b>. We\'ll call you on WhatsApp before then to set everything up.`)
          + this.#restDue();
        break;
      case 'completed':
        main = head('award', 'You finished the programme', 'Well done. Keep the habit going: one message to the bot each day.')
          + this.#restDue();
        break;
      default:
        main = head('info', 'Your application', Html.escape(a.status));
    }
    const canEdit = a.status === 'waitlisted' || a.status === 'offered' || a.status === 'confirmed';
    const canLeave = a.status === 'waitlisted' || a.status === 'offered';
    return `
      <div class="card p-6">
        ${main}
        <div class="mt-6 pt-4 border-t border-zinc-100 text-sm text-zinc-600 grid sm:grid-cols-2 gap-x-6 gap-y-1">
          <div><span class="text-zinc-400">Name</span> ${Html.escape(a.fullName)}</div>
          <div><span class="text-zinc-400">WhatsApp</span> ${Html.escape(a.whatsapp)}</div>
          ${a.telegram ? `<div><span class="text-zinc-400">Telegram</span> ${Html.escape(a.telegram)}</div>` : ''}
          ${a.preferredTime ? `<div><span class="text-zinc-400">Best time</span> ${Html.escape(a.preferredTime)}</div>` : ''}
        </div>
        <div class="mt-5 flex flex-wrap gap-3 text-sm">
          ${canEdit ? '<button data-action="edit" class="btn-soft"><i data-lucide="pencil"></i> Edit my details</button>' : ''}
          ${canLeave ? `<button data-action="withdraw" class="btn-soft">${a.status === 'offered' ? 'Decline the place' : 'Leave the waitlist'}</button>` : ''}
          <a href="#" data-action="sign-out" class="btn-soft">Sign out</a>
        </div>
      </div>`;
  }
}
