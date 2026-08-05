/**
 * TransactionsScreen — searchable, filterable, sortable list grouped by day
 * with month subtotals, plus a multi-select mode for bulk delete.
 *
 * Parity with the web TransactionsView:
 *   • search (payee / note / category)
 *   • date-range presets, type filter, sort (TX_SORT_OPTIONS)
 *   • month divider rows carrying income / expense / net subtotals
 *   • multi-select → bulk delete
 *   • rows show the split count, transfer direction, and — when the entry is
 *     in a foreign currency — the home-currency conversion line
 * Sorting/deletion go through the shared TransactionService so behaviour and
 * the recurring-skip guard match the web exactly.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, SectionList, TouchableOpacity, Alert } from 'react-native';
import { useAppState } from '../state/AppContext.js';
import { PickerBus } from '../state/PickerBus.js';
import { Row, Dot, Input, Button, EmptyState } from '../ui/common.js';
import { colors } from '../ui/theme.js';
import { TX_SORT_OPTIONS } from '../data/constants.js';
import { DateService } from '../domain/services/DateService.js';
import { HijriCalendarService } from '../domain/services/HijriCalendarService.js';

const hijri = new HijriCalendarService();

const RANGES = [
  { id: 'all', label: 'All' },
  { id: '7', label: '7d' },
  { id: '30', label: '30d' },
  { id: '90', label: '90d' },
];
const TYPES = [
  { id: 'all', label: 'All' },
  { id: 'expense', label: 'Expense' },
  { id: 'income', label: 'Income' },
  { id: 'transfer', label: 'Transfer' },
];

function withinRange(iso, range) {
  if (range === 'all') return true;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - parseInt(range, 10));
  return new Date(iso + 'T12:00:00') >= cutoff;
}

export default function TransactionsScreen({ navigation }) {
  const { state, services } = useAppState();
  const { fx, categories, transactions: txService } = services;
  const home = state.user.homeCurrency;
  const dateFmt = state.user.dateFormat || 'auto';
  const showHijri = state.user.showHijri !== false;

  const [query, setQuery] = useState('');
  const [range, setRange] = useState('all');
  const [type, setType] = useState('all');
  const [sort, setSort] = useState('date-desc');
  const [showFilters, setShowFilters] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [catFilter, setCatFilter] = useState([]);        // category ids (+descendants matched)
  const [acctFilter, setAcctFilter] = useState(() => new Set());
  const [payFilter, setPayFilter] = useState(() => new Set());
  const [amtMin, setAmtMin] = useState('');
  const [amtMax, setAmtMax] = useState('');

  const accName = (id) => state.accounts.find((a) => a.id === id)?.name || 'Unknown';

  // Expand category filter to descendants (a parent selection covers its subs).
  const allowedCats = useMemo(() => {
    if (!catFilter.length) return null;
    const s = new Set();
    for (const id of catFilter) for (const d of categories.descendants(id)) s.add(d);
    return s;
  }, [catFilter, services.store.revision]);

  const txTouchesAcct = (t, set) =>
    set.has(t.accountId) || (Array.isArray(t.splits) && t.splits.some((sp) => set.has(sp.accountId || t.accountId)));
  const txTouchesCat = (t, set) =>
    set.has(t.categoryId) || (Array.isArray(t.splits) && t.splits.some((sp) => set.has(sp.categoryId)));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const min = amtMin.trim() ? Number(amtMin) : null;
    const max = amtMax.trim() ? Number(amtMax) : null;
    const rows = state.transactions.filter((t) => {
      if (type !== 'all' && t.type !== type) return false;
      if (!withinRange(t.date, range)) return false;
      if (allowedCats && !txTouchesCat(t, allowedCats)) return false;
      if (acctFilter.size && !txTouchesAcct(t, acctFilter)) return false;
      if (payFilter.size && !payFilter.has(t.paymentType)) return false;
      if (min != null || max != null) {
        const v = Math.abs(fx.fromMinor(fx.convert(t.amount, t.currency, home), home));
        if (min != null && v < min) return false;
        if (max != null && v > max) return false;
      }
      if (!q) return true;
      return (
        (t.payee || '').toLowerCase().includes(q) ||
        (t.note || '').toLowerCase().includes(q) ||
        (categories.fullName(t.categoryId) || '').toLowerCase().includes(q)
      );
    });
    return txService.sort(rows, sort);
  }, [state.transactions, query, range, type, sort, allowedCats, acctFilter, payFilter, amtMin, amtMax, services.store.revision]);

  // Day sections for a *virtualized* SectionList (only on-screen rows render —
  // a plain ScrollView over every row is what made touch janky on big ledgers).
  // Month subtotals ride on the first section of each month (date sorts only).
  const sections = useMemo(() => {
    const dateSort = sort.startsWith('date-');
    const byDay = [];
    const idx = new Map();
    for (const t of filtered) {
      if (!idx.has(t.date)) { idx.set(t.date, byDay.length); byDay.push({ date: t.date, data: [] }); }
      byDay[idx.get(t.date)].data.push(t);
    }
    const monthTot = {};
    for (const t of filtered) {
      const ym = (t.date || '').slice(0, 7);
      const m = (monthTot[ym] = monthTot[ym] || { income: 0, expense: 0 });
      const v = fx.convert(t.amount, t.currency, home);
      if (t.type === 'income') m.income += v;
      else if (t.type === 'expense') m.expense += v;
    }
    let prev = null;
    for (const s of byDay) {
      const ym = (s.date || '').slice(0, 7);
      s.monthHeader = (dateSort && ym !== prev) ? { ym, ...monthTot[ym] } : null;
      prev = ym;
    }
    return byDay;
  }, [filtered, sort]);

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const bulkDelete = () => {
    if (!selected.size) return;
    Alert.alert('Delete transactions', `Delete ${selected.size} selected?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        selected.forEach((id) => txService.delete(id));
        setSelected(new Set()); setSelecting(false);
      } },
    ]);
  };

  const activeFilterCount = (range !== 'all' ? 1 : 0) + (type !== 'all' ? 1 : 0) + (sort !== 'date-desc' ? 1 : 0)
    + (catFilter.length ? 1 : 0) + (acctFilter.size ? 1 : 0) + (payFilter.size ? 1 : 0)
    + (amtMin.trim() || amtMax.trim() ? 1 : 0);

  const clearFilters = () => {
    setRange('all'); setType('all'); setSort('date-desc');
    setCatFilter([]); setAcctFilter(new Set()); setPayFilter(new Set()); setAmtMin(''); setAmtMax('');
  };

  const toggleSet = (setter) => (id) => setter((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const pickCats = () => {
    const token = PickerBus.register((ids) => setCatFilter(ids || []));
    navigation.navigate('CategoryPicker', { token, mode: 'multi', type: type === 'all' ? null : type, selected: catFilter });
  };

  const chip = (on) => ({
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
    borderColor: on ? colors.primary : colors.border,
    backgroundColor: on ? colors.primary : colors.card,
  });
  const chipTxt = (on) => ({ fontSize: 12, color: on ? colors.primaryFg : colors.text });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Input placeholder="Search payee, note or category…" value={query} onChangeText={setQuery} style={{ flex: 1 }} />
          <TouchableOpacity onPress={() => navigation.navigate('TransactionForm', {})}
            style={{ backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' }}>
            <Text style={{ color: colors.primaryFg, fontWeight: '700', fontSize: 18 }}>＋</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 8, alignItems: 'center' }}>
          <TouchableOpacity onPress={() => setShowFilters((v) => !v)}>
            <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>
              {showFilters ? 'Hide filters' : 'Filters'}{activeFilterCount ? ` · ${activeFilterCount}` : ''}
            </Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={() => { setSelecting((v) => !v); setSelected(new Set()); }}>
            <Text style={{ color: selecting ? colors.rose : colors.subtle, fontSize: 13, fontWeight: '600' }}>
              {selecting ? 'Cancel' : 'Select'}
            </Text>
          </TouchableOpacity>
        </View>

        {showFilters ? (
          <View style={{ marginTop: 10, gap: 8 }}>
            <FilterRow label="Range" opts={RANGES} value={range} onPick={setRange} chip={chip} chipTxt={chipTxt} />
            <FilterRow label="Type" opts={TYPES} value={type} onPick={setType} chip={chip} chipTxt={chipTxt} />
            <FilterRow label="Sort"
              opts={TX_SORT_OPTIONS.map(([id, label]) => ({ id, label }))}
              value={sort} onPick={setSort} chip={chip} chipTxt={chipTxt} />

            <View>
              <Text style={{ fontSize: 11, color: colors.subtle, marginBottom: 4 }}>Categories</Text>
              <TouchableOpacity onPress={pickCats}
                style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ flex: 1, color: catFilter.length ? colors.text : colors.subtle, fontSize: 13 }}>
                  {catFilter.length ? `${catFilter.length} selected` : 'Any category'}
                </Text>
                {catFilter.length ? <Text onPress={() => setCatFilter([])} style={{ color: colors.rose, fontSize: 12, marginRight: 8 }}>Clear</Text> : null}
                <Text style={{ color: colors.faint }}>›</Text>
              </TouchableOpacity>
            </View>

            <MultiRow label="Accounts" opts={state.accounts.map((a) => ({ id: a.id, label: a.name }))}
              set={acctFilter} onToggle={toggleSet(setAcctFilter)} chip={chip} chipTxt={chipTxt} />
            <MultiRow label="Payment method" opts={services.paymentTypes.allTypes().map((p) => ({ id: p, label: p }))}
              set={payFilter} onToggle={toggleSet(setPayFilter)} chip={chip} chipTxt={chipTxt} />

            <View>
              <Text style={{ fontSize: 11, color: colors.subtle, marginBottom: 4 }}>Amount ({home})</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Input placeholder="min" value={amtMin} onChangeText={setAmtMin} keyboardType="decimal-pad" style={{ flex: 1 }} />
                <Input placeholder="max" value={amtMax} onChangeText={setAmtMax} keyboardType="decimal-pad" style={{ flex: 1 }} />
              </View>
            </View>

            {activeFilterCount ? (
              <TouchableOpacity onPress={clearFilters} style={{ paddingVertical: 4 }}>
                <Text style={{ color: colors.rose, fontSize: 13, fontWeight: '600' }}>Clear all filters</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>

      {filtered.length === 0 ? (
        <View style={{ padding: 16 }}>
          <EmptyState title={query || activeFilterCount ? 'No matches' : 'No transactions yet'}
            subtitle={query || activeFilterCount ? 'Try widening the filters.' : 'Tap ＋ to add your first one.'} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(t) => t.id}
          stickySectionHeadersEnabled={false}
          initialNumToRender={16}
          windowSize={11}
          removeClippedSubviews
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: selecting ? 90 : 24 }}
          renderSectionHeader={({ section }) => (
            <View style={{ backgroundColor: colors.bg }}>
              {section.monthHeader ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 4 }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>{monthLabel(section.monthHeader.ym)}</Text>
                  <View style={{ flex: 1 }} />
                  {section.monthHeader.income ? <Text style={{ fontSize: 11, color: colors.green, marginLeft: 8 }}>+{fx.formatMoney(section.monthHeader.income, home)}</Text> : null}
                  {section.monthHeader.expense ? <Text style={{ fontSize: 11, color: colors.rose, marginLeft: 8 }}>−{fx.formatMoney(section.monthHeader.expense, home)}</Text> : null}
                </View>
              ) : null}
              <Text style={{ fontSize: 12, color: colors.subtle, fontWeight: '600', paddingVertical: 6 }}>{DateService.label(section.date, dateFmt)}</Text>
            </View>
          )}
          renderItem={({ item: t }) => {
            const isSel = selected.has(t.id);
            const foreign = t.currency !== home;
            return (
              <Row
                onPress={() => selecting ? toggle(t.id) : navigation.navigate('TransactionForm', { id: t.id })}
                style={{
                  backgroundColor: isSel ? colors.muted : colors.card,
                  borderWidth: 1, borderColor: isSel ? colors.primary : colors.border,
                  borderRadius: 12, paddingHorizontal: 12, marginBottom: 6,
                }}
              >
                {selecting ? (
                  <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 1, marginRight: 10,
                    borderColor: isSel ? colors.primary : colors.border,
                    backgroundColor: isSel ? colors.primary : 'transparent',
                    alignItems: 'center', justifyContent: 'center' }}>
                    {isSel ? <Text style={{ color: colors.primaryFg, fontSize: 12 }}>✓</Text> : null}
                  </View>
                ) : (
                  <Dot color={state.categories.find((c) => c.id === t.categoryId)?.color} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '500' }} numberOfLines={1}>
                    {t.payee || (t.type === 'transfer'
                      ? `Transfer ${t.transferDir === 'in' ? 'in' : 'out'}`
                      : categories.fullName(t.categoryId) || 'Uncategorised')}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.subtle }} numberOfLines={1}>
                    {accName(t.accountId)}
                    {Array.isArray(t.splits) && t.splits.length ? ` · ${t.splits.length} splits` : ''}
                    {t.recurring ? ' · recurring' : ''}
                    {showHijri ? ` · ${(() => { const h = t.hijriDate || hijri.toHijri(t.date); return `${h.day} ${hijri.monthsShort[h.month]}`; })()}` : ''}
                    {t.addedBy ? ` · by ${t.addedBy}` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontWeight: '600',
                    color: t.type === 'income' ? colors.green : t.type === 'expense' ? colors.text : colors.subtle }}>
                    {t.type === 'expense' ? '−' : t.type === 'income' ? '+' : ''}{fx.formatMoney(t.amount, t.currency)}
                  </Text>
                  {foreign ? (
                    <Text style={{ fontSize: 11, color: colors.faint }}>
                      {fx.formatMoney(fx.convert(t.amount, t.currency, home), home)}
                    </Text>
                  ) : null}
                </View>
              </Row>
            );
          }}
        />
      )}

      {selecting ? (
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 16 }}>
          <Button title={selected.size ? `Delete ${selected.size} selected` : 'Select transactions to delete'}
            kind={selected.size ? 'danger' : 'ghost'} onPress={bulkDelete} disabled={!selected.size} />
        </View>
      ) : null}
    </View>
  );
}

function MultiRow({ label, opts, set, onToggle, chip, chipTxt }) {
  if (!opts.length) return null;
  return (
    <View>
      <Text style={{ fontSize: 11, color: colors.subtle, marginBottom: 4 }}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {opts.map((o) => (
            <TouchableOpacity key={o.id} onPress={() => onToggle(o.id)} style={chip(set.has(o.id))}>
              <Text style={[chipTxt(set.has(o.id)), { textTransform: 'capitalize' }]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function FilterRow({ label, opts, value, onPick, chip, chipTxt }) {
  return (
    <View>
      <Text style={{ fontSize: 11, color: colors.subtle, marginBottom: 4 }}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {opts.map((o) => (
            <TouchableOpacity key={o.id} onPress={() => onPick(o.id)} style={chip(o.id === value)}>
              <Text style={chipTxt(o.id === value)}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function monthLabel(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
