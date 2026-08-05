import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../../core/file_saver/file_opener.dart';
import '../../../core/file_saver/file_saver.dart';
import '../../../sync/sync_config.dart';
import '../../dashboard/application/dashboard_providers.dart';
import '../../receipts/application/gemini_key_store.dart';
import '../../transactions/application/transaction_filters.dart';
import '../application/csv_export_service.dart';
import '../application/csv_import_controller.dart';
import '../application/settings_controller.dart';

/// Settings — ports the legacy `SettingsModal` sections that apply to the
/// Flutter app: currencies, date format, theme, Hijri calendar, cloud account.
/// (CSV/JSON migration and the receipt-scanner key come later with those
/// features.)
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings =
        ref.watch(settingsProvider).valueOrNull ?? const UserSettings();
    final controller = ref.watch(settingsControllerProvider);
    final currencies = ref.watch(fxProvider).rates.keys.toList()..sort();

    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Settings',
                style: Theme.of(context)
                    .textTheme
                    .headlineMedium
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            _SettingsCard(
              title: 'Home currency',
              caption: 'All balances and totals are converted to this currency.',
              child: DropdownButtonFormField<String>(
                initialValue: currencies.contains(settings.homeCurrency)
                    ? settings.homeCurrency
                    : null,
                items: [
                  for (final c in currencies)
                    DropdownMenuItem(value: c, child: Text(c)),
                ],
                onChanged: (v) {
                  if (v != null) controller.setHomeCurrency(v);
                },
              ),
            ),
            _SettingsCard(
              title: 'Default currency for new entries',
              caption:
                  'Pre-selected when adding a transaction, account, budget, or regular item.',
              child: DropdownButtonFormField<String>(
                initialValue: currencies.contains(settings.defaultCurrency)
                    ? settings.defaultCurrency
                    : null,
                items: [
                  for (final c in currencies)
                    DropdownMenuItem(value: c, child: Text(c)),
                ],
                onChanged: (v) {
                  if (v != null) controller.setDefaultCurrency(v);
                },
              ),
            ),
            _SettingsCard(
              title: 'Date format',
              caption: 'Used everywhere dates are displayed.',
              child: DropdownButtonFormField<String>(
                initialValue: settings.dateFormat,
                items: const [
                  DropdownMenuItem(
                      value: 'auto', child: Text('Auto (system locale)')),
                  DropdownMenuItem(
                      value: 'YYYY-MM-DD',
                      child: Text('YYYY-MM-DD (2026-05-20)')),
                  DropdownMenuItem(
                      value: 'MM/DD/YYYY',
                      child: Text('MM/DD/YYYY (05/20/2026)')),
                  DropdownMenuItem(
                      value: 'DD/MM/YYYY',
                      child: Text('DD/MM/YYYY (20/05/2026)')),
                ],
                onChanged: (v) {
                  if (v != null) controller.setDateFormat(v);
                },
              ),
            ),
            _SettingsCard(
              title: 'Theme',
              child: SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'light', label: Text('Light')),
                  ButtonSegment(value: 'dark', label: Text('Dark')),
                  ButtonSegment(value: 'system', label: Text('System')),
                ],
                selected: {settings.theme},
                onSelectionChanged: (s) => controller.setTheme(s.first),
              ),
            ),
            _HijriCard(settings: settings, controller: controller),
            const _DataCard(),
            const _GeminiCard(),
            _AccountCard(),
            const SizedBox(height: 16),
            Center(
              child: Text('Pocket · Flutter',
                  style: TextStyle(
                      fontSize: 12, color: Theme.of(context).hintColor)),
            ),
          ],
        ),
      ),
    );
  }
}

/// One rounded settings section: title, optional caption, content.
class _SettingsCard extends StatelessWidget {
  final String title;
  final String? caption;
  final Widget child;
  const _SettingsCard({required this.title, this.caption, required this.child});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
            if (caption != null) ...[
              const SizedBox(height: 2),
              Text(caption!,
                  style: TextStyle(
                      fontSize: 12, color: Theme.of(context).hintColor)),
            ],
            const SizedBox(height: 10),
            child,
          ],
        ),
      ),
    );
  }
}

/// Hijri calendar settings: on/off, today's corrected date, the −7…+7 offset
/// stepper, and the calendar view default — mirrors the legacy section.
class _HijriCard extends StatelessWidget {
  final UserSettings settings;
  final SettingsController controller;
  const _HijriCard({required this.settings, required this.controller});

