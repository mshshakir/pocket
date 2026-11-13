/**
 * telegram-bot — Supabase Edge Function that logs Pocket transactions from
 * Telegram messages.
 *
 * Secrets (supabase secrets set ...):
 *   TELEGRAM_BOT_TOKEN       from @BotFather
 *   TELEGRAM_WEBHOOK_SECRET  any long random string; also passed to setWebhook
 *   BOT_TIMEZONE             optional, defaults to Asia/Kolkata
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
 *
 * Deploy with --no-verify-jwt: Telegram cannot send a Supabase JWT, so the
 * webhook secret header is the gate instead.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { BotController, LocalClock, type TelegramMessage } from './lib/BotController.ts';
import { PocketStore } from './lib/PocketStore.ts';
import { TelegramClient } from './lib/TelegramClient.ts';

/** Reads secrets by name, ignoring capitalisation (TELEGRAM_BOT_TOKEN = Telegram_Bot_Token). */
class SecretReader {
  readonly #byLowerName: Map<string, string>;

  constructor(env: Record<string, string>) {
    this.#byLowerName = new Map(Object.entries(env).map(([k, v]) => [k.toLowerCase(), v]));
  }

  get(name: string): string {
    return this.#byLowerName.get(name.toLowerCase()) ?? '';
  }
}

class WebhookServer {
  readonly #secret: string;
  readonly #controller: BotController;

  constructor(secret: string, controller: BotController) {
    if (!secret) throw new Error('TELEGRAM_WEBHOOK_SECRET is not set');
    this.#secret = secret;
    this.#controller = controller;
  }

  async handle(req: Request): Promise<Response> {
    if (req.method !== 'POST') return new Response('ok');
    if (req.headers.get('x-telegram-bot-api-secret-token') !== this.#secret) {
      return new Response('forbidden', { status: 403 });
    }
    try {
      const update = await req.json();
      const message: TelegramMessage | undefined = update.message;
      if (message?.chat?.id) await this.#controller.handle(message);
    } catch (err) {
      console.error('[telegram-bot] update failed', err);
    }
    // Always 200 so Telegram doesn't retry; the per-message id dedups any retry anyway.
    return new Response('ok');
  }
}

const secrets = new SecretReader(Deno.env.toObject());

const supabase = createClient(
  secrets.get('SUPABASE_URL'),
  secrets.get('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } },
);

const server = new WebhookServer(
  secrets.get('TELEGRAM_WEBHOOK_SECRET'),
  new BotController(
    new PocketStore(supabase),
    new TelegramClient(secrets.get('TELEGRAM_BOT_TOKEN')),
    new LocalClock(secrets.get('BOT_TIMEZONE') || 'Asia/Kolkata'),
  ),
);

Deno.serve((req) => server.handle(req));
