/**
 * BudgetAlertStore — the database side of Telegram budget alerts (0039).
 *
 * Reads the totals the app stamps on each budget (alertStatus — never
 * entries) and claims each alert once per budget, period and level in
 * budget_alerts, so a repeated run sends nothing extra.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface BudgetAlertStatusRow {
  key: string;
  from: string;
  to: string;
  label: string;
  name: string;
  currency: string;
  spent: number;
  limit: number;
  ahead: number;
  at: string;
}

export interface BudgetAlertCandidate {
  ownerId: string;
  budgetId: string;
  status: BudgetAlertStatusRow;
  chats: number[];
}

export type BudgetAlertLevel = 'near' | 'over' | 'fast';

export class BudgetAlertStore {
  readonly #sb: SupabaseClient;

  constructor(sb: SupabaseClient) {
    this.#sb = sb;
  }

  async candidates(): Promise<BudgetAlertCandidate[]> {
    const { data, error } = await this.#sb.rpc('pocket_budget_alert_status', {});
    if (error) throw new Error(error.message);
    return ((data ?? []) as BudgetAlertCandidate[]).filter((c) => c && c.status && typeof c.status === 'object');
  }

  /** Levels already sent for this budget and period. */
  async sentLevels(ownerId: string, budgetId: string, periodKey: string): Promise<BudgetAlertLevel[]> {
    const { data, error } = await this.#sb.from('budget_alerts').select('level')
      .eq('owner_id', ownerId).eq('budget_id', budgetId).eq('period_key', periodKey);
    if (error) throw error;
    return ((data ?? []) as { level: BudgetAlertLevel }[]).map((r) => r.level);
  }

  /** True when this alert hadn't been sent yet (and now counts as sent). */
  async claim(ownerId: string, budgetId: string, periodKey: string, level: BudgetAlertLevel): Promise<boolean> {
    const { data, error } = await this.#sb.from('budget_alerts')
      .upsert({ owner_id: ownerId, budget_id: budgetId, period_key: periodKey, level },
        { onConflict: 'owner_id,budget_id,period_key,level', ignoreDuplicates: true })
      .select('owner_id');
    if (error) throw error;
    return ((data ?? []) as unknown[]).length > 0;
  }
}