  @override
  Widget build(BuildContext context) {
    final hint = Theme.of(context).hintColor;
    const cal = HijriCalendar();
    final offset = settings.hijriOffset;
    final today =
        cal.format(cal.toHijri(DateTime.now(), offset: offset), long: true);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: const Color(0xFF0EA5E9).withValues(alpha: 0.13),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.nightlight_outlined,
                      size: 18, color: Color(0xFF0EA5E9)),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Hijri calendar',
                          style: TextStyle(fontWeight: FontWeight.w600)),
                      Text('Show Hijri dates and miqaats',
                          style: TextStyle(fontSize: 12, color: hint)),
                    ],
                  ),
                ),
                Switch(
                  value: settings.showHijri,
                  onChanged: (_) => controller.toggleHijri(),
                ),
              ],
            ),
            if (settings.showHijri) ...[
              const Divider(height: 24),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text("Today's Hijri date (after your correction)",
                        style: TextStyle(fontSize: 12, color: hint)),
                    const SizedBox(height: 4),
                    Text(today,
                        style: const TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 4),
                    if (offset != 0)
                      Row(
                        children: [
                          Text(
                            'Offset applied: ${offset > 0 ? '+' : ''}$offset '
                            'day${offset.abs() == 1 ? '' : 's'}',
                            style: TextStyle(
                                fontSize: 12,
                                color: offset > 0
                                    ? const Color(0xFFD97706)
                                    : const Color(0xFF2563EB)),
                          ),
                          TextButton(
                            onPressed: () => controller.setHijriOffset(0),
                            child: const Text('reset',
                                style: TextStyle(fontSize: 12)),
                          ),
                        ],
                      )
                    else
                      Text('No offset applied — using calculated date',
                          style: TextStyle(fontSize: 12, color: hint)),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              Text(
                  'Adjust if your local moon sighting differs from the calculated date',
                  style: TextStyle(fontSize: 12, color: hint)),
              const SizedBox(height: 8),
              Row(
                children: [
                  OutlinedButton(
                    onPressed: offset <= UserSettings.minHijriOffset
                        ? null
                        : () => controller.adjustHijriOffset(-1),
                    child: const Text('−', style: TextStyle(fontSize: 18)),
                  ),
                  Expanded(
                    child: Column(
                      children: [
                        Text('${offset > 0 ? '+' : ''}$offset',
                            style: const TextStyle(
                                fontSize: 22, fontWeight: FontWeight.bold)),
                        Text('days',
                            style: TextStyle(fontSize: 12, color: hint)),
                      ],
                    ),
                  ),
                  OutlinedButton(
                    onPressed: offset >= UserSettings.maxHijriOffset
                        ? null
                        : () => controller.adjustHijriOffset(1),
                    child: const Text('+', style: TextStyle(fontSize: 18)),
                  ),
                ],
              ),
              Center(
                child: Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                      'Range: −7 to +7 days · Changes apply everywhere instantly',
                      style: TextStyle(fontSize: 11, color: hint)),
                ),
              ),
              const SizedBox(height: 12),
              Text('Calendar view default',
                  style: TextStyle(fontSize: 12, color: hint)),
              const SizedBox(height: 6),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'gregorian', label: Text('Gregorian')),
                  ButtonSegment(value: 'both', label: Text('Both dates')),
                  ButtonSegment(value: 'hijri', label: Text('Hijri')),
                ],
                selected: {settings.calendarMode},
                onSelectionChanged: (s) => controller.setCalendarMode(s.first),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Data export — CSV in the legacy import-template column format.
class _DataCard extends ConsumerWidget {
  const _DataCard();

