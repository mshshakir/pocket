/** TelegramClient — the Bot API calls the bot needs: messages, buttons, edits and the command menu. */
import type { BotCommand } from './HelpMenu.ts';

export interface InlineButton { text: string; callback_data: string }
export type Keyboard = InlineButton[][];

export interface SendOptions {
  replyTo?: number;
  html?: boolean;          // Telegram HTML; only for trusted, pre-escaped text
  keyboard?: Keyboard;     // inline buttons under the message
  forceReply?: string;     // open the reply box, with this placeholder
}

export class TelegramClient {
  readonly #token: string;

  constructor(token: string) {
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
    this.#token = token;
  }

  /** Sends a message and returns its id (0 if Telegram refused it). */
  async send(chatId: number, text: string, opts: SendOptions = {}): Promise<number> {
    const result = await this.#call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: opts.html ? 'HTML' : undefined,
      reply_parameters: opts.replyTo ? { message_id: opts.replyTo, allow_sending_without_reply: true } : undefined,
      reply_markup: TelegramClient.#markup(opts),
    });
    return (result as { message_id?: number } | null)?.message_id ?? 0;
  }

  /** Shorthand kept for plain replies. */
  async reply(chatId: number, text: string, replyTo?: number, html = false): Promise<void> {
    await this.send(chatId, text, { replyTo, html });
  }

  /** Replaces a message's text and buttons (no keyboard removes them). */
  async edit(chatId: number, messageId: number, text: string, keyboard?: Keyboard): Promise<void> {
    await this.#call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      reply_markup: { inline_keyboard: keyboard ?? [] },
    });
  }

  /** Acknowledges a button tap, optionally with a short toast. */
  async answer(callbackId: string, text?: string): Promise<void> {
    await this.#call('answerCallbackQuery', { callback_query_id: callbackId, text });
  }

  /** Registers the commands shown in the chat's menu button. */
  async setCommands(commands: BotCommand[]): Promise<void> {
    await this.#call('setMyCommands', { commands });
  }

  static #markup(opts: SendOptions) {
    if (opts.keyboard) return { inline_keyboard: opts.keyboard };
    if (opts.forceReply !== undefined) return { force_reply: true, input_field_placeholder: opts.forceReply };
    return undefined;
  }

  async #call(method: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`https://api.telegram.org/bot${this.#token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[telegram] ${method} failed`, res.status, await res.text());
      return null;
    }
    return (await res.json())?.result ?? null;
  }
}
