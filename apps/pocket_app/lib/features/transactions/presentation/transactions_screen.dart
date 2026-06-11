import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';

import '../../../core/format.dart';
import '../../../core/icon_pill.dart';
import '../../dashboard/application/dashboard_providers.dart';
import '../../settings/application/settings_controller.dart';
import 'add_transaction_dialog.dart';

class TransactionsScreen extends ConsumerWidget {
  const TransactionsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fx = ref.watch(fxProvider);
    final txs = ref.watch(transactionsProvider).valueOrNull ?? const [];
    final accounts = ref.watch(accountsProvider).valueOrNull ?? const [];
    final cats = ref.watch(categoriesProvider).valueOrNull ?? const [];
    final dates = ref.watch(dateFormatProvider);

    final accountById = {for (final a in accounts) a.id: a};
    final catById = {for (final c in cats) c.id: c};

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
            if (txs.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child:
                    Center(child: Text('No transactions yet. Tap + to add one.')),
              )
            else
              for (final t in txs)
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
        trailing: Text(
          '${outgoing ? '−' : '+'}${formatMoney(fx, t.amount, t.currency)}',
          style: TextStyle(fontWeight: FontWeight.w600, color: amountColor),
        ),
      ),
    );
  }
}
