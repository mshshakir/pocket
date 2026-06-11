import 'package:pocket_domain/domain.dart';

/// Pure mappers between domain entities and database/JSON **rows** (the column
/// shape defined by `supabase/migrations/0001_init.sql`). Both the Supabase and
/// Drift repositories funnel through these, so the schema↔entity contract lives
/// in exactly one tested place. Infra columns (user_id, updated_at, deleted_at)
/// are owned by the repositories, not the entity, and aren't handled here.

typedef Row = Map<String, dynamic>;

// ── enums ↔ text ───────────────────────────────────────────────────────
String txTypeToText(TxType t) => switch (t) {
      TxType.expense => 'expense',
      TxType.income => 'income',
      TxType.transfer => 'transfer',
    };

TxType txTypeFromText(String? s) => switch (s) {
      'income' => TxType.income,
      'transfer' => TxType.transfer,
      _ => TxType.expense,
    };

String? transferDirToText(TransferDir? d) => switch (d) {
      TransferDir.inbound => 'in',
      TransferDir.outbound => 'out',
      null => null,
    };

TransferDir? transferDirFromText(String? s) => switch (s) {
      'in' => TransferDir.inbound,
      'out' => TransferDir.outbound,
      _ => null,
    };

String? _dateToIso(DateTime? d) => d == null
    ? null
    : '${d.year.toString().padLeft(4, '0')}-'
        '${d.month.toString().padLeft(2, '0')}-'
        '${d.day.toString().padLeft(2, '0')}';

DateTime? _dateFromIso(String? s) {
  if (s == null || s.isEmpty) return null;
  final p = s.split('-');
  return DateTime(int.parse(p[0]), int.parse(p[1]), int.parse(p[2]));
}

int? _toInt(Object? v) => v == null ? null : (v as num).toInt();

/// Tags may arrive as a Postgres array (Supabase → `List`) or as a CSV text
/// column (PowerSync's local SQLite). Handle both.
List<String> _parseTags(Object? v) {
  if (v is List) return v.cast<String>();
  if (v is String && v.isNotEmpty) return v.split(',');
  return const [];
}

// ── accounts ───────────────────────────────────────────────────────────
Row accountToRow(LedgerAccount a) => {
      'id': a.id,
      'name': a.name,
      'type': a.type,
      'currency': a.currency,
      'opening_balance': a.openingBalance,
      'color': a.color,
      'icon': a.icon,
      'archived': a.archived,
      'group_id': a.groupId,
    };

LedgerAccount accountFromRow(Row r) => LedgerAccount(
      id: r['id'] as String,
      currency: r['currency'] as String,
      openingBalance: _toInt(r['opening_balance']) ?? 0,
      name: r['name'] as String? ?? '',
      type: r['type'] as String? ?? 'bank',
      color: r['color'] as String?,
      icon: r['icon'] as String?,
      archived: r['archived'] == true || r['archived'] == 1,
      groupId: r['group_id'] as String?,
    );

// ── transaction splits ─────────────────────────────────────────────────
Row splitToRow(LedgerSplit s, String transactionId) => {
      'id': s.id,
      'transaction_id': transactionId,
      'account_id': s.accountId,
      'category_id': s.categoryId,
      'amount_minor': s.amount,
      'acct_minor': s.acctMinor,
    };

LedgerSplit splitFromRow(Row r) => LedgerSplit(
      id: r['id'] as String?,
      accountId: r['account_id'] as String?,
      categoryId: r['category_id'] as String?,
      amount: _toInt(r['amount_minor'])!,
      acctMinor: _toInt(r['acct_minor']),
    );

// ── transactions ───────────────────────────────────────────────────────
Row transactionToRow(LedgerTransaction t) => {
      'id': t.id,
      'account_id': t.accountId,
      'category_id': t.categoryId,
      'type': txTypeToText(t.type),
      'amount_minor': t.amount,
      'currency': t.currency,
      'exchange_rate': t.exchangeRate,
      'ref_amount_minor': t.refAmountMinor,
      'acct_minor': t.acctMinor,
      'payee': t.payee,
      'note': t.note,
      'date': _dateToIso(t.date),
      'hijri_year': t.hijriDate?.year,
      'hijri_month': t.hijriDate?.month,
      'hijri_day': t.hijriDate?.day,
      'payment_type': t.paymentType,
      'record_state': t.recordState,
      'transfer_pair_id': t.transferPairId,
      'transfer_dir': transferDirToText(t.transferDir),
      'transfer_rate': t.transferRate,
      'tags': t.tags,
      'added_by': t.addedBy,
      'debt_id': t.debtId,
      'debt_role': t.debtRole,
      'regular_item_id': t.regularItemId,
    };

