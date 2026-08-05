import 'package:pocket_domain/domain.dart';

/// CSV import planning — pure port of legacy `#parseCsv`, `#parseImportDate`
/// and `#buildImportPlan`:
///  * RFC-4180 tolerant parser (BOM, quotes, CRLF);
///  * headers normalized (lowercase, spaces/underscores/dashes stripped);
///  * type aliases: debit→expense, credit→income, borrow→borrowed,
///    lend/loan→lent;
///  * dates: ISO preferred; Y/M/D variants; ambiguous D/M vs M/D slash dates
///    follow the user's date-format preference;
///  * unknown currencies (no FX rate) are rejected per row;
///  * missing accounts/categories/subcategories become creation drafts
///    (type/icon/colour guessed from the name);
///  * rows sharing a SplitOf value merge into ONE split transaction;
///  * transfer rows read ToAccount/ToAmount/ToCurrency;
///  * borrowed/lent rows become debt drafts (counterparty = payee).
///
/// No I/O here — `CsvImportController` commits a plan through the repos.
class CsvImportService {
  final CurrencyService fx;

  const CsvImportService(this.fx);

  ImportPlan plan({
    required String text,
    required List<LedgerAccount> accounts,
    required List<CategoryNode> categories,
    required List<LedgerTransaction> existing,
    required String homeCurrency,
    required String dateFormatPref,
  }) {
    final rows = _parseCsv(text);
    final plan = ImportPlan()..parsedRows = rows.length;
    if (rows.isEmpty) return plan;

    String norm(String? s) => (s ?? '').toLowerCase().trim();

    final accByName = {for (final a in accounts) norm(a.name): a};
    final rootCats = {
      for (final c in categories)
        if (c.parentId == null) '${norm(c.name)}|${c.type}': c,
    };
    final subCats = <String, CategoryNode>{};
    for (final c in categories) {
      if (c.parentId == null) continue;
      CategoryNode? parent;
      for (final p in categories) {
        if (p.id == c.parentId) {
          parent = p;
          break;
        }
      }
      if (parent != null) {
        subCats['${norm(parent.name)}|${norm(c.name)}|${c.type}'] = c;
      }
    }

    // Existing-transaction fingerprints for duplicate detection.
    final accNameById = {for (final a in accounts) a.id: norm(a.name)};
    final fingerprints = <String>{};
    for (final t in existing) {
      if (t.date == null) continue;
      fingerprints.add(
          '${_iso(t.date!)}|${t.amount}|${t.currency}|${accNameById[t.accountId] ?? ''}|${norm(t.payee)}');
    }

    final splitGroups = <String, SplitGroupDraft>{};

    for (final r in rows) {
      final date = parseImportDate(r['date'], dateFormatPref);
      if (date == null) {
        plan.skip('unreadable date');
        continue;
      }
      var type = norm(r['type']);
      type = switch (type) {
        '' => 'expense',
        'debit' => 'expense',
        'credit' => 'income',
        'borrow' => 'borrowed',
        'lend' || 'loan' => 'lent',
        _ => type,
      };
      if (!const {'expense', 'income', 'transfer', 'borrowed', 'lent'}
          .contains(type)) {
        plan.skip('unknown type "$type"');
        continue;
      }

      final acctName = (r['account'] ?? '').trim();
      if (acctName.isEmpty) {
        plan.skip('missing account');
        continue;
      }
      final currency =
          ((r['currency'] ?? '').trim().isEmpty ? homeCurrency : r['currency']!)
              .trim()
              .toUpperCase();
      if (!fx.rates.containsKey(currency)) {
        plan.skip('no FX rate for $currency');
        continue;
      }
      final rawAmt =
          (r['amount'] ?? '0').replaceAll(RegExp(r'[^0-9.\-]'), '');
      final parsedAmt = double.tryParse(rawAmt);
      if (parsedAmt == null || parsedAmt == 0) {
        plan.skip('bad amount');
        continue;
      }
      final amount = fx.toMinor(parsedAmt.abs(), currency);

      if (!accByName.containsKey(norm(acctName))) {
        plan.newAccounts.putIfAbsent(norm(acctName), () {
          final t = guessAccountType(acctName);
          return AccountDraft(
              name: acctName,
              type: t,
              currency: currency,
              color: deterministicColor(acctName),
              icon: defaultAccountIcon(t));
        });
      }

      final catName = (r['category'] ?? '').trim();
      final subName = (r['subcategory'] ?? '').trim();
      final catType = type == 'income' ? 'income' : 'expense';
      if (catName.isNotEmpty && type != 'transfer') {
        final rk = '${norm(catName)}|$catType';
        if (!rootCats.containsKey(rk)) {
          plan.newCategories.putIfAbsent(
              'root|$rk',
              () => CategoryDraft(
                  name: catName,
                  type: catType,
                  parentName: null,
                  color: deterministicColor(catName),
                  icon: guessCategoryIcon(catName)));
        }
        if (subName.isNotEmpty) {
          final sk = '${norm(catName)}|${norm(subName)}|$catType';
          if (!subCats.containsKey(sk)) {
            plan.newCategories.putIfAbsent(
                'sub|$sk',
                () => CategoryDraft(
                    name: subName,
                    type: catType,
                    parentName: catName,
                    color: deterministicColor(subName),
                    icon: guessCategoryIcon(subName)));
          }
        }
      }

      var paymentType = norm(r['paymenttype']);
      if (!const {'card', 'cash', 'transfer'}.contains(paymentType)) {
        paymentType = type == 'transfer' ? 'transfer' : 'card';
      }
      final tags = [
        for (final t in (r['tags'] ?? '').split(','))
          if (t.trim().isNotEmpty) t.trim(),
      ];
      final payee = (r['payee'] ?? '').trim();
      final note = (r['note'] ?? '').trim();

      // Split grouping.
      final splitOf = (r['splitof'] ?? '').trim();
      if (splitOf.isNotEmpty) {
        final group = splitGroups.putIfAbsent(splitOf, () {
          final g = SplitGroupDraft(
              date: date,
              accountName: acctName,
              payee: payee,
              note: note,
              currency: currency,
              paymentType: paymentType,
              tags: tags);
          plan.txDrafts.add(g);
          return g;
        });
        group.amount += amount;
        group.splits.add(SplitDraft(
            categoryName: catName.isEmpty ? null : catName,
            subcategoryName: subName.isEmpty ? null : subName,
            amount: amount));
        continue;
      }

      if (type == 'transfer') {
        final toName = (r['toaccount'] ?? '').trim();
        if (toName.isEmpty) {
          plan.skip('transfer without ToAccount');
          continue;
        }
        final rawToCcy = (r['tocurrency'] ?? '').trim().toUpperCase();
        final toCcy = fx.rates.containsKey(rawToCcy) ? rawToCcy : currency;
        final rawToAmt =
            (r['toamount'] ?? '').replaceAll(RegExp(r'[^0-9.\-]'), '');
        final toAmtParsed = double.tryParse(rawToAmt);
        final toAmount =
            toAmtParsed == null ? null : fx.toMinor(toAmtParsed.abs(), toCcy);
        if (!accByName.containsKey(norm(toName))) {
          plan.newAccounts.putIfAbsent(norm(toName), () {
            final t = guessAccountType(toName);
            return AccountDraft(
                name: toName,
                type: t,
                currency: toCcy,
                color: deterministicColor(toName),
                icon: defaultAccountIcon(t));
          });
        }
        plan.txDrafts.add(TransferDraft(
            date: date,
            accountName: acctName,
            toAccountName: toName,
            amount: amount,
            currency: currency,
            toAmount: toAmount,
            toCurrency: toCcy,
            payee: payee,
            note: note,
            paymentType: paymentType,
            tags: tags));
        continue;
      }

      if (type == 'borrowed' || type == 'lent') {
        plan.debtDrafts.add(DebtDraft(
            type: type == 'lent' ? DebtType.lent : DebtType.borrowed,
            date: date,
            accountName: acctName,
            counterparty: payee.isEmpty ? 'Unknown' : payee,
            amount: amount,
            currency: currency,
            note: note,
            dueDate: parseImportDate(r['duedate'], dateFormatPref)));
        continue;
      }

      final draft = PlainDraft(
          type: type == 'income' ? TxType.income : TxType.expense,
          date: date,
          accountName: acctName,
          categoryName: catName.isEmpty ? null : catName,
          subcategoryName: subName.isEmpty ? null : subName,
          amount: amount,
          currency: currency,
          payee: payee,
          note: note,
          paymentType: paymentType,
          tags: tags);
      draft.isDuplicate = fingerprints.contains(
          '${draft.date}|$amount|$currency|${norm(acctName)}|${norm(payee)}');
      plan.txDrafts.add(draft);
    }
    return plan;
  }

