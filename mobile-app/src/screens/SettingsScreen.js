/**
 * SettingsScreen — sync sign-in (email one-time code), status, sign-out.
 *
 * Honest constraint, surfaced in the UI: the Supabase project currently has
 * Google sign-in configured for the web. Email codes require the Email
 * provider to be enabled in Supabase Auth settings — one switch, no code.
 * Signing in with the SAME email as your Google account maps to the same user
 * only if Supabase account-linking is on; otherwise it creates a separate
 * book. The screen says so rather than letting it surprise you.
 */
import React, { useState } from 'react';
import { ScrollView, View, Text, Alert, TouchableOpacity, Appearance } from 'react-native';
import { useAppState } from '../state/AppContext.js';
import { Card, Field, Input, Button, SectionTitle, Segmented, Dot } from '../ui/common.js';
import { colors, applyTheme } from '../ui/theme.js';
import { CURRENCIES } from '../data/constants.js';
import { Repository } from '../core/Repository.js';
import { SeedFactory } from '../data/seed.js';
import { StateMigrator } from '../data/StateMigrator.js';

// expo-file-system / expo-sharing are imported lazily inside handlers so a
// missing native module (before `npx expo install`) degrades one button
// rather than failing the whole bundle and white-screening the app.
const DATE_FORMATS = [
  { id: 'auto', label: 'Automatic' },
  { id: 'dmy', label: 'DD/MM/YYYY' },
  { id: 'mdy', label: 'MM/DD/YYYY' },
  { id: 'ymd', label: 'YYYY-MM-DD' },
];

