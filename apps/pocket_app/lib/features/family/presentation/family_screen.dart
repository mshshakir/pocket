import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';

import '../../dashboard/application/dashboard_providers.dart';
import 'family_member_dialog.dart';

/// Access-level chrome — mirrors legacy `ACCESS_LEVELS`.
abstract final class AccessLevelStyle {
  static (String, IconData, Color) of(ShareAccess access) => switch (access) {
        ShareAccess.full =>
          ('Full access', Icons.verified_user_outlined, const Color(0xFF10B981)),
        ShareAccess.edit =>
          ('Can edit', Icons.edit_outlined, const Color(0xFF3B82F6)),
        ShareAccess.view =>
          ('View only', Icons.visibility_outlined, const Color(0xFFF59E0B)),
      };
}

/// Family Sharing — outgoing shares grouped per member, plus the accounts
/// other people share with the current user. Mirrors legacy `FamilyView` on
/// top of the normalized `account_shares` backend.
class FamilyScreen extends ConsumerWidget {
  const FamilyScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hint = Theme.of(context).hintColor;
    final shares = ref.watch(outboundSharesProvider).valueOrNull ?? const [];
    final inbound = ref.watch(inboundSharesProvider).valueOrNull ?? const [];
    final accounts = ref.watch(accountsProvider).valueOrNull ?? const [];

    // Group outbound shares by member email.
    final byMember = <String, List<AccountShare>>{};
    for (final s in shares) {
      byMember.putIfAbsent(s.memberEmail, () => []).add(s);
    }
    final memberEmails = byMember.keys.toList()..sort();

    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => showFamilyMemberDialog(context),
        icon: const Icon(Icons.person_add_outlined),
        label: const Text('Add member'),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Family Sharing',
                style: Theme.of(context)
                    .textTheme
                    .headlineMedium
                    ?.copyWith(fontWeight: FontWeight.bold)),
            Text(
                'Share specific accounts with family members and control their access level.',
                style: TextStyle(fontSize: 13, color: hint)),
            const SizedBox(height: 12),
            if (memberEmails.isEmpty)
              Card(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 40),
                  child: Column(
                    children: [
                      Container(
                        width: 56,
                        height: 56,
                        decoration: BoxDecoration(
                          color:
                              const Color(0xFF8B5CF6).withValues(alpha: 0.13),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: const Icon(Icons.group_outlined,
                            size: 28, color: Color(0xFF8B5CF6)),
                      ),
                      const SizedBox(height: 12),
                      const Text('No family members yet',
                          style: TextStyle(fontWeight: FontWeight.w600)),
                      const SizedBox(height: 4),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 32),
                        child: Text(
                          'Add a family member and choose which accounts they can see — with exactly the access level you want.',
                          textAlign: TextAlign.center,
                          style: TextStyle(fontSize: 13, color: hint),
                        ),
                      ),
                    ],
                  ),
                ),
              )
            else ...[
              for (final email in memberEmails)
                _MemberCard(
                  email: email,
                  shares: byMember[email]!,
                  accounts: accounts,
                ),
              const SizedBox(height: 8),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(Icons.info_outline, size: 16, color: hint),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Access changes apply immediately — sharing is enforced by the backend, so members see updates on their next sync.',
                          style: TextStyle(fontSize: 12, color: hint),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
            if (inbound.isNotEmpty) ...[
              const SizedBox(height: 20),
              Row(
                children: [
                  const Icon(Icons.group_outlined,
                      size: 15, color: Color(0xFF818CF8)),
                  const SizedBox(width: 6),
                  Text('SHARED WITH ME',
                      style: TextStyle(
                          fontSize: 11, letterSpacing: 1.2, color: hint)),
                ],
              ),
              const SizedBox(height: 8),
              _InboundCard(inbound: inbound),
            ],
          ],
        ),
      ),
    );
  }
}

class _MemberCard extends ConsumerWidget {
  final String email;
  final List<AccountShare> shares;
  final List<LedgerAccount> accounts;
  const _MemberCard({
    required this.email,
    required this.shares,
    required this.accounts,
  });

  Future<void> _remove(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Remove member?'),
        content: Text(
            'Stop sharing all accounts with $email? They lose access on their next sync.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(c).pop(false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.of(c).pop(true),
              child: const Text('Remove')),
        ],
      ),
    );
    if (confirmed != true) return;
    final repo = ref.read(shareRepositoryProvider);
    for (final s in shares) {
      await repo.remove(s.id);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final initials = email.length >= 2
        ? email.substring(0, 2).toUpperCase()
        : email.toUpperCase();

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 20,
                  backgroundColor: const Color(0xFF8B5CF6),
                  child: Text(initials,
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 13,
                          fontWeight: FontWeight.w600)),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(email,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                ),
                IconButton(
                  tooltip: 'Edit access',
                  icon: const Icon(Icons.edit_outlined, size: 17),
                  onPressed: () => showFamilyMemberDialog(context,
                      existingEmail: email, existingShares: shares),
                ),
              ],
            ),
            const SizedBox(height: 10),
            for (final s in shares) _SharedAccountRow(share: s, accounts: accounts),
            const Divider(height: 20),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFFEF4444)),
                icon: const Icon(Icons.delete_outline, size: 15),
                label: const Text('Remove'),
                onPressed: () => _remove(context, ref),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SharedAccountRow extends StatelessWidget {
  final AccountShare share;
  final List<LedgerAccount> accounts;
  const _SharedAccountRow({required this.share, required this.accounts});

  @override
  Widget build(BuildContext context) {
    final hint = Theme.of(context).hintColor;
    LedgerAccount? acc;
    for (final a in accounts) {
      if (a.id == share.accountId) {
        acc = a;
        break;
      }
    }
    final (label, icon, color) = AccessLevelStyle.of(share.access);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              color: const Color(0xFF71717A).withValues(alpha: 0.13),
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Icon(Icons.account_balance_wallet_outlined, size: 14),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(acc?.name ?? 'Account',
                    style: const TextStyle(fontSize: 13),
                    overflow: TextOverflow.ellipsis),
                if (acc != null)
                  Text(acc.currency,
                      style: TextStyle(fontSize: 11, color: hint)),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(99),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 11, color: color),
                const SizedBox(width: 4),
                Text(label, style: TextStyle(fontSize: 11, color: color)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _InboundCard extends StatelessWidget {
  final List<InboundShare> inbound;
  const _InboundCard({required this.inbound});

  @override
  Widget build(BuildContext context) {
    final hint = Theme.of(context).hintColor;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Sharing ${inbound.length} account${inbound.length > 1 ? 's' : ''} with you',
                style: TextStyle(fontSize: 12, color: hint)),
            const SizedBox(height: 8),
            for (final s in inbound)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    Container(
                      width: 28,
                      height: 28,
                      decoration: BoxDecoration(
                        color: const Color(0xFF818CF8).withValues(alpha: 0.13),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Icon(Icons.account_balance_wallet_outlined,
                          size: 14, color: Color(0xFF818CF8)),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(s.accountName,
                              style: const TextStyle(
                                  fontSize: 13, fontWeight: FontWeight.w500)),
                          Text('${s.currency} · from ${s.ownerEmail}',
                              style: TextStyle(fontSize: 11, color: hint)),
                        ],
                      ),
                    ),
                    Builder(builder: (context) {
                      final (label, icon, color) =
                          AccessLevelStyle.of(s.access);
                      return Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: color.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(99),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(icon, size: 11, color: color),
                            const SizedBox(width: 4),
                            Text(label,
                                style:
                                    TextStyle(fontSize: 11, color: color)),
                          ],
                        ),
                      );
                    }),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
