import '../calendar/hijri_calendar.dart';
import '../category/category_tree.dart';
import '../ledger/ledger_entities.dart';
import '../money/currency_service.dart';

enum BudgetPeriod { gregorian, hijri }

class Budget {
  final String id;

  /// Target categories. Each counts itself plus its descendants.
  final List<String> categoryIds;

  /// Legacy single-category budgets carried a lone `categoryId`.
  final String? legacyCategoryId;

  final int amount; // minor units, in [currency]
  final String currency;
  final BudgetPeriod period;
  final bool rollover;

  const Budget({
    required this.id,
    this.categoryIds = const [],
    this.legacyCategoryId,
    required this.amount,
    required this.currency,
    this.period = BudgetPeriod.gregorian,
    this.rollover = false,
  });
}

class CategorySpend {
  final String categoryId;
  final String name;
  final String? color;
  final String? icon;
  final int spend;
  const CategorySpend({
    required this.categoryId,
    required this.name,
    this.color,
    this.icon,
    required this.spend,
  });
}

class EffectiveLimit {
  final int limit;
  final int rollover;
  const EffectiveLimit(this.limit, this.rollover);
}

typedef _Slice = ({String? categoryId, int amount, String currency});

/// Budget period-spend + rollover logic — a faithful Dart port of the JS
/// `BudgetService` (pure parts only; CRUD lives in the data layer).
///
/// `now` is injected per call (instead of `new Date()`), so the logic is pure
/// and deterministic in tests. Hijri periods read the transaction's immutable
/// `hijriDate` snapshot, falling back to a raw (offset-0) computation for legacy
/// rows — exactly as the JS did, so a later offset change never reclassifies a
/// past transaction.
class BudgetService {
  final CategoryTree categories;
  final CurrencyService fx;
  final HijriCalendar hijri;

  const BudgetService({
    required this.categories,
    required this.fx,
    required this.hijri,
  });

  List<String> targetCategoryIds(Budget b) {
    if (b.categoryIds.isNotEmpty) return b.categoryIds;
    final legacy = b.legacyCategoryId;
    return legacy != null ? [legacy] : const [];
  }

  Set<String> _expandedIds(Budget b) {
    final set = <String>{};
    for (final id in targetCategoryIds(b)) {
      set.addAll(categories.descendants(id));
    }
    return set;
  }

  List<_Slice> _categoryAmounts(LedgerTransaction t) {
    final splits = t.splits;
    if (splits != null && splits.isNotEmpty) {
      return [
        for (final s in splits)
          (categoryId: s.categoryId, amount: s.amount, currency: t.currency),
      ];
    }
    return [(categoryId: t.categoryId, amount: t.amount, currency: t.currency)];
  }

  bool _inCurrentPeriod(Budget b, LedgerTransaction t, DateTime now, int offset) {
    if (t.type != TxType.expense) return false;
    final d = t.date;
    if (d == null) return false;
    if (b.period == BudgetPeriod.hijri) {
      final todayH = hijri.toHijri(now, offset: offset);
      final h = t.hijriDate ?? hijri.toHijriRaw(d);
      return h.year == todayH.year && h.month == todayH.month;
    }
    return d.year == now.year && d.month == now.month;
  }

  int _sumMatching(
    Budget b,
    List<LedgerTransaction> txs,
    Set<String> ids,
    bool Function(LedgerTransaction) inPeriod,
  ) {
    var spend = 0;
    for (final t in txs) {
      if (!inPeriod(t)) continue;
      for (final slice in _categoryAmounts(t)) {
        final cid = slice.categoryId;
        if (cid != null && ids.contains(cid)) {
          spend += fx.convert(slice.amount, slice.currency, b.currency);
        }
      }
    }
    return spend;
  }

  /// Total current-period spend across all target categories (+ descendants).
  int currentSpend(Budget b, List<LedgerTransaction> txs, DateTime now,
      {int hijriOffset = 0}) {
    return _sumMatching(b, txs, _expandedIds(b),
        (t) => _inCurrentPeriod(b, t, now, hijriOffset));
  }

  /// Per-target-category spend for the current period.
  List<CategorySpend> spendByCategory(
      Budget b, List<LedgerTransaction> txs, DateTime now,
      {int hijriOffset = 0}) {
    return targetCategoryIds(b).map((cid) {
      final ids = categories.descendants(cid).toSet();
      final spend = _sumMatching(
          b, txs, ids, (t) => _inCurrentPeriod(b, t, now, hijriOffset));
      final cat = categories.find(cid);
      return CategorySpend(
        categoryId: cid,
        name: cat?.name ?? 'Category',
        color: cat?.color,
        icon: cat?.icon,
        spend: spend,
      );
    }).toList();
  }

  /// Current-period expense transactions counting toward the budget, newest
  /// first.
  List<LedgerTransaction> periodTransactions(
      Budget b, List<LedgerTransaction> txs, DateTime now,
      {int hijriOffset = 0}) {
    final ids = _expandedIds(b);
    final out = txs
        .where((t) =>
            _inCurrentPeriod(b, t, now, hijriOffset) &&
            _categoryAmounts(t)
                .any((s) => s.categoryId != null && ids.contains(s.categoryId)))
        .toList();
    final epoch = DateTime.fromMillisecondsSinceEpoch(0);
    out.sort((a, c) => (c.date ?? epoch).compareTo(a.date ?? epoch));
    return out;
  }

  /// Effective limit including optional rollover from the previous period.
  EffectiveLimit effectiveLimit(
      Budget b, List<LedgerTransaction> txs, DateTime now,
      {int hijriOffset = 0}) {
    if (!b.rollover) return EffectiveLimit(b.amount, 0);
    final ids = _expandedIds(b);

    bool prevMatches(LedgerTransaction t) {
      if (t.type != TxType.expense) return false;
      final d = t.date;
      if (d == null) return false;
      if (b.period == BudgetPeriod.hijri) {
        final todayH = hijri.toHijri(now, offset: hijriOffset);
        var pm = todayH.month - 1, py = todayH.year;
        if (pm < 0) {
          pm = 11;
          py -= 1;
        }
        final h = t.hijriDate ?? hijri.toHijriRaw(d);
        return h.year == py && h.month == pm;
      }
      final pm = now.month == 1 ? 12 : now.month - 1;
      final py = now.month == 1 ? now.year - 1 : now.year;
      return d.year == py && d.month == pm;
    }

    final prevSpent = _sumMatching(b, txs, ids, prevMatches);
    final leftover = (b.amount - prevSpent) > 0 ? b.amount - prevSpent : 0;
    return EffectiveLimit(b.amount + leftover, leftover);
  }
}
