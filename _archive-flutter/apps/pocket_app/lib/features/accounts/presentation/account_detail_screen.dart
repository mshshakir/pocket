import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';

import '../../../core/format.dart';
import '../../../core/icon_pill.dart';
import '../../dashboard/application/dashboard_providers.dart';
import '../../family/presentation/family_screen.dart' show AccessLevelStyle;
import '../../settings/application/settings_controller.dart';
import '../../transactions/presentation/add_transaction_dialog.dart';
import '../../transactions/presentation/transactions_screen.dart' show TransactionRow;
import 'add_account_dialog.dart';
import 'reconcile_dialog.dart';

/// Pushes the account drill-down. [inbound] is supplied when navigating from a
/// "shared with me" account so the page can render even when the account row
/// is owned by someone else (and may not exist in the local account list).
Future<void> showAccountDetail(
  BuildContext context, {
  required String accountId,
  InboundShare? inbound,
}) =>
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => AccountDetailScreen(accountId: accountId, inbound: inbound),
    ));

/// One account in focus: balance header, share state, and the ledger filtered
/// to just this account (its own postings plus any transfer/split legs that
/// touch it). Mirrors legacy `AccountDetailView`, including the inbound-share
/// variant that gives "shared with me" accounts a real destination.
class AccountDetailScreen extends ConsumerWidget {
  final String accountId;
  final InboundShare? inbound;
  const AccountDetailScreen({super.key, required this.accountId, this.inbound});

  bool get _isInbound => inbound != null;

  /// View-only inbound shares can read but not write; owned accounts and
  /// edit/full inbound shares can add transactions.
  bool get _canWrite => !_isInbound || inbound!.access != ShareAccess.view;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fx = ref.watch(fxProvider);
    final accounts = ref.watch(accountsProvider).valueOrNull ?? const [];
    final txs = ref.watch(transactionsProvider).valueOrNull ?? const [];
    final cats = ref.watch(categoriesProvider).valueOrNull ?? const [];
    final dates = ref.watch(dateFormatProvider);
    final outbound = ref.watch(outboundSharesProvider).valueOrNull ?? const [];
    final balances = ref.watch(balancesProvider);

    LedgerAccount? local;
    for (final a in accounts) {
      if (a.id == accountId) {
        local = a;
        break;
      }
    }

    // Real account when we have it; otherwise a transient stand-in built from
    // the inbound share so the header/ledger still render.
    final account = local ??
        (inbound != null
            ? LedgerAccount(
                id: inbound!.accountId,
                currency: inbound!.currency,
                name: inbound!.accountName,
              )
            : null);

    if (account == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Account')),
        body: const Center(child: Text('This account is no longer available.')),
      );
    }

    final catById = {for (final c in cats) c.id: c};
    final accountById = {for (final a in accounts) a.id: a};

    // Ledger filtered to this account via the same contribution logic the
    // balance engine uses (so transfer legs and split rows are included).
    final ledger = [
      for (final t in txs)
        if (LedgerMath.contributions(t).any((c) => c.accountId == accountId)) t,
    ]..sort((a, b) =>
        (b.date ?? DateTime(1970)).compareTo(a.date ?? DateTime(1970)));

    // Balance: prefer the shared engine; fall back to a local recompute for
    // inbound accounts not present in [balancesProvider].
    final balance = balances[accountId] ??
        () {
          var b = account.openingBalance;
          for (final t in ledger) {
            b += LedgerMath.accountDelta(t, account, fx);
          }
          return b;
        }();

    final sharedWith = [
      for (final s in outbound)
        if (s.accountId == accountId) s,
    ];

    return Scaffold(
      appBar: AppBar(
        title: Text(account.name.isEmpty ? 'Account' : account.name),
        actions: [
          if (local != null) ...[
            IconButton(
              tooltip: 'Reconcile balance',
              icon: const Icon(Icons.balance),
              onPressed: () => showReconcileDialog(context, local!),
            ),
            IconButton(
              tooltip: 'Edit account',
              icon: const Icon(Icons.edit_outlined),
              onPressed: () => showAccountDialog(context, existing: local!),
            ),
          ],
        ],
      ),
      floatingActionButton: _canWrite
          ? FloatingActionButton(
              onPressed: () => showAddTransactionDialog(context),
              child: const Icon(Icons.add),
            )
          : null,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _BalanceHeader(
              account: account,
              balance: balance,
              fx: fx,
              sharedWith: sharedWith,
              inbound: inbound,
            ),
            const SizedBox(height: 16),
            Text('TRANSACTIONS',
                style: TextStyle(
                    fontSize: 11,
                    letterSpacing: 1.2,
                    color: Theme.of(context).hintColor)),
            const SizedBox(height: 8),
            if (ledger.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child: Center(child: Text('No transactions for this account yet.')),
              )
            else
              for (final t in ledger)
                TransactionRow(
                  transaction: t,
                  account: accountById[t.accountId] ?? account,
                  category: t.categoryId == null ? null : catById[t.categoryId],
                  fx: fx,
                  dateText: t.date == null ? '' : dates.format(t.date!),
                  onTap: _canWrite
                      ? () => showTransactionDialog(context, existing: t)
                      : null,
                ),
          ],
        ),
      ),
    );
  }
}

/// The balance card at the top of the detail page: icon, currency, big signed
/// balance, archived state, and share badges (outbound + inbound).
class _BalanceHeader extends StatelessWidget {
  final LedgerAccount account;
  final int balance;
  final CurrencyService fx;
  final List<AccountShare> sharedWith;
  final InboundShare? inbound;

  const _BalanceHeader({
    required this.account,
    required this.balance,
    required this.fx,
    required this.sharedWith,
    required this.inbound,
  });

  @override
  Widget build(BuildContext context) {
    final hint = Theme.of(context).hintColor;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                IconPill(
                  iconName: account.icon ?? 'wallet',
                  colorHex: account.color ?? '#0ea5e9',
                  size: 44,
                  fallbackIcon: Icons.account_balance_wallet_outlined,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(account.name.isEmpty ? 'Account' : account.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontWeight: FontWeight.w600, fontSize: 16)),
                      Text(account.currency,
                          style: TextStyle(fontSize: 12, color: hint)),
                    ],
                  ),
                ),
                if (account.archived)
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: hint.withValues(alpha: 0.13),
                      borderRadius: BorderRadius.circular(99),
                    ),
                    child: Text('Archived',
                        style: TextStyle(fontSize: 11, color: hint)),
                  ),
              ],
            ),
            const SizedBox(height: 14),
            Text('Current balance',
                style: TextStyle(fontSize: 12, color: hint)),
            Text(
              formatMoney(fx, balance, account.currency),
              style: TextStyle(
                fontSize: 28,
                fontWeight: FontWeight.bold,
                color: balance < 0 ? const Color(0xFFEF4444) : null,
              ),
            ),
            if (inbound != null) ...[
              const SizedBox(height: 10),
              _shareChip(
                inbound!.access,
                'Shared by ${inbound!.ownerEmail}',
              ),
            ],
            if (sharedWith.isNotEmpty) ...[
              const SizedBox(height: 10),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final s in sharedWith)
                    _shareChip(s.access, s.memberEmail),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _shareChip(ShareAccess access, String label) {
    final (_, icon, color) = AccessLevelStyle.of(access);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: color),
          const SizedBox(width: 4),
          Text(label, style: TextStyle(fontSize: 11, color: color)),
        ],
      ),
    );
  }
}
