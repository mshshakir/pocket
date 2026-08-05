/**
 * MoreScreen — hub for the features that don't warrant a bottom-tab slot.
 * Each row pushes a screen onto the stack.
 */
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useAppState } from '../state/AppContext.js';
import { Card } from '../ui/common.js';
import { colors } from '../ui/theme.js';

const ITEMS = [
  { route: 'Debts',      icon: '⇄', label: 'Debts',        sub: 'Loans and IOUs' },
  { route: 'Reports',    icon: '◔', label: 'Reports',      sub: 'Spending breakdown' },
  { route: 'Categories', icon: '▤', label: 'Categories',   sub: 'Edit the category tree' },
  { route: 'Regulars',   icon: '↻', label: 'Regular items', sub: 'Quick-log recurring buys' },
  { route: 'Family',     icon: '👪', label: 'Family sharing', sub: 'Share accounts' },
  { route: 'Settings',   icon: '⚙', label: 'Settings',     sub: 'Sync, currency, export' },
];

export default function MoreScreen({ navigation }) {
  const { state } = useAppState();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <Card style={{ paddingVertical: 4 }}>
        {ITEMS.map((it, i) => (
          <TouchableOpacity key={it.route} onPress={() => navigation.navigate(it.route)}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
              borderBottomWidth: i === ITEMS.length - 1 ? 0 : 1, borderColor: colors.muted }}>
            <Text style={{ fontSize: 18, width: 32 }}>{it.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '600', color: colors.text }}>{it.label}</Text>
              <Text style={{ fontSize: 12, color: colors.subtle }}>{it.sub}</Text>
            </View>
            <Text style={{ color: colors.faint }}>›</Text>
          </TouchableOpacity>
        ))}
      </Card>
      <Text style={{ fontSize: 11, color: colors.faint, textAlign: 'center', marginTop: 8 }}>
        {state.user.homeCurrency} · {state.accounts.length} accounts · {state.transactions.length} transactions
      </Text>
    </ScrollView>
  );
}
