/**
 * RegularsScreen — regular purchases, mirroring the web CalendarView.
 *
 * Three segments:
 *   • Calendar — a month grid with per-day dots + spend totals; tap a day to
 *     see (and quick-add to) that day's logged items.
 *   • Summary  — this month's spend broken down by item.
 *   • Items    — manage the named items and quick-log them.
 *
 * Each log writes a real transaction (same shape as the web's
 * submitRegularLog). Deleting an item keeps its logged transactions (audit L5).
 */
import React, { useState } from 'react';
import { ScrollView, View, Text, Alert, TouchableOpacity } from 'react-native';
import { useAppState } from '../state/AppContext.js';
import { PickerBus } from '../state/PickerBus.js';
import { Card, Field, Input, Button, Dot, Segmented, EmptyState } from '../ui/common.js';
import { colors } from '../ui/theme.js';
import { IdGenerator } from '../domain/services/IdGenerator.js';
import { DateService } from '../domain/services/DateService.js';
import { HijriCalendarService } from '../domain/services/HijriCalendarService.js';
import { RATES } from '../domain/services/FxRates.js';

const hijri = new HijriCalendarService();

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Build the transaction a single regular-item log writes. */
function buildLogTx(item, services) {
  const s = services.store.getState();
  const currency = item.currency || s.user.homeCurrency;
  return {
    id: IdGenerator.generate('tx'),
    regularItemId: item.id,
    accountId: item.accountId || s.accounts[0]?.id,
    date: DateService.todayIso(), hijriDate: null,
    amount: item.defaultAmount || 0, unitAmount: item.defaultAmount || 0, qty: 1,
    currency,
    exchangeRate: (RATES[currency] || 1) / (RATES[s.user.homeCurrency] || 1),
    refAmount: services.fx.convert(item.defaultAmount || 0, currency, s.user.homeCurrency),
    payee: item.name, note: '', type: 'expense',
    categoryId: item.categoryId || null, splits: null,
    paymentType: 'cash', recordState: 'cleared', tags: [],
    createdAt: new Date().toISOString(),
  };
}

const isoOf = (d) => DateService.toIso(d);