export default function SettingsScreen() {
  const { state, services, syncStatus, user } = useAppState();
  const sync = services.sync;
  const [email, setEmail] = useState('');
  const [code, setCode]   = useState('');
  const [stage, setStage] = useState('email'); // email → code
  const [busy, setBusy]   = useState(false);

  const statusLabel = {
    local:   'Local only — not synced',
    syncing: 'Syncing…',
    synced:  'Synced',
    error:   'Sync error',
  }[syncStatus] || syncStatus;

  const requestCode = async () => {
    if (!email.trim()) return;
    setBusy(true);
    const res = await sync.requestCode(email);
    setBusy(false);
    if (!res.ok) { Alert.alert('Could not send code', res.error); return; }
    setStage('code');
  };

  const verify = async () => {
    setBusy(true);
    const res = await sync.verifyCode(email, code);
    setBusy(false);
    if (!res.ok) { Alert.alert('Sign-in failed', res.error); return; }
    setStage('email'); setCode('');
  };

  const googleIn = async () => {
    setBusy(true);
    const res = await sync.signInWithGoogle();
    setBusy(false);
    if (!res.ok && res.error) Alert.alert('Google sign-in', res.error);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <SectionTitle>Cloud sync</SectionTitle>
      <Card>
        <Text style={{ color: colors.subtle, fontSize: 13, marginBottom: 8 }}>
          Status: <Text style={{ color: colors.text, fontWeight: '600' }}>{statusLabel}</Text>
        </Text>

        {user ? (
          <>
            <Text style={{ color: colors.text, marginBottom: 12 }}>
              Signed in as <Text style={{ fontWeight: '600' }}>{user.email}</Text>
            </Text>
            <Button title="Pull latest from cloud" kind="ghost" onPress={() => sync.pull()} />
            <Button
              title="Sign out (local data is kept)"
              kind="danger"
              onPress={() => sync.signOut()}
              style={{ marginTop: 8 }}
            />
          </>
        ) : stage === 'email' ? (
          <>
            <Field label="Email">
              <Input
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="you@example.com"
              />
            </Field>
            <Button title={busy ? 'Sending…' : 'Send sign-in code'} onPress={requestCode} disabled={busy} />

            <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 14 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.muted }} />
              <Text style={{ marginHorizontal: 10, color: colors.faint, fontSize: 12 }}>or</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.muted }} />
            </View>
            <Button title={busy ? 'Please wait…' : 'Continue with Google'} kind="ghost" onPress={googleIn} disabled={busy} />
            <Text style={{ color: colors.faint, fontSize: 12, marginTop: 8, lineHeight: 17 }}>
              Google sign-in works in a development or store build (not Expo Go).
              It signs you into the same book as the web when Supabase account
              linking is on.
            </Text>

            <Text style={{ color: colors.faint, fontSize: 12, marginTop: 10, lineHeight: 17 }}>
              Got a LINK instead of a code? Supabase sends a magic link until its
              Magic Link email template contains {'{{ .Token }}'} — add that in
              Authentication → Email Templates → Magic Link, then request again.
              {'\n\n'}
              Use the same email as on the web: with Supabase account-linking
              enabled it resolves to the same data; without it, a separate book.
            </Text>
          </>
        ) : (
          <>
            <Field label={`Code sent to ${email}`}>
              <Input
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                placeholder="123456"
              />
            </Field>
            <Button title={busy ? 'Verifying…' : 'Verify & sign in'} onPress={verify} disabled={busy} />
            <Button title="Back" kind="ghost" onPress={() => setStage('email')} style={{ marginTop: 8 }} />
          </>
        )}
      </Card>

      <SectionTitle>Appearance</SectionTitle>
      <Appearance_ state={state} services={services} />

      <SectionTitle>Preferences</SectionTitle>
      <Preferences state={state} services={services} />

      <SectionTitle>Payment methods</SectionTitle>
      <PaymentMethods services={services} />

      <SectionTitle>Receipt scanning</SectionTitle>
      <GeminiKey state={state} services={services} />

      <SectionTitle>Backup &amp; data</SectionTitle>
      <ExportData state={state} />
      <DataTools services={services} />

      <SectionTitle>About</SectionTitle>
      <Card>
        <Text style={{ color: colors.subtle, fontSize: 13, lineHeight: 19 }}>
          Pocket mobile shares its entire business layer with the web app — the
          same ledger math, budgets, Hijri snapshots, family sharing and sync
          protocol — so both read and write one book.
        </Text>
        <Text style={{ color: colors.faint, fontSize: 12, marginTop: 8 }}>
          {state.user.homeCurrency} · {state.accounts.length} accounts ·{' '}
          {state.transactions.length} transactions
        </Text>
      </Card>
    </ScrollView>
  );
}

/** Theme: light / dark / follow-the-system. Mutates the live palette + repaints. */
function Appearance_({ state, services }) {
  const [, force] = useState(0);
  const current = state.user.theme || 'system';
  const setTheme = (mode) => {
    state.user.theme = mode;
    applyTheme(mode, Appearance.getColorScheme());
    services.store.flush();          // persists + emits state:changed → app repaints
    force((n) => n + 1);
  };
  return (
    <Card>
      <Field label="Theme">
        <Segmented
          options={[
            { id: 'light', label: 'Light' },
            { id: 'dark', label: 'Dark' },
            { id: 'system', label: 'System' },
          ]}
          value={current}
          onChange={setTheme}
        />
      </Field>
      <Text style={{ fontSize: 12, color: colors.faint }}>
        “System” follows your phone's light/dark setting automatically.
      </Text>
    </Card>
  );
}

