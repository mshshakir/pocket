/**
 * BudgetsScreen — budget cards with live spend, a drill-in detail view, and a
 * create/edit form. currentSpend / effectiveLimit / spendByCategory /
 * periodTransactions all come from the SAME BudgetService the web runs, so
 * Hijri periods, rollover and split attribution behave identically.
 *
 * Parity with the web BudgetsView + BudgetDetailView:
 *   • real period label (Gregorian month name or Hijri month + year)
 *   • days-left countdown (Hijri-aware)
 *   • % used, and "$X left" / "Over by $X"
 *   • rollover toggle + "(+$X)" carry-over display
 *   • per-category breakdown for multi-category budgets
 *   • tap a card → detail (breakdown + the period's transactions)
 *   • edit an existing budget (categories, limit, currency, period, rollover)
 */
import React, { useState } from 'react';
import { ScrollView, View, Text, Alert, TouchableOpacity } from 'react-native';
import { useAppState } from '../state/AppContext.js';
import { PickerBus } from '../state/PickerBus.js';
import { Card, Field, Input, Button, Segmented, EmptyState, Dot } from '../ui/common.js';
import { colors } from '../ui/theme.js';
import { CURRENCIES } from '../data/constants.js';
import { HijriCalendarService } from '../domain/services/HijriCalendarService.js';
import { DateService } from '../domain/services/DateService.js';
import { BudgetView } from '../domain/services/BudgetView.js';

const hijri = new HijriCalendarService();

/** Period label + days-left, matching web BudgetsView lines 52-67. */
function periodMeta(b) {
  const isHijri = b.period === 'hijri';
  const now = new Date();
  if (isHijri) {
    const todayH = hijri.toHijri(DateService.todayIso());
    return {
      isHijri: true,
      label: `☾ ${hijri.monthsShort[todayH.month]} ${todayH.year} H`,
      daysLeft: hijri.daysInMonth(todayH.year, todayH.month) - todayH.day,
    };
  }
  const eom = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    isHijri: false,
    label: now.toLocaleDateString(undefined, { month: 'long' }),
    daysLeft: eom.getDate() - now.getDate(),
  };
}

