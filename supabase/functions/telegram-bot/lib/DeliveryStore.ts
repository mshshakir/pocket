/**
 * DeliveryStore — the database side of pay-later items and bills for the bot
 * (migrations 0031–0032): the items, who may be told, changing a day as a
 * verified person (the server checks their access), the morning check-ins and
 * the messages they went out as, and bill reminders.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { DeliveryItem } from './DeliveryDay.ts';

/** Someone who may hear about an owner's item: the owner, or a family member with add access. */
export interface NotifyPerson {
  email: string;
  name: string;
  chats: number[];
}

export interface NotifyGroup {
  chatId: number;
  threadId: number | null;
}

export interface Checkin {
  id: number;
  owner_id: string;
  day: string;
  slot: string;
  items: string[];
  answered_by: string | null;
}

export interface CheckinMessage {
  chat_id: number;
  message_id: number;
}

/** A recurring entry marked "amount changes, ask me" (pocket_bill_templates). */
export interface BillTemplate {
  ownerId: string;
  id: string;
  payee: string;
  amount: number;
  currency: string;
  date: string;
  accountId: string;
  categoryId: string | null;
  rule: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number | null;
  until: string | null;
  skipped: string[];
  remindTo: 'all' | 'one' | 'group' | 'off';
  remindEmail: string | null;
  remindDays: number;
  lastAmount: number;
  paid: string[];
}

export interface BillReminder {
  id: number;
  owner_id: string;
  template_id: string;
  occurrence: string;
  kind: 'before' | 'due';
}

export type DeliveryChange =
  | { set: { date: string; qty: number } }
  | { clear: string }
  | { paidTo: string; tx?: string };

export class DeliveryStore {
  readonly #sb: SupabaseClient;

  constructor(sb: SupabaseClient) {
    this.#sb = sb;
  }