/** Home + default currency, date format, Hijri toggle/offset/calendar mode. */
function Preferences({ state, services }) {
  const [, force] = useState(0);
  const flush = () => { services.store.flush(); force((n) => n + 1); };
  const setHome = (c) => { state.user.homeCurrency = c; flush(); };
  const setDefault = (c) => { state.user.defaultCurrency = c; flush(); };
  const bumpOffset = (d) => {
    state.user.hijriOffset = Math.max(-7, Math.min(7, (state.user.hijriOffset ?? 0) + d));
    flush();
  };
  const showHijri = state.user.showHijri !== false;

  const currencyRow = (selected, onPick) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {CURRENCIES.map((c) => (
          <TouchableOpacity key={c} onPress={() => onPick(c)}
            style={{ borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6,
              borderColor: c === selected ? colors.primary : colors.border,
              backgroundColor: c === selected ? colors.primary : colors.card }}>
            <Text style={{ fontSize: 12, color: c === selected ? colors.primaryFg : colors.text }}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );

  return (
    <Card>
      <Field label="Home currency (all balances convert to this)">
        {currencyRow(state.user.homeCurrency, setHome)}
      </Field>
      <Field label="Default currency for new entries">
        {currencyRow(state.user.defaultCurrency || state.user.homeCurrency, setDefault)}
      </Field>
      <Field label="Date format">
        <Segmented
          options={DATE_FORMATS}
          value={state.user.dateFormat || 'auto'}
          onChange={(id) => { state.user.dateFormat = id; flush(); }}
        />
      </Field>

      <TouchableOpacity
        onPress={() => { state.user.showHijri = !showHijri; flush(); }}
        style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}
      >
        <View style={{
          width: 22, height: 22, borderRadius: 6, borderWidth: 1, marginRight: 10,
          borderColor: showHijri ? colors.primary : colors.border,
          backgroundColor: showHijri ? colors.primary : colors.card,
          alignItems: 'center', justifyContent: 'center',
        }}>
          {showHijri ? <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>✓</Text> : null}
        </View>
        <Text style={{ flex: 1, color: colors.text }}>Show Hijri dates</Text>
      </TouchableOpacity>

      {showHijri ? (
        <>
          <Field label={`Hijri date offset: ${state.user.hijriOffset ?? 0} day(s)`}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Button title="−1" kind="ghost" onPress={() => bumpOffset(-1)} />
              <Text style={{ flex: 1, textAlign: 'center', color: colors.text, fontWeight: '600' }}>
                {state.user.hijriOffset ?? 0}
              </Text>
              <Button title="+1" kind="ghost" onPress={() => bumpOffset(1)} />
            </View>
          </Field>
          <Field label="Calendar display">
            <Segmented
              options={[
                { id: 'gregorian', label: 'Gregorian' },
                { id: 'both', label: 'Both' },
                { id: 'hijri', label: 'Hijri' },
              ]}
              value={state.user.calendarMode || 'both'}
              onChange={(id) => { state.user.calendarMode = id; flush(); }}
            />
          </Field>
        </>
      ) : null}
    </Card>
  );
}

/** Parse a simple CSV string into rows of fields (quote-aware). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQ = false;
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Import a JSON backup (paste/file), a CSV, recalculate balances, or reset. */
function DataTools({ services }) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [json, setJson] = useState('');
  const [csvOpen, setCsvOpen] = useState(false);
  const [csv, setCsv] = useState('');

  const doImport = () => {
    let parsed;
    try { parsed = JSON.parse(json); }
    catch { Alert.alert('Invalid JSON', 'Could not parse what you pasted.'); return; }
    if (!Array.isArray(parsed.accounts) || !Array.isArray(parsed.transactions)) {
      Alert.alert('Invalid backup', 'The file must contain accounts and transactions.');
      return;
    }
    Alert.alert('Replace all data?', 'This overwrites the book on this device with the pasted backup.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Import', style: 'destructive', onPress: () => {
        // replaceState deletes omitted keys, so run the migrator to back-fill
        // settings/openingBalance before the swap (mirrors the web importJson).
        services.store.replaceState(parsed, (s) => StateMigrator.migrate(s));
        services.accounts.recompute();
        services.store.persist();
        setPasteOpen(false); setJson('');
        Alert.alert('Imported', 'Your data was restored.');
      } },
    ]);
  };

  // Restore a JSON backup from a picked file (falls back to paste if the
  // document picker isn't installed).
  const restoreFromFile = async () => {
    let DocumentPicker, FileSystem;
    try { DocumentPicker = require('expo-document-picker'); FileSystem = require('expo-file-system'); }
    catch {
      Alert.alert('Not available', 'File restore needs expo-document-picker + expo-file-system. Use "Import backup (paste JSON)" instead, or run:\n\nnpx expo install expo-document-picker expo-file-system');
      return;
    }
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
      const uri = res?.assets?.[0]?.uri || res?.uri;
      if (res?.canceled || !uri) return;
      const text = await FileSystem.readAsStringAsync(uri);
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed.accounts) || !Array.isArray(parsed.transactions)) {
        Alert.alert('Invalid backup', 'The file must contain accounts and transactions.');
        return;
      }
      Alert.alert('Replace all data?', 'This overwrites the book on this device with the chosen file.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Restore', style: 'destructive', onPress: () => {
          services.store.replaceState(parsed, (s) => StateMigrator.migrate(s));
          services.accounts.recompute();
          services.store.persist();
          Alert.alert('Restored', 'Your data was restored from the file.');
        } },
      ]);
    } catch (e) { Alert.alert('Restore failed', String(e?.message || e)); }
  };

  // Import transactions from a pasted CSV (same 8 columns Export CSV writes).
  const doImportCsv = () => {
    const rows = parseCsv(csv);
    if (rows.length < 2) { Alert.alert('Empty CSV', 'Paste a CSV with a header row and at least one entry.'); return; }
    const st = services.store.getState();
    const home = st.user.homeCurrency;
    const findAcc = (name) => st.accounts.find((a) => a.name.toLowerCase() === (name || '').toLowerCase());
    const findCat = (name, type) => st.categories.find((c) => c.name.toLowerCase() === (name || '').toLowerCase() && (!type || c.type === type));
    let added = 0, skipped = 0;
    for (let i = 1; i < rows.length; i++) {
      const [date, type, accName, catName, payee, amount, currency, note] = rows[i].map((s) => (s || '').trim());
      const t = (type || 'expense').toLowerCase();
      if (t === 'transfer') { skipped++; continue; } // pair not represented in CSV
      const amt = Number(amount);
      if (!date || !Number.isFinite(amt) || amt === 0) { skipped++; continue; }
      const ccy = currency || home;
      let acc = findAcc(accName);
      if (!acc) acc = services.accounts.create({ name: accName || 'Imported', currency: ccy });
      let catId = null;
      if (catName) {
        let cat = findCat(catName, t === 'income' ? 'income' : 'expense');
        if (!cat) cat = services.categories.create({ name: catName, type: t === 'income' ? 'income' : 'expense', ...services.categories.guessAppearance(catName, t) });
        catId = cat.id;
      }
      const res = services.composer.create({
        type: t === 'income' ? 'income' : 'expense',
        amount: Math.abs(amt), currency: ccy, accountId: acc.id, categoryId: catId,
        date, payee: payee || '', note: note || '', paymentType: 'card',
      });
      if (res.ok) added++; else skipped++;
    }
    services.accounts.recompute();
    services.store.flush();
    setCsvOpen(false); setCsv('');
    Alert.alert('CSV imported', `${added} transaction${added === 1 ? '' : 's'} added${skipped ? `, ${skipped} skipped` : ''}.`);
  };

  const recalc = () => {
    services.accounts.recompute();
    services.store.flush();
    Alert.alert('Balances recalculated', 'Every account balance was rebuilt from its ledger.');
  };

  const reset = () => {
    Alert.alert('Reset everything?', 'Deletes all accounts, transactions and settings on this device. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => {
        services.store.reset(() => SeedFactory.create(), (s) => StateMigrator.migrate(s));
        services.accounts.recompute();
        services.store.persist();
        Alert.alert('Reset', 'The book is back to a fresh start.');
      } },
    ]);
  };

  return (
    <Card style={{ marginTop: 8 }}>
      <Text style={{ fontSize: 12, color: colors.subtle, marginBottom: 10 }}>
        Restore a backup you exported earlier, rebuild balances, or wipe this device.
      </Text>
      {pasteOpen ? (
        <>
          <Field label="Paste backup JSON">
            <Input value={json} onChangeText={setJson} multiline placeholder='{ "accounts": [...], ... }'
              autoCapitalize="none" style={{ minHeight: 100 }} />
          </Field>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Import" onPress={doImport} style={{ flex: 1 }} />
            <Button title="Cancel" kind="ghost" onPress={() => { setPasteOpen(false); setJson(''); }} />
          </View>
        </>
      ) : (
        <Button title="Import backup (paste JSON)" onPress={() => setPasteOpen(true)} />
      )}
      <Button title="Restore from file (JSON)" kind="ghost" onPress={restoreFromFile} style={{ marginTop: 8 }} />

      {csvOpen ? (
        <>
          <Field label="Paste CSV (Date, Type, Account, Category, Payee, Amount, Currency, Note)">
            <Input value={csv} onChangeText={setCsv} multiline placeholder="2026-07-30,expense,Cash,Food,Cafe,4.50,USD,latte"
              autoCapitalize="none" style={{ minHeight: 100 }} />
          </Field>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Import CSV" onPress={doImportCsv} style={{ flex: 1 }} />
            <Button title="Cancel" kind="ghost" onPress={() => { setCsvOpen(false); setCsv(''); }} />
          </View>
        </>
      ) : (
        <Button title="Import transactions (paste CSV)" kind="ghost" onPress={() => setCsvOpen(true)} style={{ marginTop: 8 }} />
      )}

      <Button title="Recalculate balances" kind="ghost" onPress={recalc} style={{ marginTop: 8 }} />
      <Button title="Reset all data" kind="danger" onPress={reset} style={{ marginTop: 8 }} />
    </Card>
  );
}

