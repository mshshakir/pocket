/** Format — how the dashboard shows money, dates and labels. */
import { Html } from '../core/Html.js';

export class Format {
  static esc(v) { return Html.escape(v); }

  /** 16900 → "₹169"; 107928 → "₹1,079.28"; null → "—" */
  static inr(paise) {
    if (paise == null || paise === '') return '—';
    const n = Number(paise);
    return (n / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: n % 100 ? 2 : 0 });
  }

  /** Rupees typed in a form → paise, or null when blank. */
  static paise(rupees) {
    const t = String(rupees ?? '').trim();
    if (!t) return null;
    const n = Number(t.replace(/[₹,\s]/g, ''));
    if (!Number.isFinite(n) || n < 0) throw new Error(`"${t}" isn't an amount`);
    return Math.round(n * 100);
  }

  /** Paise → rupees for a form field ("" when null). */
  static rupees(paise) {
    return paise == null ? '' : String(Number(paise) / 100);
  }

  static date(v) {
    if (!v) return '—';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  static dateTime(v) {
    if (!v) return '—';
    const d = new Date(v);
    return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }

  /** "3 days ago", "today", "—" */
  static ago(v) {
    if (!v) return '—';
    const days = Math.floor((Date.now() - new Date(v).getTime()) / 86_400_000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 60) return `${days} days ago`;
    return Format.date(v);
  }

  /** A date for an <input type="date"> ("" when none). */
  static isoDay(v) {
    if (!v) return '';
    return new Date(v).toISOString().slice(0, 10);
  }

  static number(n) { return Number(n ?? 0).toLocaleString('en-IN'); }

  /** A small coloured pill. tone: good | warn | bad | quiet | accent */
  static pill(text, tone = 'quiet') {
    return `<span class="pill pill-${tone}">${Html.escape(text)}</span>`;
  }

  /** WhatsApp chat link for a number typed with any spacing. */
  static whatsapp(number) {
    const digits = String(number ?? '').replace(/[^0-9]/g, '');
    return digits ? `https://wa.me/${digits}` : null;
  }

  /** A CSV file from rows of values, downloaded by the browser. */
  static downloadCsv(name, header, rows) {
    const cell = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const text = [header, ...rows].map((r) => r.map(cell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
