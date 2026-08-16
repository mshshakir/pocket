/**
 * DebtsScreen — money owed and owed to you, with repayments and the audited
 * delete / mark-paid choices (M7, L6). All ledger logic is in DebtService.
 *
 * Parity with the web DebtsView + DebtModal:
 *   • Active / Paid-off sections
 *   • progress bar + "% repaid · N payments"
 *   • due-date + overdue/"due in Nd" chip
 *   • note display
 *   • edit an existing debt (counterparty, due date, note, mark-paid) —
 *     principal/currency/account stay locked after creation, exactly like web
 *   • create form gains date-taken, due-date and note
 *   • payment amount capped at the outstanding balance
 */
import React, { useState } from 'react';
import { ScrollView, View, Text, Alert, TouchableOpacity } from 'react-native';
import { useAppState } from '../state/AppContext.js';
import { Card, SectionTitle, Field, Input, Button, Segmented, Dot, EmptyState } from '../ui/common.js';
import { colors } from '../ui/theme.js';
import { CURRENCIES } from '../data/constants.js';
import { DateService } from '../domain/services/DateService.js';

/** Days between today and an ISO date (negative = overdue). */
function daysUntil(iso) {
  if (!iso) return null;
  const today = new Date(DateService.todayIso() + 'T12:00:00');
  const due = new Date(iso + 'T12:00:00');
  return Math.round((due - today) / 86400000);
}

