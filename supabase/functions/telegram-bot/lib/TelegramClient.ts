/** TelegramClient — the Bot API calls the bot needs: replies and the command menu. */
import type { BotCommand } from './HelpMenu.ts';

export class TelegramClient {
  readonly #token: string;

  constructor(token: string) {
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
    this.#token = token;
  }

  /** @param html send as Telegram HTML (only for trusted, pre-escaped text) */
  async reply(chatId: number, text: string, replyTo?: number, html = false): Promise<void> {
    await this.#call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: html ? 'HTML' : undefined,
      reply_parameters: replyTo ? { message_id: replyTo, allow_sending_without_reply: true } : undefined,
    });
  }

  /** Registers the commands shown in the chat's menu button. */
  async setCommands(commands: BotCommand[]): Promise<void> {
    await this.#call('setMyCommands', { commands });
  }

  async #call(method: string, body: Record<string, unknown>): Promise<void> {
    const res = await fetch(`https://api.telegram.org/bot${this.#token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error(`[telegram] ${method} failed`, res.status, await res.text());
  }
}
