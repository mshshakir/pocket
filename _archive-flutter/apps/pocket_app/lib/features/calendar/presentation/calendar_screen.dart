import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';

import '../../../core/format.dart';
import '../../../core/icon_pill.dart';
import '../../dashboard/application/dashboard_providers.dart';
import '../../regular/application/regular_item_controller.dart';
import '../../transactions/presentation/add_transaction_dialog.dart';
import '../application/miqaats_provider.dart';

/// Calendar — port of legacy `CalendarView`'s month grid: Gregorian/Hijri
/// day labels (per the calendarMode setting), per-day spend, miqaat markers,
/// and a day sheet (port of `DayLogsModal`) with the day's transactions and
/// one-tap quick-log of regular items onto that date.
class CalendarScreen extends ConsumerStatefulWidget {
  const CalendarScreen({super.key});

  @override
  ConsumerState<CalendarScreen> createState() => _CalendarScreenState();
}

class _CalendarScreenState extends ConsumerState<CalendarScreen> {
  late DateTime _month; // first day of the visible month

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _month = DateTime(now.year, now.month, 1);
  }

  void _shift(int months) =>
      setState(() => _month = DateTime(_month.year, _month.month + months, 1));

  @override
  Widget build(BuildContext context) {
    final fx = ref.watch(fxProvider);
    final home = ref.watch(homeCurrencyProvider);
    final settings =
        ref.watch(settingsProvider).valueOrNull ?? const UserSettings();
    final hijri = ref.watch(hijriCalendarProvider);
    final txs = ref.watch(transactionsProvider).valueOrNull ?? const [];
    final hint = Theme.of(context).hintColor;

    final showHijri = settings.showHijri && settings.calendarMode != 'gregorian';
    final hijriPrimary = settings.showHijri && settings.calendarMode == 'hijri';

    // Spend per day of the visible month (frozen snapshots, audit B1).
    final spend = <int, int>{};
    final txCount = <int, int>{};
    for (final t in txs) {
      final d = t.date;
      if (d == null || d.year != _month.year || d.month != _month.month) {
        continue;
      }
      txCount[d.day] = (txCount[d.day] ?? 0) + 1;
      if (t.type == TxType.expense) {
        spend[d.day] =
            (spend[d.day] ?? 0) + LedgerMath.homeAmount(t, fx, home);
      }
    }

    final daysInMonth = DateTime(_month.year, _month.month + 1, 0).day;
    final leading = _month.weekday % 7; // Sunday-first offset
    final today = DateTime.now();

    final monthLabel =
        '${_gregMonths[_month.month - 1]} ${_month.year}';
    String hijriRange = '';
    if (showHijri) {
      final first =
          hijri.toHijri(_month, offset: settings.hijriOffset);
      final last = hijri.toHijri(
          DateTime(_month.year, _month.month, daysInMonth),
          offset: settings.hijriOffset);
      hijriRange = first.month == last.month
          ? '${HijriCalendar.monthsLong[first.month]} ${first.year}H'
          : '${HijriCalendar.monthsShort[first.month]} – '
              '${HijriCalendar.monthsShort[last.month]} ${last.year}H';
    }

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(monthLabel,
                            style: Theme.of(context)
                                .textTheme
                                .headlineSmall
                                ?.copyWith(fontWeight: FontWeight.bold)),
                        if (hijriRange.isNotEmpty)
                          Text(hijriRange,
                              style:
                                  TextStyle(fontSize: 13, color: hint)),
                      ],
                    ),
                  ),
                  IconButton(
                      onPressed: () => _shift(-1),
                      icon: const Icon(Icons.chevron_left)),
                  TextButton(
                      onPressed: () => setState(() =>
                          _month = DateTime(today.year, today.month, 1)),
                      child: const Text('Today')),
                  IconButton(
                      onPressed: () => _shift(1),
                      icon: const Icon(Icons.chevron_right)),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Row(
                children: [
                  for (final d in const ['S', 'M', 'T', 'W', 'T', 'F', 'S'])
                    Expanded(
                      child: Center(
                          child: Text(d,
                              style:
                                  TextStyle(fontSize: 11, color: hint))),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 4),
            Expanded(
              child: GridView.builder(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                gridDelegate:
                    const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 7,
                  mainAxisSpacing: 4,
                  crossAxisSpacing: 4,
                  childAspectRatio: 0.82,
                ),
                itemCount: leading + daysInMonth,
                itemBuilder: (context, i) {
                  if (i < leading) return const SizedBox.shrink();
                  final day = i - leading + 1;
                  final date = DateTime(_month.year, _month.month, day);
                  final h =
                      hijri.toHijri(date, offset: settings.hijriOffset);
                  final miqaats = hijri.miqaatsFor(h);
                  final isToday = date.year == today.year &&
                      date.month == today.month &&
                      date.day == today.day;
                  final daySpend = spend[day] ?? 0;

                  return InkWell(
                    borderRadius: BorderRadius.circular(10),
                    onTap: () => _openDaySheet(date, h),
                    child: Container(
                      padding: const EdgeInsets.all(4),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: isToday
                              ? Theme.of(context).colorScheme.primary
                              : Theme.of(context)
                                  .dividerColor
                                  .withValues(alpha: 0.4),
                          width: isToday ? 1.6 : 1,
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Text(
                                hijriPrimary ? '${h.day}' : '$day',
                                style: TextStyle(
                                    fontSize: 13,
                                    fontWeight: isToday
                                        ? FontWeight.bold
                                        : FontWeight.w500),
                              ),
                              const Spacer(),
                              if (showHijri)
                                Text(
                                  hijriPrimary ? '$day' : '${h.day}',
                                  style: TextStyle(
                                      fontSize: 10, color: hint),
                                ),
                            ],
                          ),
                          const Spacer(),
                          if (miqaats.isNotEmpty)
                            Icon(Icons.star,
                                size: 10,
                                color: miqaats.any((m) => m.priority <= 2)
                                    ? const Color(0xFFF59E0B)
                                    : hint),
                          if (daySpend > 0)
                            FittedBox(
                              child: Text(
                                formatMoney(fx, daySpend, home),
                                style: const TextStyle(
                                    fontSize: 9,
                                    color: Color(0xFFEF4444),
                                    fontWeight: FontWeight.w600),
                              ),
                            )
                          else if ((txCount[day] ?? 0) > 0)
                            Container(
                              width: 5,
                              height: 5,
                              decoration: const BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: Color(0xFF0EA5E9)),
                            ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _openDaySheet(DateTime date, HijriDate h) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) => _DaySheet(date: date, hijriDate: h),
    );
  }

  static const _gregMonths = [
    'January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December',
  ];
}