export default function DebtsScreen() {
  const { state, services, inGuestSpace, guard } = useAppState();
  const { fx, debts } = services;
  const home = state.user.homeCurrency;
  const [mode, setMode] = useState(null); // null | 'new' | {debt} payment | {edit:debt}

  /**
   * The debt list and the ledger its payments are measured against MUST come
   * from the same book. They did not: the cards came from `debts.all()` (local)
   * while `state.transactions` was the owner's snapshot, so every count and
   * every remaining balance was computed across two different people's data.
   * The visible consequence was the delete confirmation, which reported "0
   * linked transactions" and then deleted the member's real linked rows.
   */
  const ledger = inGuestSpace ? (state.transactions || []) : services.store.getState().transactions;

  /** Nothing here is editable from inside someone else's space (phase 1). */
  const requireOwn = () => {
    const v = guard?.requireHome('debts') ?? { ok: true };
    if (!v.ok) Alert.alert('Not here', v.message);
    return v.ok;
  };

  if (mode === 'new') return <DebtForm onDone={() => setMode(null)} services={services} state={state} />;
  if (mode && mode.edit) return <DebtForm debt={mode.edit} onDone={() => setMode(null)} services={services} state={state} />;
  if (mode && mode.id) return <PaymentForm debt={mode} onDone={() => setMode(null)} services={services} state={state} />;

  // In a guest space these are the OWNER's debts, from their snapshot; at home
  // they are the member's own. Either way they are drawn from the same book as
  // `ledger` above.
  const all = inGuestSpace ? (state.debts || []) : debts.all();
  const left = (d) => debts.remaining(d, ledger);
  const active = all.filter((d) => d.status !== 'paid' && left(d) > 0);
  const paid = all.filter((d) => d.status === 'paid' || left(d) <= 0);

  const youOwe = active.filter((d) => d.type === 'borrowed')
    .reduce((s, d) => s + fx.convert(left(d), d.currency, home), 0);
  const owed = active.filter((d) => d.type === 'lent')
    .reduce((s, d) => s + fx.convert(left(d), d.currency, home), 0);

  const paymentCount = (d) =>
    ledger.filter((t) => t.debtId === d.id && t.id !== d.initialTxId).length;

  const confirmDelete = (d) => {
    if (!requireOwn()) return;
    const linked = ledger.filter((t) => t.debtId === d.id || t.id === d.initialTxId).length;
    Alert.alert('Delete debt', `${linked} linked transaction${linked === 1 ? '' : 's'}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Keep transactions', onPress: () => { debts.delete(d, false); } },
      { text: 'Delete them too', style: 'destructive', onPress: () => { debts.delete(d, true); } },
    ]);
  };

  const confirmMarkPaid = (d) => {
    if (!requireOwn()) return;
    const rem = left(d);
    if (rem <= 0) { debts.markPaid(d, 'external'); return; }
    Alert.alert('Mark as paid off',
      `${fx.formatMoney(rem, d.currency)} still outstanding. How was it settled?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'I just paid it', onPress: () => debts.markPaid(d, 'paid', d.accountId) },
      { text: 'Settled outside app', onPress: () => debts.markPaid(d, 'external') },
    ]);
  };

  const renderCard = (d) => {
    const rem = left(d);
    const isPaid = d.status === 'paid' || rem <= 0;
    const pctRepaid = d.principal > 0 ? Math.min(1, (d.principal - rem) / d.principal) : 0;
    const pays = paymentCount(d);
    const dueIn = daysUntil(d.dueDate);
    const overdue = dueIn != null && dueIn < 0 && !isPaid;

    return (
      <Card key={d.id}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Dot color={d.type === 'borrowed' ? colors.rose : colors.green} />
          <Text style={{ flex: 1, fontWeight: '600', color: colors.text }}>{d.counterparty}</Text>
          {!isPaid && dueIn != null ? (
            <Text style={{ fontSize: 11, color: overdue ? colors.rose : colors.subtle, fontWeight: overdue ? '700' : '400' }}>
              {overdue ? `Overdue ${Math.abs(dueIn)}d` : dueIn === 0 ? 'Due today' : `Due in ${dueIn}d`}
            </Text>
          ) : (
            <Text style={{ fontSize: 12, color: colors.subtle }}>
              {d.type === 'borrowed' ? 'You owe' : 'Owes you'}
            </Text>
          )}
        </View>

        <Text style={{ fontSize: 20, fontWeight: '700', marginTop: 6, color: isPaid ? colors.faint : colors.text }}>
          {fx.formatMoney(rem, d.currency)}{isPaid ? '  · paid' : ''}
        </Text>
        <Text style={{ fontSize: 12, color: colors.subtle }}>of {fx.formatMoney(d.principal, d.currency)}</Text>

        <View style={{ height: 6, backgroundColor: colors.muted, borderRadius: 999, marginTop: 8, overflow: 'hidden' }}>
          <View style={{ width: `${pctRepaid * 100}%`, height: '100%', borderRadius: 999,
            backgroundColor: isPaid ? colors.green : colors.primary }} />
        </View>
        <Text style={{ fontSize: 11, color: colors.subtle, marginTop: 4 }}>
          {Math.round(pctRepaid * 100)}% repaid · {pays} payment{pays === 1 ? '' : 's'}
        </Text>
        {d.note ? <Text style={{ fontSize: 12, color: colors.subtle, marginTop: 4 }}>{d.note}</Text> : null}

        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' }}>
          {/* Every one of these resolved the debt against the member's own book
              and returned early on a miss — the form closed and nothing changed.
              The guard refuses with a reason instead. */}
          {!isPaid ? (
            <>
              <Button title="Record payment" style={{ flex: 1 }}
                onPress={() => { if (requireOwn()) setMode(d); }} />
              <Button title="Paid off" kind="ghost" onPress={() => confirmMarkPaid(d)} />
            </>
          ) : <View style={{ flex: 1 }} />}
          <Button title="Edit" kind="ghost"
            onPress={() => { if (requireOwn()) setMode({ edit: d }); }} />
        </View>
        <TouchableOpacity onPress={() => confirmDelete(d)} style={{ marginTop: 8 }}>
          <Text style={{ fontSize: 12, color: colors.faint }}>Delete</Text>
        </TouchableOpacity>
      </Card>
    );
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      {inGuestSpace ? null : <Button title="＋ New debt" onPress={() => setMode('new')} style={{ marginBottom: 12 }} />}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Card style={{ flex: 1 }}>
          <Text style={{ fontSize: 12, color: colors.subtle }}>You owe</Text>
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.rose }}>{fx.formatMoney(youOwe, home)}</Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <Text style={{ fontSize: 12, color: colors.subtle }}>Owed to you</Text>
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.green }}>{fx.formatMoney(owed, home)}</Text>
        </Card>
      </View>

      {all.length === 0 ? (
        <EmptyState title="No debts" subtitle="Record money you borrowed or lent; it links to an account." />
      ) : (
        <>
          {active.length ? <SectionTitle>Active</SectionTitle> : null}
          {active.map(renderCard)}
          {paid.length ? <SectionTitle>Paid off</SectionTitle> : null}
          {paid.map(renderCard)}
        </>
      )}
    </ScrollView>
  );
}

