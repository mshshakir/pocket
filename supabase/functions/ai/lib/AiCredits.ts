/**
 * AiCredits — charging and refunding AI uses through the database
 * (pocket_ai_spend / pocket_ai_refund, migration 0019), which decides who
 * pays: unlimited, the Family owner's pool in their shared space, or the
 * person's own credits. Both are safe to repeat with the same request id.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface Charge {
  ok: boolean;
  reason?: 'no_credits' | 'no_access';
  chargedTo?: 'unlimited' | 'own' | 'family';
  ownerEmail?: string;
  remaining?: number;
}

export class AiCredits {
  readonly #admin: SupabaseClient;

  /** @param admin a client with the service key (the functions are server-only) */
  constructor(admin: SupabaseClient) {
    this.#admin = admin;
  }

  async spend(userId: string, book: string, ref: string): Promise<Charge> {
    const { data, error } = await this.#admin.rpc('pocket_ai_spend', { p_user: userId, p_book: book, p_ref: ref });
    if (error) throw new Error(`spend failed: ${error.message}`);
    return data as Charge;
  }

  async refund(userId: string, ref: string): Promise<void> {
    const { error } = await this.#admin.rpc('pocket_ai_refund', { p_user: userId, p_ref: ref });
    if (error) console.error('[ai] refund failed', ref, error.message);
  }
}