  Future<void> _export(BuildContext context, WidgetRef ref, int? days,
      {DateTimeRange? range}) async {
    final csv = ref.read(csvExportServiceProvider).export(
          transactions:
              ref.read(transactionsProvider).valueOrNull ?? const [],
          accounts: ref.read(accountsProvider).valueOrNull ?? const [],
          categories: ref.read(categoriesProvider).valueOrNull ?? const [],
          debts: ref.read(debtsProvider).valueOrNull ?? const [],
          rangeDays: days,
          rangeStart: range?.start,
          rangeEnd: range?.end,
        );
    final name =
        'transactions-${DateTime.now().toIso8601String().substring(0, 10)}.csv';
    final path = await saveTextFile(name, csv);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content:
            Text(path == null ? 'CSV downloaded' : 'CSV saved to $path')));
  }

  static const String _template =
      'Date,Type,Account,ToAccount,ToAmount,ToCurrency,Category,Subcategory,Payee,Note,Amount,Currency,PaymentType,Tags,DueDate,DebtRef,SplitOf\n'
      '2026-06-01,expense,Main Checking,,,,Food & Drink,Groceries,Whole Foods,Weekly groceries,87.45,USD,card,,,,\n'
      '2026-06-01,income,Main Checking,,,,Salary,,Acme Corp,Monthly payroll,5800.00,USD,transfer,,,,\n'
      '2026-06-02,transfer,Main Checking,High-Yield Save,,,,,,Move to savings,500.00,USD,transfer,,,,\n'
      '2026-06-03,borrowed,Main Checking,,,,,,Ali,Wedding loan,1000.00,USD,transfer,,2026-09-01,,';

  Future<void> _import(BuildContext context, WidgetRef ref) async {
    final text = await pickTextFile();
    if (!context.mounted) return;
    if (text == null) return; // user cancelled the picker
    final settings =
        ref.read(settingsProvider).valueOrNull ?? const UserSettings();
    final plan = ref.read(csvImportServiceProvider).plan(
          text: text,
          accounts: ref.read(accountsProvider).valueOrNull ?? const [],
          categories: ref.read(categoriesProvider).valueOrNull ?? const [],
          existing: ref.read(transactionsProvider).valueOrNull ?? const [],
          homeCurrency: settings.homeCurrency,
          dateFormatPref: settings.dateFormat,
        );
    if (plan.isEmpty) {
      final why = plan.parsedRows == 0
          ? 'The file parsed to 0 data rows (${text.length} characters read) — '
              'is it a valid CSV with a header line?'
          : 'Parsed ${plan.parsedRows} rows but all were skipped: '
              '${plan.skipReasons.entries.map((e) => '${e.value}× ${e.key}').join(', ')}.';
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Nothing to import. $why')));
      return;
    }

    var includeDupes = false;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, setState) => AlertDialog(
          title: const Text('Import preview'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('${plan.txDrafts.length} transactions · '
                  '${plan.debtDrafts.length} debts · '
                  '${plan.newAccounts.length} new accounts · '
                  '${plan.newCategories.length} new categories'
                  '${plan.skipped > 0 ? ' · ${plan.skipped} rows skipped' : ''}'),
              if (plan.duplicateCount > 0)
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: Text(
                      'Include ${plan.duplicateCount} probable duplicate${plan.duplicateCount == 1 ? '' : 's'}'),
                  value: includeDupes,
                  onChanged: (v) => setState(() => includeDupes = v ?? false),
                ),
            ],
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.of(c).pop(false),
                child: const Text('Cancel')),
            FilledButton(
                onPressed: () => Navigator.of(c).pop(true),
                child: const Text('Import')),
          ],
        ),
      ),
    );
    if (confirmed != true || !context.mounted) return;

    final summary = await ref.read(csvImportControllerProvider).commit(
          plan: plan,
          existingAccounts: ref.read(accountsProvider).valueOrNull ?? const [],
          existingCategories:
              ref.read(categoriesProvider).valueOrNull ?? const [],
          includeDuplicates: includeDupes,
        );
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('Imported ${summary.transactions} transactions, '
            '${summary.debts} debts, ${summary.accounts} accounts, '
            '${summary.categories} categories'
            '${summary.skipped > 0 ? ' (${summary.skipped} rows skipped)' : ''}.')));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hint = Theme.of(context).hintColor;
    final range = ref.watch(transactionsDateRangeProvider);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Data', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 2),
            Text(
                'Export transactions as CSV, or migrate from another app: download the template, paste your data, re-upload. Accounts, categories and subcategories are auto-created; transfers, splits (SplitOf) and debts (borrowed/lent) are preserved.',
                style: TextStyle(fontSize: 12, color: hint)),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(
                  icon: const Icon(Icons.download, size: 16),
                  label: const Text('Last 30 days'),
                  onPressed: () => _export(context, ref, 30),
                ),
                OutlinedButton.icon(
                  icon: const Icon(Icons.download, size: 16),
                  label: const Text('Last 90 days'),
                  onPressed: () => _export(context, ref, 90),
                ),
                OutlinedButton.icon(
                  icon: const Icon(Icons.download, size: 16),
                  label: const Text('All time'),
                  onPressed: () => _export(context, ref, null),
                ),
                if (range != null)
                  OutlinedButton.icon(
                    icon: const Icon(Icons.event_note, size: 16),
                    label: const Text('Current range'),
                    onPressed: () => _export(context, ref, null, range: range),
                  ),
                OutlinedButton.icon(
                  icon: const Icon(Icons.file_download_outlined, size: 16),
                  label: const Text('Download template'),
                  onPressed: () async {
                    final path =
                        await saveTextFile('pocket-import-template.csv', _template);
                    if (!context.mounted) return;
                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                        content: Text(path == null
                            ? 'Template downloaded'
                            : 'Template saved to $path')));
                  },
                ),
                FilledButton.tonalIcon(
                  icon: const Icon(Icons.upload, size: 16),
                  label: const Text('Import CSV'),
                  onPressed: () => _import(context, ref),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// AI receipt scanner key — device-local, never synced (legacy behavior).
class _GeminiCard extends ConsumerStatefulWidget {
  const _GeminiCard();

  @override
  ConsumerState<_GeminiCard> createState() => _GeminiCardState();
}

class _GeminiCardState extends ConsumerState<_GeminiCard> {
  final _key = TextEditingController();
  bool _obscure = true;
  bool _loaded = false;

  @override
  void dispose() {
    _key.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final hint = Theme.of(context).hintColor;
    final store = ref.watch(geminiKeyStoreProvider).valueOrNull;
    if (store != null && !_loaded) {
      _loaded = true;
      _key.text = store.key;
    }
    final saved = store?.hasKey ?? false;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: const Color(0xFF4285F4).withValues(alpha: 0.13),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.document_scanner_outlined,
                      size: 18, color: Color(0xFF4285F4)),
                ),
                const SizedBox(width: 10),
                const Expanded(
                  child: Text('AI Receipt Scanner',
                      style: TextStyle(fontWeight: FontWeight.w600)),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              'Powered by Gemini (Google AI). Get a free key at aistudio.google.com/apikey. '
              'Reads the receipt, maps line items to your categories, and pre-fills splits. '
              'The key is stored only on this device.',
              style: TextStyle(fontSize: 12, color: hint),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _key,
                    obscureText: _obscure,
                    decoration: InputDecoration(
                      labelText: 'Gemini API key',
                      hintText: 'AIzaSy...',
                      suffixIcon: IconButton(
                        icon: Icon(_obscure
                            ? Icons.visibility_outlined
                            : Icons.visibility_off_outlined),
                        onPressed: () =>
                            setState(() => _obscure = !_obscure),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  onPressed: store == null
                      ? null
                      : () async {
                          await store.save(_key.text);
                          if (!context.mounted) return;
                          setState(() {});
                          ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('Key saved.')));
                        },
                  child: const Text('Save'),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              saved
                  ? 'Key saved — receipt scanning is enabled (Add transaction → Scan receipt).'
                  : 'No key saved yet. Paste a key and press Save.',
              style: TextStyle(
                  fontSize: 12,
                  color: saved ? const Color(0xFF10B981) : hint),
            ),
          ],
        ),
      ),
    );
  }
}