export default function RegularsScreen({ navigation }) {
  const { state, services } = useAppState();
  const [tab, setTab] = useState('calendar'); // calendar | summary | items
  const [editing, setEditing] = useState(null);

  if (editing !== null) {
    return <ItemForm item={editing.id ? editing : null} onDone={() => setEditing(null)}
      navigation={navigation} services={services} state={state} />;
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <Segmented
        options={[
          { id: 'calendar', label: 'Calendar' },
          { id: 'summary', label: 'Summary' },
          { id: 'items', label: 'Items' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <View style={{ height: 12 }} />
      {tab === 'calendar' ? <CalendarTab state={state} services={services} />
        : tab === 'summary' ? <SummaryTab state={state} services={services} />
        : <ItemsTab state={state} services={services} onEdit={setEditing} />}
    </ScrollView>
  );
}

// ── Calendar ────────────────────────────────────────────────────────────────

function CalendarTab({ state, services }) {
  const { fx } = services;
  const home = state.user.homeCurrency;
  const items = state.regularItems || [];
  const today = isoOf(new Date());
  const showHijri = state.user.showHijri !== false;
  // Effective display mode: honor user.calendarMode when Hijri is on.
  const mode = showHijri ? (state.user.calendarMode || 'both') : 'gregorian';
  const isHijri = mode === 'hijri';
  const showBoth = mode === 'both';

  // Anchor = an ISO date inside the focused month. Works for both calendars.
  const [anchor, setAnchor] = useState(today);
  const [openDay, setOpenDay] = useState(null);

  const setMode = (m) => { state.user.calendarMode = m; services.store.flush(); };

  const logsForDate = (iso) => (state.transactions || []).filter((t) => t.regularItemId && t.date === iso);
  const itemOf = (id) => items.find((i) => i.id === id);

  // Shift a month in whichever calendar is active.
  const shift = (delta) => {
    setOpenDay(null);
    if (isHijri) {
      const h = hijri.toHijri(anchor);
      let m = h.month + delta, y = h.year;
      while (m < 0) { m += 12; y -= 1; }
      while (m > 11) { m -= 12; y += 1; }
      setAnchor(isoOf(hijri.toGregorian(y, m, 1)));
    } else {
      const d = new Date(anchor + 'T12:00:00');
      d.setDate(1); d.setMonth(d.getMonth() + delta);
      setAnchor(isoOf(d));
    }
  };

  // Build the grid cells + header + month spend for the active calendar.
  let header, cells = [], monthLogs;
  if (isHijri) {
    const h = hijri.toHijri(anchor);
    const dim = hijri.daysInMonth(h.year, h.month);
    const day1 = hijri.toGregorian(h.year, h.month, 1);
    header = `${hijri.monthsLong[h.month]} ${h.year} AH`;
    for (let i = 0; i < day1.getDay(); i++) cells.push(null);
    for (let d = 1; d <= dim; d++) {
      const g = hijri.toGregorian(h.year, h.month, d);
      cells.push({ primary: d, secondary: `${g.getDate()} ${g.toLocaleDateString(undefined, { month: 'short' })}`, iso: isoOf(g) });
    }
    monthLogs = (state.transactions || []).filter((t) => {
      if (!t.regularItemId) return false;
      const th = hijri.toHijri(t.date);
      return th.year === h.year && th.month === h.month;
    });
  } else {
    const d0 = new Date(anchor + 'T12:00:00');
    const year = d0.getFullYear(), month = d0.getMonth();
    const dim = new Date(year, month + 1, 0).getDate();
    header = new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    for (let i = 0; i < new Date(year, month, 1).getDay(); i++) cells.push(null);
    for (let d = 1; d <= dim; d++) {
      const iso = isoOf(new Date(year, month, d, 12));
      const h = showBoth ? hijri.toHijri(iso) : null;
      cells.push({ primary: d, secondary: h ? `${h.day} ${hijri.monthsShort[h.month]}` : null, iso });
    }
    monthLogs = (state.transactions || []).filter((t) => {
      if (!t.regularItemId) return false;
      const dt = new Date(t.date + 'T12:00:00');
      return dt.getFullYear() === year && dt.getMonth() === month;
    });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const monthSpent = monthLogs.reduce((s, t) => s + fx.convert(t.amount, t.currency, home), 0);
  const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  if (items.length === 0) {
    return (
      <EmptyState
        title="No regular items yet"
        subtitle="Add a recurring purchase in the Items tab, then log it — it will show up here on the calendar."
      />
    );
  }

  return (
    <View>
      {showHijri ? (
        <View style={{ marginBottom: 8 }}>
          <Segmented
            options={[
              { id: 'gregorian', label: 'Gregorian' },
              { id: 'both', label: 'Both' },
              { id: 'hijri', label: 'Hijri' },
            ]}
            value={mode}
            onChange={setMode}
          />
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        <TouchableOpacity onPress={() => shift(-1)} style={{ padding: 8 }}>
          <Text style={{ fontSize: 20, color: colors.text }}>‹</Text>
        </TouchableOpacity>
        <Text style={{ flex: 1, textAlign: 'center', fontWeight: '700', color: colors.text }}>{header}</Text>
        <TouchableOpacity onPress={() => shift(1)} style={{ padding: 8 }}>
          <Text style={{ fontSize: 20, color: colors.text }}>›</Text>
        </TouchableOpacity>
      </View>
      <Text style={{ textAlign: 'center', fontSize: 12, color: colors.subtle, marginBottom: 10 }}>
        {fx.formatMoney(monthSpent, home)} this {isHijri ? 'Hijri month' : 'month'}
      </Text>

      <Card style={{ padding: 6 }}>
        <View style={{ flexDirection: 'row' }}>
          {dayNames.map((n) => (
            <Text key={n} style={{ flex: 1, textAlign: 'center', fontSize: 11, color: colors.subtle, paddingVertical: 4 }}>{n}</Text>
          ))}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {cells.map((c, i) => {
            if (!c) return <View key={`e${i}`} style={{ width: `${100 / 7}%`, aspectRatio: 1 }} />;
            const logs = logsForDate(c.iso);
            const total = logs.reduce((s, t) => s + fx.convert(t.amount, t.currency, home), 0);
            const isToday = c.iso === today;
            const miqaat = showHijri && hijri.topMiqaat(hijri.miqaatsForGregorian(c.iso));
            return (
              <TouchableOpacity
                key={c.iso}
                onPress={() => setOpenDay(openDay === c.iso ? null : c.iso)}
                style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 2 }}
              >
                <View style={{
                  flex: 1, borderRadius: 8, padding: 3,
                  borderWidth: openDay === c.iso ? 2 : isToday ? 1 : 0,
                  borderColor: openDay === c.iso ? colors.primary : colors.text,
                  backgroundColor: logs.length ? colors.muted : 'transparent',
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 11, fontWeight: isToday ? '700' : '400', color: colors.text }}>{c.primary}</Text>
                    {c.secondary ? <Text style={{ fontSize: 8, color: colors.faint }} numberOfLines={1}>{c.secondary}</Text> : null}
                  </View>
                  {miqaat ? <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: colors.amber, marginTop: 1 }} /> : null}
                  <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 2 }}>
                    {logs.slice(0, 4).map((t, k) => {
                      const it = itemOf(t.regularItemId);
                      return <View key={k} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: it?.color || colors.faint }} />;
                    })}
                  </View>
                  {total > 0 ? (
                    <Text style={{ fontSize: 8, color: colors.subtle }} numberOfLines={1}>{fx.formatMoney(total, home)}</Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </Card>

      {openDay ? (
        <DayPanel iso={openDay} logs={logsForDate(openDay)} items={items} services={services} state={state} showHijri={showHijri} />
      ) : null}
    </View>
  );
}

/** The list of logs on a tapped day, with quick-add of any defined item. */
function DayPanel({ iso, logs, items, services, state, showHijri }) {
  const { fx } = services;
  const [, force] = useState(0);
  const h = showHijri ? hijri.toHijri(iso) : null;
  const miqaats = showHijri ? hijri.miqaatsForGregorian(iso) : [];

  const quickAdd = (item) => {
    const s = services.store.getState();
    const tx = buildLogTx(item, services);
    tx.date = iso; // log onto the tapped day
    const cur = tx.currency;
    tx.hijriDate = null;
    s.transactions.push(tx);
    services.store.flush();
    force((n) => n + 1);
    Alert.alert('Logged', `${item.name} · ${fx.formatMoney(item.defaultAmount || 0, cur)} on ${iso}`);
  };

  const removeLog = (t) => {
    const s = services.store.getState();
    s.transactions = (s.transactions || []).filter((x) => x.id !== t.id);
    services.store.flush();
    force((n) => n + 1);
  };

  return (
    <Card style={{ marginTop: 12 }}>
      <Text style={{ fontWeight: '700', color: colors.text }}>{DateService.label(iso, state.user.dateFormat || 'auto')}</Text>
      {h ? <Text style={{ fontSize: 12, color: colors.subtle, marginTop: 1 }}>☾ {h.day} {hijri.monthsLong[h.month]} {h.year} AH</Text> : null}
      {miqaats.length ? (
        <View style={{ marginTop: 6, marginBottom: 8 }}>
          {miqaats.map((m, i) => (
            <Text key={i} style={{ fontSize: 12, color: colors.amber }} numberOfLines={2}>• {m.t}</Text>
          ))}
        </View>
      ) : <View style={{ height: 8 }} />}
      {logs.length === 0 ? (
        <Text style={{ fontSize: 12, color: colors.subtle, marginBottom: 8 }}>Nothing logged. Quick-add below.</Text>
      ) : logs.map((t) => {
        const it = items.find((i) => i.id === t.regularItemId);
        return (
          <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <Dot color={it?.color} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text }}>{it?.name || t.payee}</Text>
            </View>
            <Text style={{ color: colors.text, fontWeight: '600', marginRight: 10 }}>
              {fx.formatMoney(t.amount, t.currency)}
            </Text>
            <TouchableOpacity onPress={() => removeLog(t)}>
              <Text style={{ color: colors.red }}>✕</Text>
            </TouchableOpacity>
          </View>
        );
      })}
      <Text style={{ fontSize: 12, color: colors.subtle, marginTop: 4, marginBottom: 6 }}>Quick-add to this day:</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {items.map((it) => (
          <TouchableOpacity
            key={it.id}
            onPress={() => quickAdd(it)}
            style={{
              flexDirection: 'row', alignItems: 'center',
              borderWidth: 1, borderColor: colors.border, borderRadius: 999,
              paddingHorizontal: 10, paddingVertical: 6,
            }}
          >
            <Dot color={it.color} size={8} />
            <Text style={{ fontSize: 13, color: colors.text }}>{it.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </Card>
  );
}

// ── Summary ───────────────────────────────────────────────────────────────

function SummaryTab({ state, services }) {
  const { fx } = services;
  const home = state.user.homeCurrency;
  const items = state.regularItems || [];
  const now = new Date();

  const logs = (state.transactions || []).filter((t) => {
    if (!t.regularItemId) return false;
    const d = new Date(t.date + 'T12:00:00');
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });

  const byItem = {};
  logs.forEach((t) => {
    const it = items.find((i) => i.id === t.regularItemId);
    if (!it) return;
    byItem[t.regularItemId] = byItem[t.regularItemId] || { item: it, count: 0, total: 0 };
    byItem[t.regularItemId].count += 1;
    byItem[t.regularItemId].total += fx.convert(t.amount, t.currency, home);
  });
  const rows = Object.values(byItem).sort((a, b) => b.total - a.total);
  const totalSpent = rows.reduce((s, r) => s + r.total, 0);

  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        <View style={{ flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12 }}>
          <Text style={{ fontSize: 11, color: colors.subtle }}>Total this month</Text>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>{fx.formatMoney(totalSpent, home)}</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12 }}>
          <Text style={{ fontSize: 11, color: colors.subtle }}>Purchases</Text>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>{logs.length}</Text>
        </View>
      </View>
      {rows.length === 0 ? (
        <EmptyState title="No purchases this month" subtitle="Log items on the Calendar tab to see the breakdown." />
      ) : (
        <Card style={{ paddingVertical: 4 }}>
          {rows.map((r, i) => (
            <View key={r.item.id} style={{
              flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
              borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderColor: colors.muted,
            }}>
              <Dot color={r.item.color} />
              <Text style={{ flex: 1, color: colors.text }}>{r.item.name}</Text>
              <Text style={{ color: colors.subtle, marginRight: 12 }}>×{r.count}</Text>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{fx.formatMoney(r.total, home)}</Text>
            </View>
          ))}
        </Card>
      )}
    </View>
  );
}

// ── Items ───────────────────────────────────────────────────────────────────

function ItemsTab({ state, services, onEdit }) {
  const { fx, categories } = services;
  const items = state.regularItems || [];

  const log = (item) => {
    const s = services.store.getState();
    s.transactions.push(buildLogTx(item, services));
    services.store.flush();
    Alert.alert('Logged', `${item.name} · ${fx.formatMoney(item.defaultAmount || 0, item.currency || s.user.homeCurrency)}`);
  };

  const del = (item) => {
    const s = services.store.getState();
    const n = (s.transactions || []).filter((t) => t.regularItemId === item.id).length;
    Alert.alert('Delete item', n ? `${n} logged transaction${n === 1 ? '' : 's'} will be kept.` : '', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        s.transactions.forEach((t) => { if (t.regularItemId === item.id) t.regularItemId = null; });
        s.regularItems = (s.regularItems || []).filter((i) => i.id !== item.id);
        services.store.flush();
      } },
    ]);
  };

  return (
    <View>
      <Button title="＋ New regular item" onPress={() => onEdit({})} style={{ marginBottom: 12 }} />
      {items.length === 0 ? (
        <EmptyState title="No regular items" subtitle="Add a recurring purchase like 'Morning coffee' to log it in one tap." />
      ) : items.map((item) => (
        <Card key={item.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Dot color={item.color} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '600', color: colors.text }}>{item.name}</Text>
              <Text style={{ fontSize: 12, color: colors.subtle }}>
                {fx.formatMoney(item.defaultAmount || 0, item.currency || state.user.homeCurrency)}
                {item.categoryId ? ` · ${categories.fullName(item.categoryId)}` : ''}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <Button title="Log now" onPress={() => log(item)} style={{ flex: 1 }} />
            <Button title="Edit" kind="ghost" onPress={() => onEdit(item)} />
            <Button title="Delete" kind="danger" onPress={() => del(item)} />
          </View>
        </Card>
      ))}
    </View>
  );
}

