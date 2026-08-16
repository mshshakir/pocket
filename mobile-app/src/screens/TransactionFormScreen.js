/**
 * TransactionFormScreen — new/edit transaction, transfers and splits included.
 *
 * All correctness lives in TransactionComposer (the audited web rules); this
 * screen only collects input. Notable UI carry-overs from the web:
 *   - transfers show a LOCKED currency label (the source account's — H4)
 *   - the category field opens the two-step picker, never a long list
 *   - split rows each get their own picker + amount; the running remainder is
 *     shown and submit is blocked until it is exactly zero (L1)
 */
import React, { useMemo, useState, useRef } from 'react';
import { ScrollView, View, Text, Alert, TouchableOpacity } from 'react-native';
import VoiceOverlay from '../ui/VoiceOverlay.js';
// expo-image-picker / -document-picker / -file-system are required lazily inside
// the scan handlers so a missing native module can't fail the whole bundle.
import { useAppState } from '../state/AppContext.js';
import { PickerBus } from '../state/PickerBus.js';
import { Card, Field, Input, Button, Segmented, Row, Dot } from '../ui/common.js';
import { colors } from '../ui/theme.js';
import { CURRENCIES } from '../data/constants.js';
import { DateService } from '../domain/services/DateService.js';
import { HijriCalendarService } from '../domain/services/HijriCalendarService.js';
import { RATES } from '../domain/services/FxRates.js';

const hijri = new HijriCalendarService();

