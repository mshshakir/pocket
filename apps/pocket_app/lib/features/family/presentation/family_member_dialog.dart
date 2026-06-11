import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';
import 'package:uuid/uuid.dart';

import '../../dashboard/application/dashboard_providers.dart';

Future<void> showFamilyMemberDialog(
  BuildContext context, {
  String? existingEmail,
  List<AccountShare> existingShares = const [],
}) =>
    showDialog<void>(
      context: context,
      builder: (_) => FamilyMemberDialog(
          existingEmail: existingEmail, existingShares: existingShares),
    );

/// Add / edit a family member: their email plus a per-account access picker
/// (None / View only / Can edit / Full access). Saving reconciles the
/// `account_shares` rows to match the selection.
class FamilyMemberDialog extends ConsumerStatefulWidget {
  final String? existingEmail;
  final List<AccountShare> existingShares;
  const FamilyMemberDialog(
      {super.key, this.existingEmail, this.existingShares = const []});

  @override
  ConsumerState<FamilyMemberDialog> createState() =>
      _FamilyMemberDialogState();
}

class _FamilyMemberDialogState extends ConsumerState<FamilyMemberDialog> {
  final _email = TextEditingController();

  /// accountId → access, or absent = not shared.
  final Map<String, ShareAccess> _selection = {};
  bool _busy = false;

  bool get _isEditing => widget.existingEmail != null;

  @override
  void initState() {
    super.initState();
    _email.text = widget.existingEmail ?? '';
    for (final s in widget.existingShares) {
      _selection[s.accountId] = s.access;
    }
  }

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final email = _email.text.trim().toLowerCase();
    if (email.isEmpty || !email.contains('@')) return;
    setState(() => _busy = true);
    final repo = ref.read(shareRepositoryProvider);

    // Reconcile: delete deselected rows, upsert the rest.
    final existingByAccount = {
      for (final s in widget.existingShares) s.accountId: s,
    };
    for (final s in widget.existingShares) {
      if (!_selection.containsKey(s.accountId)) await repo.remove(s.id);
    }
    for (final entry in _selection.entries) {
      final existing = existingByAccount[entry.key];
      await repo.upsert(AccountShare(
        id: existing?.id ?? const Uuid().v4(),
        accountId: entry.key,
        memberEmail: email,
        access: entry.value,
      ));
    }
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final accounts = (ref.watch(accountsProvider).valueOrNull ?? const [])
        .where((a) => !a.archived)
        .toList();
    final hint = Theme.of(context).hintColor;

    return AlertDialog(
      title: Text(_isEditing ? 'Edit member' : 'Add family member'),
      content: SizedBox(
        width: 400,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              TextField(
                controller: _email,
                enabled: !_isEditing,
                autofocus: !_isEditing,
                keyboardType: TextInputType.emailAddress,
                decoration: const InputDecoration(
                  labelText: 'Member email',
                  hintText: 'name@example.com',
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'They sign in with this email to see what you share.',
                style: TextStyle(fontSize: 12, color: hint),
              ),
              const SizedBox(height: 16),
              Text('Shared accounts',
                  style: TextStyle(fontSize: 12, color: hint)),
              const SizedBox(height: 6),
              if (accounts.isEmpty)
                const Text('Add an account first.')
              else
                for (final a in accounts)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text('${a.name} (${a.currency})',
                              overflow: TextOverflow.ellipsis),
                        ),
                        DropdownButton<ShareAccess?>(
                          value: _selection[a.id],
                          hint: const Text('Not shared'),
                          items: const [
                            DropdownMenuItem(
                                value: null, child: Text('Not shared')),
                            DropdownMenuItem(
                                value: ShareAccess.view,
                                child: Text('View only')),
                            DropdownMenuItem(
                                value: ShareAccess.edit,
                                child: Text('Can edit')),
                            DropdownMenuItem(
                                value: ShareAccess.full,
                                child: Text('Full access')),
                          ],
                          onChanged: (v) => setState(() {
                            if (v == null) {
                              _selection.remove(a.id);
                            } else {
                              _selection[a.id] = v;
                            }
                          }),
                        ),
                      ],
                    ),
                  ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _busy || accounts.isEmpty ? null : _save,
          child: const Text('Save'),
        ),
      ],
    );
  }
}
