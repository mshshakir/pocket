/**
 * AccountPickerScreen — the two-step account picker, mirroring the category
 * picker: step 1 shows GROUPS, step 2 shows the accounts in the chosen group.
 * Search spans every account.
 *
 * Groups are:
 *   • your own account-groups (from AccountGroupService) + an "Ungrouped" group
 *   • one "Shared · <owner>" group per family member who shares accounts with
 *     you (from the sync snapshot), listing the accounts you may post to.
 *
 * Params (via route):
 *   { token, mode?='all', selected?=accountId }
 *     mode 'all'   — own + shared accounts (expense / income)
 *     mode 'local' — own accounts only (transfers can't touch a shared book)
 *
 * Resolves via PickerBus with { accountId, ownerId, currency, name } — ownerId
 * is null for your own accounts, or the owner's id for a shared account.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { useAppState } from '../state/AppContext.js';
import { PickerBus } from '../state/PickerBus.js';
import { Row, Dot, Input } from '../ui/common.js';
import { colors } from '../ui/theme.js';

const CAN_POST = ['add', 'edit', 'full'];

export default function AccountPickerScreen({ navigation, route }) {
  const { token, mode = 'all', selected = null } = route.params || {};
  const { services } = useAppState();
  const { accountGroups, sync, fx } = services;

  const [groupId, setGroupId] = useState(null);
  const [query, setQuery] = useState('');

  // Build the group model once per render.
  const groups = useMemo(() => {
    const live = (list) => list.filter((a) => !a.archived).map((a) => ({ ...a, ownerId: null }));
    const own = [
      ...accountGroups.all().map((g) => ({
        id: g.id, name: g.name, color: g.color, ownerId: null,
        accs: live(accountGroups.accountsIn(g.id)),
      })),
      { id: '__none__', name: 'Ungrouped', color: '#9ca3af', ownerId: null,
        accs: live(accountGroups.ungrouped()) },
    ].filter((s) => s.accs.length);

    if (mode === 'local') return own;

    const shared = (sync.sharedData || []).map((share) => ({
      id: `share_${share._ownerId}`,
      name: `Shared · ${share.sharedBy || 'family'}`,
      color: colors.indigo, ownerId: share._ownerId,
      accs: (share.accounts || [])
        .filter((a) => CAN_POST.includes((share.permission || {})[a.id] || 'view'))
        .map((a) => ({ ...a, ownerId: share._ownerId })),
    })).filter((s) => s.accs.length);

    return [...own, ...shared];
  }, [mode, services.store.revision]);

  const finish = (acc) => {
    PickerBus.resolve(token, {
      accountId: acc.id, ownerId: acc.ownerId ?? null, currency: acc.currency, name: acc.name,
    });
    navigation.goBack();
  };

  // Flatten for search.
  const allAccounts = useMemo(() => groups.flatMap((g) => g.accs.map((a) => ({ ...a, _group: g.name }))), [groups]);

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const rows = searching
    ? allAccounts.filter((a) => a.name.toLowerCase().includes(q) || (a._group || '').toLowerCase().includes(q))
    : (groupId ? (groups.find((g) => g.id === groupId)?.accs || []) : groups);

  const inGroup = !searching && groupId;
  const activeGroup = inGroup ? groups.find((g) => g.id === groupId) : null;

  const renderRow = ({ item }) => {
    // Group row (step 1).
    if (!searching && !groupId) {
      const total = item.accs.reduce((s, a) => s + fx.convert(a.balance || 0, a.currency, 'USD'), 0);
      return (
        <Row onPress={() => setGroupId(item.id)} style={{ paddingHorizontal: 12 }}>
          <Dot color={item.color} />
          <Text style={{ flex: 1, color: colors.text, fontWeight: '500' }}>{item.name}</Text>
          <Text style={{ fontSize: 12, color: colors.faint, marginRight: 6 }}>{item.accs.length}</Text>
          <Text style={{ color: colors.faint }}>›</Text>
        </Row>
      );
    }
    // Account row (step 2 or search).
    const a = item;
    const on = a.id === selected;
    return (
      <Row onPress={() => finish(a)} style={{ paddingHorizontal: 12 }}>
        <Dot color={a.color} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text }} numberOfLines={1}>
            {searching && a._group ? <Text style={{ color: colors.subtle }}>{a._group} / </Text> : null}
            {a.name}
          </Text>
          {a.ownerId ? <Text style={{ fontSize: 11, color: colors.indigo }}>shared</Text> : null}
        </View>
        <Text style={{ fontSize: 12, color: colors.subtle, marginRight: 8 }}>{a.currency}</Text>
        {on ? <Text style={{ color: colors.green, fontWeight: '700' }}>✓</Text> : null}
      </Row>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        {inGroup ? (
          <TouchableOpacity onPress={() => setGroupId(null)} style={{ marginBottom: 8 }}>
            <Text style={{ color: colors.subtle }}>‹ All groups{activeGroup ? ` · ${activeGroup.name}` : ''}</Text>
          </TouchableOpacity>
        ) : null}
        <Input placeholder="Search accounts…" value={query} onChangeText={setQuery} />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(item, i) => item.id || `row_${i}`}
        renderItem={renderRow}
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 12 }}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', color: colors.subtle, marginTop: 24 }}>
            {searching ? `Nothing matches “${query.trim()}”.` : 'No accounts here.'}
          </Text>
        }
      />
    </View>
  );
}
