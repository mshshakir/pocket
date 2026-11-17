/**
 * AdminStore — the database side of the admin bot (migrations 0062, 0063).
 * Every call uses the service key; the pocket_admbot_* functions check that
 * the chat belongs to an admin where it matters.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface AdminEvent { id: number; kind: 'payment' | 'free_request' | 'programme' | 'feedback' | string; payload: Record<string, unknown>; at: string }
export interface FreeRequest { id: number; name: string; email: string; reason: string; at: string }

export class AdminStore {
  readonly #db: SupabaseClient;

  constructor(db: SupabaseClient) {
    this.#db = db;
  }

  link(code: string, chatId: number): Promise<{ ok: boolean; email?: string }> {
    return this.#rpc('pocket_admbot_link', { p_code: code, p_chat: chatId }) as Promise<{ ok: boolean; email?: string }>;
  }
  async isAdmin(chatId: number): Promise<boolean> {
    return !!(await this.#rpc('pocket_admbot_admin', { p_chat: chatId }));
  }
  async chats(): Promise<number[]> {
    return ((await this.#rpc('pocket_admbot_chats', {})) as number[] | null ?? []).map(Number);
  }
  stats(): Promise<Record<string, any>> { return this.#rpc('pocket_admbot_stats', {}) as Promise<Record<string, any>>; }
  botSpeed(): Promise<Record<string, any>> { return this.#rpc('pocket_admbot_bot_speed', {}) as Promise<Record<string, any>>; }
  requests(): Promise<FreeRequest[]> { return this.#rpc('pocket_admbot_requests', {}) as Promise<FreeRequest[]>; }
  setRequest(chatId: number, id: number, status: 'approved' | 'declined'): Promise<{ ok: boolean; name?: string; email?: string; validUntil?: string }> {
    return this.#rpc('pocket_admbot_request_set', { p_chat: chatId, p_id: id, p_status: status }) as Promise<{ ok: boolean; name?: string; email?: string; validUntil?: string }>;
  }
  auto(chatId: number, limit: number | null, reset: boolean): Promise<{ limit: number; used: number }> {
    return this.#rpc('pocket_admbot_auto', { p_chat: chatId, p_limit: limit, p_reset: reset }) as Promise<{ limit: number; used: number }>;
  }
  events(): Promise<AdminEvent[]> { return this.#rpc('pocket_admbot_events_take', { p_limit: 20 }) as Promise<AdminEvent[]>; }
  async eventsDone(ids: number[]): Promise<void> { if (ids.length) await this.#rpc('pocket_admbot_events_done', { p_ids: ids }); }
  async summaryDue(): Promise<boolean> { return (await this.#rpc('pocket_admbot_summary_claim', {})) === true; }

  async #rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await this.#db.rpc(fn, args);
    if (error) throw new Error(`${fn} failed: ${error.message}`);
    return data;
  }
}
