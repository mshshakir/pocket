/**
 * PlanBanner — the notice above every page when a plan needs the person's
 * attention. It says nothing to people on Free who never paid, or whose plan
 * is fine.
 *
 *   grace   The plan ended: the cloud copy is read-only until graceUntil.
 *           Tells them to download their data before then (the decision of
 *           2026-11-14), with the button to do it.
 *   lapsed  A paid plan ended longer ago: Pocket keeps working on this device;
 *           cloud sync and Telegram are paused; renewing brings the cloud copy
 *           back. Can be dismissed for the session.
 */
import { EventBus } from '../../core/EventBus.js';
import { Html } from '../../core/Html.js';

export class PlanBanner {
  static #DISMISS_KEY = 'pocket.planBanner.dismissed';

  #el;
  #plan = null;
  #bus;

  /** @param {HTMLElement|null} el */
  constructor(el, bus = EventBus.getInstance()) {
    this.#el = el;
    this.#bus = bus;
    this.#bus.on('plan:changed', ({ plan }) => this.show(plan));
    this.#bus.on('auth:changed', ({ user }) => { if (!user) this.show(null); });
  }

  /** @param {import('../../domain/billing/Entitlements.js').Entitlements|null} plan */
  show(plan) {
    this.#plan = plan;
    if (this.#el) this.#el.innerHTML = this.html(plan);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  dismiss() {
    try { sessionStorage.setItem(PlanBanner.#DISMISS_KEY, '1'); } catch (_) { /* private mode */ }
    this.show(this.#plan);
  }

  /** @param {import('../../domain/billing/Entitlements.js').Entitlements|null} plan @param {Date} [today] */
  html(plan, today = new Date()) {
    if (!plan) return '';
    if (plan.state === 'grace' && plan.graceUntil) return this.#grace(plan, today);
    if (plan.state === 'lapsed' && plan.toJSON().paidPlan && !this.#dismissed()) return this.#lapsed(plan);
    return '';
  }

  #grace(plan, today) {
    const daysLeft = Math.max(0, Math.ceil((plan.graceUntil - today) / 86_400_000));
    const ended = plan.endsAt ? ` on ${PlanBanner.#day(plan.endsAt)}` : '';
    return `
      <div class="plan-banner plan-banner-warn" role="status">
        <i data-lucide="cloud-download" class="plan-banner-icon"></i>
        <div class="flex-1 min-w-0">
          <div class="font-semibold">Download your data within ${daysLeft} day${daysLeft === 1 ? '' : 's'}</div>
          <div class="plan-banner-text">
            Your ${Html.escape(plan.planName)} plan ended${ended}. Your cloud copy is read-only until
            <strong>${PlanBanner.#day(plan.graceUntil)}</strong>; after that it can't be opened until you renew.
            Download a copy now to keep everything.
          </div>
          <div class="flex flex-wrap gap-2 mt-2">
            <button class="btn btn-primary text-sm" onclick="window.__app.downloadMyData()">
              <i data-lucide="download"></i> Download my data
            </button>
            <button class="btn btn-outline text-sm" onclick="window.__app.openModal('settings',{})">Renew</button>
          </div>
        </div>
      </div>`;
  }

  #lapsed(plan) {
    return `
      <div class="plan-banner" role="status">
        <i data-lucide="hard-drive" class="plan-banner-icon"></i>
        <div class="flex-1 min-w-0">
          <div class="font-semibold">Your plan has ended</div>
          <div class="plan-banner-text">
            Pocket keeps working on this device. Cloud sync and Telegram are paused; your cloud
            copy is kept and comes back when you renew.
          </div>
        </div>
        <button class="btn btn-ghost px-2" aria-label="Dismiss" onclick="window.__app.dismissPlanBanner()">
          <i data-lucide="x"></i>
        </button>
      </div>`;
  }

  #dismissed() {
    try { return sessionStorage.getItem(PlanBanner.#DISMISS_KEY) === '1'; } catch (_) { return false; }
  }

  static #day(d) {
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