/// Cloud sync / account section.
class _AccountCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final hint = Theme.of(context).hintColor;
    final email = syncConfigured
        ? Supabase.instance.client.auth.currentUser?.email
        : null;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: const Color(0xFF10B981).withValues(alpha: 0.13),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.cloud_outlined,
                      size: 18, color: Color(0xFF10B981)),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Cloud Sync & Multi-device',
                          style: TextStyle(fontWeight: FontWeight.w600)),
                      Text(
                        syncConfigured
                            ? 'All your devices stay in sync.'
                            : 'Running in offline sample mode — cloud keys not configured.',
                        style: TextStyle(fontSize: 12, color: hint),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            if (email != null) ...[
              const SizedBox(height: 12),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: const Color(0xFF10B981).withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                      color: const Color(0xFF10B981).withValues(alpha: 0.3)),
                ),
                child: Row(
                  children: [
                    CircleAvatar(
                      radius: 16,
                      backgroundColor: const Color(0xFF10B981),
                      child: Text(
                        (email.isNotEmpty ? email[0] : '?').toUpperCase(),
                        style: const TextStyle(
                            color: Colors.white, fontWeight: FontWeight.bold),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('SIGNED IN AS',
                              style: TextStyle(fontSize: 10, color: hint)),
                          Text(email,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  fontWeight: FontWeight.w500)),
                        ],
                      ),
                    ),
                    const Icon(Icons.verified_outlined,
                        size: 18, color: Color(0xFF10B981)),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  icon: const Icon(Icons.logout, size: 16),
                  label: const Text('Sign out'),
                  onPressed: () => Supabase.instance.client.auth.signOut(),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