/** Add / rename / delete payment methods via PaymentTypeService. */
function PaymentMethods({ services }) {
  const { paymentTypes } = services;
  const [, force] = useState(0);
  const refresh = () => force((n) => n + 1);
  const types = paymentTypes.allTypes();

  const add = () => {
    Alert.prompt?.('New payment method', 'Name', (name) => {
      if (name?.trim()) { paymentTypes.addCustom(name.trim()); refresh(); }
    });
    // Alert.prompt is iOS-only; on Android fall back to a fixed set below.
  };
  const rename = (m) => {
    Alert.prompt?.('Rename method', m, (name) => {
      if (name?.trim()) {
        const r = paymentTypes.rename(m, name.trim());
        if (!r.ok) Alert.alert('Cannot rename', r.reason);
        refresh();
      }
    }, undefined, m);
  };
  const remove = (m) => {
    const r = paymentTypes.remove(m);
    if (!r.ok) { Alert.alert('Cannot delete', r.reason); return; }
    refresh();
  };

  return (
    <Card style={{ paddingVertical: 4 }}>
      {types.map((m, i) => (
        <View key={m} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
          borderBottomWidth: i === types.length - 1 ? 0 : 1, borderColor: colors.muted }}>
          <Text style={{ flex: 1, color: colors.text, textTransform: 'capitalize' }}>{m}</Text>
          <TouchableOpacity onPress={() => rename(m)} style={{ paddingHorizontal: 8 }}>
            <Text style={{ color: colors.subtle }}>Rename</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => remove(m)} style={{ paddingHorizontal: 4 }}>
            <Text style={{ color: colors.red }}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}
      <AddMethod onAdd={(name) => { paymentTypes.addCustom(name); refresh(); }} />
    </Card>
  );
}

