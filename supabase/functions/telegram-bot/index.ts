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
import { BotApp, SecretReader } from './lib/BotApp.ts';
import type { UpdateQueue } from './lib/UpdateQueue.ts';

/** Keeps work running after the response is sent (Supabase Edge Runtime), or awaits it elsewhere. */
type Background = (work: Promise<unknown>) => Promise<void>;

/**
 * Stores each update, tells Telegram it arrived, then handles it. A slow
 * reply would make Telegram send the same update again; storing first means
 * an update is never lost even if the function stops while handling it.
 */
class WebhookServer {
  readonly #secret: string;
  readonly #app: BotApp;
  readonly #background: Background;

  constructor(secret: string, app: BotApp, background: Background) {
    if (!secret) throw new Error('TELEGRAM_WEBHOOK_SECRET is not set');
    this.#secret = secret;
    this.#app = app;
    this.#background = background;
  }

  async handle(req: Request): Promise<Response> {
    if (req.method !== 'POST') return new Response('ok');
    if (req.headers.get('x-telegram-bot-api-secret-token') !== this.#secret) {
      return new Response('forbidden', { status: 403 });
    }
    let update: Record<string, unknown>;
    try {
      update = await req.json();
    } catch {
      return new Response('ok'); // not an update; nothing to retry
    }
    this.#app.rates.warm(); // ready by the time an entry needs them
    const queue: UpdateQueue = this.#app.queue;
    try {
      if (!(await queue.receive(update))) return new Response('ok'); // a re-send
    } catch (err) {
      // Couldn't store it: fail, so Telegram keeps the update and sends it again.
      console.error('[telegram-bot] could not store update', err);
      return new Response('retry', { status: 503 });
    }
    await this.#background((async () => {
      await queue.handle(update);
      await queue.sweep().catch((err) => console.error('[telegram-bot] sweep', err));
    })());
    return new Response('ok');
  }

  /** EdgeRuntime.waitUntil when available (Supabase), otherwise just wait. */
  static background(): Background {
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
    if (runtime?.waitUntil) return (work) => { runtime.waitUntil(work); return Promise.resolve(); };
    return async (work) => { await work; };
  }
}

const secrets = new SecretReader(Deno.env.toObject());
const server = new WebhookServer(
  secrets.get('TELEGRAM_WEBHOOK_SECRET'),
  BotApp.create(secrets),
  WebhookServer.background(),
);

Deno.serve((req) => server.handle(req));