function ItemForm({ item, onDone, navigation, services, state }) {
  const { fx, categories } = services;
  const [name, setName] = useState(item?.name || '');
  const [amount, setAmount] = useState(item ? String(fx.fromMinor(item.defaultAmount || 0, item.currency || state.user.homeCurrency)) : '');
  const [currency, setCurrency] = useState(item?.currency || state.user.homeCurrency);
  const [accountId, setAccountId] = useState(item?.accountId || state.accounts[0]?.id || '');
  const [categoryId, setCategoryId] = useState(item?.categoryId || null);

  const pickCategory = () => {
    const token = PickerBus.register((ids) => setCategoryId(ids[0] ?? null));
    navigation.navigate('CategoryPicker', { token, mode: 'single', type: 'expense', selected: categoryId ? [categoryId] : [] });
  };

  const save = () => {
    if (!name.trim()) { Alert.alert('Name required'); return; }
    const s = services.store.getState();
    if (!Array.isArray(s.regularItems)) s.regularItems = [];
    const payload = {
      name: name.trim(),
      defaultAmount: fx.toMinor(Number(amount) || 0, currency),
      currency, accountId, categoryId,
      icon: item?.icon || 'coffee', color: item?.color || '#f97316',
    };
    if (item) Object.assign(item, payload);
    else s.regularItems.push({ id: IdGenerator.generate('ri'), ...payload });
    services.store.flush();
    onDone();
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <Card>
        <Field label="Name">
          <Input value={name} onChangeText={setName} autoFocus placeholder="e.g. Morning coffee" />
        </Field>
        <Field label={`Default amount (${currency})`}>
          <Input value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
        </Field>
        <Field label="Default category">
          <TouchableOpacity onPress={pickCategory}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center' }}>
            <Dot color={categories.find(categoryId)?.color} />
            <Text style={{ flex: 1, color: categoryId ? colors.text : colors.subtle }}>
              {categoryId ? categories.fullName(categoryId) : '— Choose —'}
            </Text>
            <Text style={{ color: colors.faint }}>›</Text>
          </TouchableOpacity>
        </Field>
        <Field label="Default account">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {state.accounts.map((a) => (
                <TouchableOpacity key={a.id} onPress={() => { setAccountId(a.id); setCurrency(a.currency); }}
                  style={{ borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8,
                    borderColor: a.id === accountId ? colors.primary : colors.border,
                    backgroundColor: a.id === accountId ? colors.primary : colors.card }}>
                  <Text style={{ fontSize: 13, color: a.id === accountId ? colors.primaryFg : colors.text }}>{a.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </Field>
      </Card>
      <Button title={item ? 'Save' : 'Create'} onPress={save} />
      <Button title="Cancel" kind="ghost" onPress={onDone} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}