/** Inline add row — works on Android where Alert.prompt is unavailable. */
function AddMethod({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  if (!open) {
    return (
      <TouchableOpacity onPress={() => setOpen(true)} style={{ paddingVertical: 10 }}>
        <Text style={{ color: colors.subtle }}>＋ New method</Text>
      </TouchableOpacity>
    );
  }
  return (
    <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 8 }}>
      <Input value={name} onChangeText={setName} placeholder="Method name" autoFocus style={{ flex: 1 }} />
      <Button title="Add" onPress={() => { if (name.trim()) { onAdd(name.trim()); setName(''); setOpen(false); } }} />
      <Button title="✕" kind="ghost" onPress={() => { setName(''); setOpen(false); }} />
    </View>
  );
}

/** Gemini API key for receipt scanning — stored in user state, synced. */
function GeminiKey({ state, services }) {
  const [key, setKey] = useState(state.user.geminiApiKey || '');
  const save = () => {
    state.user.geminiApiKey = key.trim();
    services.store.flush();
    Alert.alert(key.trim() ? 'Key saved' : 'Key cleared',
      key.trim() ? 'Receipt scanning is enabled.' : 'Receipt scanning disabled.');
  };
  return (
    <Card>
      <Field label="Google AI (Gemini) API key">
        <Input value={key} onChangeText={setKey} autoCapitalize="none" placeholder="AIza…" secureTextEntry />
      </Field>
      <Text style={{ fontSize: 12, color: colors.faint, marginBottom: 8 }}>
        Free key from aistudio.google.com. Enables "Scan receipt" on the transaction form.
      </Text>
      <Button title="Save key" onPress={save} />
    </Card>
  );
}