  // ── parsing helpers (ported) ─────────────────────────────────────────

  List<Map<String, String>> _parseCsv(String input) {
    var text = input;
    if (text.isNotEmpty && text.codeUnitAt(0) == 0xFEFF) {
      text = text.substring(1);
    }
    final rows = <List<String>>[];
    var cur = <String>[];
    final field = StringBuffer();
    var inQ = false;
    for (var i = 0; i < text.length; i++) {
      final c = text[i];
      final nx = i + 1 < text.length ? text[i + 1] : '';
      if (inQ) {
        if (c == '"' && nx == '"') {
          field.write('"');
          i++;
        } else if (c == '"') {
          inQ = false;
        } else {
          field.write(c);
        }
      } else {
        if (c == '"') {
          inQ = true;
        } else if (c == ',') {
          cur.add(field.toString());
          field.clear();
        } else if (c == '\n' || c == '\r') {
          if (c == '\r' && nx == '\n') i++;
          cur.add(field.toString());
          field.clear();
          if (cur.length > 1 || cur[0].trim().isNotEmpty) rows.add(cur);
          cur = <String>[];
        } else {
          field.write(c);
        }
      }
    }
    if (field.isNotEmpty || cur.isNotEmpty) {
      cur.add(field.toString());
      if (cur.any((v) => v.trim().isNotEmpty)) rows.add(cur);
    }
    if (rows.isEmpty) return const [];

    final headers = [
      for (final h in rows.first)
        h.trim().toLowerCase().replaceAll(RegExp(r'[\s_\-]+'), ''),
    ];
    return [
      for (final r in rows.skip(1))
        if (r.any((v) => v.trim().isNotEmpty))
          {
            for (var i = 0; i < headers.length; i++)
              headers[i]: (i < r.length ? r[i] : '').trim(),
          },
    ];
  }