export default function TransactionFormScreen({ navigation, route }) {
  const { id } = route.params || {};
  // `localState`, deliberately, not the space projection.
  //
  // This form already had a complete model of "somebody else's book": when
  // `sharedMode` is set it reads accounts and categories out of the owner's
  // snapshot and submits through the contribution API. Handing it a projection
  // on top of that gave it a SECOND, silent notion of the same thing — so in a
  // guest space `state.accounts` was the owner's while `accountId` held a local
  // id from `accounts.defaultId()`, the account field rendered its placeholder
  // forever, the split chips offered accounts the composer would then reject,
  // and the currency defaulted to the owner's. One book per form: this one
  // reads the member's, and everything about the other person's arrives through
  // `sharedMode`.
  const { localState: state, services, guard } = useAppState();
  const { fx, composer, categories, paymentTypes, sync, receipts, accounts } = services;

  // Shared-account contribution: the row lives in the OWNER's book, so this
  // form submits through the sync contribution API, not the local composer.
  // sharedMode = { ownerId, accountId, editTxId? }. It can arrive as a route
  // param (from the Family screen), be decided by the active space, OR be
  // chosen in-form by picking a shared account — so it is state, not a param.
  //
  // Deciding it up front is what fixes the duplicate-row bug: previously an
  // edit of an existing row acquired contribution mode LATER, by touching the
  // account field, and the mode it acquired carried no `editTxId` — so
  // submitting called submitContribution with a fresh id and left a second copy
  // of the row in the owner's book.
  const [routeVerdict] = useState(() => {
    if (route.params?.sharedMode) return { ok: true, sharedMode: route.params.sharedMode };
    if (!guard) return { ok: true, sharedMode: null };
    return id ? guard.routeEditTransaction(id) : guard.routeNewTransaction();
  });
  const [sharedMode, setSharedMode] = useState(routeVerdict.ok ? routeVerdict.sharedMode : null);
  const share = sharedMode ? sync.shareByOwner?.(sharedMode.ownerId) : null;
  // Category name/colour come from the owner's snapshot when contributing.
  const ownerCats = sharedMode ? (share?.categories || []) : null;
  const catFind = (cid) => sharedMode ? (ownerCats.find((c) => c.id === cid)) : categories.find(cid);
  const catFullName = (cid) => sharedMode ? categories.fullName(cid, ownerCats) : categories.fullName(cid);

  const editing = id ? state.transactions.find((t) => t.id === id) : null;

  // Editing a transfer: always edit from the OUT leg so account/direction map
  // correctly, and recover the destination from the pair (web parity). Opening
  // the IN leg would otherwise leave "To account" empty and flip the direction.
  let editBase = editing, editPair = null;
  if (editing?.type === 'transfer' && editing.transferPairId) {
    const pair = state.transactions.find((t) => t.id === editing.transferPairId);
    if (editing.transferDir === 'in' && pair) { editBase = pair; editPair = editing; }
    else editPair = pair;
  }

  // Editing an existing SHARED contribution: seed fields from the owner's
  // snapshot row (it lives in their book, not ours).
  const sharedSeed = sharedMode?.editTxId
    ? (share?.transactions || []).find((t) => t.id === sharedMode.editTxId)
    : null;
  const seed = sharedSeed || editBase;

  const [busy, setBusy] = useState(false);
  // Voice entry overlay: phase is null | 'listening' | 'processing'.
  const [voicePhase, setVoicePhase] = useState(null);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [voiceSecs,  setVoiceSecs]  = useState(0);
  const recRef = useRef(null);   // active expo-av Recording
  const fsRef  = useRef(null);   // expo-file-system module (lazy-required)

  const [type, setType]           = useState(seed?.type || 'expense');
  const [amount, setAmount]       = useState(
    seed ? String(fx.fromMinor(seed.amount, seed.currency)) : '');
  const [currency, setCurrency]   = useState(
    seed?.currency || state.user.defaultCurrency || state.user.homeCurrency);
  const [accountId, setAccountId] = useState(
    editBase?.accountId || accounts.defaultId?.() || state.accounts[0]?.id || null);
  const [toAccountId, setToAccountId] = useState(editPair?.accountId ?? null);
  const [categoryId, setCategoryId]   = useState(seed?.categoryId || null);
  const [payee, setPayee]         = useState(seed?.payee || '');
  const [note, setNote]           = useState(seed?.note || '');
  const [date, setDate]           = useState(seed?.date || DateService.todayIso());
  const [paymentType, setPaymentType] = useState(
    seed?.paymentType || paymentTypes.defaultType?.() || 'card');
  const [splits, setSplits]       = useState(
    editBase?.splits ? editBase.splits.map((s) => ({ ...s })) : null);

  // Recurring rule (web parity). Only offered for local, non-split entries.
  const [recurOn, setRecurOn]   = useState(!!editBase?.recurring);
  const [recurRule, setRecurRule] = useState(editBase?.recurring?.rule || 'monthly');
  const [recurEvery, setRecurEvery] = useState(String(editBase?.recurring?.interval || 1));
  const [recurUntil, setRecurUntil] = useState(editBase?.recurring?.until || '');

  // Manual FX override for cross-currency transfers (H5).
  const [transferRate, setTransferRate] = useState(
    editBase?.transferRate ? String(editBase.transferRate) : '');
  // Manual FX for a non-transfer entry whose currency ≠ its account currency.
  // Seed from the frozen acctMinor so an edit shows the rate actually booked.
  const [txFxRate, setTxFxRate] = useState(() => {
    if (editBase && editBase.type !== 'transfer' && Number.isFinite(editBase.acctMinor) && editBase.amount) {
      const acc = state.accounts.find((a) => a.id === editBase.accountId);
      if (acc) return String((fx.fromMinor(editBase.acctMinor, acc.currency) / fx.fromMinor(editBase.amount, editBase.currency)).toFixed(6));
    }
    return '';
  });

  const srcAccount = state.accounts.find((a) => a.id === accountId);
  // H4: a transfer is denominated in the source account's currency.
  const effCurrency = type === 'transfer' ? (srcAccount?.currency || currency) : currency;
  const dstAccount = state.accounts.find((a) => a.id === toAccountId);
  const crossCurrency = type === 'transfer' && dstAccount && dstAccount.currency !== effCurrency;
  const liveRate = crossCurrency ? (RATES[dstAccount.currency] || 1) / (RATES[effCurrency] || 1) : 1;
  const usedRate = Number(transferRate) > 0 ? Number(transferRate) : liveRate;

  const minorAmount = fx.toMinor(Number(amount) || 0, effCurrency);
  const splitSum    = (splits || []).reduce((s, x) => s + (x.amount || 0), 0);
  const splitDiff   = minorAmount - splitSum;

  const openCategoryPicker = (onPicked, current) => {
    const token = PickerBus.register((ids) => onPicked(ids[0] ?? null));
    navigation.navigate('CategoryPicker', {
      token, mode: 'single', type, selected: current ? [current] : [],
      // Contributing → browse the OWNER's categories, not the local book.
      categories: sharedMode ? ownerCats : undefined,
    });
  };

  // Currently-selected account (local or shared) for the picker field label.
  const currentAcc = sharedMode
    ? (share?.accounts || []).find((a) => a.id === sharedMode.accountId)
    : state.accounts.find((a) => a.id === accountId);
  const toAcc = state.accounts.find((a) => a.id === toAccountId);

  // Non-transfer manual FX: entry currency differs from its account's currency.
  const nonXferFx = type !== 'transfer' && !sharedMode && currentAcc && currentAcc.currency !== currency;
  const txLiveRate = nonXferFx ? (RATES[currentAcc.currency] || 1) / (RATES[currency] || 1) : 1;
  const txUsedRate = Number(txFxRate) > 0 ? Number(txFxRate) : txLiveRate;

  // Payee → category suggestion (learned merchant map), only when uncategorised.
  const suggestedCatId = (!categoryId && payee.trim() && type !== 'transfer' && !sharedMode)
    ? (state.merchantCategories || {})[payee.trim().toLowerCase()] : null;
  const suggestedCat = suggestedCatId ? categories.find(suggestedCatId) : null;

  // Hijri preview for the date field.
  const showHijriDates = state.user.showHijri !== false;
  const dateH = showHijriDates ? hijri.toHijri(date) : null;
  const dateMiqaat = showHijriDates ? hijri.topMiqaat(hijri.miqaatsForGregorian(date)) : null;

  const openAccountPicker = (kind) => {
    const token = PickerBus.register((res) => {
      if (!res) return;
      if (kind === 'to') { setToAccountId(res.accountId); return; }
      if (kind === 'from') { setAccountId(res.accountId); return; }
      // main account (expense / income): shared choice flips to contribution mode
      if (res.ownerId) {
        // …but never for a row that already exists. Moving an entry from your
        // own book into someone else's is a delete-here-and-contribute-there,
        // not an account change: the old code flipped the mode, dropped the id
        // on the way, and submitting then wrote a SECOND copy into the owner's
        // book while the original stayed put.
        if (editBase && !sharedMode?.editTxId) {
          Alert.alert(
            'Not an account change',
            'That account belongs to someone else. Delete this entry and add it '
            + 'to their account instead — moving it would leave a copy in both books.',
          );
          return;
        }
        setSharedMode((m) => ({ ownerId: res.ownerId, accountId: res.accountId, editTxId: m?.editTxId }));
        if (res.currency) setCurrency(res.currency);
        setType((t) => (t === 'transfer' ? 'expense' : t));
        setSplits(null);
        setCategoryId(null); // owner's categories differ from mine
      } else {
        setAccountId(res.accountId);
        setSharedMode(null);
      }
    });
    navigation.navigate('AccountPicker', {
      token,
      mode: kind === 'main' ? 'all' : 'local',
      selected: kind === 'to' ? toAccountId : (sharedMode ? sharedMode.accountId : accountId),
    });
  };

  const submit = async () => {
    // ── Shared-account contribution ─────────────────────────────────────
    if (sharedMode && share) {
      if (!(fx.toMinor(Number(amount) || 0, currency) > 0)) { Alert.alert('Enter an amount'); return; }
      // Route through the composer so FX/refAmount/tags/hijriDate match the
      // local ledger rules exactly (no inline arithmetic to drift).
      const tx = composer.buildContributionTx({
        id: sharedMode.editTxId,
        accountId: sharedMode.accountId, categoryId: categoryId || null,
        amountMajor: amount, currency, type, payee, note, date, paymentType,
        ownerHome: share.homeCurrency || state.user.homeCurrency,
        addedBy: sync.currentUser?.email || null,
      });
      setBusy(true);
      try {
        if (sharedMode.editTxId) await sync.updateContribution(share._ownerId, sharedMode.editTxId, tx);
        else                     await sync.submitContribution(share._ownerId, tx);
        sync.scheduleSharesRefresh?.(3000);
        navigation.goBack();
      } catch (e) {
        Alert.alert('Could not submit', String(e?.message || e));
      } finally { setBusy(false); }
      return;
    }

    // ── Normal local transaction ────────────────────────────────────────
    const draft = {
      type,
      amount: Number(amount) || 0,
      currency: effCurrency,
      accountId,
      transferToAccountId: toAccountId,
      transferRate: Number(transferRate) > 0 ? Number(transferRate) : undefined,
      txFxRate: Number(txFxRate) > 0 ? Number(txFxRate) : undefined,
      categoryId,
      payee, note, date, paymentType,
      splits: splits && splits.length ? splits : null,
      recurring: (recurOn && !splits)
        ? { rule: recurRule, interval: Math.max(1, parseInt(recurEvery, 10) || 1), until: recurUntil || null }
        : null,
    };
    const res = editing ? composer.update(editBase.id, draft) : composer.create(draft);
    if (!res.ok) { Alert.alert('Cannot save', res.reason); return; }
    navigation.goBack();
  };

  /**
   * Scan a receipt: pick an image (base64), hand it to ReceiptScanService,
   * and pre-fill the form from the result. Needs a Gemini key (Settings).
   */
  const applyPrefill = (prefill, opts = {}) => {
    // Type first: voice can return income/transfer; a receipt is always expense.
    // Never switch a shared contribution to transfer (not allowed in that mode).
    if (prefill.type && ['expense', 'income', 'transfer'].includes(prefill.type)
        && !(sharedMode && prefill.type === 'transfer')) {
      setType(prefill.type);
      if (prefill.type === 'transfer') setSplits(null);
    }
    if (prefill.amount != null) setAmount(String(prefill.amount));
    if (prefill.currency) setCurrency(prefill.currency);
    if (prefill.payee) setPayee(prefill.payee);
    if (prefill.note) setNote(prefill.note);
    if (prefill.date) setDate(prefill.date);
    if (prefill.paymentType) setPaymentType(prefill.paymentType);
    if (prefill.categoryId) setCategoryId(prefill.categoryId);
    // Splits arrive from a multi-category receipt scan or voice entry. Without
    // this line they were silently dropped — mobile accepted the prefill,
    // showed the total, and threw away the per-category breakdown the model had
    // already worked out. A contribution to a shared account has no split path,
    // so they are refused there rather than dropped after the fact.
    if (Array.isArray(prefill.splits) && prefill.splits.length && !sharedMode
        && prefill.type !== 'transfer') {
      setSplits(prefill.splits.map((sp) => ({ ...sp })));
      setCategoryId(null);   // the parent of a split carries no category
    }
    Alert.alert(opts.title || 'Receipt scanned', opts.message || 'Review the pre-filled fields, then save.');
  };

  const runScan = async (getInput) => {
    setBusy(true);
    try {
      const input = await getInput();
      if (!input) return;
      applyPrefill(await receipts.scan(input));
    } catch (e) {
      const m = String(e?.message || e);
      Alert.alert('Scan failed', m === 'NO_API_KEY' ? 'Add a Gemini key in Settings.' : m);
    } finally { setBusy(false); }
  };

  const scanReceipt = () => {
    if (!state.user.geminiApiKey?.trim()) {
      Alert.alert('No AI key', 'Add a Google AI (Gemini) key in Settings → Receipt scanning first.');
      return;
    }
    let ImagePicker;
    try { ImagePicker = require('expo-image-picker'); }
    catch { Alert.alert('Not available', 'Receipt scanning needs expo-image-picker. Run:\n\nnpx expo install expo-image-picker'); return; }

    const fromLibrary = () => runScan(async () => {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access.'); return null; }
      const p = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.6 });
      const a = p.assets?.[0];
      return (p.canceled || !a?.base64) ? null : { base64: a.base64, mimeType: a.mimeType || 'image/jpeg' };
    });
    const fromCamera = () => runScan(async () => {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Allow camera access.'); return null; }
      const p = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6 });
      const a = p.assets?.[0];
      return (p.canceled || !a?.base64) ? null : { base64: a.base64, mimeType: a.mimeType || 'image/jpeg' };
    });
    const fromPdf = () => runScan(async () => {
      let DocumentPicker, FileSystem;
      try { DocumentPicker = require('expo-document-picker'); FileSystem = require('expo-file-system'); }
      catch { Alert.alert('Not available', 'PDF scan needs expo-document-picker + expo-file-system.'); return null; }
      const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
      const uri = res?.assets?.[0]?.uri || res?.uri;
      if (res?.canceled || !uri) return null;
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType?.Base64 || 'base64' });
      return { base64, mimeType: 'application/pdf' };
    });

    Alert.alert('Scan a receipt', 'Choose a source', [
      { text: 'Photo library', onPress: fromLibrary },
      { text: 'Camera', onPress: fromCamera },
      { text: 'PDF file', onPress: fromPdf },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  /**
   * Voice entry: record a short clip with a live level meter, hand it to
   * ReceiptScanService.parseVoice, and pre-fill the form. Capture uses expo-av
   * (lazy-required so a build without it can't fail the bundle); interpretation
   * is the shared service. Android records AAC/ADTS (.aac) — a Gemini-supported
   * format — rather than the default .m4a, so the model reads it reliably.
   *
   * The VoiceOverlay shows the live meter ('listening') then a spinner
   * ('processing'); metering values arrive via the recording status callback.
   */
  const mimeForUri = (uri) =>
    uri.endsWith('.aac') ? 'audio/aac'
      : uri.endsWith('.m4a') ? 'audio/mp4'
      : uri.endsWith('.3gp') ? 'audio/3gpp'
      : 'audio/aac';

  const startVoice = () => {
    if (voicePhase) return; // already recording
    if (!state.user.geminiApiKey?.trim()) {
      Alert.alert('No AI key', 'Add a Google AI (Gemini) key in Settings → Receipt scanning first.');
      return;
    }
    let AV, FileSystem;
    try { AV = require('expo-av'); }
    catch { Alert.alert('Not available', 'Voice entry needs expo-av. Run:\n\nnpx expo install expo-av\n\nthen rebuild the dev client.'); return; }
    try { FileSystem = require('expo-file-system'); }
    catch { Alert.alert('Not available', 'Voice entry needs expo-file-system.'); return; }
    fsRef.current = FileSystem;

    const { Audio, AndroidOutputFormat, AndroidAudioEncoder, IOSOutputFormat, IOSAudioQuality } = AV;
    const recOptions = {
      isMeteringEnabled: true, // drives the live level meter
      android: {
        extension: '.aac',
        outputFormat: AndroidOutputFormat?.AAC_ADTS ?? 6,
        audioEncoder: AndroidAudioEncoder?.AAC ?? 3,
        sampleRate: 44100, numberOfChannels: 1, bitRate: 64000,
      },
      ios: {
        extension: '.m4a',
        outputFormat: IOSOutputFormat?.MPEG4AAC,
        audioQuality: IOSAudioQuality?.MAX ?? 0x7f,
        sampleRate: 44100, numberOfChannels: 1, bitRate: 64000,
        linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false,
      },
      web: { mimeType: 'audio/webm', bitsPerSecond: 128000 },
    };

    const onStatus = (st) => {
      if (!st) return;
      if (typeof st.metering === 'number') {
        // metering is dBFS (~-160..0); map the useful speech band -50..0 → 0..1
        setVoiceLevel(Math.max(0, Math.min(1, (st.metering + 50) / 50)));
      }
      if (typeof st.durationMillis === 'number') setVoiceSecs(Math.floor(st.durationMillis / 1000));
    };

    (async () => {
      try {
        const perm = await Audio.requestPermissionsAsync();
        if (!perm.granted) { Alert.alert('Permission needed', 'Allow microphone access to use voice entry.'); return; }
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const r = await Audio.Recording.createAsync(recOptions, onStatus, 90);
        recRef.current = r.recording;
        setVoiceLevel(0); setVoiceSecs(0); setVoicePhase('listening');
      } catch (e) {
        Alert.alert('Could not start recording', String(e?.message || e));
      }
    })();
  };

  const stopVoice = async () => {
    const recording = recRef.current;
    if (!recording) { setVoicePhase(null); return; }
    setVoicePhase('processing');
    try {
      try { recording.setOnRecordingStatusUpdate(null); } catch (_) {}
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      recRef.current = null;
      if (!uri) throw new Error('No audio captured.');
      const FileSystem = fsRef.current;
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType?.Base64 || 'base64',
      });
      const prefill = await receipts.parseVoice({ base64, mimeType: mimeForUri(uri) });
      setVoicePhase(null);
      applyPrefill(prefill, { title: 'Heard it', message: 'Review the pre-filled fields, then save.' });
    } catch (e) {
      setVoicePhase(null);
      const m = String(e?.message || e);
      Alert.alert('Voice failed', m === 'NO_API_KEY' ? 'Add a Gemini key in Settings.' : m);
    }
  };

  const cancelVoice = async () => {
    const recording = recRef.current;
    recRef.current = null;
    setVoicePhase(null);
    if (recording) {
      try { recording.setOnRecordingStatusUpdate(null); await recording.stopAndUnloadAsync(); } catch (_) {}
    }
  };

  /**
   * Withdraw a contribution from the owner's book.
   *
   * A member could reach this form to CREATE a contribution but had no way to
   * remove one — the Delete button was hidden whenever `sharedMode` was set, so
   * the only route back was the Family screen. The owner's client accepts the
   * delete marker only for a row whose `addedBy` matches, which SpaceGuard has
   * already checked before the form opened.
   */
  const confirmDeleteShared = () => {
    Alert.alert('Withdraw this entry?', 'It will be removed from the owner\'s book.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Withdraw', style: 'destructive', onPress: async () => {
        setBusy(true);
        try {
          await sync.deleteContribution(sharedMode.ownerId, sharedMode.editTxId);
          sync.scheduleSharesRefresh?.(3000);
          navigation.goBack();
        } catch (e) {
          Alert.alert('Could not withdraw', String(e?.message || e));
        } finally { setBusy(false); }
      } },
    ]);
  };

  const confirmDelete = () => {
    Alert.alert('Delete transaction?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive',
        onPress: () => { composer.remove(editBase.id); navigation.goBack(); } },
    ]);
  };

  const shiftDate = (days) => {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + days);
    setDate(d.toISOString().slice(0, 10));
  };

  const catLabel = categoryId
    ? catFullName(categoryId) || 'Uncategorised'
    : '— Uncategorised —';

  // A shared contribution can't be a transfer or a split — it's a single row
  // in someone else's book. Offer expense/income only in that mode.
  const typeOptions = sharedMode
    ? [{ id: 'expense', label: 'Expense' }, { id: 'income', label: 'Income' }]
    : [{ id: 'expense', label: 'Expense' }, { id: 'income', label: 'Income' }, { id: 'transfer', label: 'Transfer' }];

  // Refused before anything is rendered — view-only access, someone else's
  // entry, or a local row reached from a report while a guest space is active.
  // Previously each of these opened the form fully populated and failed at the
  // end: Save alerted "Transaction not found", and Delete closed the screen
  // having removed nothing at all.
  if (!routeVerdict.ok) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
        <Card>
          <Text style={{ color: colors.text, fontWeight: '600', marginBottom: 6 }}>Not here</Text>
          <Text style={{ color: colors.subtle, fontSize: 13, lineHeight: 19 }}>
            {routeVerdict.message}
          </Text>
        </Card>
        <Button title="Back" kind="ghost" onPress={() => navigation.goBack()} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <VoiceOverlay
        visible={!!voicePhase}
        phase={voicePhase || 'listening'}
        level={voiceLevel}
        seconds={voiceSecs}
        onStop={stopVoice}
        onCancel={cancelVoice}
      />
      {sharedMode ? (
        <Card style={{ backgroundColor: colors.card, borderColor: colors.indigo, borderWidth: 1 }}>
          <Text style={{ color: colors.indigo, fontWeight: '600' }}>
            Contributing to a shared account
          </Text>
          <Text style={{ fontSize: 12, color: colors.subtle, marginTop: 2 }}>
            {share?.accounts?.find((a) => a.id === sharedMode.accountId)?.name || 'Shared account'}
            {' · '}shared by {share?.sharedBy || 'family'}
          </Text>
        </Card>
      ) : null}

      {!sharedMode && !editing ? (
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          <Button title={busy ? 'Scanning…' : '📷 Scan a receipt'} kind="ghost" onPress={scanReceipt}
            disabled={busy} style={{ flex: 1 }} />
          <Button title={busy ? '…' : '🎤 Voice'} kind="ghost" onPress={startVoice}
            disabled={busy} style={{ flex: 1 }} />
        </View>
      ) : null}

      <Segmented
        options={typeOptions}
        value={type === 'transfer' && sharedMode ? 'expense' : type}
        onChange={(t) => {
          setType(t);
          const cat = categoryId ? categories.find(categoryId) : null;
          if (cat && cat.type !== t) setCategoryId(null);
          if (t === 'transfer') setSplits(null);
        }}
      />

      <Card>
        <Field label="Amount">
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Input
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              style={{ flex: 1, fontSize: 22, fontWeight: '600' }}
            />
            {type === 'transfer' ? (
              <Text style={{ color: colors.subtle, fontWeight: '600' }}>🔒 {effCurrency}</Text>
            ) : (
              <CurrencyCycler value={currency} onChange={setCurrency} />
            )}
          </View>
        </Field>

        {type === 'transfer' ? (
          <>
            <Field label="From account">
              <AccountButton acc={currentAcc} onPress={() => openAccountPicker('from')} />
            </Field>
            <Field label="To account">
              <AccountButton acc={toAcc} placeholder="Choose account" onPress={() => openAccountPicker('to')} />
            </Field>
          </>
        ) : (
          <Field label="Account">
            <AccountButton acc={currentAcc} shared={!!sharedMode} onPress={() => openAccountPicker('main')} />
          </Field>
        )}

        {crossCurrency ? (
          <Field label={`Exchange rate (1 ${effCurrency} → ${dstAccount.currency})`}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Input
                value={transferRate}
                onChangeText={setTransferRate}
                keyboardType="decimal-pad"
                placeholder={`live ${liveRate.toFixed(4)}`}
                style={{ flex: 1 }}
              />
              {transferRate ? <Button title="Live" kind="ghost" onPress={() => setTransferRate('')} /> : null}
            </View>
            <Text style={{ fontSize: 12, color: colors.subtle, marginTop: 6 }}>
              They'll receive ≈ {fx.formatMoney(
                fx.toMinor(fx.fromMinor(minorAmount, effCurrency) * usedRate, dstAccount.currency),
                dstAccount.currency)}
              {transferRate ? '' : ' · using live rate'}
            </Text>
          </Field>
        ) : null}

        {nonXferFx ? (
          <Field label={`Exchange rate (1 ${currency} → ${currentAcc.currency})`}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Input value={txFxRate} onChangeText={setTxFxRate} keyboardType="decimal-pad"
                placeholder={`live ${txLiveRate.toFixed(4)}`} style={{ flex: 1 }} />
              {txFxRate ? <Button title="Live" kind="ghost" onPress={() => setTxFxRate('')} /> : null}
            </View>
            <Text style={{ fontSize: 12, color: colors.subtle, marginTop: 6 }}>
              Posts ≈ {fx.formatMoney(fx.toMinor(fx.fromMinor(minorAmount, currency) * txUsedRate, currentAcc.currency), currentAcc.currency)} to {currentAcc.name}
              {txFxRate ? '' : ' · live rate'}
            </Text>
          </Field>
        ) : null}

        {type !== 'transfer' && !splits ? (
          <Field label="Category">
            <TouchableOpacity
              onPress={() => openCategoryPicker(setCategoryId, categoryId)}
              style={{
                borderWidth: 1, borderColor: colors.border, borderRadius: 10,
                padding: 12, flexDirection: 'row', alignItems: 'center',
              }}
            >
              <Dot color={catFind(categoryId)?.color} />
              <Text style={{ flex: 1, color: categoryId ? colors.text : colors.subtle }}>
                {catLabel}
              </Text>
              <Text style={{ color: colors.faint }}>›</Text>
            </TouchableOpacity>
          </Field>
        ) : null}
      </Card>

      {type !== 'transfer' && !sharedMode ? (
        <Card>
          {splits ? (
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ fontSize: 12, color: colors.subtle, fontWeight: '600' }}>SPLITS</Text>
                <View style={{ flex: 1 }} />
                <Text style={{
                  fontSize: 12,
                  color: splitDiff === 0 ? colors.green : splitDiff > 0 ? colors.amber : colors.red,
                }}>
                  {splitDiff === 0
                    ? 'Splits match total'
                    : splitDiff > 0
                      ? `${fx.formatMoney(splitDiff, effCurrency)} remaining`
                      : `${fx.formatMoney(-splitDiff, effCurrency)} over`}
                </Text>
              </View>
              {splits.map((s, i) => (
                <View key={i} style={{ marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <TouchableOpacity
                      onPress={() => openCategoryPicker(
                        (cid) => setSplits((prev) => prev.map((x, j) => j === i ? { ...x, categoryId: cid } : x)),
                        s.categoryId,
                      )}
                      style={{
                        flex: 1, borderWidth: 1, borderColor: colors.border,
                        borderRadius: 10, padding: 10, flexDirection: 'row', alignItems: 'center',
                      }}
                    >
                      <Dot color={categories.find(s.categoryId)?.color} size={8} />
                      <Text style={{ color: s.categoryId ? colors.text : colors.subtle, fontSize: 13 }} numberOfLines={1}>
                        {s.categoryId ? categories.fullName(s.categoryId) : 'Category…'}
                      </Text>
                    </TouchableOpacity>
                    <Input
                      placeholder="0.00"
                      keyboardType="decimal-pad"
                      defaultValue={s.amount ? String(fx.fromMinor(s.amount, effCurrency)) : ''}
                      onChangeText={(v) => setSplits((prev) =>
                        prev.map((x, j) => j === i
                          ? { ...x, amount: fx.toMinor(Number(v) || 0, effCurrency) }
                          : x))}
                      style={{ width: 90, fontSize: 13 }}
                    />
                    <TouchableOpacity onPress={() =>
                      setSplits((prev) => prev.length <= 1 ? null : prev.filter((_, j) => j !== i))}>
                      <Text style={{ color: colors.red, fontSize: 18 }}>×</Text>
                    </TouchableOpacity>
                  </View>
                  {state.accounts.length > 1 ? (
                    <View style={{ marginTop: 6 }}>
                      <OptionRow
                        options={state.accounts.map((a) => ({ id: a.id, label: a.name }))}
                        value={s.accountId || accountId}
                        onChange={(aid) => setSplits((prev) => prev.map((x, j) => j === i ? { ...x, accountId: aid } : x))}
                      />
                    </View>
                  ) : null}
                </View>
              ))}
              <Button
                title="＋ Add split"
                kind="ghost"
                onPress={() => setSplits((prev) => [
                  ...(prev || []),
                  { categoryId: null, accountId, amount: 0 },
                ])}
              />
            </View>
          ) : (
            <Button
              title="Split this transaction"
              kind="ghost"
              onPress={() => setSplits([
                { categoryId: null, accountId, amount: 0 },
                { categoryId: null, accountId, amount: 0 },
              ])}
            />
          )}
        </Card>
      ) : null}

      {!sharedMode && !splits ? (
        <Card>
          <TouchableOpacity
            onPress={() => setRecurOn((v) => !v)}
            style={{ flexDirection: 'row', alignItems: 'center' }}
          >
            <View style={{
              width: 22, height: 22, borderRadius: 6, borderWidth: 1, marginRight: 10,
              borderColor: recurOn ? colors.primary : colors.border,
              backgroundColor: recurOn ? colors.primary : colors.card,
              alignItems: 'center', justifyContent: 'center',
            }}>
              {recurOn ? <Text style={{ color: colors.primaryFg, fontWeight: '700' }}>✓</Text> : null}
            </View>
            <Text style={{ flex: 1, color: colors.text }}>Repeat this transaction</Text>
          </TouchableOpacity>
          {recurOn ? (
            <View style={{ marginTop: 12 }}>
              <Field label="Frequency">
                <Segmented
                  options={[
                    { id: 'daily', label: 'Daily' },
                    { id: 'weekly', label: 'Weekly' },
                    { id: 'monthly', label: 'Monthly' },
                    { id: 'yearly', label: 'Yearly' },
                  ]}
                  value={recurRule}
                  onChange={setRecurRule}
                />
              </Field>
              <Field label="Every N periods">
                <Input value={recurEvery} onChangeText={setRecurEvery} keyboardType="number-pad" placeholder="1" />
              </Field>
              <Field label="Until (optional, YYYY-MM-DD)">
                <Input value={recurUntil} onChangeText={setRecurUntil} placeholder="—" autoCapitalize="none" />
              </Field>
            </View>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <Field label="Date">
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Button title="−1d" kind="ghost" onPress={() => shiftDate(-1)} />
            <Input value={date} onChangeText={setDate} style={{ flex: 1, textAlign: 'center' }} />
            <Button title="+1d" kind="ghost" onPress={() => shiftDate(1)} />
          </View>
          {dateH ? (
            <Text style={{ fontSize: 12, color: colors.subtle, marginTop: 6 }}>
              ☾ {dateH.day} {hijri.monthsLong[dateH.month]} {dateH.year} AH
              {dateMiqaat ? <Text style={{ color: colors.amber }}>  · {dateMiqaat.t}</Text> : null}
            </Text>
          ) : null}
        </Field>
        {type !== 'transfer' ? (
          <Field label="Payment method">
            <OptionRow
              options={paymentTypes.allTypes().map((p) => ({
                id: p, label: p.charAt(0).toUpperCase() + p.slice(1),
              }))}
              value={paymentType}
              onChange={setPaymentType}
            />
          </Field>
        ) : null}
        <Field label="Payee / merchant">
          <Input value={payee} onChangeText={setPayee} placeholder="e.g. Whole Foods" />
          {suggestedCat ? (
            <TouchableOpacity onPress={() => setCategoryId(suggestedCatId)}
              style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
              <Dot color={suggestedCat.color} size={8} />
              <Text style={{ fontSize: 12, color: colors.primary }}>
                Use “{categories.fullName(suggestedCatId)}” (last used here)
              </Text>
            </TouchableOpacity>
          ) : null}
        </Field>
        <Field label="Note">
          <Input value={note} onChangeText={setNote} placeholder="optional…" />
        </Field>
        {seed?.createdAt || seed?.addedBy ? (
          <Text style={{ fontSize: 11, color: colors.faint }}>
            Entered{seed.createdAt ? ` ${DateService.label(seed.createdAt.slice(0, 10))}` : ''}{seed.addedBy ? ` by ${seed.addedBy}` : ''}
          </Text>
        ) : null}
      </Card>

      <Button
        title={busy ? 'Working…'
          : sharedMode ? (sharedMode.editTxId ? 'Submit change' : 'Submit to shared account')
          : editing ? 'Save changes' : 'Add transaction'}
        onPress={submit}
        disabled={busy}
      />
      {editing && !sharedMode ? (
        <Button title="Delete" kind="danger" onPress={confirmDelete} style={{ marginTop: 8 }} />
      ) : sharedMode?.editTxId ? (
        <Button title="Withdraw" kind="danger" onPress={confirmDeleteShared} style={{ marginTop: 8 }} />
      ) : null}
      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

/** Tappable account field that opens the two-step account picker. */
function AccountButton({ acc, shared, placeholder = 'Choose account', onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        borderWidth: 1, borderColor: colors.border, borderRadius: 10,
        padding: 12, flexDirection: 'row', alignItems: 'center',
      }}
    >
      <Dot color={acc?.color} />
      <Text style={{ flex: 1, color: acc ? colors.text : colors.subtle }} numberOfLines={1}>
        {acc ? `${acc.name} · ${acc.currency}` : placeholder}
      </Text>
      {shared ? <Text style={{ fontSize: 11, color: colors.indigo, marginRight: 6 }}>shared</Text> : null}
      <Text style={{ color: colors.faint }}>›</Text>
    </TouchableOpacity>
  );
}

/** Horizontal chip selector for short option lists (payment methods, splits). */
function OptionRow({ options, value, onChange }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {options.map((o) => {
          const on = o.id === value;
          return (
            <TouchableOpacity
              key={o.id}
              onPress={() => onChange(o.id)}
              style={{
                borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8,
                borderColor: on ? colors.primary : colors.border,
                backgroundColor: on ? colors.primary : colors.card,
              }}
            >
              <Text style={{ color: on ? colors.primaryFg : colors.text, fontSize: 13 }}>
                {o.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
  );
}

/** Tap to cycle through the currency list; long-press resets to home. */
function CurrencyCycler({ value, onChange }) {
  const idx = Math.max(0, CURRENCIES.indexOf(value));
  return (
    <TouchableOpacity
      onPress={() => onChange(CURRENCIES[(idx + 1) % CURRENCIES.length])}
      onLongPress={() => onChange(CURRENCIES[0])}
      style={{
        borderWidth: 1, borderColor: colors.border, borderRadius: 10,
        paddingHorizontal: 12, paddingVertical: 10,
      }}
    >
      <Text style={{ fontWeight: '600', color: colors.text }}>{value}</Text>
    </TouchableOpacity>
  );
}
