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
import { RegularLogSubmitter } from '../domain/services/RegularLogSubmitter.js';

const hijri = new HijriCalendarService();

// ── Shared helpers ──────────────────────────────────────────────────────────

/**
 * Log a regular item, to whichever book it belongs to.
 *
 * The rule this used to hold inline now lives in RegularLogSubmitter, in the
 * domain layer. It moved because it was wrong and nothing caught it: a `.js`
 * file full of JSX cannot be imported by a node test, so the one rule the
 * Spaces port most needed covered was the one no test could reach — a mutation
 * reverting the fix left every assertion green.
 *
 * @returns {Promise<{ok: boolean, shared: boolean, reason?: string}>}
 */
function logRegular(item, services, date) {
  return new RegularLogSubmitter({
    store: services.store, sync: services.sync, fx: services.fx,
    guard: services.spaceGuard,
  }).submit(item, date);
}

const isoOf = (d) => DateService.toIso(d);

export default function RegularsScreen({ navigation }) {
  const { state, services, inGuestSpace } = useAppState();
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

  // The user's own preference, not the viewed space's — see SettingsScreen.
  const setMode = (m) => { services.store.getState().user.calendarMode = m; services.store.flush(); };

  // Merged: local rows plus contributions sitting in an owner's snapshot. Read
  // straight from state.transactions and a shared log disappears the instant it
  // is submitted, because it never lands locally.
  const logsForDate = (iso) => services.regularLogs.onDate(iso);
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
    monthLogs = services.regularLogs.all().filter((t) => {
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
    monthLogs = services.regularLogs.all().filter((t) => {
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

  const quickAdd = async (item) => {
    const res = await logRegular(item, services, iso);
    force((n) => n + 1);
    if (!res.ok) return Alert.alert('Could not log', res.reason || 'Please try again');
    const cur = item.currency || services.store.getState().user.homeCurrency;
    Alert.alert(
      res.shared ? 'Submitted' : 'Logged',
      `${item.name} · ${fx.formatMoney(item.defaultAmount || 0, cur)} on ${iso}`
        + (res.shared ? '\n\nSent to the account owner.' : ''),
    );
  };

  const removeLog = async (t) => {
    // A contributed row does not live in state.transactions at all — it comes
    // back inside the owner's snapshot, tagged by RegularLogService. Deleting it
    // means asking the owner, not filtering a local array.
    if (t._shared) {
      try {
        await services.sync.deleteContribution(t._ownerId, t.id);
        services.sync.scheduleSharesRefresh?.(3000);
      } catch (e) {
        return Alert.alert('Could not delete', String(e?.message || e));
      }
      force((n) => n + 1);
      return;
    }
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
              {t._shared ? (
                <Text style={{ fontSize: 10, color: colors.subtle }}>
                  In their book · pending the owner
                </Text>
              ) : null}
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

  const logs = services.regularLogs.all().filter((t) => {
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
  // ItemsTab is a sub-component and does not receive the hook's values as
  // props, so it reads them itself. Referencing inGuestSpace without this is a
  // ReferenceError at render, not a silently-falsy value.
  const { inGuestSpace, guard } = useAppState();
  const { fx, categories } = services;
  const items = state.regularItems || [];

  /**
   * Editing and deleting an OWNER's item used to be live buttons that resolved
   * the id against the member's own book, missed, and returned early — the
   * form closed, the alert said nothing was wrong, and no item changed. Refuse
   * with a reason instead of failing quietly.
   */
  const requireOwn = (what) => {
    const v = guard?.requireHome(what) ?? { ok: true };
    if (!v.ok) Alert.alert('Not here', v.message);
    return v.ok;
  };

  const log = async (item) => {
    const res = await logRegular(item, services);
    if (!res.ok) return Alert.alert('Could not log', res.reason || 'Please try again');
    Alert.alert(
      res.shared ? 'Submitted' : 'Logged',
      `${item.name} · ${fx.formatMoney(item.defaultAmount || 0, item.currency || state.user.homeCurrency)}`
        + (res.shared ? '\n\nSent to the account owner.' : ''),
    );
  };

  const del = (item) => {
    if (!requireOwn('your regular items')) return;
    const s = services.store.getState();
    // Count through the merged source — an item on a shared account has none of
    // its logs locally, so a local count always reported zero.
    const n = services.regularLogs.all().filter((t) => t.regularItemId === item.id).length;
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
      {inGuestSpace ? null : <Button title="＋ New regular item" onPress={() => onEdit({})} style={{ marginBottom: 12 }} />}
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
                {/* In a guest space the item's categoryId is the OWNER's, so the
                    local tree cannot name it and the label came out blank. */}
                {item.categoryId
                  ? ` · ${categories.fullName(item.categoryId, inGuestSpace ? state.categories : undefined) || 'Uncategorised'}`
                  : ''}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <Button title="Log now" onPress={() => log(item)} style={{ flex: 1 }} />
            <Button title="Edit" kind="ghost"
              onPress={() => { if (requireOwn('your regular items')) onEdit(item); }} />
            <Button title="Delete" kind="danger" onPress={() => del(item)} />
          </View>
        </Card>
      ))}
    </View>
  );
}

function ItemForm({ item, onDone, navigation, services, state }) {
  const { fx, categories, sync, accounts: accountService } = services;
  const [name, setName] = useState(item?.name || '');
  const [amount, setAmount] = useState(item ? String(fx.fromMinor(item.defaultAmount || 0, item.currency || state.user.homeCurrency)) : '');
  const [currency, setCurrency] = useState(item?.currency || state.user.homeCurrency);
  const [accountId, setAccountId] = useState(
    item?.accountId || accountService?.defaultId?.() || state.accounts[0]?.id || '');
  // null = my own book. Set, and logging this item contributes to that owner.
  const [ownerId, setOwnerId] = useState(item?.sharedOwnerId || null);
  const [categoryId, setCategoryId] = useState(item?.categoryId || null);

  // Only accounts the member may actually post to — offering a view-only one
  // would just produce a contribution the owner's device rejects later.
  const CAN_POST = ['add', 'edit', 'full'];
  const shares = (sync?.sharedData || [])
    .map((sh) => ({
      sh,
      accounts: (sh.accounts || []).filter((a) => CAN_POST.includes((sh.permission || {})[a.id])),
    }))
    .filter((g) => g.accounts.length);

  // A contribution lands in the OWNER's book, so its categoryId has to be one
  // of theirs. Their tree travels in the snapshot already.
  const ownerShare = ownerId ? shares.find((g) => g.sh._ownerId === ownerId)?.sh : null;
  const ownerCats  = ownerShare ? (ownerShare.categories || []) : null;

  const pickCategory = () => {
    const token = PickerBus.register((ids) => setCategoryId(ids[0] ?? null));
    navigation.navigate('CategoryPicker', {
      token, mode: 'single', type: 'expense',
      selected: categoryId ? [categoryId] : [],
      // Undefined means "my own book" — the picker falls back to local.
      categories: ownerCats || undefined,
    });
  };

  /**
   * Move the item between books. The previously-picked category belongs to the
   * old book and means nothing in the new one, so it is dropped rather than
   * submitted as an id the owner cannot resolve.
   */
  const chooseAccount = (accId, ccy, nextOwnerId = null) => {
    if ((nextOwnerId || null) !== (ownerId || null)) setCategoryId(null);
    setAccountId(accId);
    setOwnerId(nextOwnerId || null);
    if (ccy) setCurrency(ccy);
  };

  const save = () => {
    if (!name.trim()) { Alert.alert('Name required'); return; }
    const s = services.store.getState();
    if (!Array.isArray(s.regularItems)) s.regularItems = [];
    const payload = {
      name: name.trim(),
      defaultAmount: fx.toMinor(Number(amount) || 0, currency),
      currency, accountId, categoryId,
      // Stored as two fields, not the encoded "shared:owner:acc" transport form.
      sharedOwnerId: ownerId || null,
      icon: item?.icon || 'coffee', color: item?.color || '#f97316',
    };
    // Resolve the item out of the REAL state before writing. `item` arrived as a
    // prop from a list built on useAppState()'s state, which is a projection in
    // a guest space — Object.assign on that copy is silently discarded, while
    // the create branch two lines down writes to the real book. Same function,
    // opposite outcomes, no error either way.
    const target = item ? (s.regularItems || []).find((i) => i.id === item.id) : null;
    if (item && target) Object.assign(target, payload);
    else if (item)      Object.assign(item, payload);   // not in our book — leave as-is
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
                <TouchableOpacity key={a.id} onPress={() => chooseAccount(a.id, a.currency, null)}
                  style={{ borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8,
                    borderColor: (!ownerId && a.id === accountId) ? colors.primary : colors.border,
                    backgroundColor: (!ownerId && a.id === accountId) ? colors.primary : colors.card }}>
                  <Text style={{ fontSize: 13, color: (!ownerId && a.id === accountId) ? colors.primaryFg : colors.text }}>{a.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </Field>
        {shares.map(({ sh, accounts }) => (
          <Field key={sh._ownerId} label={`Shared by ${sh.sharedBy || 'Family'}`}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {accounts.map((a) => {
                  const on = ownerId === sh._ownerId && a.id === accountId;
                  return (
                    <TouchableOpacity key={a.id}
                      onPress={() => chooseAccount(a.id, a.currency, sh._ownerId)}
                      style={{ borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8,
                        borderColor: on ? colors.primary : colors.border,
                        backgroundColor: on ? colors.primary : colors.card }}>
                      <Text style={{ fontSize: 13, color: on ? colors.primaryFg : colors.text }}>{a.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </Field>
        ))}
        {ownerId ? (
          <Text style={{ fontSize: 11, color: colors.subtle, marginTop: -4 }}>
            Entries logged from this item go to the owner's book, and use their categories.
          </Text>
        ) : null}
      </Card>
      <Button title={item ? 'Save' : 'Create'} onPress={save} />
      <Button title="Cancel" kind="ghost" onPress={onDone} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}
