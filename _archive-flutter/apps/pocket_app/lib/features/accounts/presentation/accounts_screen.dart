import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';

import '../../../core/format.dart';
import '../../../core/icon_pill.dart';
import '../../dashboard/application/dashboard_providers.dart';
import '../application/account_group_controller.dart';
import 'account_detail_screen.dart';
import 'add_account_dialog.dart';

class AccountsScreen extends ConsumerStatefulWidget {
  const AccountsScreen({super.key});

  @override
  ConsumerState<AccountsScreen> createState() => _AccountsScreenState();
}

class _AccountsScreenState extends ConsumerState<AccountsScreen> {
  final Set<String> _collapsed = {};
  static const _ungroupedKey = '__ungrouped__';

  Future<void> _renameGroup(AccountGroup group) async {
    final controller = TextEditingController(text: group.name);
    final name = await showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Rename group'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Group name'),
          onSubmitted: (v) => Navigator.of(c).pop(v),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(c).pop(),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.of(c).pop(controller.text),
              child: const Text('Save')),
        ],
      ),
    );
    controller.dispose();
    if (name == null || name.trim().isEmpty) return;
    await ref.read(accountGroupControllerProvider).rename(group, name.trim());
  }

  Future<void> _deleteGroup(AccountGroup group) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Delete group?'),
        content: Text(
            'Delete "${group.name}"? Its accounts are kept and moved to Ungrouped.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(c).pop(false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.of(c).pop(true),
              child: const Text('Delete')),
        ],
      ),
    );
    if (confirmed != true) return;
    final all = ref.read(accountsProvider).valueOrNull ?? const [];
    await ref.read(accountGroupControllerProvider).delete(group, all);
  }

  @override
  Widget build(BuildContext context) {
    final fx = ref.watch(fxProvider);
    final all = ref.watch(accountsProvider).valueOrNull ?? const [];
    final balances = ref.watch(balancesProvider);
    final groups = [...ref.watch(accountGroupsProvider).valueOrNull ?? const []]
      ..sort((a, b) {
        final byOrder = a.sortOrder.compareTo(b.sortOrder);
        return byOrder != 0 ? byOrder : a.name.compareTo(b.name);
      });
    final hint = Theme.of(context).hintColor;

    final active = [for (final a in all) if (!a.archived) a];
    final archived = [for (final a in all) if (a.archived) a];

    final groupIds = {for (final g in groups) g.id};
    final membersOf = <String, List<LedgerAccount>>{};
    final ungrouped = <LedgerAccount>[];
    for (final a in active) {
      final gid = a.groupId;
      if (gid != null && groupIds.contains(gid)) {
        (membersOf[gid] ??= []).add(a);
      } else {
        ungrouped.add(a);
      }
    }

    Widget tile(LedgerAccount a, {bool dim = false}) => Opacity(
          opacity: dim ? 0.6 : 1,
          child: Card(
            child: ListTile(
              onTap: () => showAccountDetail(context, accountId: a.id),
              leading: IconPill(
                  iconName: a.icon ?? 'wallet',
                  colorHex: a.color ?? '#0ea5e9',
                  size: 38,
                  fallbackIcon: Icons.account_balance_wallet_outlined),
              title: Text(a.name.isEmpty ? 'Account' : a.name),
              subtitle: Text(a.currency),
              trailing: Text(
                formatMoney(fx, balances[a.id] ?? 0, a.currency),
                style:
                    const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
              ),
            ),
          ),
        );

    Widget groupSection(
      String key,
      String title,
      List<LedgerAccount> members, {
      AccountGroup? group,
    }) {
      final collapsed = _collapsed.contains(key);
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            borderRadius: BorderRadius.circular(8),
            onTap: () => setState(() =>
                collapsed ? _collapsed.remove(key) : _collapsed.add(key)),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
              child: Row(
                children: [
                  Icon(collapsed ? Icons.chevron_right : Icons.expand_more,
                      size: 20, color: hint),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      '${title.toUpperCase()}  ·  ${members.length}',
                      style: TextStyle(
                          fontSize: 11, letterSpacing: 1.2, color: hint),
                    ),
                  ),
                  if (group != null)
                    PopupMenuButton<String>(
                      icon: Icon(Icons.more_horiz, size: 18, color: hint),
                      onSelected: (v) {
                        if (v == 'rename') _renameGroup(group);
                        if (v == 'delete') _deleteGroup(group);
                      },
                      itemBuilder: (_) => const [
                        PopupMenuItem(value: 'rename', child: Text('Rename')),
                        PopupMenuItem(value: 'delete', child: Text('Delete')),
                      ],
                    ),
                ],
              ),
            ),
          ),
          if (!collapsed)
            for (final a in members) tile(a)
          else
            const SizedBox.shrink(),
        ],
      );
    }

    return Scaffold(
      floatingActionButton: FloatingActionButton(
        onPressed: () => showAddAccountDialog(context),
        child: const Icon(Icons.add),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Accounts',
                style: Theme.of(context)
                    .textTheme
                    .headlineMedium
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            if (active.isEmpty && archived.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child: Center(child: Text('No accounts yet. Tap + to add one.')),
              ),
            // No groups defined → flat list (back-compat). Otherwise grouped.
            if (groups.isEmpty)
              for (final a in active) tile(a)
            else ...[
              for (final g in groups)
                groupSection(g.id, g.name, membersOf[g.id] ?? const [],
                    group: g),
              if (ungrouped.isNotEmpty)
                groupSection(_ungroupedKey, 'Ungrouped', ungrouped),
            ],
            if (archived.isNotEmpty) ...[
              const SizedBox(height: 16),
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text('ARCHIVED',
                    style: TextStyle(
                        fontSize: 11, letterSpacing: 1.2, color: hint)),
              ),
              for (final a in archived) tile(a, dim: true),
            ],
          ],
        ),
      ),
    );
  }
}