LedgerTransaction transactionFromRow(Row r, {List<Row> splitRows = const []}) {
  final hy = _toInt(r['hijri_year']);
  final hijri = hy == null
      ? null
      : HijriDate(hy, _toInt(r['hijri_month']) ?? 0, _toInt(r['hijri_day']) ?? 1);
  return LedgerTransaction(
    id: r['id'] as String,
    type: txTypeFromText(r['type'] as String?),
    accountId: r['account_id'] as String,
    currency: r['currency'] as String,
    amount: _toInt(r['amount_minor'])!,
    acctMinor: _toInt(r['acct_minor']),
    transferDir: transferDirFromText(r['transfer_dir'] as String?),
    categoryId: r['category_id'] as String?,
    date: _dateFromIso(r['date'] as String?),
    hijriDate: hijri,
    payee: r['payee'] as String? ?? '',
    note: r['note'] as String? ?? '',
    paymentType: r['payment_type'] as String? ?? 'card',
    recordState: r['record_state'] as String? ?? 'cleared',
    transferPairId: r['transfer_pair_id'] as String?,
    transferRate: r['transfer_rate'] as num?,
    exchangeRate: r['exchange_rate'] as num?,
    refAmountMinor: _toInt(r['ref_amount_minor']),
    tags: _parseTags(r['tags']),
    addedBy: r['added_by'] as String?,
    debtId: r['debt_id'] as String?,
    debtRole: r['debt_role'] as String?,
    regularItemId: r['regular_item_id'] as String?,
    splits: splitRows.isEmpty ? null : splitRows.map(splitFromRow).toList(),
  );
}

// ── categories ─────────────────────────────────────────────────────────
Row categoryToRow(CategoryNode c) => {
      'id': c.id,
      'parent_id': c.parentId,
      'name': c.name,
      'type': c.type,
      'color': c.color,
      'icon': c.icon,
    };

CategoryNode categoryFromRow(Row r) => CategoryNode(
      id: r['id'] as String,
      name: r['name'] as String,
      parentId: r['parent_id'] as String?,
      type: r['type'] as String? ?? 'expense',
      color: r['color'] as String?,
      icon: r['icon'] as String?,
    );

// ── budgets ────────────────────────────────────────────────────────────
String budgetPeriodToText(BudgetPeriod p) =>
    p == BudgetPeriod.hijri ? 'hijri' : 'gregorian';

BudgetPeriod budgetPeriodFromText(String? s) =>
    s == 'hijri' ? BudgetPeriod.hijri : BudgetPeriod.gregorian;

Row budgetToRow(Budget b) => {
      'id': b.id,
      'amount_minor': b.amount,
      'currency': b.currency,
      'period': budgetPeriodToText(b.period),
      'rollover': b.rollover,
    };

/// Join-table rows (`budget_categories`) for a budget's target categories.
List<Row> budgetCategoryRows(Budget b) => [
      for (final cid in b.categoryIds) {'budget_id': b.id, 'category_id': cid},
    ];

Budget budgetFromRow(Row r, {List<String> categoryIds = const []}) => Budget(
      id: r['id'] as String,
      categoryIds: categoryIds,
      amount: _toInt(r['amount_minor'])!,
      currency: r['currency'] as String,
      period: budgetPeriodFromText(r['period'] as String?),
      rollover: r['rollover'] == true || r['rollover'] == 1,
    );

// ── debts ──────────────────────────────────────────────────────────────
String debtTypeToText(DebtType t) =>
    t == DebtType.lent ? 'lent' : 'borrowed';

DebtType debtTypeFromText(String? s) =>
    s == 'lent' ? DebtType.lent : DebtType.borrowed;

String debtStatusToText(DebtStatus s) =>
    s == DebtStatus.paid ? 'paid' : 'active';

DebtStatus debtStatusFromText(String? s) =>
    s == 'paid' ? DebtStatus.paid : DebtStatus.active;