/** Export the whole book as JSON (and a transactions CSV) via the share sheet. */
function ExportData({ state }) {
  // Lazy-load native modules so a missing install can't break the bundle.
  const loadExpo = () => {
    try {
      return { FileSystem: require('expo-file-system'), Sharing: require('expo-sharing') };
    } catch {
      Alert.alert('Not available',
        'File export needs the expo-file-system and expo-sharing packages. Run:\n\nnpx expo install expo-file-system expo-sharing');
      return null;
    }
  };
  const exportJson = async () => {
    const mods = loadExpo(); if (!mods) return;
    const { FileSystem, Sharing } = mods;
    try {
      const clean = Repository.stripTransient(state);
      const path = FileSystem.documentDirectory + `pocket-backup-${Date.now()}.json`;
      await FileSystem.writeAsStringAsync(path, JSON.stringify(clean, null, 2));
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path);
      else Alert.alert('Saved', path);
    } catch (e) { Alert.alert('Export failed', String(e?.message || e)); }
  };
  const exportCsv = async () => {
    const mods = loadExpo(); if (!mods) return;
    const { FileSystem, Sharing } = mods;
    try {
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = [['Date', 'Type', 'Account', 'Category', 'Payee', 'Amount', 'Currency', 'Note']];
      const acc = (id) => state.accounts.find((a) => a.id === id)?.name || '';
      const cat = (id) => state.categories.find((c) => c.id === id)?.name || '';
      for (const t of state.transactions) {
        rows.push([t.date, t.type, acc(t.accountId), cat(t.categoryId), t.payee || '',
          (t.amount / 100).toFixed(2), t.currency, t.note || '']);
      }
      const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
      const path = FileSystem.documentDirectory + `pocket-transactions-${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(path, csv);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path);
      else Alert.alert('Saved', path);
    } catch (e) { Alert.alert('Export failed', String(e?.message || e)); }
  };
  return (
    <Card>
      <Text style={{ fontSize: 12, color: colors.subtle, marginBottom: 10 }}>
        Export a full backup, or a transactions spreadsheet, through your phone's share sheet.
      </Text>
      <Button title="Export full backup (JSON)" onPress={exportJson} />
      <Button title="Export transactions (CSV)" kind="ghost" onPress={exportCsv} style={{ marginTop: 8 }} />
    </Card>
  );
}
