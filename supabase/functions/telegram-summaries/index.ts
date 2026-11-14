/**
 * telegram-summaries — posts the daily and weekly summaries that are due to
 * Telegram groups tied to a shared space (migration 0022).
 *
 * Called every hour by pg_cron (job "telegram-summaries"). It works out for
 * itself what is due (from 9 pm local time, once per day / per week) and
 * claims each summary in the database before sending, so a call at the wrong
 * time, a repeated call, or a call by anyone else posts nothing extra. That is
 * why it is deployed with --no-verify-jwt and needs no secret of its own.
 *
 * Secrets: TELEGRAM_BOT_TOKEN (shared with telegram-bot), BOT_TIMEZONE
 * (optional, Asia/Kolkata), and SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { GroupSummaries } from '../telegram-bot/lib/GroupSummaries.ts';
import { LocalClock } from '../telegram-bot/lib/LocalClock.ts';
import { PocketStore } from '../telegram-bot/lib/PocketStore.ts';
import { SummaryReport } from '../telegram-bot/lib/SummaryReport.ts';
import { SummaryRunner } from '../telegram-bot/lib/SummaryRunner.ts';
import { TelegramClient } from '../telegram-bot/lib/TelegramClient.ts';

const env = new Map(Object.entries(Deno.env.toObject()).map(([k, v]) => [k.toLowerCase(), v]));
const get = (name: string) => env.get(name.toLowerCase()) ?? '';

const store = new PocketStore(createClient(get('SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } }));
const telegram = new TelegramClient(get('TELEGRAM_BOT_TOKEN'));
const runner = new SummaryRunner(
  store, telegram,
  new GroupSummaries(store, new SummaryReport()),
  new LocalClock(get('BOT_TIMEZONE') || 'Asia/Kolkata'),
);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');
  try {
    return Response.json(await runner.run());
  } catch (e) {
    console.error('[summaries]', e);
    return new Response('failed', { status: 500 });
  }
});
