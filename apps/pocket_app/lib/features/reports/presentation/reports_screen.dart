import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';

import '../../../core/format.dart';
import '../../dashboard/application/dashboard_providers.dart';

const _palette = [
  Color(0xFF0EA5E9), Color(0xFF22C55E), Color(0xFFF59E0B), Color(0xFFA855F7),
  Color(0xFFEF4444), Color(0xFF14B8A6), Color(0xFFEC4899), Color(0xFF6366F1),
  Color(0xFF84CC16), Color(0xFF06B6D4),
];

/// Date ranges offered by the Reports filter.
enum ReportRange { thisMonth, lastMonth, threeMonths, year, all }

extension ReportRangeX on ReportRange {
  String get label => switch (this) {
        ReportRange.thisMonth => 'This month',
        ReportRange.lastMonth => 'Last month',
        ReportRange.threeMonths => '3 months',
        ReportRange.year => 'This year',
        ReportRange.all => 'All time',
      };

  /// Inclusive start / exclusive end; null = unbounded.
  (DateTime?, DateTime?) bounds(DateTime now) => switch (this) {
        ReportRange.thisMonth => (
            DateTime(now.year, now.month, 1),
            DateTime(now.year, now.month + 1, 1)
          ),
        ReportRange.lastMonth => (
            DateTime(now.year, now.month - 1, 1),
            DateTime(now.year, now.month, 1)
          ),
        ReportRange.threeMonths => (
            DateTime(now.year, now.month - 2, 1),
            DateTime(now.year, now.month + 1, 1)
          ),
        ReportRange.year => (
            DateTime(now.year, 1, 1),
            DateTime(now.year + 1, 1, 1)
          ),
        ReportRange.all => (null, null),
      };
}

final reportRangeProvider =
    StateProvider<ReportRange>((ref) => ReportRange.thisMonth);

class ReportsScreen extends ConsumerWidget {
  const ReportsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fx = ref.watch(fxProvider);
    final home = ref.watch(homeCurrencyProvider);
    final txs = ref.watch(transactionsProvider).valueOrNull ?? const [];
    final cats = ref.watch(categoriesProvider).valueOrNull ?? const [];
    final range = ref.watch(reportRangeProvider);
    final tree = CategoryTree(cats);
    final now = DateTime.now();
    final (start, end) = range.bounds(now);

    bool inRange(DateTime? d) {
      if (d == null) return false;
      if (start != null && d.isBefore(start)) return false;
      if (end != null && !d.isBefore(end)) return false;
      return true;
    }

    // Spend per category + overall income/expense, in the home currency.
    final totals = <String, int>{};
    var income = 0, expense = 0;
    for (final t in txs) {
      if (!inRange(t.date)) continue;
      if (t.type == TxType.income) {
        income += fx.convert(t.amount, t.currency, home);
        continue;
      }
      if (t.type != TxType.expense) continue;
      expense += fx.convert(t.amount, t.currency, home);
      final slices = (t.splits != null && t.splits!.isNotEmpty)
          ? [for (final s in t.splits!) (cat: s.categoryId, amt: s.amount)]
          : [(cat: t.categoryId, amt: t.amount)];
      for (final s in slices) {
        final v = fx.convert(s.amt, t.currency, home);
        totals.update(s.cat ?? '', (p) => p + v, ifAbsent: () => v);
      }
    }

    final entries = totals.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    final grand = entries.fold<int>(0, (s, e) => s + e.value);
    final hint = Theme.of(context).hintColor;

    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Reports',
                style: Theme.of(context)
                    .textTheme
                    .headlineMedium
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            Text('Spending by category · ${range.label.toLowerCase()}',
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: hint)),
            const SizedBox(height: 12),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final r in ReportRange.values)
                    Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: ChoiceChip(
                        label: Text(r.label),
                        selected: range == r,
                        onSelected: (_) =>
                            ref.read(reportRangeProvider.notifier).state = r,
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            // income / expense summary for the range
            Row(
              children: [
                Expanded(
                  child: _MiniStat(
                      label: 'Income',
                      value: formatMoney(fx, income, home),
                      color: const Color(0xFF10B981)),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _MiniStat(
                      label: 'Expenses',
                      value: formatMoney(fx, expense, home),
                      color: const Color(0xFFEF4444)),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _MiniStat(
                      label: 'Net',
                      value: formatMoney(fx, income - expense, home),
                      color: income - expense >= 0
                          ? const Color(0xFF10B981)
                          : const Color(0xFFEF4444)),
                ),
              ],
            ),
            const SizedBox(height: 16),
            if (entries.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 40),
                child: Center(
                    child:
                        Text('No spending in ${range.label.toLowerCase()}.')),
              )
            else ...[
              SizedBox(
                height: 220,
                child: PieChart(
                  PieChartData(
                    sectionsSpace: 2,
                    centerSpaceRadius: 48,
                    sections: [
                      for (var i = 0; i < entries.length; i++)
                        PieChartSectionData(
                          value: entries[i].value.toDouble(),
                          color: _palette[i % _palette.length],
                          radius: 56,
                          title: grand == 0
                              ? ''
                              : '${(entries[i].value / grand * 100).round()}%',
                          titleStyle: const TextStyle(
                              color: Colors.white,
                              fontSize: 11,
                              fontWeight: FontWeight.bold),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Card(
                child: Column(
                  children: [
                    for (var i = 0; i < entries.length; i++)
                      ListTile(
                        leading: CircleAvatar(
                            radius: 8,
                            backgroundColor: _palette[i % _palette.length]),
                        title: Text(
                            tree.find(entries[i].key)?.name ?? 'Uncategorised'),
                        subtitle: grand == 0
                            ? null
                            : Text(
                                '${(entries[i].value / grand * 100).toStringAsFixed(1)}%',
                                style:
                                    TextStyle(fontSize: 12, color: hint)),
                        trailing: Text(formatMoney(fx, entries[i].value, home),
                            style:
                                const TextStyle(fontWeight: FontWeight.w600)),
                      ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _MiniStat extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  const _MiniStat(
      {required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label,
                style: TextStyle(
                    fontSize: 11, color: Theme.of(context).hintColor)),
            const SizedBox(height: 2),
            FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(value,
                  style: TextStyle(
                      fontWeight: FontWeight.w700, color: color)),
            ),
          ],
        ),
      ),
    );
  }
}
