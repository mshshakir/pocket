/**
 * TelegramApi — the few Bot API calls the admin bot makes.
 */
export interface InlineButton { text: string; callback_data: string }

export class TelegramApi {
  readonly #token: string;
  readonly #fetch: typeof fetch;

  constructor(token: string, fetcher: typeof fetch = fetch) {
    this.#token = token;
    this.#fetch = fetcher;
  }

  send(chatId: number, html: string, buttons: InlineButton[][] | null = null): Promise<unknown> {
    return this.#call('sendMessage', {
      chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true,
      ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
    });
  }

  edit(chatId: number, messageId: number, html: string): Promise<unknown> {
    return this.#call('editMessageText', { chat_id: chatId, message_id: messageId, text: html, parse_mode: 'HTML', disable_web_page_preview: true });
  }

  answer(callbackId: string, text = ''): Promise<unknown> {
    return this.#call('answerCallbackQuery', { callback_query_id: callbackId, ...(text ? { text } : {}) });
  }

  async webhookUrl(): Promise<string> {
    const r = await this.#call('getWebhookInfo', {}) as { result?: { url?: string } };
    return r?.result?.url ?? '';
  }

  setWebhook(url: string, secret: string): Promise<unknown> {
    return this.#call('setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false });
  }

  setCommands(commands: { command: string; description: string }[]): Promise<unknown> {
    return this.#call('setMyCommands', { commands });
  }

  async #call(method: string, body: unknown): Promise<unknown> {
    const res = await this.#fetch(`https://api.telegram.org/bot${this.#token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) console.error(`[telegram-admin] ${method} failed`, res.status, JSON.stringify(json).slice(0, 300));
    return json;
  }
}
