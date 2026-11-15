/**
 * CheckinMessage — the morning "what came today?" message for pay-later items:
 * one line per item with what's expected, − / + buttons to change it, and
 * "✓ That's right". Once someone confirms, every copy shows who did and loses
 * its buttons. Callback data: dv:<checkin>:<item index>:-|+|=  and  dv:<checkin>:ok
 * (= is the item's own label: tapping it does nothing).
 */
import { DeliveryDay, type DeliveryItem } from './DeliveryDay.ts';
import type { Keyboard } from './TelegramClient.ts';

export class CheckinMessage {
  static readonly PREFIX = 'dv:';

  static isButton(data: string | undefined): boolean {
    return !!data && data.startsWith(CheckinMessage.PREFIX);
  }

  /** { checkinId, index (−1 for ✓), step (+1/−1/0) } from a button, or null. */
  static parse(data: string): { checkinId: number; index: number; step: number } | null {
    const m = /^dv:(\d+):(ok|(\d+):([+=-]))$/.exec(data);
    if (!m) return null;
    if (m[2] === 'ok') return { checkinId: Number(m[1]), index: -1, step: 0 };
    return { checkinId: Number(m[1]), index: Number(m[3]), step: m[4] === '+' ? 1 : m[4] === '-' ? -1 : 0 };
  }

  /** Text and buttons for `items` on `day`; answered = the name of whoever confirmed. */
  static render(checkinId: number, items: DeliveryItem[], day: string, answered: string | null): { text: string; keyboard: Keyboard } {
    const lines = items.map((it) => {
      const d = new DeliveryDay(it);
      const qty = d.qtyOn(day);
      const changed = d.changedOn(day);
      const note = d.pausedOn(day) && !changed ? ' (paused)' : changed ? ` (usual ${d.qtyLabel(d.usualOn(day))})` : '';
      return `• ${CheckinMessage.#esc(it.name)}: <b>${qty ? CheckinMessage.#esc(d.qtyLabel(qty)) : 'none'}</b>${note}`;
    });
    const head = `🌅 <b>Deliveries · ${DeliveryDay.dayLabel(day)}</b>`;
    if (answered) {
      return { text: `${head}\n${lines.join('\n')}\n\n✓ Confirmed by ${CheckinMessage.#esc(answered)}`, keyboard: [] };
    }
    const keyboard: Keyboard = items.map((it, i) => {
      const d = new DeliveryDay(it);
      const qty = d.qtyOn(day);
      return [
        { text: '−', callback_data: `dv:${checkinId}:${i}:-` },
        { text: `${it.name} ${qty ? d.qtyLabel(qty) : '0'}`.slice(0, 40), callback_data: `dv:${checkinId}:${i}:=` },
        { text: '+', callback_data: `dv:${checkinId}:${i}:+` },
      ];
    });
    keyboard.push([{ text: '✓ That\'s right', callback_data: `dv:${checkinId}:ok` }]);
    return { text: `${head}\n${lines.join('\n')}\n\nAnything different? Use − / +, then ✓.`, keyboard };
  }

  static #esc(s: string): string {
    return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  }
}