/// Port of `DayLogsModal`: miqaats, the day's transactions, and quick-log
/// chips that book a regular item onto THIS date.
class _DaySheet extends ConsumerWidget {
  final DateTime date;
  final HijriDate hijriDate;
  const _DaySheet({required this.date, required this.hijriDate});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fx = ref.watch(fxProvider);
    final hijri = ref.watch(hijriCalendarProvider);
    final settings =
        ref.watch(settingsProvider).valueOrNull ?? const UserSettings();
    final txs = ref.watch(transactionsProvider).valueOrNull ?? const [];
    final cats = ref.watch(categoriesProvider).valueOrNull ?? const [];
    final items = ref.watch(regularItemsProvider).valueOrNull ?? const [];
    final accounts = ref.watch(activeAccountsProvider);
    final hint = Theme.of(context).hintColor;

    final catById = {for (final c in cats) c.id: c};
    final dayTxs = [
      for (final t in txs)
        if (t.date != null &&
            t.date!.year == date.year &&
            t.date!.month == date.month &&
            t.date!.day == date.day)
          t,
    ];
    final miqaats = hijri.miqaatsFor(hijriDate);

    Future<void> quickLog(RegularItem item) async {
      LedgerAccount? account;
      for (final a in accounts) {
        if (a.id == item.accountId) account = a;
      }
      account ??= accounts.isNotEmpty ? accounts.first : null;
      if (account == null || item.defaultAmount == 0) return;
      await ref
          .read(regularItemControllerProvider)
          .log(item: item, account: account, date: date);
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Logged ${item.name}')));
      }
    }

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.6,
      builder: (context, scroll) => ListView(
        controller: scroll,
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        children: [
          Text(
            '${date.day} ${_CalendarScreenState._gregMonths[date.month - 1]} ${date.year}',
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          if (settings.showHijri)
            Text(hijri.format(hijriDate, long: true),
                style: TextStyle(fontSize: 13, color: hint)),
          if (miqaats.isNotEmpty) ...[
            const SizedBox(height: 10),
            for (final m in miqaats)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(
                  children: [
                    Icon(Icons.star,
                        size: 13,
                        color: m.priority <= 2
                            ? const Color(0xFFF59E0B)
                            : hint),
                    const SizedBox(width: 6),
                    Expanded(
                        child:
                            Text(m.text, style: const TextStyle(fontSize: 13))),
                  ],
                ),
              ),
          ],
          if (items.any((i) => i.defaultAmount > 0)) ...[
            const SizedBox(height: 12),
            Text('QUICK LOG',
                style: TextStyle(
                    fontSize: 11, letterSpacing: 1.2, color: hint)),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final item in items)
                  if (item.defaultAmount > 0)
                    ActionChip(
                      avatar: Icon(PocketIcons.of(item.icon),
                          size: 14, color: colorFromHex(item.color)),
                      label: Text(
                          '${item.name} · ${formatMoney(fx, item.defaultAmount, item.currency)}',
                          style: const TextStyle(fontSize: 12)),
                      onPressed: () => quickLog(item),
                    ),
              ],
            ),
          ],
          const SizedBox(height: 12),
          Row(
            children: [
              Text('TRANSACTIONS',
                  style: TextStyle(
                      fontSize: 11, letterSpacing: 1.2, color: hint)),
              const Spacer(),
              TextButton.icon(
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Add'),
                onPressed: () => showAddTransactionDialog(context),
              ),
            ],
          ),
          if (dayTxs.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text('No transactions on this day.',
                  style: TextStyle(color: hint)),
            )
          else
            for (final t in dayTxs)
              ListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                onTap: () => showTransactionDialog(context, existing: t),
                leading: IconPill(
                    iconName: t.categoryId != null
                        ? (catById[t.categoryId]?.icon ?? 'tag')
                        : (t.type == TxType.transfer
                            ? 'arrow-left-right'
                            : 'tag'),
                    colorHex: catById[t.categoryId]?.color ?? '#71717a',
                    size: 30),
                title: Text(t.payee.isEmpty ? t.type.name : t.payee,
                    style: const TextStyle(fontSize: 13)),
                trailing: Text(
                  '${t.type == TxType.expense ? '−' : t.type == TxType.income ? '+' : ''}${formatMoney(fx, t.amount, t.currency)}',
                  style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: t.type == TxType.expense
                          ? const Color(0xFFEF4444)
                          : t.type == TxType.income
                              ? const Color(0xFF10B981)
                              : hint),
                ),
              ),
        ],
      ),
    );
  }
}
