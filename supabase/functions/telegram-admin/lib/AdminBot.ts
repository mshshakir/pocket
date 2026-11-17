/**
 * AdminBot — Pocket's admin bot (migration 0062). Separate from the Pocket
 * bot: it never logs or reads entries. It answers only chats linked to an
 * admin; anyone else gets nothing (except a pointer on /start).
 *
 *   update(u)  a Telegram update (message or button tap)
 *   notify()   sends waiting alerts, and the evening summary when due
 */
import type { AdminStore } from './AdminStore.ts';
import { AdminFormat } from './AdminFormat.ts';
import type { TelegramApi } from './TelegramApi.ts';

export class AdminBot {
  static readonly COMMANDS = [
    { command: 'stats', description: 'Users, plans, money, bot reply time' },
    { command: 'requests', description: 'Free requests waiting' },
    { command: 'auto', description: 'Automatic approvals (limit / reset)' },
    { command: 'help', description: 'What this bot does' },
  ];

  readonly #store: AdminStore;
  readonly #tg: TelegramApi;

  constructor(store: AdminStore, tg: TelegramApi) {
    this.#store = store;
    this.#tg = tg;
  }

  async update(u: Record<string, any>): Promise<void> {
    if (u.callback_query) return await this.#button(u.callback_query);
    const msg = u.message;
    const chatId = Number(msg?.chat?.id);
    const text = String(msg?.text ?? '').trim();
    if (!chatId || !text || msg?.chat?.type !== 'private') return;

    const [cmd, ...args] = text.split(/\s+/);
    const command = cmd.toLowerCase().replace(/@\w+$/, '');
    if (command === '/start' && args[0]) return await this.#link(chatId, args[0]);
    if (!(await this.#store.isAdmin(chatId))) {
      if (command === '/start') await this.#tg.send(chatId, 'This bot is for Pocket\'s admin. Link it from the admin dashboard.');
      return;
    }
    switch (command) {
      case '/start': case '/help': await this.#tg.send(chatId, AdminFormat.help()); return;
      case '/stats': await this.#stats(chatId); return;
      case '/requests': await this.#requests(chatId); return;
      case '/auto': await this.#auto(chatId, args[0]); return;
      default: await this.#tg.send(chatId, 'I didn\'t understand that. /help lists what I can do.');
    }
  }

  async notify(): Promise<{ sent: number; summary: boolean }> {
    const chats = await this.#store.chats();
    const events = await this.#store.events();
    if (!chats.length) {
      // Nobody linked yet: keep the alerts until someone is.
      return { sent: 0, summary: false };
    }
    for (const e of events) {
      const { html, buttons } = AdminFormat.event(e);
      for (const c of chats) await this.#tg.send(c, html, buttons);
    }
    await this.#store.eventsDone(events.map((e) => e.id));
    let summary = false;
    if (await this.#store.summaryDue()) {
      const html = await this.#statsHtml();
      for (const c of chats) await this.#tg.send(c, `🌙 <b>Evening summary</b>\n\n${html}`);
      summary = true;
    }
    return { sent: events.length, summary };
  }

  async #link(chatId: number, code: string): Promise<void> {
    const r = await this.#store.link(code, chatId);
    await this.#tg.send(chatId, r.ok
      ? `✅ Linked to ${AdminFormat.esc(r.email ?? 'your admin account')}. Alerts will come here.\n\n${AdminFormat.help()}`
      : 'That code didn\'t work. It may have expired (15 minutes) or been used. Make a new one in the admin dashboard.');
  }

  async #statsHtml(): Promise<string> {
    const [s, speed] = await Promise.all([this.#store.stats(), this.#store.botSpeed().catch(() => null)]);
    return AdminFormat.stats(s, speed);
  }

  async #stats(chatId: number): Promise<void> {
    await this.#tg.send(chatId, await this.#statsHtml());
  }

  async #requests(chatId: number): Promise<void> {
    const list = await this.#store.requests();
    if (!list.length) { await this.#tg.send(chatId, 'No free requests waiting.'); return; }
    for (const r of list) await this.#tg.send(chatId, AdminFormat.request(r), AdminFormat.requestButtons(r.id));
  }

  async #auto(chatId: number, arg?: string): Promise<void> {
    const a = (arg ?? '').toLowerCase();
    if (a && a !== 'reset' && !/^\d{1,6}$/.test(a)) {
      await this.#tg.send(chatId, 'Use /auto to see it, /auto 80 to set the limit, or /auto reset to start counting again.');
      return;
    }
    const r = await this.#store.auto(chatId, /^\d+$/.test(a) ? Number(a) : null, a === 'reset');
    const left = Math.max(0, r.limit - r.used);
    const done = a === 'reset' ? '✅ Count reset to 0\n\n' : a ? `✅ Limit set to ${r.limit}\n\n` : '';
    await this.#tg.send(chatId, `${done}🆓 <b>Automatic approvals</b>\n<b>${r.used}</b> of ${r.limit} used · ${left ? `${left} left` : 'used up: new requests wait for you'}`);
  }

  async #button(q: Record<string, any>): Promise<void> {
    const chatId = Number(q.message?.chat?.id);
    const m = /^fr:([ad]):(\d+)$/.exec(String(q.data ?? ''));
    if (!chatId || !m || !(await this.#store.isAdmin(chatId))) { await this.#tg.answer(q.id); return; }
    const status = m[1] === 'a' ? 'approved' : 'declined';
    const r = await this.#store.setRequest(chatId, Number(m[2]), status);
    if (!r.ok) {
      await this.#tg.answer(q.id, 'Already decided');
      return;
    }
    const until = r.validUntil ? new Date(r.validUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    await this.#tg.edit(chatId, Number(q.message.message_id), status === 'approved'
      ? `✅ <b>Approved</b> until ${until}\n${AdminFormat.esc(r.name)} · ${AdminFormat.esc(r.email)}`
      : `❌ <b>Declined</b>\n${AdminFormat.esc(r.name)} · ${AdminFormat.esc(r.email)}`);
    await this.#tg.answer(q.id, status === 'approved' ? 'Approved' : 'Declined');
  }
}
