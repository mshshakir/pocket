/**
 * FamilyScreen — manage family members and what each can see/do, plus the
 * "shared with me" accounts other people share with this user.
 *
 * Writing permissions goes through FamilyShareService (same storage as the
 * account-side sheet). Saving republishes snapshots and, when a member ends up
 * with no accounts, revokes their cloud share (audit H8). Requires sign-in —
 * sharing is a cloud feature.
 */
import React, { useState } from 'react';
import { ScrollView, View, Text, Alert, TouchableOpacity } from 'react-native';
import { useOwnState } from '../state/AppContext.js';
import { Card, SectionTitle, Field, Input, Button, Dot, EmptyState } from '../ui/common.js';
import { colors } from '../ui/theme.js';
import { FAMILY_ACCESS_LEVELS, MEMBER_COLORS } from '../data/constants.js';
import { IdGenerator } from '../domain/services/IdGenerator.js';
import { DateService } from '../domain/services/DateService.js';

const accessLabel = (id) => FAMILY_ACCESS_LEVELS.find((l) => l.id === id)?.label || id;

export default function FamilyScreen({ navigation }) {
  // useOwnState: this screen is about who *I* share with, which does not change
  // with the space I am viewing. Under a projection the "Account access" list
  // rendered the OWNER's accounts, so cycling a level wrote their accountIds
  // into the member's own family record — and the subsequent push then
  // published a member with a non-empty permission map over an empty account
  // list, i.e. a blank space, with no error anywhere.
  const { state, services, user, inGuestSpace } = useOwnState();
  const { fx } = services;
  const [editing, setEditing] = useState(null);
  const [viewShare, setViewShare] = useState(null); // { ownerId, accountId }

  if (editing !== null) {
    return <MemberForm member={editing.id ? editing : null} onDone={() => setEditing(null)}
      services={services} state={state} />;
  }

  if (viewShare !== null) {
    const sh = (services.sync.sharedData || []).find((s) => s._ownerId === viewShare.ownerId);
    if (!sh) { setViewShare(null); return null; }
    return <SharedAccountDetail share={sh} accountId={viewShare.accountId} services={services}
      navigation={navigation} onBack={() => setViewShare(null)} />;
  }

  const members = state.family || [];
  const shared  = services.sync.sharedData || [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      {!user ? (
        <Card>
          <Text style={{ color: colors.subtle }}>
            Sign in (Settings → Cloud sync) to share accounts with family.
          </Text>
        </Card>
      ) : null}

      {/* Editing a member was never hidden here, so hiding only "Add member"
          in a guest space produced the worst of both: half the screen live,
          half of it missing. Now that the screen is unambiguously about the
          member's own sharing, everything is live and the banner explains it. */}
      {inGuestSpace ? (
        <Text style={{
          color: colors.subtle, fontSize: 12, lineHeight: 17,
          backgroundColor: '#818cf815', borderRadius: 10, padding: 10, marginBottom: 12,
        }}>
          This is who <Text style={{ fontWeight: '700' }}>you</Text> share with — it
          doesn't change with the space you're viewing.
        </Text>
      ) : null}
      <SectionTitle>Members</SectionTitle>
      <Button title="＋ Add member" onPress={() => setEditing({})} style={{ marginBottom: 12 }} />
      {members.length === 0 ? (
        <EmptyState title="No family members" subtitle="Add someone to share specific accounts with them." />
      ) : members.map((m) => {
        const n = (m.permissions || []).length;
        return (
          <Card key={m.id}>
            <TouchableOpacity onPress={() => setEditing(m)} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: m.color || colors.indigo,
                alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>
                  {m.initials || (m.name || m.email || '?').slice(0, 2).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '600', color: colors.text }}>{m.name || m.email}</Text>
                <Text style={{ fontSize: 12, color: colors.subtle }}>
                  {m.email || 'no email'} · {n} account{n === 1 ? '' : 's'} shared
                </Text>
              </View>
              <Text style={{ color: colors.faint }}>›</Text>
            </TouchableOpacity>
          </Card>
        );
      })}

      {shared.length ? (
        <>
          <SectionTitle>Shared with me</SectionTitle>
          {shared.flatMap((share) => (share.accounts || []).map((a) => {
            const access = (share.permission || {})[a.id] || 'view';
            const canAdd = ['add', 'edit', 'full'].includes(access);
            return (
              <Card key={`${share._ownerId}_${a.id}`}>
                <TouchableOpacity onPress={() => setViewShare({ ownerId: share._ownerId, accountId: a.id })}
                  style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Dot color={a.color} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '600', color: colors.text }}>{a.name}</Text>
                    <Text style={{ fontSize: 12, color: colors.subtle }}>
                      {a.currency} · shared by {share.sharedBy || 'family'} · {accessLabel(access)}
                    </Text>
                  </View>
                  <Text style={{ fontWeight: '600', color: a.balance < 0 ? colors.rose : colors.text }}>
                    {fx.formatMoney(a.balance || 0, a.currency)}
                  </Text>
                  <Text style={{ color: colors.faint, marginLeft: 8 }}>›</Text>
                </TouchableOpacity>
                {canAdd ? (
                  <Button title="＋ Add a transaction" kind="ghost" style={{ marginTop: 10 }}
                    onPress={() => navigation.navigate('TransactionForm', {
                      sharedMode: { ownerId: share._ownerId, accountId: a.id },
                    })} />
                ) : (
                  <Text style={{ fontSize: 12, color: colors.faint, marginTop: 8 }}>View-only · tap to see the ledger</Text>
                )}
              </Card>
            );
          }))}
        </>
      ) : null}
    </ScrollView>
  );
}

