/**
 * PromiseModal — the ₹30-a-month promise, and asking to use Pocket free.
 *
 * Opens when someone tries to add an entry and may not (EntryAccess.check):
 *   'none'        no promise, plan or approved request yet
 *   'wait_full'   their request is waiting and they've used the entries it allows
 *   'signed_out'  the rule is on and they aren't signed in
 * Two pages: the promise itself, and the request form ("Ask to use Pocket free").
 */
import { Html } from '../../core/Html.js';

export class PromiseModal {
  /** @type {() => import('../../domain/billing/EntryAccess.js').EntryAccess} */
  #access;
  /** @type {() => {name: string}} */
  #person;
  /** @type {() => void} */
  #redraw;
  /** 'promise' | 'request' | 'sent' */
  #page = 'promise';
  /** 'none' | 'wait_full' | 'signed_out' */
  #reason = 'none';
  #error = '';
  #sending = false;

  /**
   * @param {object} deps
   * @param {() => any} deps.access   the person's EntryAccess now
   * @param {() => {name: string}} deps.person  what to prefill
   * @param {() => void} deps.redraw  re-draw this window
   */
  constructor({ access, person, redraw }) {
    this.#access = access;
    this.#person = person;
    this.#redraw = redraw;
  }

  /** @param {{reason?: string, page?: string}} [opts] */
  open(opts = {}) {
    this.#reason = ['none', 'wait_full', 'signed_out'].includes(opts.reason) ? opts.reason : 'none';
    this.#page = opts.page === 'request' ? 'request' : 'promise';
    this.#error = '';
    this.#sending = false;
  }

  /** @param {'promise'|'request'|'sent'} page */
  show(page, error = '') {
    this.#page = page;
    this.#error = error;
    this.#redraw();
  }

  set sending(on) { this.#sending = !!on; this.#redraw(); }

  render() {
    const body = this.#page === 'request' ? this.#request() : this.#page === 'sent' ? this.#sent() : this.#promise();
    return `<div class="p-5 promise-modal">
      <div class="sheet-header flex items-center justify-end">
        <button class="btn btn-ghost px-2.5" onclick="window.__app.closeModal()" aria-label="Close" title="Close"><i data-lucide="x"></i></button>
      </div>${body}</div>`;
  }

  #promise() {
    const a = this.#access();
    const req = a.request;
    const lead = this.#reason === 'wait_full'
      ? `You've added ${a.waitLimit} entries while we read your request.`
      : req?.status === 'declined' ? 'We couldn\'t approve your request to use Pocket free.'
      : req?.status === 'expired' ? 'Your free use of Pocket has ended. You can ask again.'
      : 'Before your first entry';
    const action = this.#reason === 'signed_out'
      ? `<button class="btn btn-primary w-full justify-center promise-signin" onclick="window.__app.openModal('auth')">Sign in to start</button>`
      : `<button class="btn btn-primary w-full justify-center promise-keep" onclick="window.__app.promiseStart()">Keep my promise · ₹${a.promiseRupees} a month</button>`;
    const ask = this.#reason === 'signed_out' || this.#reason === 'wait_full' ? '' : `
      <p class="text-sm text-zinc-500 mt-3 text-center">Can't pay ₹${a.promiseRupees}?
        <button class="underline text-indigo-600 promise-ask" onclick="window.__app.promiseAsk()">Ask to use Pocket free</button></p>`;
    return `
      <div class="text-xs font-medium text-emerald-600 mb-1">${Html.escape(lead)}</div>
      <h3 class="text-lg font-semibold mb-2">₹${a.promiseRupees} a month. It isn't for us. It's for you.</h3>
      <p class="text-sm text-zinc-500 mb-3 leading-relaxed">Pocket works for people who write things down every day.
        ₹${a.promiseRupees} a month is how you tell yourself you're one of them.</p>
      <div class="border-y border-zinc-100 dark:border-zinc-800 py-2.5 mb-4 text-sm leading-7">
        ${PromiseModal.#line('check', `<b>Every rupee comes back to you</b> as ${a.promiseCredits} AI credits each month`)}
        ${PromiseModal.#line('check', `About ${Math.floor(a.promiseCredits / 5)} receipt scans or ${a.promiseCredits} voice entries`)}
        ${PromiseModal.#line('clock', `Each month's credits last ${a.promiseCreditDays} days`)}
        ${PromiseModal.#line('gift', 'Plus 20 welcome credits that last 6 months')}
        ${PromiseModal.#line('rotate-ccw', 'Paid by auto-debit. Stop any time.')}
      </div>
      ${action}${ask}`;
  }

  #request() {
    const p = this.#person();
    const a = this.#access();
    return `
      <h3 class="text-lg font-semibold mb-1">Ask to use Pocket free</h3>
      <p class="text-sm text-zinc-500 mb-3 leading-relaxed">No one should stop looking after their money because of ₹${a.promiseRupees}.
        Tell us in a line or two. Only the Pocket team reads it.</p>
      <form onsubmit="window.__app.freeRequestSend(event)" class="space-y-3">
        <label class="block"><span class="text-xs text-zinc-500">Your name</span>
          <input name="name" class="input w-full" maxlength="120" required value="${Html.escape(p.name || '')}"></label>
        <label class="block"><span class="text-xs text-zinc-500">Why would you like to use Pocket free?</span>
          <textarea name="reason" class="input w-full" rows="3" maxlength="1000" required placeholder="I'm a student and saving for my fees"></textarea></label>
        ${this.#error ? `<div class="text-sm text-rose-600 promise-error">${Html.escape(this.#error)}</div>` : ''}
        <div class="text-xs text-zinc-500 bg-zinc-50 dark:bg-zinc-800/60 rounded-lg p-2.5 leading-relaxed">
          Free use doesn't include the monthly ${a.promiseCredits} AI credits. You keep your 20 welcome credits, and can buy AI credits any time.
          While we read your request, you can add up to ${a.waitLimit} entries.
        </div>
        <button class="btn btn-primary w-full justify-center" ${this.#sending ? 'disabled' : ''}>${this.#sending ? 'Sending…' : 'Send request'}</button>
        <button type="button" class="btn btn-ghost w-full justify-center text-sm" onclick="window.__app.promiseBack()">Back</button>
      </form>`;
  }

  #sent() {
    const a = this.#access();
    return `
      <div class="text-center py-4">
        <i data-lucide="mail-check" style="width:32px;height:32px" class="text-emerald-600 mx-auto mb-2"></i>
        <h3 class="text-lg font-semibold mb-1">Request sent</h3>
        <p class="text-sm text-zinc-500 mb-4 leading-relaxed">While we read it, you can add up to ${a.waitLimit} entries.
          We'll let you know here once it's decided.</p>
        <button class="btn btn-primary w-full justify-center" onclick="window.__app.closeModal()">Continue</button>
      </div>`;
  }

  static #line(icon, html) {
    return `<div class="flex items-start gap-2"><i data-lucide="${icon}" style="width:16px;height:16px;margin-top:6px" class="text-emerald-600 shrink-0"></i><span>${html}</span></div>`;
  }
}
