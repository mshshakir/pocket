import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';
import 'package:uuid/uuid.dart';

import '../../dashboard/application/dashboard_providers.dart';

/// Account-group use-cases: create/rename/delete. Deleting a group ungroups its
/// member accounts first (mirrors the Postgres `on delete set null`), keeping
/// the local data consistent before the next sync.
class AccountGroupController {
  final AccountGroupRepository _groups;
  final AccountRepository _accounts;
  final Uuid _uuid;

  AccountGroupController(this._groups, this._accounts,
      {Uuid uuid = const Uuid()})
      : _uuid = uuid;

  Future<AccountGroup> create(String name, {int sortOrder = 0}) async {
    final group =
        AccountGroup(id: _uuid.v4(), name: name.trim(), sortOrder: sortOrder);
    await _groups.upsert(group);
    return group;
  }

  Future<void> rename(AccountGroup group, String name) =>
      _groups.upsert(group.copyWith(name: name.trim()));

  Future<void> delete(AccountGroup group, List<LedgerAccount> allAccounts) async {
    for (final a in allAccounts) {
      if (a.groupId == group.id) {
        await _accounts.upsert(a.copyWith(groupId: null));
      }
    }
    await _groups.remove(group.id);
  }
}

final accountGroupControllerProvider = Provider<AccountGroupController>(
  (ref) => AccountGroupController(
    ref.watch(accountGroupRepositoryProvider),
    ref.watch(accountRepositoryProvider),
  ),
);
