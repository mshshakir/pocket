import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';

import '../../../core/date_format_service.dart';
import '../../../core/format.dart';
import '../../../core/icon_pill.dart';
import '../../dashboard/application/dashboard_providers.dart';
import '../../settings/application/settings_controller.dart';
import '../application/transaction_filters.dart';
import 'add_transaction_dialog.dart';

class TransactionsScreen extends ConsumerStatefulWidget {
  const TransactionsScreen({super.key});

  @override
  ConsumerState<TransactionsScreen> createState() => _TransactionsScreenState();
}

class _TransactionsScreenState extends ConsumerState<TransactionsScreen> {
  final _search = TextEditingController();
  TxType? _typeFilter;
  String? _accountFilter;

  // The date range lives in [transactionsDateRangeProvider] so CSV export can
  // reuse it (audit A1-6).
  DateTimeRange? get _range => ref.read(transactionsDateRangeProvider);
  set _range(DateTimeRange? v) =>
      ref.read(transactionsDateRangeProvider.notifier).state = v;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  bool get _hasFilters =>
      _search.text.trim().isNotEmpty ||
      _typeFilter != null ||
      _accountFilter != null ||
      _range != null;

  void _clearFilters() => setState(() {
        _search.clear();
        _typeFilter = null;
        _accountFilter = null;
        _range = null;
      });

  bool _matches(
    LedgerTransaction t,
    Map<String, CategoryNode> catById,
    Map<String, LedgerAccount> accountById,
    DateTimeRange? range,
  ) {
    if (_typeFilter != null && t.type != _typeFilter) return false;
    if (_accountFilter != null &&
        !LedgerMath.contributions(t)
            .any((c) => c.accountId == _accountFilter)) {
      return false;
    }
    if (range != null) {
      final d = t.date;
      if (d == null) return false;
      final start =
          DateTime(range.start.year, range.start.month, range.start.day);
      final end = DateTime(range.end.year, range.end.month, range.end.day);
      if (d.isBefore(start) || d.isAfter(end)) return false;
    }
    final q = _search.text.trim().toLowerCase();
    if (q.isNotEmpty) {
      final cat = t.categoryId == null ? null : catById[t.categoryId];
      final haystack = [
        t.payee,
        t.note,
        cat?.name ?? '',
        accountById[t.accountId]?.name ?? '',
      ].join(' ').toLowerCase();
      if (!haystack.contains(q)) return false;
    }
    return true;
  }

  Future<void> _pickRange() async {
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
      initialDateRange: _range,
    );
    if (picked != null) setState(() => _range = picked);
  }

  @override
  Widget build(BuildContext context) {
    final fx = ref.watch(fxProvider);
    final all = ref.watch(transactionsProvider).valueOrNull ?? const [];
    final accounts = ref.watch(accountsProvider).valueOrNull ?? const [];
    final cats = ref.watch(categoriesProvider).valueOrNull ?? const [];
    final dates = ref.watch(dateFormatProvider);
    final range = ref.watch(transactionsDateRangeProvider);

    final accountById = {for (final a in accounts) a.id: a};
    final catById = {for (final c in cats) c.id: c};

    final filtered = [
      for (final t in all)
        if (_matches(t, catById, accountById, range)) t,
    ]..sort((a, b) =>
        (b.date ?? DateTime(1970)).compareTo(a.date ?? DateTime(1970)));

    return Scaffold(
      floatingActionButton: FloatingActionButton(
        onPressed: () => showAddTransactionDialog(context),
        child: const Icon(Icons.add),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Transactions',
                style: Theme.of(context)
                    .textTheme
                    .headlineMedium
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            TextField(
              controller: _search,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                isDense: true,
                prefixIcon: const Icon(Icons.search, size: 20),
                hintText: 'Search payee, note, category…',
                border: const OutlineInputBorder(),
                suffixIcon: _search.text.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.close, size: 18),
                        onPressed: () => setState(() => _search.clear()),
                      ),
              ),
            ),
            const SizedBox(height: 10),
            _FilterBar(
              type: _typeFilter,
              accountId: _accountFilter,
              range: range,
              accounts: accounts,
              dates: dates,
              onType: (v) => setState(() => _typeFilter = v),
              onAccount: (v) => setState(() => _accountFilter = v),
              onRange: _pickRange,
              onClearRange: () => setState(() => _range = null),
            ),
            if (_hasFilters)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  icon: const Icon(Icons.filter_alt_off_outlined, size: 16),
                  label: Text('Clear filters · ${filtered.length} shown'),
                  onPressed: _clearFilters,
                ),
              ),
            const SizedBox(height: 4),
            if (all.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child: Center(
                    child: Text('No transactions yet. Tap + to add one.')),
              )
            else if (filtered.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child:
                    Center(child: Text('No transactions match your filters.')),
              )
            else
              for (final t in filtered)
                TransactionRow(
                  transaction: t,
                  account: accountById[t.accountId],
                  category:
                      t.categoryId == null ? null : catById[t.categoryId],
                  fx: fx,
                  dateText: t.date == null ? '' : dates.format(t.date!),
                  onTap: () => showTransactionDialog(context, existing: t),
                ),
          ],
        ),
      ),
    );
  }
}