  /// Returns ISO 'YYYY-MM-DD' or null. Ambiguous slash dates follow
  /// [userPref] ('MM/DD/YYYY' means month-first; anything else day-first).
  static String? parseImportDate(String? raw, String userPref) {
    final s = (raw ?? '').trim();
    if (s.isEmpty) return null;
    if (RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(s)) return s;
    var m = RegExp(r'^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})$').firstMatch(s);
    if (m != null) {
      return '${m[1]}-${m[2]!.padLeft(2, '0')}-${m[3]!.padLeft(2, '0')}';
    }
    m = RegExp(r'^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$').firstMatch(s);
    if (m != null) {
      final a = int.parse(m[1]!), b = int.parse(m[2]!);
      final y = m[3]!;
      int dd, mm;
      if (a > 12 && b <= 12) {
        dd = a;
        mm = b;
      } else if (b > 12 && a <= 12) {
        mm = a;
        dd = b;
      } else if (a > 12 && b > 12) {
        return null;
      } else if (userPref == 'MM/DD/YYYY') {
        mm = a;
        dd = b;
      } else {
        dd = a;
        mm = b;
      }
      return '$y-${mm.toString().padLeft(2, '0')}-${dd.toString().padLeft(2, '0')}';
    }
    final d = DateTime.tryParse(s);
    return d == null ? null : _iso(d);
  }

