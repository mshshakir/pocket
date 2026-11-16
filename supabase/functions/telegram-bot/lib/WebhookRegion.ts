/**
 * WebhookRegion — keeps the bot running next to its database.
 *
 * Supabase runs an Edge Function in the region nearest the caller. Telegram
 * calls from Amsterdam, so the bot ran in Frankfurt while the database is in
 * Sydney, and every query crossed the globe (~0.3 s each). Telegram can't
 * send headers, so the region goes in the webhook URL as forceFunctionRegion.
 *
 * When an update arrives on a URL without it, the bot points its own webhook
 * at the pinned URL (same secret; Telegram keeps the other settings). Once
 * per function instance; a failure only means it tries again next time.
 */
import type { TelegramClient } from './TelegramClient.ts';

export class WebhookRegion {
  static readonly DEFAULT = 'ap-southeast-2'; // the database's region (Sydney)

  readonly #telegram: TelegramClient;
  readonly #functionUrl: string;
  readonly #region: string;
  readonly #secret: string;
  #tried = false;

  constructor(telegram: TelegramClient, supabaseUrl: string, region: string, secret: string) {
    this.#telegram = telegram;
    this.#functionUrl = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/telegram-bot`;
    this.#region = region || WebhookRegion.DEFAULT;
    this.#secret = secret;
  }

  /** The webhook URL pinned to the database's region. */
  get pinnedUrl(): string {
    return `${this.#functionUrl}?forceFunctionRegion=${encodeURIComponent(this.#region)}`;
  }

  /** Whether this request came in on the pinned URL. */
  isPinned(requestUrl: string): boolean {
    try {
      return new URL(requestUrl).searchParams.get('forceFunctionRegion') === this.#region;
    } catch {
      return false;
    }
  }

  /** Re-points the webhook if this request wasn't on the pinned URL. */
  async ensure(requestUrl: string): Promise<void> {
    if (this.#tried || this.isPinned(requestUrl)) return;
    this.#tried = true;
    const ok = await this.#telegram.setWebhook(this.pinnedUrl, this.#secret);
    console.log(`[telegram-bot] webhook → ${this.#region}: ${ok ? 'done' : 'failed'}`);
  }
}
