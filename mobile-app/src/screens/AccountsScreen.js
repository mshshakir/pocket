/**
 * AccountsScreen — accounts grouped by account-group.
 *
 * Tapping an account opens its LEDGER (AccountDetail): the account's whole
 * transaction history with month/lifetime stats, exactly like the web's
 * AccountDetailView. Editing the account itself is a separate button inside
 * the ledger (matching the web, where the row opens the detail and a pencil
 * opens the edit form). Tapping a transaction row opens the shared
 * TransactionForm modal.
 *
 * Creating an account with a starting balance writes an opening 'Balance
 * adjustment' transaction, exactly like the web — balances stay derived.
 */
import React, { useState } from 'react';
import { ScrollView, View, Text, Alert, TouchableOpacity } from 'react-native';
import { useAppState } from '../state/AppContext.js';
import { Card, SectionTitle, Row, Dot, Field, Input, Button, EmptyState } from '../ui/common.js';
import { colors } from '../ui/theme.js';
import { ACCOUNT_TYPES, CURRENCIES, FAMILY_ACCESS_LEVELS } from '../data/constants.js';
import { IdGenerator } from '../domain/services/IdGenerator.js';
import { DateService } from '../domain/services/DateService.js';
import { RATES } from '../domain/services/FxRates.js';

