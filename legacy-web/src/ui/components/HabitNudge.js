/**
 * HabitNudge — one small box above the page offering help when recording has
 * slipped (RecordingGaps decides which):
 *
 *   catchUp    the catch-up service, on WhatsApp
 *   programme  the 6-week habit programme
 *   restDue    the second half of the programme fee
 *
 * "Not now" hides it for a while, never for good: it comes back after
 * AWAY_DAYS (REST_AWAY_DAYS for a payment that is due) if it still applies.
 * The catch-up and programme offers share that pause.
 * What was put away, and when, is remembered on the device (pocket.v1.nudge).
 */
import { Html } from '../../core/Html.js';

export class HabitNudge {
  static #KEY = 'pocket.v1.nudge';
  static AWAY_DAYS = 21;
  static REST_AWAY_DAYS = 3;
  static WHATSAPP = '919687318953';

  #el;
  #storage;
  #now;
  /** @type {{kind: string}|null} */
  #current = null;

  /**
   * @param {HTMLElement|null} el
   * @param {{storage?: {getItem: Function, setItem: Function}|null, now?: () => Date}} [deps]
   */
  constructor(el, { storage = null, now = () => new Date() } = {}) {
    this.#el = el;
    this.#storage = storage;
    this.#now = now;
  }

  /** @param {ReturnType<typeof import('../../domain/services/RecordingGaps.js').RecordingGaps.suggestion>} suggestion */
  show(suggestion) {
    this.#current = suggestion && !this.#away(suggestion.kind) ? suggestion : null;
    if (!this.#el) return;
    this.#el.innerHTML = this.html();
    if (this.#current && typeof lucide !== 'undefined') lucide.createIcons();
  }

  /** "Not now": hide this kind for a while. */
  later() {
    if (!this.#current) return;
    const saved = this.#read();
    saved[HabitNudge.#group(this.#current.kind)] = this.#now().toISOString();
    this.#write(saved);
    this.show(null);
  }

  html() {
    const s = this.#current;
    if (!s) return '';
    const box = (icon, tone, title, text, action) => `
      <div class="habit-nudge mb-4 rounded-2xl border ${tone} px-4 py-3 flex items-start gap-3" data-kind="${s.kind}">
        <i data-lucide="${icon}" class="shrink-0 mt-0.5" style="width:18px;height:18px"></i>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-sm">${title}</div>
          <p class="text-sm mt-0.5 opacity-90">${text}</p>
          <div class="mt-2 flex flex-wrap items-center gap-3 text-sm">
            ${action}
            <button type="button" data-nudge="later" class="underline opacity-75" onclick="window.__app.nudgeLater()">Not now</button>
          </div>
        </div>
      </div>`;
    const link = (href, label, external = false) =>
      `<a href="${Html.escape(href)}" ${external ? 'target="_blank" rel="noopener"' : ''} class="font-semibold underline">${label}</a>`;

    if (s.kind === 'catchUp') {
      const text = encodeURIComponent(`Hi, I'd like the Pocket catch-up service for the last ${s.days} days.`);
      return box('file-spreadsheet', 'border-sky-200 bg-sky-50 text-sky-900',
        `No entries for the last ${s.days} days`,
        'Missed a few days? It happens. Send us your statements or receipts and we\'ll sort them into a file you import yourself: ₹100 for up to 7 days or 100 entries. We delete your data once the file is delivered.',
        link(`https://wa.me/${HabitNudge.WHATSAPP}?text=${text}`, 'Ask on WhatsApp', true));
    }
    if (s.kind === 'programme') {
      const text = s.stopped
        ? 'It\'s been a while since your last entry. Our 6-week habit programme helps you start again and make recording part of your day, with a short check-in every day.'
        : `You recorded on ${s.recordedDays} of the last ${s.window} days. Our 6-week habit programme helps you make it daily, with a short check-in every day.`;
      return box('sprout', 'border-amber-200 bg-amber-50 text-amber-900', 'Make recording a daily habit',
        `${text} ₹4,500 in full, or ₹2,500 now and ₹2,500 at the end.`,
        link('programme.html', 'See the programme'));
    }
    if (s.kind === 'restDue') {
      return box('credit-card', 'border-amber-200 bg-amber-50 text-amber-900', 'Second half of the programme fee',
        'The 6 weeks are done — well done! Please pay the second half. Your 3 months of Pocket Pro start as soon as it\'s paid.',
        link('programme.html', 'Pay now'));
    }
    return '';
  }

  /** The catch-up and the programme share one pause, so putting one away doesn't bring on the other. */
  static #group(kind) {
    return kind === 'restDue' ? 'restDue' : 'help';
  }

  #away(kind) {
    const at = this.#read()[HabitNudge.#group(kind)];
    if (!at) return false;
    const days = kind === 'restDue' ? HabitNudge.REST_AWAY_DAYS : HabitNudge.AWAY_DAYS;
    return this.#now().getTime() - Date.parse(at) < days * 86400000;
  }

  #read() {
    try { return JSON.parse(this.#storage?.getItem(HabitNudge.#KEY) || '{}') || {}; } catch { return {}; }
  }

  #write(v) {
    try { this.#storage?.setItem(HabitNudge.#KEY, JSON.stringify(v)); } catch { /* storage full or blocked */ }
  }
}
