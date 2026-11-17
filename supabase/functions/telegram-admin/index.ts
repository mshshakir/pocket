/**
 * telegram-admin — Pocket's admin bot (@Shakirs_PocketAdminBot), separate
 * from the Pocket bot that logs entries (migration 0062).
 *
 * Secret: TELEGRAM_ADMIN_BOT_TOKEN (from @BotFather). The webhook secret is
 * worked out from it (lib/WebhookSecret.ts), and the function sets its own
 * webhook and command list on the first /notify run.
 *
 *   POST /telegram-admin          Telegram updates (checked by the secret header)
 *   POST /telegram-admin/notify   pg_cron every 5 minutes: alerts, evening summary
 *
 * Deployed with --no-verify-jwt (Telegram and pg_cron send no Supabase sign-in).
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AdminBot } from './lib/AdminBot.ts';
import { AdminStore } from './lib/AdminStore.ts';
import { TelegramApi } from './lib/TelegramApi.ts';
import { WebhookSecret } from './lib/WebhookSecret.ts';

const env = Deno.env.toObject();
const token = env.TELEGRAM_ADMIN_BOT_TOKEN ?? '';
const SELF = `${env.SUPABASE_URL}/functions/v1/telegram-admin`;

class AdminServer {
  readonly #bot: AdminBot;
  readonly #tg: TelegramApi;
  readonly #secret: Promise<string>;
  #webhookChecked = false;

  constructor(bot: AdminBot, tg: TelegramApi, secret: Promise<string>) {
    this.#bot = bot;
    this.#tg = tg;
    this.#secret = secret;
  }

  async handle(req: Request): Promise<Response> {
    if (!token) return new Response('TELEGRAM_ADMIN_BOT_TOKEN is not set', { status: 503 });
    if (req.method !== 'POST') return new Response('ok');
    try {
      if (new URL(req.url).pathname.endsWith('/notify')) {
        await this.#ensureWebhook();
        return Response.json(await this.#bot.notify());
      }
      if (req.headers.get('x-telegram-bot-api-secret-token') !== await this.#secret) return new Response('forbidden', { status: 403 });
      const update = await req.json().catch(() => null);
      if (update) await this.#bot.update(update);
      return new Response('ok');
    } catch (e) {
      console.error('[telegram-admin]', e);
      return new Response('ok'); // never make Telegram resend an admin command
    }
  }

  /** Points the bot at this function (once per start-up, if it isn't already). */
  async #ensureWebhook(): Promise<void> {
    if (this.#webhookChecked) return;
    if ((await this.#tg.webhookUrl()) !== SELF) {
      await this.#tg.setWebhook(SELF, await this.#secret);
      await this.#tg.setCommands(AdminBot.COMMANDS);
    }
    this.#webhookChecked = true;
  }
}

const tg = new TelegramApi(token);
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const server = new AdminServer(new AdminBot(new AdminStore(db), tg), tg, WebhookSecret.from(token));
Deno.serve((req) => server.handle(req));