Row debtToRow(Debt d) => {
      'id': d.id,
      'type': debtTypeToText(d.type),
      'counterparty': d.counterparty,
      'principal_minor': d.principal,
      'currency': d.currency,
      'account_id': d.accountId,
      'date_taken': _dateToIso(d.dateTaken),
      'due_date': _dateToIso(d.dueDate),
      'note': d.note,
      'status': debtStatusToText(d.status),
      'initial_tx_id': d.initialTxId,
    };

Debt debtFromRow(Row r) => Debt(
      id: r['id'] as String,
      type: debtTypeFromText(r['type'] as String?),
      counterparty: r['counterparty'] as String? ?? '',
      principal: _toInt(r['principal_minor']) ?? 0,
      currency: r['currency'] as String,
      accountId: r['account_id'] as String?,
      dateTaken: _dateFromIso(r['date_taken'] as String?),
      dueDate: _dateFromIso(r['due_date'] as String?),
      note: r['note'] as String? ?? '',
      status: debtStatusFromText(r['status'] as String?),
      initialTxId: r['initial_tx_id'] as String?,
    );

// ── regular items ──────────────────────────────────────────────────────
String regularFrequencyToText(RegularFrequency f) => switch (f) {
      RegularFrequency.daily => 'daily',
      RegularFrequency.weekly => 'weekly',
      RegularFrequency.monthly => 'monthly',
    };

RegularFrequency regularFrequencyFromText(String? s) => switch (s) {
      'daily' => RegularFrequency.daily,
      'weekly' => RegularFrequency.weekly,
      _ => RegularFrequency.monthly,
    };

Row regularItemToRow(RegularItem i) => {
      'id': i.id,
      'name': i.name,
      'default_amount_minor': i.defaultAmount,
      'currency': i.currency,
      'account_id': i.accountId,
      'category_id': i.categoryId,
      'icon': i.icon,
      'color': i.color,
      'frequency': regularFrequencyToText(i.frequency),
    };

RegularItem regularItemFromRow(Row r) => RegularItem(
      id: r['id'] as String,
      name: r['name'] as String? ?? '',
      defaultAmount: _toInt(r['default_amount_minor']) ?? 0,
      currency: r['currency'] as String? ?? 'USD',
      accountId: r['account_id'] as String?,
      categoryId: r['category_id'] as String?,
      icon: r['icon'] as String? ?? 'coffee',
      color: r['color'] as String? ?? '#f97316',
      frequency: regularFrequencyFromText(r['frequency'] as String?),
    );

// ── settings (profiles table, one row per user) ────────────────────────
Row settingsToRow(UserSettings s) => {
      'home_currency': s.homeCurrency,
      'default_currency': s.defaultCurrency,
      'theme': s.theme,
      'show_hijri': s.showHijri,
      'calendar_mode': s.calendarMode,
      'date_format': s.dateFormat,
      'hijri_offset': s.hijriOffset,
    };

UserSettings settingsFromRow(Row r) => UserSettings(
      homeCurrency: r['home_currency'] as String? ?? 'INR',
      defaultCurrency:
          r['default_currency'] as String? ?? r['home_currency'] as String? ?? 'INR',
      theme: r['theme'] as String? ?? 'system',
      showHijri: r['show_hijri'] == null
          ? true
          : (r['show_hijri'] == true || r['show_hijri'] == 1),
      calendarMode: r['calendar_mode'] as String? ?? 'both',
      dateFormat: r['date_format'] as String? ?? 'auto',
      hijriOffset: _toInt(r['hijri_offset']) ?? 0,
    );

// ── account shares (family) ────────────────────────────────────────────
String shareAccessToText(ShareAccess a) => switch (a) {
      ShareAccess.view => 'view',
      ShareAccess.edit => 'edit',
      ShareAccess.full => 'full',
    };

ShareAccess shareAccessFromText(String? s) => switch (s) {
      'full' => ShareAccess.full,
      'edit' => ShareAccess.edit,
      _ => ShareAccess.view,
    };

Row shareToRow(AccountShare s) => {
      'id': s.id,
      'account_id': s.accountId,
      'member_email': s.memberEmail.toLowerCase(),
      'access': shareAccessToText(s.access),
    };

AccountShare shareFromRow(Row r) => AccountShare(
      id: r['id'] as String,
      accountId: r['account_id'] as String,
      memberEmail: (r['member_email'] as String? ?? '').toLowerCase(),
      access: shareAccessFromText(r['access'] as String?),
    );