export default function AccountsScreen({ navigation }) {
  const { state, services } = useAppState();
  const { fx, accountGroups } = services;
  const home = state.user.homeCurrency;
  // null = list · { id?: ... } = edit form · { view: account } = ledger
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null); // account id being drilled into
  const [manageGroups, setManageGroups] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const toggleGroup = (id) => setCollapsedGroups((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const sections = [
    ...accountGroups.all().map((g) => ({
      id: g.id, name: g.name, color: g.color, accs: accountGroups.accountsIn(g.id),
    })),
    { id: '__none__', name: 'Ungrouped', color: '#9ca3af', accs: accountGroups.ungrouped() },
  ].filter((s) => s.accs.length);

  if (editing !== null) {
    return (
      <AccountForm
        account={editing.id ? editing : null}
        onDone={() => setEditing(null)}
        services={services}
        state={state}
      />
    );
  }

  if (viewing !== null) {
    // Re-resolve from live state so the ledger reflects edits/new entries.
    const account = state.accounts.find((a) => a.id === viewing);
    if (!account) { setViewing(null); return null; }
    return (
      <AccountDetail
        account={account}
        services={services}
        state={state}
        navigation={navigation}
        onBack={() => setViewing(null)}
        onEdit={() => { setViewing(null); setEditing(account); }}
      />
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        <Button title="＋ New account" onPress={() => setEditing({})} style={{ flex: 1 }} />
        <Button title="Groups" kind="ghost" onPress={() => setManageGroups((v) => !v)} />
      </View>
      {manageGroups ? <GroupManager services={services} onClose={() => setManageGroups(false)} /> : null}
      {sections.length === 0 ? (
        <EmptyState title="No accounts" subtitle="Add your first account to start tracking." />
      ) : sections.map((sec) => {
        const total = sec.accs.reduce(
          (s, a) => s + fx.convert(a.balance, a.currency, home), 0);
        const open = !collapsedGroups.has(sec.id);
        return (
          <View key={sec.id}>
            <TouchableOpacity onPress={() => toggleGroup(sec.id)}>
              <SectionTitle
                right={<Text style={{ fontSize: 12, color: colors.subtle }}>{open ? '' : `${sec.accs.length} · `}{fx.formatMoney(total, home)}</Text>}
              >
                {open ? '▾ ' : '▸ '}{sec.name}
              </SectionTitle>
            </TouchableOpacity>
            {open ? (
            <Card style={{ paddingVertical: 4 }}>
              {sec.accs.map((a, i) => (
                <Row
                  key={a.id}
                  onPress={() => setViewing(a.id)}
                  style={{ borderBottomWidth: i === sec.accs.length - 1 ? 0 : 1, borderColor: colors.muted, opacity: a.archived ? 0.5 : 1 }}
                >
                  <Dot color={a.color} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '500' }}>
                      {a.name}{a.archived ? '  · archived' : ''}
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.subtle }}>
                      {a.type} · {a.currency}
                    </Text>
                  </View>
                  <Text style={{
                    fontWeight: '600',
                    color: a.balance < 0 ? colors.rose : colors.text,
                  }}>
                    {fx.formatMoney(a.balance, a.currency)}
                  </Text>
                  <Text style={{ color: colors.faint, marginLeft: 8 }}>›</Text>
                </Row>
              ))}
            </Card>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

/**
 * AccountDetail — the account's ledger, mirroring web AccountDetailView:
 * header + balance, this-month/lifetime in-out stats, and the transaction
 * list grouped by day (newest first). Tapping a row edits that transaction.
 */
function AccountDetail({ account: a, services, state, navigation, onBack, onEdit }) {
  const { fx, transactions: txs, categories, reports } = services;
  const home = state.user.homeCurrency;
  const [sharing, setSharing] = useState(false);

  const touches = (t) => {
    if (t.accountId === a.id) return true;
    if (Array.isArray(t.splits)) return t.splits.some((s) => (s.accountId || t.accountId) === a.id);
    return false;
  };

  const allTxs = state.transactions.filter(touches);

  // ── Stats: this month vs lifetime, in vs out (uses the ledger authority) ──
  const monthStart = reports.startOfMonth();
  let mthIn = 0, mthOut = 0, lifeIn = 0, lifeOut = 0;
  for (const t of allTxs) {
    const imp = txs.impactOnAccount(t, a);
    const inMonth = new Date(t.date + 'T12:00:00') >= monthStart;
    if (imp.dir === '+') { lifeIn += imp.minorInAcc; if (inMonth) mthIn += imp.minorInAcc; }
    if (imp.dir === '-') { lifeOut += imp.minorInAcc; if (inMonth) mthOut += imp.minorInAcc; }
  }

  // Newest first, grouped by day.
  const sorted = allTxs.slice().sort((x, y) => (y.date || '').localeCompare(x.date || ''));
  const byDay = [];
  const idx = new Map();
  for (const t of sorted) {
    if (!idx.has(t.date)) { idx.set(t.date, byDay.length); byDay.push({ date: t.date, rows: [] }); }
    byDay[idx.get(t.date)].rows.push(t);
  }

  const Stat = ({ label, value, tone }) => (
    <View style={{ flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10 }}>
      <Text style={{ fontSize: 11, color: colors.subtle }}>{label}</Text>
      <Text style={{ fontSize: 15, fontWeight: '700', color: tone || colors.text }}>{value}</Text>
    </View>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <TouchableOpacity onPress={onBack} style={{ paddingVertical: 6, paddingRight: 12 }}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>‹ Accounts</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <Button title="Share" kind="ghost" onPress={() => setSharing((v) => !v)} />
        <Button title="Edit" kind="ghost" onPress={onEdit} />
      </View>

      {sharing ? <AccountShareSheet accountId={a.id} services={services} onClose={() => setSharing(false)} /> : null}

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Dot color={a.color} size={16} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>{a.name}</Text>
            <Text style={{ fontSize: 12, color: colors.subtle }}>{a.type} · {a.currency}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 11, color: colors.subtle }}>Balance</Text>
            <Text style={{ fontSize: 22, fontWeight: '700', color: a.balance < 0 ? colors.rose : colors.text }}>
              {fx.formatMoney(a.balance, a.currency)}
            </Text>
            {a.currency !== home ? (
              <Text style={{ fontSize: 11, color: colors.subtle }}>
                {fx.formatMoney(fx.convert(a.balance, a.currency, home), home)} in {home}
              </Text>
            ) : null}
          </View>
        </View>
      </Card>

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
        <Stat label="This month in" value={`+${fx.formatMoney(mthIn, a.currency)}`} tone={colors.green} />
        <Stat label="This month out" value={`−${fx.formatMoney(mthOut, a.currency)}`} tone={colors.rose} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        <Stat label="Lifetime in" value={`+${fx.formatMoney(lifeIn, a.currency)}`} />
        <Stat label="Lifetime out" value={`−${fx.formatMoney(lifeOut, a.currency)}`} />
      </View>

      {byDay.length === 0 ? (
        <EmptyState title="No transactions" subtitle="Entries for this account will appear here." />
      ) : byDay.map((grp) => (
        <View key={grp.date} style={{ marginBottom: 6 }}>
          <Text style={{ fontSize: 12, color: colors.subtle, fontWeight: '600', marginBottom: 4 }}>{DateService.label(grp.date, state.user.dateFormat || 'auto')}</Text>
          <Card style={{ paddingVertical: 4 }}>
            {grp.rows.map((t, i) => {
              const imp = txs.impactOnAccount(t, a);
              return (
                <Row
                  key={t.id}
                  onPress={() => navigation.navigate('TransactionForm', { id: t.id })}
                  style={{ borderBottomWidth: i === grp.rows.length - 1 ? 0 : 1, borderColor: colors.muted }}
                >
                  <Dot color={state.categories.find((c) => c.id === t.categoryId)?.color} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '500' }} numberOfLines={1}>
                      {t.payee || (t.type === 'transfer'
                        ? `Transfer ${t.transferDir === 'in' ? 'in' : 'out'}`
                        : categories.fullName(t.categoryId) || 'Uncategorised')}
                    </Text>
                    {t.note ? (
                      <Text style={{ fontSize: 12, color: colors.subtle }} numberOfLines={1}>{t.note}</Text>
                    ) : null}
                  </View>
                  <Text style={{
                    fontWeight: '600',
                    color: imp.dir === '+' ? colors.green : imp.dir === '-' ? colors.text : colors.subtle,
                  }}>
                    {imp.dir === '-' ? '−' : imp.dir === '+' ? '+' : ''}
                    {fx.formatMoney(imp.minorInAcc, a.currency)}
                  </Text>
                </Row>
              );
            })}
          </Card>
        </View>
      ))}
    </ScrollView>
  );
}

const ACCOUNT_COLORS = ['#3b82f6', '#0ea5e9', '#22c55e', '#a855f7', '#f97316', '#14b8a6', '#ec4899', '#ef4444', '#f59e0b', '#64748b'];

function AccountForm({ account, onDone, services, state }) {
  const { fx, accounts, accountGroups } = services;
  const [, force] = useState(0);
  const [name, setName]         = useState(account?.name || '');
  const [type, setType]         = useState(account?.type || 'bank');
  const [currency, setCurrency] = useState(account?.currency || state.user.homeCurrency);
  const [color, setColor]       = useState(account?.color || ACCOUNT_COLORS[0]);
  const [groupId, setGroupId]   = useState(account?.groupId || null);
  const [archived, setArchived] = useState(!!account?.archived);
  const [balance, setBalance]   = useState(
    account ? String(fx.fromMinor(account.balance, account.currency)) : '');

  const groups = accountGroups.all();

  const newGroup = () => {
    Alert.prompt?.('New group', 'Group name', (n) => {
      if (n?.trim()) { const r = accountGroups.create(n.trim()); if (r.ok) { setGroupId(r.group.id); force((x) => x + 1); } }
    });
  };

  const save = () => {
    if (!name.trim()) { Alert.alert('Name required'); return; }
    const store = services.store;
    const st    = store.getState();

    if (account) {
      // Same rule as the web (audit C1): a pure currency switch re-denominates;
      // only a real balance edit in the SAME currency logs an adjustment.
      const currencyChanged = account.currency !== currency;
      const wasMinor = currencyChanged
        ? fx.convert(account.balance, account.currency, currency)
        : account.balance;
      accounts.update(account.id, { name: name.trim(), type, currency, color, groupId: groupId || null, archived });
      const newMinor = fx.toMinor(Number(balance) || 0, currency);
      if (!currencyChanged && newMinor !== wasMinor) {
        st.transactions.push(adjustmentTx(account.id, newMinor - wasMinor, currency, st, fx));
        store.flush();
      }
    } else {
      const a = accounts.create({
        name: name.trim(), type, currency, color, icon: 'wallet', groupId: groupId || null,
      });
      const opening = fx.toMinor(Number(balance) || 0, currency);
      if (opening !== 0) {
        st.transactions.push(adjustmentTx(a.id, opening, currency, st, fx));
        store.flush();
      }
    }
    onDone();
  };

  const del = () => {
    Alert.alert('Delete account?',
      'Transactions that belong only to this account are removed; split legs elsewhere are detached.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { accounts.delete(account.id); onDone(); } },
    ]);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <Card>
        <Field label="Name">
          <Input value={name} onChangeText={setName} placeholder="e.g. Main Checking" autoFocus />
        </Field>
        <Field label="Type">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {ACCOUNT_TYPES.map((t) => {
              const tid = t.id ?? t;
              const on = tid === type;
              return (
                <TouchableOpacity
                  key={tid}
                  onPress={() => setType(tid)}
                  style={{
                    borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8,
                    borderColor: on ? colors.primary : colors.border,
                    backgroundColor: on ? colors.primary : colors.card,
                  }}
                >
                  <Text style={{ color: on ? colors.primaryFg : colors.text, fontSize: 13 }}>
                    {t.label ?? tid}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Field>
        <Field label={`Currency (${currency})`}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {CURRENCIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  onPress={() => setCurrency(c)}
                  style={{
                    borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
                    borderColor: c === currency ? colors.primary : colors.border,
                    backgroundColor: c === currency ? colors.primary : colors.card,
                  }}
                >
                  <Text style={{ fontSize: 12, color: c === currency ? colors.primaryFg : colors.text }}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </Field>
        <Field label="Colour">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {ACCOUNT_COLORS.map((c) => (
              <TouchableOpacity key={c} onPress={() => setColor(c)}
                style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c,
                  borderWidth: c === color ? 3 : 0, borderColor: colors.text }} />
            ))}
          </View>
        </Field>
        <Field label="Group">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <GroupChip label="None" on={!groupId} onPress={() => setGroupId(null)} />
              {groups.map((g) => (
                <GroupChip key={g.id} label={g.name} on={groupId === g.id} onPress={() => setGroupId(g.id)} />
              ))}
              <GroupChip label="＋ New" on={false} onPress={newGroup} />
            </View>
          </ScrollView>
        </Field>
        <Field label={account ? 'Balance (logs an adjustment if changed)' : 'Starting balance'}>
          <Input value={balance} onChangeText={setBalance} keyboardType="decimal-pad" placeholder="0.00" />
        </Field>
        {account ? (
          <TouchableOpacity onPress={() => setArchived((v) => !v)}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
            <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1, marginRight: 10,
              borderColor: archived ? colors.primary : colors.border,
              backgroundColor: archived ? colors.primary : colors.card,
              alignItems: 'center', justifyContent: 'center' }}>
              {archived ? <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>✓</Text> : null}
            </View>
            <Text style={{ flex: 1, color: colors.text }}>Archived (hidden from the transaction picker)</Text>
          </TouchableOpacity>
        ) : null}
      </Card>
      <Button title={account ? 'Save' : 'Create account'} onPress={save} />
      {account ? <Button title="Delete account" kind="danger" onPress={del} style={{ marginTop: 8 }} /> : null}
      <Button title="Cancel" kind="ghost" onPress={onDone} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}

/** Account-first sharing: set each family member's access to THIS account. */
function AccountShareSheet({ accountId, services, onClose }) {
  const { familyShares, sync } = services;
  const [, force] = useState(0);
  const members = familyShares.members();
  const order = [null, ...FAMILY_ACCESS_LEVELS.map((l) => l.id)];

  const cycle = (m) => {
    const cur = familyShares.accessFor(m.id, accountId) || null;
    const next = order[(order.indexOf(cur) + 1) % order.length];
    const r = familyShares.setAccess(m.id, accountId, next);
    if (!r.ok) { Alert.alert('Cannot change', r.reason); return; }
    sync.pushFamilyShares?.();
    force((x) => x + 1);
  };
  const stop = () => {
    familyShares.unshareAccount(accountId);
    sync.pushFamilyShares?.();
    force((x) => x + 1);
  };

  return (
    <Card style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <Text style={{ flex: 1, fontWeight: '700', color: colors.text }}>Share this account</Text>
        <TouchableOpacity onPress={onClose}><Text style={{ color: colors.subtle }}>Done</Text></TouchableOpacity>
      </View>
      {members.length === 0 ? (
        <Text style={{ fontSize: 12, color: colors.subtle }}>Add family members first (More → Family sharing), then set their access here.</Text>
      ) : (
        <>
          <Text style={{ fontSize: 12, color: colors.subtle, marginBottom: 6 }}>Tap a member to cycle their access to this account.</Text>
          {members.map((m, i) => {
            const level = FAMILY_ACCESS_LEVELS.find((l) => l.id === familyShares.accessFor(m.id, accountId));
            return (
              <TouchableOpacity key={m.id} onPress={() => cycle(m)}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
                  borderTopWidth: i === 0 ? 0 : 1, borderColor: colors.muted }}>
                <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: m.color || colors.indigo,
                  alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{(m.name || m.email || '?').slice(0, 2).toUpperCase()}</Text>
                </View>
                <Text style={{ flex: 1, color: colors.text }}>{m.name || m.email}</Text>
                <Text style={{ fontSize: 13, fontWeight: '600', color: level ? level.color : colors.faint }}>
                  {level ? level.label : 'No access'}
                </Text>
              </TouchableOpacity>
            );
          })}
          <Button title="Stop sharing with everyone" kind="ghost" onPress={stop} style={{ marginTop: 8 }} />
        </>
      )}
    </Card>
  );
}

/** Inline group manager: create, rename, delete account groups. */
function GroupManager({ services, onClose }) {
  const { accountGroups } = services;
  const [, force] = useState(0);
  const [newName, setNewName] = useState('');
  const refresh = () => force((x) => x + 1);
  const groups = accountGroups.all();

  const create = () => {
    if (!newName.trim()) return;
    const r = accountGroups.create(newName.trim());
    if (!r.ok) { Alert.alert('Cannot create', r.reason); return; }
    setNewName(''); refresh();
  };
  const rename = (g) => {
    Alert.prompt?.('Rename group', g.name, (n) => {
      if (n?.trim()) { const r = accountGroups.rename(g.id, n.trim()); if (!r.ok) Alert.alert('Cannot rename', r.reason); refresh(); }
    }, undefined, g.name);
  };
  const del = (g) => {
    Alert.alert('Delete group', `Accounts in "${g.name}" become Ungrouped.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { accountGroups.delete(g.id); refresh(); } },
    ]);
  };

  return (
    <Card style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <Text style={{ flex: 1, fontWeight: '700', color: colors.text }}>Account groups</Text>
        <TouchableOpacity onPress={onClose}><Text style={{ color: colors.subtle }}>Done</Text></TouchableOpacity>
      </View>
      {groups.length === 0 ? (
        <Text style={{ fontSize: 12, color: colors.subtle, marginBottom: 8 }}>No groups yet. Create one below, then assign accounts from each account's form.</Text>
      ) : groups.map((g) => (
        <View key={g.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderColor: colors.muted }}>
          <Dot color={g.color} />
          <Text style={{ flex: 1, color: colors.text }}>{g.name}</Text>
          <Text style={{ fontSize: 12, color: colors.subtle, marginRight: 10 }}>{accountGroups.accountsIn(g.id).length}</Text>
          <TouchableOpacity onPress={() => rename(g)} style={{ paddingHorizontal: 8 }}><Text style={{ color: colors.subtle }}>Rename</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => del(g)} style={{ paddingHorizontal: 4 }}><Text style={{ color: colors.red }}>✕</Text></TouchableOpacity>
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <Input value={newName} onChangeText={setNewName} placeholder="New group name" style={{ flex: 1 }} />
        <Button title="Add" onPress={create} />
      </View>
    </Card>
  );
}

function GroupChip({ label, on, onPress }) {
  return (
    <TouchableOpacity onPress={onPress}
      style={{ borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8,
        borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.card }}>
      <Text style={{ fontSize: 13, color: on ? colors.primaryFg : colors.text }}>{label}</Text>
    </TouchableOpacity>
  );
}

/** The web's 'Balance adjustment' ledger entry, verbatim semantics. */
function adjustmentTx(accountId, deltaMinor, currency, state, fx) {
  const today = DateService.todayIso();
  return {
    id: IdGenerator.generate('tx'), accountId, categoryId: null,
    amount: Math.abs(deltaMinor), currency,
    exchangeRate: (RATES[currency] || 1) / (RATES[state.user.homeCurrency] || 1),
    refAmount: fx.convert(Math.abs(deltaMinor), currency, state.user.homeCurrency),
    payee: 'Balance adjustment', note: '',
    date: today, hijriDate: null,
    paymentType: 'cash', recordState: 'cleared',
    type: deltaMinor > 0 ? 'income' : 'expense',
    transferPairId: null, splits: null, tags: ['balance-adjustment'],
  };
}
