/**
 * BotApp — builds the bot from its secrets: the database clients, Telegram,
 * the BotController and the UpdateQueue. Used by the telegram-bot webhook and
 * by telegram-summaries (which sweeps the queue on its schedule).
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { BatchEntryService } from './BatchEntryService.ts';
import { BotController } from './BotController.ts';
import { DeliveryBot } from './DeliveryBot.ts';
import { DeliveryStore } from './DeliveryStore.ts';
import { EntryService } from './EntryService.ts';
import { ExchangeRates } from './ExchangeRates.ts';
import { GroupService } from './GroupService.ts';
import { GroupSummaries } from './GroupSummaries.ts';
import { LinkService } from './LinkService.ts';
import { LocalClock } from './LocalClock.ts';
import { OwedBot } from './OwedBot.ts';
import { PocketStore } from './PocketStore.ts';
import { SummaryReport } from './SummaryReport.ts';
import { TelegramClient } from './TelegramClient.ts';
import { UpdateQueue } from './UpdateQueue.ts';
import { WebhookRegion } from './WebhookRegion.ts';

/** Reads secrets by name, ignoring capitalisation (TELEGRAM_BOT_TOKEN = Telegram_Bot_Token). */
export class SecretReader {
  readonly #byLowerName: Map<string, string>;

  constructor(env: Record<string, string>) {
    this.#byLowerName = new Map(Object.entries(env).map(([k, v]) => [k.toLowerCase(), v]));
  }

  get(name: string): string {
    return this.#byLowerName.get(name.toLowerCase()) ?? '';
  }
}

export class BotApp {
  readonly store: PocketStore;
  readonly rates: ExchangeRates;
  readonly queue: UpdateQueue;
  readonly region: WebhookRegion;

  private constructor(store: PocketStore, rates: ExchangeRates, queue: UpdateQueue, region: WebhookRegion) {
    this.store = store;
    this.rates = rates;
    this.queue = queue;
    this.region = region;
  }

  static create(secrets: SecretReader): BotApp {
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
    const clock = new LocalClock(secrets.get('BOT_TIMEZONE') || 'Asia/Kolkata');
    const rates = new ExchangeRates();
    const entries = new EntryService(store, telegram, clock, rates);
    const controller = new BotController(
      store, telegram, entries,
      new LinkService(store, telegram, auth),
      new BatchEntryService(store, telegram, entries),
      new GroupService(store, telegram, new GroupSummaries(store, new SummaryReport()), clock),
      new DeliveryBot(store, new DeliveryStore(supabase), telegram, clock, rates),
      new OwedBot(store, telegram, clock, rates),
    );
    // BOT_REGION (optional secret): where the database is; defaults to Sydney.
    const region = new WebhookRegion(telegram, secrets.get('SUPABASE_URL'), secrets.get('BOT_REGION'), secrets.get('TELEGRAM_WEBHOOK_SECRET'));
    return new BotApp(store, rates, new UpdateQueue(store, controller), region);
  }
}
