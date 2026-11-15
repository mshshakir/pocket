/**
 * RepeatPause — pausing a repeating entry or bill for a while.
 *
 * A repeat's original entry (the template) carries
 *   pauses: [{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' | null }]
 * `to: null` means "until I resume". A date inside a pause is treated like a
 * skipped date: no copy is made (RecurringService), a bill isn't due
 * (BillService) and the bot doesn't remind (pocket_bill_templates lists the
 * paused days with the skipped ones). Pauses are kept after they end, so a
 * paused month is never filled in later.
 *
 * Pure: static helpers that read a template and return new arrays.
 */
export class RepeatPause {
  /** Open-ended pauses are read as lasting until this date. */
  static FOREVER = '9999-12-31';

  /** @returns {{from:string, to:string|null}[]} */
  static list(t) {
    return (Array.isArray(t?.pauses) ? t.pauses : [])
      .filter((p) => p && RepeatPause.isIso(p.from) && (p.to == null || RepeatPause.isIso(p.to)));
  }

  static isIso(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  /** Is `iso` inside one of the template's pauses? */
  static on(t, iso) {
    return RepeatPause.list(t).some((p) => iso >= p.from && iso <= (p.to || RepeatPause.FOREVER));
  }

  /** The pause covering `today`, or the next one to start, or null. */
  static current(t, today) {
    const live = RepeatPause.list(t).filter((p) => (p.to || RepeatPause.FOREVER) >= today)
      .sort((a, b) => a.from.localeCompare(b.from));
    return live.find((p) => p.from <= today) || live[0] || null;
  }

  /** Paused today? */
  static active(t, today) {
    const p = RepeatPause.current(t, today);
    return !!p && p.from <= today;
  }

  /** New pauses with [from, to] added; overlapping or touching ones merge. */
  static withPause(t, from, to = null) {
    if (!RepeatPause.isIso(from) || (to != null && (!RepeatPause.isIso(to) || to < from))) return RepeatPause.list(t);
    const end = (p) => p.to || RepeatPause.FOREVER;
    const all = [...RepeatPause.list(t), { from, to: to || null }].sort((a, b) => a.from.localeCompare(b.from));
    const out = [];
    for (const p of all) {
      const last = out[out.length - 1];
      if (last && p.from <= RepeatPause.addDays(end(last), 1)) {
        if (end(p) > end(last)) last.to = p.to;
      } else {
        out.push({ ...p });
      }
    }
    return out;
  }

  /**
   * New pauses after resuming today. A pause running today ends yesterday
   * (kept, so those dates stay paused; removed if it only started today).
   * With none running, the next one to start is removed. Others stay.
   */
  static resumed(t, today) {
    const list = RepeatPause.list(t);
    const running = list.find((p) => p.from <= today && (p.to || RepeatPause.FOREVER) >= today);
    if (running) {
      return list.flatMap((p) => (p !== running ? [p]
        : p.from < today ? [{ from: p.from, to: RepeatPause.addDays(today, -1) }] : []));
    }
    const next = RepeatPause.current(t, today);
    return list.filter((p) => p !== next);
  }

  /** "Paused until 15 Jan" / "Paused until you resume" / "Pauses 1 Dec – 31 Jan". */
  static label(t, today, short) {
    const p = RepeatPause.current(t, today);
    if (!p) return '';
    if (p.from <= today) return p.to ? `Paused until ${short(p.to)}` : 'Paused until you resume';
    return p.to ? `Pauses ${short(p.from)} – ${short(p.to)}` : `Pauses from ${short(p.from)}`;
  }

  static addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
}