  /** Every pay-later item with a check-in (not "No messages"). */
  async checkinItems(): Promise<DeliveryItem[]> {
    return (await this.#rpc('pocket_delivery_items', {}) ?? []) as DeliveryItem[];
  }

  /** One owner's pay-later items. */
  async itemsOf(ownerId: string): Promise<DeliveryItem[]> {
    return (await this.#rpc('pocket_delivery_items_of', { p_owner: ownerId }) ?? []) as DeliveryItem[];
  }

  /** Changes an item as `actorId`; throws the server's reason (no access, a paid day…). */
  async change(actorId: string, ownerId: string, itemId: string, change: DeliveryChange): Promise<void> {
    await this.#rpc('pocket_delivery_apply', { p_actor: actorId, p_owner: ownerId, p_item: itemId, p_change: change });
  }

  /** 4 owner · 3 full · 2 edit · 1 add · 0 view · -1 none (pocket_member_access). */
  async access(actorId: string, ownerId: string, accountId: string | null): Promise<number> {
    return Number(await this.#rpc('pocket_member_access', { p_actor: actorId, p_owner: ownerId, p_account: accountId ?? '' }));
  }

  async people(ownerId: string, accountId: string | null): Promise<NotifyPerson[]> {
    return (await this.#rpc('pocket_notify_people', { p_owner: ownerId, p_account: accountId ?? '' }) ?? []) as NotifyPerson[];
  }

  async groups(ownerId: string, accountId: string | null): Promise<NotifyGroup[]> {
    return (await this.#rpc('pocket_notify_groups', { p_owner: ownerId, p_account: accountId ?? '' }) ?? []) as NotifyGroup[];
  }

  /** Owners whose items this email may change (owner, or family with add access to the item's account). */
  async ownersFor(userId: string, email: string): Promise<string[]> {
    const { data, error } = await this.#sb.from('family_members').select('owner_id')
      .ilike('email', email.toLowerCase().trim().replace(/[\\%_]/g, (c) => `\\${c}`)).is('deleted_at', null);
    if (error) throw error;
    return [...new Set([userId, ...((data ?? []) as { owner_id: string }[]).map((r) => r.owner_id)])];
  }

  // ── check-ins ───────────────────────────────────────────────────────────

  /** Claims today's check-in for a slot; null when it was already sent. */
  async claimCheckin(ownerId: string, day: string, slot: string, items: string[]): Promise<number | null> {
    const { data, error } = await this.#sb.from('delivery_checkins')
      .upsert({ owner_id: ownerId, day, slot, items }, { onConflict: 'owner_id,day,slot', ignoreDuplicates: true })
      .select('id');
    if (error) throw error;
    return ((data ?? []) as { id: number }[])[0]?.id ?? null;
  }

  async checkin(id: number): Promise<Checkin | null> {
    const { data, error } = await this.#sb.from('delivery_checkins').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data as Checkin | null;
  }

  /** Today's latest check-in of an owner that includes this item (for typed changes and /deliveries). */
  async latestCheckin(ownerId: string, day: string): Promise<Checkin | null> {
    const { data, error } = await this.#sb.from('delivery_checkins').select('*')
      .eq('owner_id', ownerId).eq('day', day).order('id', { ascending: false }).limit(1);
    if (error) throw error;
    return ((data ?? []) as Checkin[])[0] ?? null;
  }

  async saveMessage(checkinId: number, chatId: number, messageId: number): Promise<void> {
    const { error } = await this.#sb.from('delivery_checkin_messages')
      .upsert({ checkin_id: checkinId, chat_id: chatId, message_id: messageId });
    if (error) throw error;
  }

  async messages(checkinId: number): Promise<CheckinMessage[]> {
    const { data, error } = await this.#sb.from('delivery_checkin_messages').select('chat_id, message_id').eq('checkin_id', checkinId);
    if (error) throw error;
    return (data ?? []) as CheckinMessage[];
  }

  /** Marks a check-in answered by `name`; false when someone already had. */
  async answer(checkinId: number, name: string): Promise<boolean> {
    const { data, error } = await this.#sb.from('delivery_checkins')
      .update({ answered_by: name, answered_at: new Date().toISOString() })
      .eq('id', checkinId).is('answered_at', null).select('id');
    if (error) throw error;
    return !!data?.length;
  }

  // ── bills ───────────────────────────────────────────────────────────────

  async billTemplates(): Promise<BillTemplate[]> {
    return (await this.#rpc('pocket_bill_templates', {}) ?? []) as BillTemplate[];
  }

  /** Claims one reminder; its id (for the buttons), or null when it was already sent. */
  async claimReminder(ownerId: string, templateId: string, occurrence: string, kind: 'before' | 'due'): Promise<number | null> {
    const { data, error } = await this.#sb.from('bill_reminders')
      .upsert({ owner_id: ownerId, template_id: templateId, occurrence, kind }, { onConflict: 'owner_id,template_id,occurrence,kind', ignoreDuplicates: true })
      .select('id');
    if (error) throw error;
    return ((data ?? []) as { id: number }[])[0]?.id ?? null;
  }

  async reminder(id: number): Promise<BillReminder | null> {
    const { data, error } = await this.#sb.from('bill_reminders').select('id, owner_id, template_id, occurrence, kind').eq('id', id).maybeSingle();
    if (error) throw error;
    return data as BillReminder | null;
  }

  /** Adds a skipped date to a bill (recurring.skipped). */
  async skipBill(ownerId: string, templateId: string, occurrence: string): Promise<void> {
    const { data, error } = await this.#sb.from('transactions').select('recurring_skipped')
      .eq('owner_id', ownerId).eq('id', templateId).maybeSingle();
    if (error) throw error;
    const had = ((data as { recurring_skipped: string[] | null } | null)?.recurring_skipped) ?? [];
    if (had.includes(occurrence)) return;
    const { error: e2 } = await this.#sb.from('transactions')
      .update({ recurring_skipped: [...had, occurrence].sort() }).eq('owner_id', ownerId).eq('id', templateId);
    if (e2) throw e2;
  }

  async #rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await this.#sb.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  }
}
