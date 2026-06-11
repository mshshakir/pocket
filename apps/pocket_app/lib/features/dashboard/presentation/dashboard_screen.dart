import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:pocket_domain/domain.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../../core/format.dart';
import '../../../core/theme.dart';
import '../../../sync/sync_config.dart';
import '../../settings/application/settings_controller.dart';
import '../../transactions/presentation/add_transaction_dialog.dart';
import '../application/dashboard_providers.dart';

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fx = ref.watch(fxProvider);
    final home = ref.watch(homeCurrencyProvider);
    final accounts = ref.watch(accountsProvider).valueOrNull ?? const [];
    final txs = ref.watch(transactionsProvider).valueOrNull ?? const [];
    final netWorth = ref.watch(netWorthProvider);
    final now = DateTime.now();
    const hijri = HijriCalendar();
    final settings =
        ref.watch(settingsProvider).valueOrNull ?? const UserSettings();
    final hijriToday = hijri.toHijri(now, offset: settings.hijriOffset);

    var income = 0, expense = 0;
    for (final t in txs) {
      final d = t.date;
      if (d == null || d.year != now.year || d.month != now.month) continue;
      final inHome = fx.convert(t.amount, t.currency, home);
      if (t.type == TxType.income) {
        income += inHome;
      } else if (t.type == TxType.expense) {
        expense += inHome;
      }
    }
    final recent = [...txs]
      ..sort((a, b) => (b.date ?? DateTime(0)).compareTo(a.date ?? DateTime(0)));

    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // ── header ──────────────────────────────────────────────
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('OVERVIEW',
                          style: Theme.of(context)
                              .textTheme
                              .labelSmall
                              ?.copyWith(letterSpacing: 1.4, color: Theme.of(context).hintColor)),
                      Text('Dashboard',
                          style: Theme.of(context)
                              .textTheme
                              .headlineMedium
                              ?.copyWith(fontWeight: FontWeight.bold)),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'Toggle theme',
                  icon: const Icon(Icons.brightness_6_outlined),
                  onPressed: () => ref.read(settingsControllerProvider).toggleTheme(
                      isDarkNow:
                          Theme.of(context).brightness == Brightness.dark),
                ),
                if (syncConfigured)
                  IconButton(
                    tooltip: 'Sign out',
                    icon: const Icon(Icons.logout),
                    onPressed: () => Supabase.instance.client.auth.signOut(),
                  ),
                const SizedBox(width: 4),
                FilledButton.icon(
                  onPressed: () => showAddTransactionDialog(context),
                  icon: const Icon(Icons.add),
                  label: const Text('New transaction'),
                ),
              ],
            ),
            const SizedBox(height: 16),

            // ── Today (Hijri, honoring the user's offset) ───────────
            if (settings.showHijri) ...[
              Card(
                child: ListTile(
                  leading: CircleAvatar(
                    backgroundColor: PocketTheme.seed.withValues(alpha: 0.15),
                    foregroundColor: PocketTheme.seed,
                    child: const Icon(Icons.nightlight_round),
                  ),
                  title: Text(
                    '${hijri.format(hijriToday, long: true, withYear: false)} '
                    '${hijriToday.year} H',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  subtitle: Text(DateFormat('EEEE, MMMM d, y').format(now)),
                ),
              ),
              const SizedBox(height: 8),
            ],

            // ── stat cards ──────────────────────────────────────────
            _StatGrid(cards: [
              _StatCard(
                  label: 'Total balance',
                  value: formatMoney(fx, netWorth, home),
                  sub: '${accounts.length} accounts · $home'),
              _StatCard(
                  label: 'Income this month',
                  value: formatMoney(fx, income, home),
                  valueColor: Colors.green.shade600),
              _StatCard(
                  label: 'Expenses this month',
                  value: formatMoney(fx, expense, home),
                  valueColor: Colors.red.shade400),
            ]),
            const SizedBox(height: 8),

            // ── recent transactions ─────────────────────────────────
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Recent transactions',
                        style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 4),
                    if (recent.isEmpty)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 16),
                        child: Text('No transactions yet. Tap “New transaction”.'),
                      ),
                    for (final t in recent.take(6))
                      _TxRow(
                          tx: t,
                          fx: fx,
                          accounts: accounts,
                          hijri: hijri,
                          dateText: t.date == null
                              ? ''
                              : ref.watch(dateFormatProvider).format(t.date!),
                          showHijri: settings.showHijri),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Responsive 1/3-column grid of stat cards.
class _StatGrid extends StatelessWidget {
  final List<Widget> cards;
  const _StatGrid({required this.cards});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, c) {
        if (c.maxWidth >= 720) {
          return IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var i = 0; i < cards.length; i++) ...[
                  if (i > 0) const SizedBox(width: 8),
                  Expanded(child: cards[i]),
                ],
              ],
            ),
          );
        }
        return Column(children: cards);
      },
    );
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final String? sub;
  final Color? valueColor;
  const _StatCard(
      {required this.label, required this.value, this.sub, this.valueColor});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label,
                style: Theme.of(context)
                    .textTheme
                    .labelMedium
                    ?.copyWith(color: Theme.of(context).hintColor)),
            const SizedBox(height: 6),
            Text(value,
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.bold, color: valueColor)),
            if (sub != null) ...[
              const SizedBox(height: 4),
              Text(sub!,
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: Theme.of(context).hintColor)),
            ],
          ],
        ),
      ),
    );
  }
}

class _TxRow extends StatelessWidget {
  final LedgerTransaction tx;
  final CurrencyService fx;
  final List<LedgerAccount> accounts;
  final HijriCalendar hijri;
  final String dateText;
  final bool showHijri;
  const _TxRow(
      {required this.tx,
      required this.fx,
      required this.accounts,
      required this.hijri,
      this.dateText = '',
      this.showHijri = true});

  @override
  Widget build(BuildContext context) {
    final isExpense = tx.type == TxType.expense;
    String accName = '';
    for (final a in accounts) {
      if (a.id == tx.accountId) accName = a.name;
    }
    // Prefer the immutable Hijri snapshot taken at write time; only fall back
    // to recomputing for legacy rows without one.
    final hijriLabel = !showHijri
        ? ''
        : tx.hijriDate != null
            ? hijri.format(tx.hijriDate!, withYear: false)
            : tx.date == null
                ? ''
                : hijri.format(hijri.toHijri(tx.date!), withYear: false);
    final sub = [accName, dateText, hijriLabel]
        .where((s) => s.isNotEmpty)
        .join(' · ');

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: PocketTheme.seed.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Icon(isExpense ? Icons.sell_outlined : Icons.south_west,
            color: PocketTheme.seed, size: 20),
      ),
      title: Text(tx.payee.isEmpty ? tx.type.name : tx.payee,
          style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: sub.isEmpty ? null : Text(sub),
      trailing: Text(
        '${isExpense ? '-' : '+'}${formatMoney(fx, tx.amount, tx.currency)}',
        style: TextStyle(
          fontWeight: FontWeight.w600,
          color: isExpense ? Colors.red.shade400 : Colors.green.shade600,
        ),
      ),
    );
  }
}
