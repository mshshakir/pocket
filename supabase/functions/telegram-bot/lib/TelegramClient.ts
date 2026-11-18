/** TelegramClient — the Bot API calls the bot needs: messages, buttons, edits and the command menu. */
import type { BotCommand } from './HelpMenu.ts';

export interface InlineButton { text: string; callback_data: string }
export type Keyboard = InlineButton[][];

export interface SendOptions {
  replyTo?: number;
  html?: boolean;          // Telegram HTML; only for trusted, pre-escaped text
  keyboard?: Keyboard;     // inline buttons under the message
  forceReply?: string;     // open the reply box, with this placeholder
  threadId?: number | null; // a topic in a group with topics
}

export class TelegramClient {
  readonly #token: string;
  readonly #fetch: typeof fetch;

  constructor(token: string, fetcher: typeof fetch = fetch) {
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
    this.#token = token;
    this.#fetch = fetcher;
  }

  /** Sends a message and returns its id (0 if Telegram refused it). */
  async send(chatId: number, text: string, opts: SendOptions = {}): Promise<number> {
    const result = await this.#call('sendMessage', {
      chat_id: chatId,
      message_thread_id: opts.threadId ?? undefined,
      text,
      parse_mode: opts.html ? 'HTML' : undefined,
      reply_parameters: opts.replyTo ? { message_id: opts.replyTo, allow_sending_without_reply: true } : undefined,
      reply_markup: TelegramClient.#markup(opts),
    });
    return (result as { message_id?: number } | null)?.message_id ?? 0;
  }

  /**
   * Sends a message (into a topic, if given) and says whether the chat is gone
   * for good (the bot was removed, or the group no longer exists) or only the
   * topic is (deleted or closed).
   */
  async post(chatId: number, text: string, html = false, threadId: number | null = null): Promise<{ ok: boolean; gone: boolean; topicGone: boolean }> {
    const res = await this.#raw('sendMessage', {
      chat_id: chatId, message_thread_id: threadId ?? undefined, text, parse_mode: html ? 'HTML' : undefined,
    });
    if (res.ok) return { ok: true, gone: false, topicGone: false };
    const gone = res.status === 403 || (res.status === 400 && /chat not found|group chat was (upgraded|deactivated)/i.test(res.description));
    const topicGone = !gone && threadId != null && res.status === 400 && /thread|topic/i.test(res.description);
    return { ok: false, gone, topicGone };
  }

  /** Shorthand kept for plain replies. */
  async reply(chatId: number, text: string, replyTo?: number, html = false): Promise<void> {
    await this.send(chatId, text, { replyTo, html });
  }

  /** Replaces a message's text and buttons (no keyboard removes them). */
  async edit(chatId: number, messageId: number, text: string, keyboard?: Keyboard, html = false): Promise<void> {
    await this.#call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: html ? 'HTML' : undefined,
      reply_markup: { inline_keyboard: keyboard ?? [] },
    });
  }

  /**
   * Downloads a file a person sent (voice note, photo, document). Telegram lets
   * bots download files up to 20 MB; null if it can't be fetched.
   */
  async download(fileId: string): Promise<Uint8Array | null> {
    const file = await this.#call('getFile', { file_id: fileId }) as { file_path?: string } | null;
    if (!file?.file_path) return null;
    try {
      const res = await this.#fetch(`https://api.telegram.org/file/bot${this.#token}/${file.file_path}`);
      if (!res.ok) { console.error('[telegram] download failed', res.status); return null; }
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      console.error('[telegram] download failed', e);
      return null;
    }
  }

  /** Points the webhook at a URL, keeping the secret header (other settings stay as they were). */
  async setWebhook(url: string, secretToken: string): Promise<boolean> {
    return (await this.#raw('setWebhook', { url, secret_token: secretToken })).ok;
  }

  /** Shows "typing…" in the chat until the next message is sent (or ~5 s pass). */
  async typing(chatId: number): Promise<void> {
    await this.#call('sendChatAction', { chat_id: chatId, action: 'typing' });
  }

  /** Acknowledges a button tap, optionally with a short toast. */
  async answer(callbackId: string, text?: string): Promise<void> {
    await this.#call('answerCallbackQuery', { callback_query_id: callbackId, text });
  }

  /** Registers the commands shown in the menu button (private chats by default, or all groups). */
  async setCommands(commands: BotCommand[], scope: 'default' | 'all_group_chats' = 'default'): Promise<void> {
    await this.#call('setMyCommands', { commands, scope: scope === 'default' ? undefined : { type: scope } });
  }

  static #markup(opts: SendOptions) {
    if (opts.keyboard) return { inline_keyboard: opts.keyboard };
    if (opts.forceReply !== undefined) return { force_reply: true, input_field_placeholder: opts.forceReply };
    return undefined;
  }

  async #call(method: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await this.#raw(method, body);
    return res.ok ? res.result : null;
  }

  async #raw(method: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; description: string; result: unknown }> {
    let res: Response;
    try {
      res = await this.#fetch(`https://api.telegram.org/bot${this.#token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      console.error(`[telegram] ${method} failed`, e);
      return { ok: false, status: 0, description: String(e), result: null };
    }
    if (!res.ok) {
      const text = await res.text();
      console.error(`[telegram] ${method} failed`, res.status, text);
      let description = text;
      try { description = JSON.parse(text)?.description ?? text; } catch (_) { /* not JSON */ }
      return { ok: false, status: res.status, description, result: null };
    }
    return { ok: true, status: res.status, description: '', result: (await res.json())?.result ?? null };
  }
}