export default function BudgetsScreen({ navigation }) {
  const { state, services, inGuestSpace, guard, space } = useAppState();
  const { fx, budgets, categories } = services;
  /**
   * Every figure below comes from here rather than from BudgetService, which
   * reads the local store: a shared budget's category ids are the OWNER's, so
   * expanding them against the member's tree matched nothing and every shared
   * budget rendered a spend of exactly 0 — indistinguishable from "you haven't
   * spent anything". The owner ships the real figure in the snapshot.
   */
  const view = BudgetView.for({ inGuestSpace, state, services });
  const requireOwn = () => {
    const v = guard?.requireHome('budgets') ?? { ok: true };
    if (!v.ok) Alert.alert('Not here', v.message);
    return v.ok;
  };
  const [editing, setEditing] = useState(null);  // null | {} (new) | budget
  const [viewing, setViewing] = useState(null);   // budget id

  if (editing !== null) {
    return (
      <BudgetForm
        budget={editing.id ? editing : null}
        onDone={() => setEditing(null)}
        navigation={navigation}
        services={services}
        state={state}
      />
    );
  }

  if (viewing !== null) {
    const b = (state.budgets || []).find((x) => x.id === viewing);
    if (!b) { setViewing(null); return null; }
    return (
      <BudgetDetail
        budget={b}
        view={view}
        inGuestSpace={inGuestSpace}
        space={space}
        services={services}
        state={state}
        navigation={navigation}
        onBack={() => setViewing(null)}
        onEdit={() => { if (requireOwn()) { setViewing(null); setEditing(b); } }}
      />
    );
  }

  const list = state.budgets || [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      {inGuestSpace ? null : <Button title="＋ New budget" onPress={() => setEditing({})} style={{ marginBottom: 12 }} />}
      {list.length === 0 ? (
        <EmptyState title="No budgets" subtitle="Create one to watch a category's monthly spend." />
      ) : list.map((b) => {
        const spend = view.spend(b);
        const eff = view.rollover(b);
        const limit = eff.limit;
        const pct = limit > 0 ? Math.min(1, spend / limit) : 0;
        const over = spend >= limit;
        const ids = view.categoryIds(b);
        const names = ids.map((id) => view.categoryName(id)).filter(Boolean);
        const meta = periodMeta(b);
        const multi = ids.length > 1;
        const hasSubs = !multi && ids[0] && view.hasChildren(ids[0]);
        const split = multi ? view.splitByCategory(b) : [];
        return (
          <TouchableOpacity key={b.id} activeOpacity={0.7} onPress={() => setViewing(b.id)}>
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Dot color={view.category(ids[0])?.color} />
                <Text style={{ flex: 1, fontWeight: '600', color: colors.text }} numberOfLines={1}>
                  {names[0] || 'Budget'}{multi ? `  +${names.length - 1}` : ''}
                  {hasSubs ? <Text style={{ fontSize: 11, color: colors.subtle }}>  · incl. subs</Text> : null}
                </Text>
                <Text style={{ fontSize: 12, color: colors.subtle }}>
                  {meta.label}{b.rollover ? ' · rollover' : ''}
                </Text>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 10 }}>
                <Text style={{ fontSize: 17, fontWeight: '700', color: over ? colors.red : colors.text }}>
                  {fx.formatMoney(spend, b.currency)}
                </Text>
                <Text style={{ fontSize: 13, color: colors.subtle }}>
                  {' '}/ {fx.formatMoney(limit, b.currency)}
                  {eff.rollover ? `  (+${fx.formatMoney(eff.rollover, b.currency)})` : ''}
                </Text>
              </View>

              <View style={{
                height: 8, backgroundColor: colors.muted, borderRadius: 999,
                marginTop: 8, overflow: 'hidden',
              }}>
                <View style={{
                  width: `${pct * 100}%`, height: '100%', borderRadius: 999,
                  backgroundColor: over ? colors.red : pct >= 0.8 ? colors.amber : colors.green,
                }} />
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <Text style={{ fontSize: 12, color: colors.subtle }}>
                  {Math.round(pct * 100)}% used · {Math.max(0, meta.daysLeft)} {meta.isHijri ? 'Hijri ' : ''}day{meta.daysLeft === 1 ? '' : 's'} left
                </Text>
                <Text style={{ fontSize: 12, color: over ? colors.rose : colors.green, fontWeight: '600' }}>
                  {over
                    ? `Over by ${fx.formatMoney(spend - limit, b.currency)}`
                    : `${fx.formatMoney(limit - spend, b.currency)} left`}
                </Text>
              </View>

              {multi ? (
                <View style={{ marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderColor: colors.muted }}>
                  {split.map((s) => (
                    <View key={s.categoryId} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                      <Dot color={s.color} size={8} />
                      <Text style={{ flex: 1, fontSize: 12, color: colors.text }} numberOfLines={1}>{s.name}</Text>
                      <Text style={{ fontSize: 12, color: colors.subtle }}>{fx.formatMoney(s.spend, b.currency)}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </Card>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

/** BudgetDetail — the web BudgetDetailView: breakdown + period transactions. */
function BudgetDetail({ budget: b, view, inGuestSpace, space, services, state, navigation, onBack, onEdit }) {
  const { fx } = services;
  const spend = view.spend(b);
  const eff = view.rollover(b);
  const limit = eff.limit;
  const pct = limit > 0 ? Math.min(1, spend / limit) : 0;
  const over = spend >= limit;
  const meta = periodMeta(b);
  const ids = view.categoryIds(b);
  const multi = ids.length > 1;
  const split = view.splitByCategory(b);
  const txns = view.transactions(b);
  const title = ids.map((id) => view.category(id)?.name).filter(Boolean).join(', ') || 'Budget';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <TouchableOpacity onPress={onBack} style={{ paddingVertical: 6, paddingRight: 12 }}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>‹ Budgets</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        {inGuestSpace ? null : <Button title="Edit" kind="ghost" onPress={onEdit} />}
      </View>

      <Card>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>{title}</Text>
        <Text style={{ fontSize: 12, color: colors.subtle, marginTop: 2 }}>
          {meta.label}{b.rollover && view.limitIsExact ? ' · rollover on' : ''} · {Math.max(0, meta.daysLeft)} {meta.isHijri ? 'Hijri ' : ''}day{meta.daysLeft === 1 ? '' : 's'} left
        </Text>
        {/* The total is the owner's exact figure over their whole ledger; the
            transaction list below it is only the accounts shared with you, so
            the two do not add up and the screen has to say why. */}
        {inGuestSpace ? (
          <Text style={{ fontSize: 11, color: colors.subtle, marginTop: 4, lineHeight: 16 }}>
            Spent is the owner's total for this budget. The entries listed below
            are only {space?.scopeNote || 'the accounts shared with you'}
            {b.rollover ? ', and rollover from earlier periods is not included' : ''}.
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 12 }}>
          <Text style={{ fontSize: 24, fontWeight: '700', color: over ? colors.red : colors.text }}>
            {fx.formatMoney(spend, b.currency)}
          </Text>
          <Text style={{ fontSize: 14, color: colors.subtle }}>
            {' '}/ {fx.formatMoney(limit, b.currency)}
            {eff.rollover ? `  (+${fx.formatMoney(eff.rollover, b.currency)})` : ''}
          </Text>
        </View>
        <View style={{ height: 10, backgroundColor: colors.muted, borderRadius: 999, marginTop: 10, overflow: 'hidden' }}>
          <View style={{ width: `${pct * 100}%`, height: '100%', borderRadius: 999,
            backgroundColor: over ? colors.red : pct >= 0.8 ? colors.amber : colors.green }} />
        </View>
        <Text style={{ fontSize: 12, color: over ? colors.rose : colors.green, fontWeight: '600', marginTop: 6 }}>
          {over ? `Over by ${fx.formatMoney(spend - limit, b.currency)}` : `${fx.formatMoney(limit - spend, b.currency)} left`}
        </Text>
      </Card>

      {multi ? (
        <>
          <Text style={{ fontSize: 12, color: colors.subtle, fontWeight: '600', marginBottom: 4 }}>By category</Text>
          <Card style={{ paddingVertical: 4 }}>
            {split.map((s, i) => (
              <View key={s.categoryId} style={{
                flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
                borderBottomWidth: i === split.length - 1 ? 0 : 1, borderColor: colors.muted,
              }}>
                <Dot color={s.color} />
                <Text style={{ flex: 1, color: colors.text }}>{s.name}</Text>
                <Text style={{ color: colors.text, fontWeight: '600' }}>{fx.formatMoney(s.spend, b.currency)}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <Text style={{ fontSize: 12, color: colors.subtle, fontWeight: '600', marginTop: 8, marginBottom: 4 }}>
        This period · {txns.length} transaction{txns.length === 1 ? '' : 's'}
      </Text>
      {txns.length === 0 ? (
        <EmptyState title="Nothing yet" subtitle="Spending in these categories this period will show here." />
      ) : (
        <Card style={{ paddingVertical: 4 }}>
          {txns.map((t, i) => (
            <TouchableOpacity
              key={t.id}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('TransactionForm', { id: t.id })}
              style={{
                flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
                borderBottomWidth: i === txns.length - 1 ? 0 : 1, borderColor: colors.muted,
              }}
            >
              <Dot color={view.category(t.categoryId)?.color} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '500' }} numberOfLines={1}>
                  {t.payee || view.categoryName(t.categoryId) || 'Uncategorised'}
                </Text>
                <Text style={{ fontSize: 12, color: colors.subtle }}>{DateService.label(t.date, state.user.dateFormat || 'auto')}</Text>
              </View>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{fx.formatMoney(t.amount, t.currency)}</Text>
            </TouchableOpacity>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}

function BudgetForm({ budget, onDone, navigation, services, state }) {
  const { fx, budgets, categories } = services;
  const seedIds = budget ? budgets.targetCategoryIds(budget) : [];
  const [categoryIds, setCategoryIds] = useState(seedIds);
  const [amount, setAmount] = useState(
    budget ? String(fx.fromMinor(budget.amount, budget.currency)) : '');
  const [period, setPeriod] = useState(budget?.period || 'gregorian');
  const [currency, setCurrency] = useState(
    budget?.currency || state.user.defaultCurrency || state.user.homeCurrency);
  const [rollover, setRollover] = useState(!!budget?.rollover);

  const pickCategories = () => {
    const token = PickerBus.register((ids) => setCategoryIds(ids));
    navigation.navigate('CategoryPicker', {
      token, mode: 'multi', type: 'expense', selected: categoryIds,
    });
  };

  const save = () => {
    const ids = categoryIds.filter(Boolean);
    if (!ids.length) { Alert.alert('Pick at least one category'); return; }
    const minor = fx.toMinor(Number(amount) || 0, currency);
    if (!(minor > 0)) { Alert.alert('Enter a limit'); return; }
    const patch = {
      categoryIds: ids,
      categoryId: ids[0], // legacy single-id kept in sync, like the web
      amount: minor, currency, period, rollover,
    };
    if (budget) {
      budgets.update(budget.id, patch);
    } else {
      const st = services.store.getState();
      st.budgets.push({ id: `bud_${Date.now().toString(36)}`, ...patch });
      services.store.flush();
    }
    onDone();
  };

  const del = () => {
    Alert.alert('Delete budget?', '', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { budgets.delete(budget.id); onDone(); } },
    ]);
  };

  const label = categoryIds.length
    ? `${categories.fullName(categoryIds[0])}${categoryIds.length > 1 ? ` +${categoryIds.length - 1} more` : ''}`
    : '— Pick categories —';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <Card>
        <Field label="Categories">
          <TouchableOpacity
            onPress={pickCategories}
            style={{
              borderWidth: 1, borderColor: colors.border, borderRadius: 10,
              padding: 12, flexDirection: 'row', alignItems: 'center',
            }}
          >
            <Text style={{ flex: 1, color: categoryIds.length ? colors.text : colors.subtle }}>{label}</Text>
            <Text style={{ color: colors.faint }}>›</Text>
          </TouchableOpacity>
        </Field>
        <Field label={`Limit (${currency})`}>
          <Input value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
        </Field>
        <Field label="Currency">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {CURRENCIES.map((c) => (
                <TouchableOpacity key={c} onPress={() => setCurrency(c)}
                  style={{ borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
                    borderColor: c === currency ? colors.primary : colors.border,
                    backgroundColor: c === currency ? colors.primary : colors.card }}>
                  <Text style={{ fontSize: 12, color: c === currency ? colors.primaryFg : colors.text }}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </Field>
        <Field label="Period">
          <Segmented
            options={[
              { id: 'gregorian', label: 'Gregorian month' },
              { id: 'hijri', label: 'Hijri month' },
            ]}
            value={period}
            onChange={setPeriod}
          />
        </Field>
        <TouchableOpacity
          onPress={() => setRollover((v) => !v)}
          style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}
        >
          <View style={{
            width: 22, height: 22, borderRadius: 6, borderWidth: 1, marginRight: 10,
            borderColor: rollover ? colors.primary : colors.border,
            backgroundColor: rollover ? colors.primary : colors.card,
            alignItems: 'center', justifyContent: 'center',
          }}>
            {rollover ? <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>✓</Text> : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text }}>Roll over unspent limit</Text>
            <Text style={{ fontSize: 12, color: colors.subtle }}>Add last period's leftover to this period's limit.</Text>
          </View>
        </TouchableOpacity>
      </Card>
      <Button title={budget ? 'Save' : 'Create budget'} onPress={save} />
      {budget ? <Button title="Delete budget" kind="danger" onPress={del} style={{ marginTop: 8 }} /> : null}
      <Button title="Cancel" kind="ghost" onPress={onDone} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}
