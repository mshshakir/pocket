/**
 * DashboardScreen — net worth, this month's flow, recent transactions.
 */
import React from 'react';
import { ScrollView, View, Text, TouchableOpacity } from 'react-native';
import { useAppState } from '../state/AppContext.js';
import { Card, SectionTitle, Button, Row, Dot, EmptyState } from '../ui/common.js';
import { colors } from '../ui/theme.js';
import { HijriCalendarService } from '../domain/services/HijriCalendarService.js';
import { DateService } from '../domain/services/DateService.js';

const hijri = new HijriCalendarService();

export default function DashboardScreen({ navigation }) {
  const { state, services } = useAppState();
  const { fx, accounts, categories, reports } = services;
  const home = state.user.homeCurrency;
  const showHijri = state.user.showHijri !== false;

  const netWorth = accounts.totalBalanceInHome();
  const topSpend = reports.spendingByCategory(30).slice(0, 4);
  const topTotal = topSpend.reduce((s, r) => s + r.amount, 0);
  const todayH = showHijri ? hijri.toHijri(DateService.todayIso()) : null;

  // This month's income/expense in home currency.
  const ym = new Date().toISOString().slice(0, 7);
  let income = 0, expense = 0;
  for (const t of state.transactions) {
    if (!t.date?.startsWith(ym)) continue;
    const inHome = fx.convert(t.amount, t.currency, home);
    if (t.type === 'income')  income  += inHome;
    if (t.type === 'expense') expense += inHome;
  }

  const recent = [...state.transactions]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 8);

  const catName = (id) => categories.fullName(id) || 'Uncategorised';
  const accName = (id) => state.accounts.find((a) => a.id === id)?.name || '?';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <Card>
        <Text style={{ fontSize: 12, color: colors.subtle }}>Net worth</Text>
        <Text style={{ fontSize: 30, fontWeight: '700', color: colors.text, marginTop: 2 }}>
          {fx.formatMoney(netWorth, home)}
        </Text>
        <View style={{ flexDirection: 'row', marginTop: 12, gap: 24 }}>
          <View>
            <Text style={{ fontSize: 12, color: colors.subtle }}>In · this month</Text>
            <Text style={{ fontWeight: '600', color: colors.green }}>
              {fx.formatMoney(income, home)}
            </Text>
          </View>
          <View>
            <Text style={{ fontSize: 12, color: colors.subtle }}>Out · this month</Text>
            <Text style={{ fontWeight: '600', color: colors.red }}>
              {fx.formatMoney(expense, home)}
            </Text>
          </View>
        </View>
      </Card>

      {todayH ? (
        <Card style={{ marginTop: -4 }}>
          <Text style={{ fontSize: 12, color: colors.subtle }}>Today (Hijri)</Text>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>
            ☾ {todayH.day} {hijri.monthsLong[todayH.month]} {todayH.year} AH
          </Text>
        </Card>
      ) : null}

      <Button title="＋ New transaction" onPress={() => navigation.navigate('TransactionForm', {})} style={{ marginTop: 4 }} />

      {topSpend.length ? (
        <>
          <SectionTitle>Top spending · 30d</SectionTitle>
          <Card style={{ paddingVertical: 4 }}>
            {topSpend.map((row, i) => {
              const cat = categories.find(row.categoryId);
              const pct = topTotal > 0 ? row.amount / topTotal : 0;
              return (
                <View key={row.categoryId} style={{ paddingVertical: 8,
                  borderBottomWidth: i === topSpend.length - 1 ? 0 : 1, borderColor: colors.muted }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Dot color={cat?.color} />
                    <Text style={{ flex: 1, color: colors.text }} numberOfLines={1}>
                      {categories.fullName(row.categoryId) || 'Uncategorised'}
                    </Text>
                    <Text style={{ fontWeight: '600', color: colors.text }}>{fx.formatMoney(row.amount, home)}</Text>
                  </View>
                  <View style={{ height: 5, backgroundColor: colors.muted, borderRadius: 999, marginTop: 6, overflow: 'hidden' }}>
                    <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: cat?.color || colors.faint, borderRadius: 999 }} />
                  </View>
                </View>
              );
            })}
          </Card>
        </>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}><SectionTitle>Recent</SectionTitle></View>
        <TouchableOpacity onPress={() => navigation.navigate('Transactions')}>
          <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>View all ›</Text>
        </TouchableOpacity>
      </View>
      {recent.length === 0 ? (
        <EmptyState title="No transactions yet" subtitle="Add your first one from the Transactions tab." />
      ) : (
        <Card style={{ paddingVertical: 4 }}>
          {recent.map((t) => (
            <Row
              key={t.id}
              onPress={() => navigation.navigate('TransactionForm', { id: t.id })}
              style={{ borderBottomWidth: t === recent[recent.length - 1] ? 0 : 1, borderColor: colors.muted }}
            >
              <Dot color={state.categories.find((c) => c.id === t.categoryId)?.color} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '500' }} numberOfLines={1}>
                  {t.payee || (t.type === 'transfer' ? 'Transfer' : catName(t.categoryId))}
                </Text>
                <Text style={{ fontSize: 12, color: colors.subtle }} numberOfLines={1}>
                  {DateService.label(t.date, state.user.dateFormat || 'auto')} · {accName(t.accountId)}
                </Text>
              </View>
              <Text style={{
                fontWeight: '600',
                color: t.type === 'income' ? colors.green
                     : t.type === 'expense' ? colors.text : colors.subtle,
              }}>
                {t.type === 'expense' ? '−' : t.type === 'income' ? '+' : ''}
                {fx.formatMoney(t.amount, t.currency)}
              </Text>
            </Row>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}
