/**
 * AiCredits — charging and refunding AI uses through the database
 * (pocket_ai_charge, migration 0043; pocket_ai_refund, 0019), which decides
 * what a request costs (a scan, or a voice entry by its length) and who pays:
 * unlimited, the Family owner's pool in their shared space, or the person's
 * own credits. Both are safe to repeat with the same request id.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface Charge {
  ok: boolean;
  reason?: 'no_credits' | 'no_access' | 'too_many';
  chargedTo?: 'unlimited' | 'own' | 'family';
  ownerEmail?: string;
  remaining?: number;
  /** Credits this request costs (0 for unlimited). */
  cost?: number;
  /** A text-only use within the daily free limit, or a free call of an import. */
  free?: boolean;
  /** Import with AI: the ledger ref of the call that charged the import (to give back). */
  chargeRef?: string;
}

export class AiCredits {
  readonly #admin: SupabaseClient;

  /** @param admin a client with the service key (the functions are server-only) */
  constructor(admin: SupabaseClient) {
    this.#admin = admin;
  }

  /** @param seconds  length of the recording, for a voice entry */
  async spend(userId: string, book: string, ref: string, kind: 'receipt' | 'voice' | 'setup', seconds: number): Promise<Charge> {
    const { data, error } = await this.#admin.rpc('pocket_ai_charge', {
      p_user: userId, p_book: book, p_ref: ref, p_kind: kind, p_seconds: Math.round(seconds),
    });
    if (error) throw new Error(`spend failed: ${error.message}`);
    return data as Charge;
  }

  /**
   * A text-only use (setup suggestions): free up to the daily limit, then
   * charged like other uses (pocket_ai_text, migration 0065).
   */
  async text(userId: string, ref: string): Promise<Charge> {
    const { data, error } = await this.#admin.rpc('pocket_ai_text', { p_user: userId, p_ref: ref });
    if (error) throw new Error(`text failed: ${error.message}`);
    return data as Charge;
  }

  /**
   * One call of an Import with AI (pocket_ai_import, migration 0069): the
   * account's first import is free (up to 5,000 rows); another import is
   * charged once, on its first call; the corrections after it are free.
   */
  async importUse(userId: string, session: string, rows: number, ref: string): Promise<Charge> {
    const { data, error } = await this.#admin.rpc('pocket_ai_import', { p_user: userId, p_session: session, p_rows: rows, p_ref: ref });
    if (error) throw new Error(`import failed: ${error.message}`);
    return data as Charge;
  }

  /** The AI failed on an import call: not counted, and credits given back if it charged. */
  async importRefund(userId: string, session: string, chargeRef: string | undefined): Promise<void> {
    const { error } = await this.#admin.rpc('pocket_ai_import_refund', { p_user: userId, p_session: session, p_ref: chargeRef ?? '' });
    if (error) console.error('[ai] import refund failed', session, error.message);
  }

  async refund(userId: string, ref: string): Promise<void> {
    const { error } = await this.#admin.rpc('pocket_ai_refund', { p_user: userId, p_ref: ref });
    if (error) console.error('[ai] refund failed', ref, error.message);
  }
}