  static String _iso(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-'
      '${d.month.toString().padLeft(2, '0')}-'
      '${d.day.toString().padLeft(2, '0')}';

  // ── name-based guesses (ported in spirit) ────────────────────────────

  static String guessAccountType(String name) {
    final n = name.toLowerCase();
    if (n.contains('cash') || n.contains('wallet')) return 'cash';
    if (n.contains('card') || n.contains('credit')) return 'card';
    if (n.contains('sav')) return 'savings';
    if (n.contains('invest') || n.contains('stock') || n.contains('fund')) {
      return 'invest';
    }
    return 'bank';
  }

  static String defaultAccountIcon(String type) => switch (type) {
        'cash' => 'wallet',
        'card' => 'credit-card',
        'savings' => 'piggy-bank',
        'invest' => 'trending-up',
        _ => 'landmark',
      };

  static String guessCategoryIcon(String name) {
    final n = name.toLowerCase();
    if (n.contains('food') || n.contains('grocer') || n.contains('dining')) {
      return 'utensils';
    }
    if (n.contains('transport') || n.contains('fuel') || n.contains('car')) {
      return 'car';
    }
    if (n.contains('home') || n.contains('rent') || n.contains('house')) {
      return 'home';
    }
    if (n.contains('health') || n.contains('medic')) return 'heart-pulse';
    if (n.contains('shop')) return 'shopping-bag';
    if (n.contains('salary') || n.contains('income') || n.contains('pay')) {
      return 'banknote';
    }
    if (n.contains('school') || n.contains('edu')) return 'graduation-cap';
    if (n.contains('travel') || n.contains('flight')) return 'plane';
    if (n.contains('bill') || n.contains('util')) return 'receipt';
    return 'tag';
  }

  static const List<String> _palette = [
    '#3b82f6', '#f97316', '#10b981', '#8b5cf6', '#ec4899',
    '#ef4444', '#f59e0b', '#06b6d4', '#84cc16', '#6366f1',
  ];

  static String deterministicColor(String name) {
    var h = 0;
    for (final c in name.toLowerCase().codeUnits) {
      h = (h * 31 + c) & 0x7fffffff;
    }
    return _palette[h % _palette.length];
  }
}

// ── plan model ─────────────────────────────────────────────────────────

class ImportPlan {
  final Map<String, AccountDraft> newAccounts = {};
  final Map<String, CategoryDraft> newCategories = {};
  final List<TxDraft> txDrafts = [];
  final List<DebtDraft> debtDrafts = [];
  int skipped = 0;

  /// Data rows the parser produced (before per-row validation) — surfaced in
  /// error messages so "no importable rows" pinpoints parse vs validation.
  int parsedRows = 0;

  /// Reason tally for skipped rows (date/type/account/currency/amount).
  final Map<String, int> skipReasons = {};

  void skip(String reason) {
    skipped++;
    skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
  }

  bool get isEmpty => txDrafts.isEmpty && debtDrafts.isEmpty;
  int get duplicateCount =>
      txDrafts.whereType<PlainDraft>().where((d) => d.isDuplicate).length;
}

class AccountDraft {
  final String name, type, currency, color, icon;
  AccountDraft(
      {required this.name,
      required this.type,
      required this.currency,
      required this.color,
      required this.icon});
}

class CategoryDraft {
  final String name, type;
  final String? parentName;
  final String color, icon;
  CategoryDraft(
      {required this.name,
      required this.type,
      required this.parentName,
      required this.color,
      required this.icon});
}

sealed class TxDraft {
  final String date; // ISO
  final String accountName;

  /// Mutable: split groups accumulate their total as member rows arrive.
  int amount;
  final String currency;
  final String payee, note, paymentType;
  final List<String> tags;
  TxDraft(
      {required this.date,
      required this.accountName,
      required this.amount,
      required this.currency,
      required this.payee,
      required this.note,
      required this.paymentType,
      required this.tags});
}

class PlainDraft extends TxDraft {
  final TxType type;
  final String? categoryName, subcategoryName;
  bool isDuplicate = false;
  PlainDraft(
      {required this.type,
      required super.date,
      required super.accountName,
      required this.categoryName,
      required this.subcategoryName,
      required super.amount,
      required super.currency,
      required super.payee,
      required super.note,
      required super.paymentType,
      required super.tags});
}

class TransferDraft extends TxDraft {
  final String toAccountName;
  final int? toAmount;
  final String toCurrency;
  TransferDraft(
      {required super.date,
      required super.accountName,
      required this.toAccountName,
      required super.amount,
      required super.currency,
      required this.toAmount,
      required this.toCurrency,
      required super.payee,
      required super.note,
      required super.paymentType,
      required super.tags});
}

class SplitGroupDraft extends TxDraft {
  final List<SplitDraft> splits = [];
  SplitGroupDraft(
      {required super.date,
      required super.accountName,
      required super.payee,
      required super.note,
      required super.currency,
      required super.paymentType,
      required super.tags})
      : super(amount: 0);
}

class SplitDraft {
  final String? categoryName, subcategoryName;
  final int amount;
  SplitDraft(
      {required this.categoryName,
      required this.subcategoryName,
      required this.amount});
}

class DebtDraft {
  final DebtType type;
  final String date;
  final String accountName;
  final String counterparty;
  final int amount;
  final String currency;
  final String note;
  final String? dueDate;
  DebtDraft(
      {required this.type,
      required this.date,
      required this.accountName,
      required this.counterparty,
      required this.amount,
      required this.currency,
      required this.note,
      this.dueDate});
}