/**
 * SharedAccountDetail — the ledger of an account someone shares with you.
 * Lists that account's transactions (from the owner's snapshot). You can add a
 * contribution, and edit/delete your own (or any, with 'full' access) — the
 * owner re-authorises every change against the current permission map (H9).
 */
function SharedAccountDetail({ share, accountId, services, navigation, onBack }) {
  const { fx, sync } = services;
  const [, force] = useState(0);
  const acc = (share.accounts || []).find((a) => a.id === accountId);
  const access = (share.permission || {})[accountId] || 'view';
  const canAdd = ['add', 'edit', 'full'].includes(access);
  const myEmail = sync.currentUser?.email?.toLowerCase();
  const ownerCats = share.categories || [];
  const catName = (id) => {
    const c = ownerCats.find((x) => x.id === id);
    if (!c) return 'Uncategorised';
    const p = c.parentId ? ownerCats.find((x) => x.id === c.parentId) : null;
    return p ? `${p.name} / ${c.name}` : c.name;
  };
  const editable = (t) => access === 'full' || (t.addedBy && t.addedBy.toLowerCase() === myEmail);

  const txs = (share.transactions || [])
    .filter((t) => t.accountId === accountId ||
      (Array.isArray(t.splits) && t.splits.some((s) => (s.accountId || t.accountId) === accountId)))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const del = (t) => {
    Alert.alert('Delete contribution', 'Remove this entry from the shared account?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await sync.deleteContribution(share._ownerId, t.id); sync.scheduleSharesRefresh?.(3000); force((x) => x + 1); }
        catch (e) { Alert.alert('Failed', String(e?.message || e)); }
      } },
    ]);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <TouchableOpacity onPress={onBack} style={{ paddingVertical: 6, paddingRight: 12 }}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>‹ Family</Text>
        </TouchableOpacity>
      </View>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Dot color={acc?.color} size={16} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>{acc?.name || 'Shared account'}</Text>
            <Text style={{ fontSize: 12, color: colors.subtle }}>
              {acc?.currency} · shared by {share.sharedBy || 'family'} · {accessLabel(access)}
            </Text>
          </View>
          <Text style={{ fontSize: 20, fontWeight: '700', color: (acc?.balance || 0) < 0 ? colors.rose : colors.text }}>
            {fx.formatMoney(acc?.balance || 0, acc?.currency || 'USD')}
          </Text>
        </View>
        {canAdd ? (
          <Button title="＋ Add a transaction" kind="ghost" style={{ marginTop: 10 }}
            onPress={() => navigation.navigate('TransactionForm', { sharedMode: { ownerId: share._ownerId, accountId } })} />
        ) : null}
      </Card>

      {txs.length === 0 ? (
        <EmptyState title="No transactions" subtitle="Entries on this shared account will show here." />
      ) : (
        <Card style={{ paddingVertical: 4 }}>
          {txs.map((t, i) => {
            const mine = editable(t);
            return (
              <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
                borderBottomWidth: i === txs.length - 1 ? 0 : 1, borderColor: colors.muted }}>
                <TouchableOpacity
                  disabled={!mine}
                  onPress={() => navigation.navigate('TransactionForm', { sharedMode: { ownerId: share._ownerId, accountId, editTxId: t.id } })}
                  style={{ flex: 1 }}
                >
                  <Text style={{ color: colors.text, fontWeight: '500' }} numberOfLines={1}>
                    {t.payee || catName(t.categoryId)}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.subtle }}>
                    {DateService.label(t.date)}{t.addedBy ? ` · ${t.addedBy}` : ''}{mine ? '' : ' · view only'}
                  </Text>
                </TouchableOpacity>
                <Text style={{ fontWeight: '600', color: t.type === 'income' ? colors.green : colors.text, marginRight: mine ? 10 : 0 }}>
                  {t.type === 'expense' ? '−' : t.type === 'income' ? '+' : ''}{fx.formatMoney(t.amount, t.currency)}
                </Text>
                {mine ? <TouchableOpacity onPress={() => del(t)}><Text style={{ color: colors.red }}>✕</Text></TouchableOpacity> : null}
              </View>
            );
          })}
        </Card>
      )}
    </ScrollView>
  );
}

