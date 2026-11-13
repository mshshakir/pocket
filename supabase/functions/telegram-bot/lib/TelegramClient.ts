/** TelegramClient — the one Bot API call the bot needs: sending a reply. */
export class TelegramClient {
  readonly #token: string;

  constructor(token: string) {
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
    this.#token = token;
  }

  async reply(chatId: number, text: string, replyTo?: number): Promise<void> {
    const res = await fetch(`https://api.telegram.org/bot${this.#token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_parameters: replyTo ? { message_id: replyTo, allow_sending_without_reply: true } : undefined,
      }),
    });
    if (!res.ok) console.error('[telegram] sendMessage failed', res.status, await res.text());
  }
}
