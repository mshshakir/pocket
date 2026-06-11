/// Pocket Budget — pure domain layer.
///
/// Framework-agnostic business logic shared by every platform. Ported from the
/// hardened vanilla-JS services; the rules here are the single source of truth
/// for how money behaves, mirrored (for validation only) by the SQL views in
/// `supabase/migrations`.
library pocket_domain;

export 'src/money/currency_service.dart';
export 'src/ledger/ledger_entities.dart';
export 'src/ledger/ledger_math.dart';
export 'src/calendar/hijri_calendar.dart';
export 'src/category/category_tree.dart';
export 'src/budget/budget_service.dart';
export 'src/recurring/recurrence.dart';
export 'src/repositories/repositories.dart';
export 'src/debt/debt.dart';
export 'src/regular/regular_item.dart';
export 'src/settings/user_settings.dart';
export 'src/sharing/account_share.dart';
