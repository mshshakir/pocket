/**
 * ReportsScreen — spending by category, a daily-expense chart, net-worth over
 * time, biggest transactions, and (when Hijri is on) a by-Hijri-month
 * breakdown. Every figure comes from the shared ReportService, so the numbers
 * match the web exactly.
 */
import React, { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity } from 'react-native';
import { useAppState } from '../state/AppContext.js';
import { Card, SectionTitle, Segmented, Dot, EmptyState } from '../ui/common.js';
import { colors } from '../ui/theme.js';
import { HijriCalendarService } from '../domain/services/HijriCalendarService.js';
import { DateService } from '../domain/services/DateService.js';

const hijri = new HijriCalendarService();

const RANGES = [
  { id: '7',   label: '7d',  days: 7 },
  { id: '30',  label: '30d', days: 30 },
  { id: '90',  label: '90d', days: 90 },
  { id: 'all', label: 'All', days: 'all' },
];

export default function ReportsScreen({ navigation }) {
  // `localState`, deliberately. ReportService reads the local store in every
  // one of its methods and has no way to answer for someone else's snapshot,
  // so under a projection this screen drew the member's own figures while
  // labelling them with the OWNER's home currency — the numbers were their
  // own money with the wrong symbol on them. Until reports are space-aware
  // (phase 2) they are honestly the member's, and the banner says so.
  const { localState: state, services, inGuestSpace, space } = useAppState();
  const { reports, fx, categories } = services;
  const home = state.user.homeCurrency;
  const showHijri = state.user.showHijri !== false;
  const [range, setRange] = useState('30');

  const days = RANGES.find((r) => r.id === range)?.days ?? 30;
  const rangeLabel = RANGES.find((r) => r.id === range)?.label;
  const byCat = reports.spendingByCategory(days);
  const total = byCat.reduce((s, r) => s + r.amount, 0);

  // Daily chart honours the range (capped so the bars stay legible), instead
  // of the previous hard 30-day cap.
  const numericDays = days === 'all' ? 90 : Math.min(days, 90);
  const daily = reports.dailyExpenses(numericDays);
  const maxDay = Math.max(1, ...daily.map((d) => d.amount));

  const worth = reports.netWorthSeries();
  const top = reports.topTransactions(5, days);
  const byHijri = showHijri ? reports.spendingByHijriMonth(days) : [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      {inGuestSpace ? (
        <Text style={{
          color: colors.subtle, fontSize: 12, lineHeight: 17,
          backgroundColor: '#818cf815', borderRadius: 10, padding: 10, marginBottom: 12,
        }}>
          These reports cover <Text style={{ fontWeight: '700' }}>your own</Text> money,
          not {space?.label}'s.
        </Text>
      ) : null}
      <Segmented options={RANGES} value={range} onChange={setRange} />

      <Card>
        <Text style={{ fontSize: 12, color: colors.subtle }}>Total spent · {rangeLabel}</Text>
        <Text style={{ fontSize: 26, fontWeight: '700', color: colors.text }}>{fx.formatMoney(total, home)}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 56, gap: 2, marginTop: 12 }}>
          {daily.map((d) => (
            <View key={d.date} style={{ flex: 1,
              height: Math.max(2, (d.amount / maxDay) * 56),
              backgroundColor: colors.indigo, borderRadius: 2, opacity: d.amount ? 1 : 0.25 }} />
          ))}
        </View>
        <Text style={{ fontSize: 11, color: colors.faint, marginTop: 4 }}>Last {daily.length} days</Text>
      </Card>

      <NetWorth series={worth} fx={fx} home={home} />

      <SectionTitle>By category</SectionTitle>
      {byCat.length === 0 ? (
        <EmptyState title="No spending in range" subtitle="Log some expenses to see the breakdown." />
      ) : (
        <Card style={{ paddingVertical: 4 }}>
          {byCat.map((row, i) => {
            const cat = categories.find(row.categoryId);
            const pct = total > 0 ? row.amount / total : 0;
            return (
              <View key={row.categoryId} style={{ paddingVertical: 8,
                borderBottomWidth: i === byCat.length - 1 ? 0 : 1, borderColor: colors.muted }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Dot color={cat?.color} />
                  <Text style={{ flex: 1, color: colors.text }} numberOfLines={1}>
                    {categories.fullName(row.categoryId) || 'Uncategorised'}
                  </Text>
                  <Text style={{ color: colors.subtle, marginRight: 8, fontSize: 12 }}>{Math.round(pct * 100)}%</Text>
                  <Text style={{ fontWeight: '600', color: colors.text }}>{fx.formatMoney(row.amount, home)}</Text>
                </View>
                <View style={{ height: 5, backgroundColor: colors.muted, borderRadius: 999, marginTop: 6, overflow: 'hidden' }}>
                  <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: cat?.color || colors.faint, borderRadius: 999 }} />
                </View>
              </View>
            );
          })}
        </Card>
      )}

      {top.length ? (
        <>
          <SectionTitle>Biggest transactions</SectionTitle>
          <Card style={{ paddingVertical: 4 }}>
            {top.map((row, i) => (
              <TouchableOpacity
                key={row.tx.id}
                activeOpacity={0.7}
                onPress={() => navigation?.navigate('TransactionForm', { id: row.tx.id })}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
                  borderBottomWidth: i === top.length - 1 ? 0 : 1, borderColor: colors.muted }}
              >
                <Dot color={categories.find(row.tx.categoryId)?.color} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '500' }} numberOfLines={1}>
                    {row.tx.payee || categories.fullName(row.tx.categoryId) || 'Uncategorised'}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.subtle }}>{DateService.label(row.tx.date, state.user.dateFormat || 'auto')}</Text>
                </View>
                <Text style={{ fontWeight: '600', color: colors.text }}>{fx.formatMoney(row.value, home)}</Text>
              </TouchableOpacity>
            ))}
          </Card>
        </>
      ) : null}

      {byHijri.length ? (
        <>
          <SectionTitle>By Hijri month</SectionTitle>
          <Card style={{ paddingVertical: 4 }}>
            {(() => {
              const max = Math.max(1, ...byHijri.map((h) => h.amount));
              return byHijri.map((h, i) => (
                <View key={`${h.year}-${h.month}`} style={{ paddingVertical: 8,
                  borderBottomWidth: i === byHijri.length - 1 ? 0 : 1, borderColor: colors.muted }}>
                  <View style={{ flexDirection: 'row' }}>
                    <Text style={{ flex: 1, color: colors.text }}>{hijri.monthsLong[h.month]} {h.year} H</Text>
                    <Text style={{ fontWeight: '600', color: colors.text }}>{fx.formatMoney(h.amount, home)}</Text>
                  </View>
                  <View style={{ height: 5, backgroundColor: colors.muted, borderRadius: 999, marginTop: 6, overflow: 'hidden' }}>
                    <View style={{ width: `${(h.amount / max) * 100}%`, height: '100%', backgroundColor: colors.indigo, borderRadius: 999 }} />
                  </View>
                </View>
              ));
            })()}
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

/** Net-worth-over-time as a compact bar chart with min/latest labels. */
function NetWorth({ series, fx, home }) {
  if (!series || series.length < 2) return null;
  // Sample down to at most 40 points so the bars stay readable.
  const step = Math.max(1, Math.ceil(series.length / 40));
  const pts = series.filter((_, i) => i % step === 0 || i === series.length - 1);
  const vals = pts.map((p) => p.netWorth);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const latest = series[series.length - 1].netWorth;

  return (
    <>
      <SectionTitle>Net worth over time</SectionTitle>
      <Card>
        <Text style={{ fontSize: 22, fontWeight: '700', color: latest < 0 ? colors.rose : colors.text }}>
          {fx.formatMoney(latest, home)}
        </Text>
        <Text style={{ fontSize: 11, color: colors.faint }}>latest</Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 60, gap: 1, marginTop: 12 }}>
          {pts.map((p, i) => (
            <View key={i} style={{ flex: 1,
              height: Math.max(2, ((p.netWorth - min) / span) * 60),
              backgroundColor: p.netWorth < 0 ? colors.rose : colors.green, borderRadius: 1 }} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
          <Text style={{ fontSize: 11, color: colors.faint }}>{pts[0].date}</Text>
          <Text style={{ fontSize: 11, color: colors.faint }}>{pts[pts.length - 1].date}</Text>
        </View>
      </Card>
    </>
  );
}
