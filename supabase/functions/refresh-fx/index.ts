// Scheduled FX refresh (audit B4).
//
// Pulls USD-based rates from open.er-api.com and upserts them into `fx_rates`
// using the SERVICE ROLE key, which bypasses RLS. Once this is deployed and
// scheduled, `fx_rates` can be made read-only for normal users (see the
// cutover steps in docs/07-handoff.md), removing the open write policy that
// migration 0004 added.
//
// Deploy:   supabase functions deploy refresh-fx
// Invoke:   POST https://<project-ref>.functions.supabase.co/refresh-fx
//
// Env (provided automatically by Supabase): SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "jsr:@supabase/supabase-js@2";

const ENDPOINT = "https://open.er-api.com/v6/latest/USD";

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const res = await fetch(ENDPOINT);
    if (!res.ok) {
      return new Response(`upstream HTTP ${res.status}`, { status: 502 });
    }
    const body = await res.json();
    if (body.result !== "success" || typeof body.rates !== "object") {
      return new Response("unexpected payload", { status: 502 });
    }

    const rows = Object.entries(body.rates as Record<string, number>).map(
      ([code, rate]) => ({ code, rate: Number(rate) }),
    );

    const { error } = await supabase.from("fx_rates").upsert(rows);
    if (error) return new Response(error.message, { status: 500 });

    return new Response(JSON.stringify({ updated: rows.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
});
