/// Family sharing — one account shared with one member, with an access level.
/// Backed by the `account_shares` table (RLS grants the member read/write
/// according to `access`). Ported from legacy-web FamilyView/FamilyModal,
/// re-keyed to the normalized backend.
library;

enum ShareAccess { view, edit, full }

class AccountShare {
  final String id;
  final String accountId;
  final String memberEmail;
  final ShareAccess access;

  const AccountShare({
    required this.id,
    required this.accountId,
    required this.memberEmail,
    this.access = ShareAccess.view,
  });

  AccountShare copyWith({ShareAccess? access}) => AccountShare(
        id: id,
        accountId: accountId,
        memberEmail: memberEmail,
        access: access ?? this.access,
      );
}

/// An account someone else shared WITH the current user (inbound).
class InboundShare {
  final String accountId;
  final String accountName;
  final String currency;
  final String ownerEmail;
  final ShareAccess access;

  const InboundShare({
    required this.accountId,
    required this.accountName,
    required this.currency,
    required this.ownerEmail,
    this.access = ShareAccess.view,
  });
}