function DebtForm({ debt, onDone, services, state }) {
  const { fx, debts } = services;
  const editing = !!debt;
  const [type, setType] = useState(debt?.type || 'borrowed');
  const [counterparty, setCP] = useState(debt?.counterparty || '');
  const [principal, setPrincipal] = useState(debt ? String(fx.fromMinor(debt.principal, debt.currency)) : '');
  const [currency, setCurrency] = useState(debt?.currency || state.user.homeCurrency);
  const [accountId, setAccountId] = useState(debt?.accountId || state.accounts[0]?.id || null);
  const [dateTaken, setDateTaken] = useState(debt?.dateTaken || DateService.todayIso());
  const [dueDate, setDueDate] = useState(debt?.dueDate || '');
  const [note, setNote] = useState(debt?.note || '');

  const save = () => {
    if (editing) {
      // Web keeps type/principal/currency/account/date locked; only metadata edits.
      debt.counterparty = counterparty.trim() || debt.counterparty;
      debt.dueDate = dueDate || null;
      debt.note = note;
      services.store.flush();
      onDone();
      return;
    }
    const res = debts.create({
      type, counterparty, principal: Number(principal) || 0, currency, accountId,
      date: dateTaken, dueDate: dueDate || null, note,
    });
    if (!res.ok) { Alert.alert('Cannot save', res.reason); return; }
    onDone();
  };

  const locked = (child) => (
    <View style={{ opacity: editing ? 0.5 : 1 }} pointerEvents={editing ? 'none' : 'auto'}>{child}</View>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      {locked(
        <Segmented
          options={[{ id: 'borrowed', label: 'I borrowed' }, { id: 'lent', label: 'I lent' }]}
          value={type} onChange={setType} />
      )}
      <Card>
        <Field label="Counterparty">
          <Input value={counterparty} onChangeText={setCP} placeholder="e.g. Ali" autoFocus />
        </Field>
        <Field label={`Amount (${currency})`}>
          {editing
            ? <Input value={principal} editable={false} style={{ opacity: 0.5 }} />
            : <Input value={principal} onChangeText={setPrincipal} keyboardType="decimal-pad" placeholder="0.00" />}
        </Field>
        {!editing ? (
          <Field label="Account">
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {state.accounts.map((a) => (
                  <TouchableOpacity key={a.id} onPress={() => { setAccountId(a.id); setCurrency(a.currency); }}
                    style={{ borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8,
                      borderColor: a.id === accountId ? colors.primary : colors.border,
                      backgroundColor: a.id === accountId ? colors.primary : colors.card }}>
                    <Text style={{ fontSize: 13, color: a.id === accountId ? colors.primaryFg : colors.text }}>
                      {a.name} · {a.currency}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </Field>
        ) : null}
        {!editing ? (
          <Field label="Date taken (YYYY-MM-DD)">
            <Input value={dateTaken} onChangeText={setDateTaken} placeholder="2026-07-30" autoCapitalize="none" />
          </Field>
        ) : null}
        <Field label="Due date (optional, YYYY-MM-DD)">
          <Input value={dueDate} onChangeText={setDueDate} placeholder="—" autoCapitalize="none" />
        </Field>
        <Field label="Note (optional)">
          <Input value={note} onChangeText={setNote} placeholder="optional…" multiline />
        </Field>
      </Card>
      <Button title={editing ? 'Save' : 'Create debt'} onPress={save} />
      <Button title="Cancel" kind="ghost" onPress={onDone} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}

function PaymentForm({ debt, onDone, services, state }) {
  const { fx } = services;
  const remMinor = services.debts.remaining(debt);
  const remMajor = fx.fromMinor(remMinor, debt.currency);
  const [amount, setAmount] = useState(String(remMajor));
  const [accountId, setAccountId] = useState(debt.accountId || state.accounts[0]?.id || null);
  const [date, setDate] = useState(DateService.todayIso());
  const [note, setNote] = useState('');

  const save = () => {
    let amt = Number(amount) || 0;
    if (amt > remMajor) amt = remMajor; // cap at outstanding, like the web max=remaining
    const res = services.debts.addPayment(debt, amt, accountId, { date, note: note.trim() || undefined });
    if (!res.ok) { Alert.alert('Cannot save', res.reason); return; }
    onDone();
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <SectionTitle>Repay {debt.counterparty}</SectionTitle>
      <Card>
        <Field label={`Amount (${debt.currency}) · max ${fx.formatMoney(remMinor, debt.currency)}`}>
          <Input value={amount} onChangeText={setAmount} keyboardType="decimal-pad" autoFocus />
        </Field>
        <Field label="Date (YYYY-MM-DD)">
          <Input value={date} onChangeText={setDate} autoCapitalize="none" placeholder="2026-07-30" />
        </Field>
        <Field label="Note (optional)">
          <Input value={note} onChangeText={setNote} placeholder="optional…" />
        </Field>
        <Field label="From account">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {state.accounts.map((a) => (
                <TouchableOpacity key={a.id} onPress={() => setAccountId(a.id)}
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
      <Button title="Record payment" onPress={save} />
      <Button title="Cancel" kind="ghost" onPress={onDone} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}
