/**
 * PaymentStore — the database side of payments (migration 0021). Prices,
 * the rules on who may buy what, and applying a paid order all live in the
 * database; this class only calls them with the service key.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface Product {
  product: string;
  name: string;
  plan?: string;
  term?: 'month' | 'year' | 'trial';
  aiCredits?: number;
  amountPaise: number;  // after any running sale
  listPaise?: number;   // before offers
  sale?: string;        // the sale's name, when one applies
  switchDays?: number;  // extra days from the time left on another plan
  switchFrom?: string;  // that plan's name
}

/** Moving to another plan with the time left: how many days it gives there. */
export interface SwitchOption {
  fromPlan: string;
  fromName: string;
  creditPaise: number;
  days: number;
  lower: boolean;  // a cheaper plan: switching is free
}

export interface Switched {
  ok: boolean;
  applied?: boolean;
  reason?: 'closed' | 'unknown' | 'no_credit' | 'not_lower';
  plan?: string;
  days?: number;
  endsAt?: string;
}

export type QuoteRefusal =
  | 'closed' | 'unknown' | 'lifetime' | 'trial_used' | 'has_plan' | 'no_place' | 'no_rest'
  | 'coupon_unknown' | 'coupon_not_started' | 'coupon_expired' | 'coupon_used_up' | 'coupon_not_for_this';

export interface Quote extends Partial<Product> {
  ok: boolean;
  reason?: QuoteRefusal;
  offerIds?: number[];
  coupon?: string;
  applicationId?: number; // the habit programme place being paid for
}

/** Auto-debit for a plan (migration 0053). renewing: false = not an auto-debit product. */
export interface SubscriptionQuote {
  ok: boolean;
  renewing: boolean;
  reason?: string;
  product?: string;
  plan?: string;
  term?: 'month' | 'year';
  amountPaise?: number;
  name?: string;
  totalCount?: number;
}

export interface Charge {
  ok: boolean;
  applied: boolean;
  cancel: string[];  // the person's other renewing subscriptions, now replaced
}

export interface Fulfilment {
  ok: boolean;
  applied: boolean;
}

export class PaymentStore {
  readonly #admin: SupabaseClient;

  constructor(admin: SupabaseClient) {
    this.#admin = admin;
  }

  async products(): Promise<Product[]> {
    return (await this.#rpc('pocket_payment_products', {})) as Product[];
  }

  /** The price for this person, after any sale and the coupon code, if given (migration 0028). */
  async quote(userId: string, product: string, code: string | null = null): Promise<Quote> {
    return (await this.#rpc('pocket_payment_quote_with', { p_user: userId, p_product: product, p_code: code })) as Quote;
  }

  async saveOrder(orderId: string, userId: string, q: Quote): Promise<void> {
    const { error } = await this.#admin.from('payment_orders').insert({
      id: orderId, user_id: userId, product: q.product, plan: q.plan ?? null, term: q.term ?? null,
      ai_credits: q.aiCredits ?? null, amount_paise: q.amountPaise, list_paise: q.listPaise ?? null,
      offer_ids: q.offerIds?.length ? q.offerIds : null, coupon_code: q.coupon ?? null,
      application_id: q.applicationId ?? null,
    });
    if (error) throw new Error(`saving the order failed: ${error.message}`);
  }

  /** Each other plan this person could move to with their time left (keyed by plan code). */
  async switchOptions(userId: string): Promise<Record<string, SwitchOption>> {
    return ((await this.#rpc('pocket_switch_options', { p_user: userId })) ?? {}) as Record<string, SwitchOption>;
  }

  /** Moves to a cheaper plan without paying; the time left becomes days there. */
  async switchPlan(userId: string, plan: string): Promise<Switched> {
    return (await this.#rpc('pocket_payment_switch', { p_user: userId, p_plan: plan })) as Switched;
  }

  /** Who placed an order, or null when it isn't one of ours. */
  async ownerOf(orderId: string): Promise<string | null> {
    const { data, error } = await this.#admin.from('payment_orders').select('user_id').eq('id', orderId).maybeSingle();
    if (error) throw new Error(`reading the order failed: ${error.message}`);
    return (data as { user_id: string } | null)?.user_id ?? null;
  }

  /** Applies a paid order. Safe to repeat: the second call changes nothing. */
  async fulfil(orderId: string, paymentId: string): Promise<Fulfilment> {
    return (await this.#rpc('pocket_payment_fulfil', { p_order: orderId, p_payment: paymentId })) as Fulfilment;
  }

  // ── Auto-debit ─────────────────────────────────────────────────────────

  async subscriptionQuote(userId: string, product: string): Promise<SubscriptionQuote> {
    return (await this.#rpc('pocket_subscription_quote', { p_user: userId, p_product: product })) as SubscriptionQuote;
  }

  /** The Razorpay plan id for this product at this price, or null. */
  async razorpayPlan(product: string, amountPaise: number): Promise<string | null> {
    return (await this.#rpc('pocket_rp_plan_get', { p_product: product, p_amount: amountPaise })) as string | null;
  }

  /** Remembers a Razorpay plan id; returns the one kept (an earlier one wins). */
  async saveRazorpayPlan(product: string, amountPaise: number, planId: string): Promise<string> {
    return (await this.#rpc('pocket_rp_plan_save', { p_product: product, p_amount: amountPaise, p_plan_id: planId })) as string;
  }

  async saveSubscription(id: string, userId: string, quote: SubscriptionQuote, planId: string): Promise<void> {
    await this.#rpc('pocket_subscription_save', { p_id: id, p_user: userId, p_quote: quote, p_rp_plan: planId });
  }

  /** Who started a subscription, or null when it isn't one of ours. */
  async subscriptionOwner(id: string): Promise<string | null> {
    return (await this.#rpc('pocket_subscription_owner', { p_id: id })) as string | null;
  }

  /** Applies one paid charge. Safe to repeat. */
  async charge(subscriptionId: string, paymentId: string, amountPaise: number | null): Promise<Charge> {
    const r = (await this.#rpc('pocket_subscription_charge', { p_sub: subscriptionId, p_payment: paymentId, p_amount: amountPaise ?? 0 })) as Charge;
    return { ok: r.ok, applied: r.applied, cancel: Array.isArray(r.cancel) ? r.cancel : [] };
  }

  async subscriptionStatus(id: string, status: string): Promise<void> {
    await this.#rpc('pocket_subscription_status', { p_sub: id, p_status: status });
  }

  /** The person's renewing subscription, or null. */
  async currentSubscription(userId: string): Promise<{ id: string; product: string } | null> {
    return (await this.#rpc('pocket_subscription_current', { p_user: userId })) as { id: string; product: string } | null;
  }

  async #rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await this.#admin.rpc(fn, args);
    if (error) throw new Error(`${fn} failed: ${error.message}`);
    return data;
  }
}
