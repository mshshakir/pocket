/**
 * telegram-bot — Supabase Edge Function that logs Pocket transactions from
 * Telegram messages.
 *
 * Secrets (supabase secrets set ...):
 *   TELEGRAM_BOT_TOKEN       from @BotFather
 *   TELEGRAM_WEBHOOK_SECRET  any long random string; also passed to setWebhook
 *   BOT_TIMEZONE             optional, defaults to Asia/Kolkata
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY are provided automatically.
 *
 * Deploy with --no-verify-jwt: Telegram cannot send a Supabase JWT, so the
 * webhook secret header is the gate instead.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { BatchEntryService } from './lib/BatchEntryService.ts';
import { BotController, type TelegramCallback, type TelegramMessage } from './lib/BotController.ts';
import { EntryService } from './lib/EntryService.ts';
import { ExchangeRates } from './lib/ExchangeRates.ts';
import { LinkService } from './lib/LinkService.ts';
import { LocalClock } from './lib/LocalClock.ts';
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
      const callback: TelegramCallback | undefined = update.callback_query;
      if (message?.chat?.id) await this.#controller.handleMessage(message);
      else if (callback?.id) await this.#controller.handleCallback(callback);
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

// Sign-in codes for /link run on a separate client with the public key, as in the
// app, so a verified user session can never replace the privileged one above.
const auth = createClient(
  secrets.get('SUPABASE_URL'),
  secrets.get('SUPABASE_ANON_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const store = new PocketStore(supabase);
const telegram = new TelegramClient(secrets.get('TELEGRAM_BOT_TOKEN'));
const entries = new EntryService(
  store,
  telegram,
  new LocalClock(secrets.get('BOT_TIMEZONE') || 'Asia/Kolkata'),
  new ExchangeRates(),
);

const server = new WebhookServer(
  secrets.get('TELEGRAM_WEBHOOK_SECRET'),
  new BotController(
    store, telegram, entries,
    new LinkService(store, telegram, auth),
    new BatchEntryService(store, telegram, entries),
  ),
);

Deno.serve((req) => server.handle(req));