/// The type / account / date-range controls under the search box.
class _FilterBar extends StatelessWidget {
  final TxType? type;
  final String? accountId;
  final DateTimeRange? range;
  final List<LedgerAccount> accounts;
  final DateFormatService dates;
  final ValueChanged<TxType?> onType;
  final ValueChanged<String?> onAccount;
  final VoidCallback onRange;
  final VoidCallback onClearRange;

  const _FilterBar({
    required this.type,
    required this.accountId,
    required this.range,
    required this.accounts,
    required this.dates,
    required this.onType,
    required this.onAccount,
    required this.onRange,
    required this.onClearRange,
  });

  @override
  Widget build(BuildContext context) {
    final accountIds = {for (final a in accounts) a.id};
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        DropdownButton<TxType?>(
          value: type,
          hint: const Text('All types'),
          underline: const SizedBox.shrink(),
          items: const [
            DropdownMenuItem(value: null, child: Text('All types')),
            DropdownMenuItem(value: TxType.expense, child: Text('Expense')),
            DropdownMenuItem(value: TxType.income, child: Text('Income')),
            DropdownMenuItem(value: TxType.transfer, child: Text('Transfer')),
          ],
          onChanged: onType,
        ),
        DropdownButton<String?>(
          value: accountIds.contains(accountId) ? accountId : null,
          hint: const Text('All accounts'),
          underline: const SizedBox.shrink(),
          items: [
            const DropdownMenuItem(value: null, child: Text('All accounts')),
            for (final a in accounts)
              DropdownMenuItem(
                value: a.id,
                child: Text(a.name.isEmpty ? 'Account' : a.name),
              ),
          ],
          onChanged: onAccount,
        ),
        ActionChip(
          avatar: const Icon(Icons.date_range, size: 16),
          label: Text(range == null
              ? 'Date range'
              : '${dates.format(range!.start)} – ${dates.format(range!.end)}'),
          onPressed: onRange,
        ),
        if (range != null)
          IconButton(
            tooltip: 'Clear date range',
            icon: const Icon(Icons.close, size: 16),
            onPressed: onClearRange,
          ),
      ],
    );
  }
}

/// One transaction row in the legacy icon-pill style: category pill (or a
/// type pill for transfers/debt payments), payee + category · account · date,
/// signed colored amount.
class TransactionRow extends StatelessWidget {
  final LedgerTransaction transaction;
  final LedgerAccount? account;
  final CategoryNode? category;
  final CurrencyService fx;
  final String dateText;
  final VoidCallback? onTap;

  const TransactionRow({
    super.key,
    required this.transaction,
    required this.account,
    required this.category,
    required this.fx,
    required this.dateText,
    this.onTap,
  });

  static const _expenseColor = Color(0xFFEF4444);
  static const _incomeColor = Color(0xFF10B981);

  @override
  Widget build(BuildContext context) {
    final t = transaction;
    final hint = Theme.of(context).hintColor;
    final isTransfer = t.type == TxType.transfer;
    final isDebt = t.debtId != null;

    // Pill: category icon/color when available; otherwise type-based.
    final String? pillIcon;
    final String? pillColor;
    if (isTransfer) {
      pillIcon = 'arrow-left-right';
      pillColor = '#0ea5e9';
    } else if (isDebt) {
      pillIcon = 'hand-coins';
      pillColor = t.type == TxType.expense ? '#ef4444' : '#10b981';
    } else if (category != null) {
      pillIcon = category!.icon ?? 'tag';
      pillColor = category!.color ?? '#3b82f6';
    } else {
      pillIcon = t.type == TxType.income ? 'banknote' : 'tag';
      pillColor = t.type == TxType.income ? '#10b981' : '#71717a';
    }

    final title = t.payee.isNotEmpty
        ? t.payee
        : isTransfer
            ? 'Transfer'
            : (category?.name ?? t.type.name);

    final subtitleParts = <String>[
      if (!isTransfer && category != null) category!.name,
      if (account != null && account!.name.isNotEmpty) account!.name,
      if (dateText.isNotEmpty) dateText,
    ];

    final outgoing = t.type == TxType.expense ||
        (isTransfer && t.transferDir == TransferDir.outbound);
    final amountColor = isTransfer
        ? hint
        : t.type == TxType.expense
            ? _expenseColor
            : _incomeColor;

    return Card(
      child: ListTile(
        onTap: onTap,
        leading:
            IconPill(iconName: pillIcon, colorHex: pillColor, size: 38),
        title: Text(title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w500)),
        subtitle: Text(subtitleParts.join(' · '),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 12, color: hint)),
        trailing: Column(
          mainAxisSize: MainAxisSize.min,
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              '${outgoing ? '−' : '+'}${formatMoney(fx, t.amount, t.currency)}',
              style: TextStyle(fontWeight: FontWeight.w600, color: amountColor),
            ),
            if (t.recordState == 'pending')
              const Text('Pending',
                  style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: Color(0xFFF59E0B))),
          ],
        ),
      ),
    );
  }
}