function MemberForm({ member, onDone, services, state }) {
  const [name, setName]   = useState(member?.name || '');
  const [email, setEmail] = useState(member?.email || '');
  const [color, setColor] = useState(member?.color || MEMBER_COLORS[(state.family?.length || 0) % MEMBER_COLORS.length]);
  const [initials, setInitials] = useState(member?.initials || '');
  const [perms, setPerms] = useState(() => {
    const map = {};
    (member?.permissions || []).forEach((p) => { map[p.accountId] = p.access; });
    return map;
  });

  const cycle = (accountId) => {
    const order = [null, ...FAMILY_ACCESS_LEVELS.map((l) => l.id)];
    setPerms((prev) => {
      const cur = prev[accountId] || null;
      const next = order[(order.indexOf(cur) + 1) % order.length];
      const copy = { ...prev };
      if (next) copy[accountId] = next; else delete copy[accountId];
      return copy;
    });
  };

  const save = () => {
    if (!name.trim() && !email.trim()) { Alert.alert('Add a name or email'); return; }
    const s = services.store.getState();
    if (!Array.isArray(s.family)) s.family = [];
    const permissions = Object.entries(perms).map(([accountId, access]) => ({ accountId, access }));
    const init = initials.trim().slice(0, 2).toUpperCase() || undefined;
    if (member) {
      // Resolve out of real state first — `member` came from a projected list.
    const target = (s.family || []).find((m) => m.id === member.id) || member;
    Object.assign(target, { name: name.trim(), email: email.trim().toLowerCase(), color, initials: init, permissions });
    } else {
      s.family.push({
        id: IdGenerator.generate('fam'),
        name: name.trim(), email: email.trim().toLowerCase(),
        color, initials: init, permissions,
      });
    }
    services.store.flush();
    // Republish shares; a member left with zero accounts gets revoked (H8).
    services.sync.pushFamilyShares?.();
    onDone();
  };

  const remove = () => {
    Alert.alert('Remove member', 'They will lose access to shared accounts.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => {
        const s = services.store.getState();
        s.family = (s.family || []).filter((m) => m.id !== member.id);
        services.store.flush();
        if (member.email) services.sync.revokeMemberShare?.(member.email);
        onDone();
      } },
    ]);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <Card>
        <Field label="Name"><Input value={name} onChangeText={setName} autoFocus placeholder="e.g. Amina" /></Field>
        <Field label="Email (needed for sharing to reach them)">
          <Input value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="amina@example.com" />
        </Field>
        <Field label="Initials (optional)">
          <Input value={initials} onChangeText={setInitials} maxLength={2} autoCapitalize="characters"
            placeholder={(name || email || '?').slice(0, 2).toUpperCase()} style={{ width: 90 }} />
        </Field>
        <Field label="Colour">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {MEMBER_COLORS.map((c) => (
              <TouchableOpacity key={c} onPress={() => setColor(c)}
                style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c,
                  borderWidth: c === color ? 3 : 0, borderColor: colors.text }} />
            ))}
          </View>
        </Field>
      </Card>
      <SectionTitle>Account access</SectionTitle>
      <Text style={{ fontSize: 12, color: colors.subtle, marginBottom: 8 }}>Tap an account to cycle its access level.</Text>
      <Card style={{ paddingVertical: 4 }}>
        {state.accounts.map((a, i) => {
          const level = FAMILY_ACCESS_LEVELS.find((l) => l.id === perms[a.id]);
          return (
            <TouchableOpacity key={a.id} onPress={() => cycle(a.id)}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11,
                borderBottomWidth: i === state.accounts.length - 1 ? 0 : 1, borderColor: colors.muted }}>
              <Dot color={a.color} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text }}>{a.name}</Text>
                <Text style={{ fontSize: 11, color: colors.faint }}>{level ? level.desc : 'No access'}</Text>
              </View>
              <Text style={{ fontSize: 13, fontWeight: '600', color: level ? level.color : colors.faint }}>
                {level ? level.label : 'No access'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </Card>
      <Button title={member ? 'Save' : 'Add member'} onPress={save} />
      {member ? <Button title="Remove member" kind="danger" onPress={remove} style={{ marginTop: 8 }} /> : null}
      <Button title="Cancel" kind="ghost" onPress={onDone} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}
