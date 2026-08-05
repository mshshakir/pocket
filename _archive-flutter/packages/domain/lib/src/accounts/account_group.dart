/// A named grouping of accounts (legacy `accountGroups`). Accounts reference a
/// group via [LedgerAccount.groupId]; deleting a group sets its members back to
/// ungrouped (Postgres `on delete set null`).
library;

class AccountGroup {
  final String id;
  final String name;
  final int sortOrder;

  const AccountGroup({
    required this.id,
    required this.name,
    this.sortOrder = 0,
  });

  AccountGroup copyWith({String? name, int? sortOrder}) => AccountGroup(
        id: id,
        name: name ?? this.name,
        sortOrder: sortOrder ?? this.sortOrder,
      );
}
