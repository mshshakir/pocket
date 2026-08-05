import 'dart:async';

import 'package:pocket_data/pocket_data.dart';
import 'package:pocket_domain/domain.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// [ShareRepository] backed directly by Supabase (`account_shares` + a join to
/// `accounts`). Family sharing is inherently online — RLS is the actual access
/// control — so this repo skips PowerSync and refreshes after every write.
class SupabaseShareRepository implements ShareRepository {
  final SupabaseClient client;

  final _outbound = StreamController<List<AccountShare>>.broadcast();
  final _inbound = StreamController<List<InboundShare>>.broadcast();
  List<AccountShare> _outboundCache = const [];
  List<InboundShare> _inboundCache = const [];
  bool _loaded = false;

  SupabaseShareRepository(this.client);

  String? get _uid => client.auth.currentUser?.id;
  String get _email => (client.auth.currentUser?.email ?? '').toLowerCase();

  @override
  Stream<List<AccountShare>> watchOutbound() async* {
    yield _outboundCache;
    _ensureLoaded();
    yield* _outbound.stream;
  }

  @override
  Stream<List<InboundShare>> watchInbound() async* {
    yield _inboundCache;
    _ensureLoaded();
    yield* _inbound.stream;
  }

  void _ensureLoaded() {
    if (_loaded) return;
    _loaded = true;
    refresh();
  }

  /// Re-reads both directions from Supabase. Errors are swallowed into the
  /// current cache (the UI keeps showing the last good list offline).
  Future<void> refresh() async {
    if (_uid == null) return;
    try {
      final out = await client
          .from('account_shares')
          .select('id, account_id, member_email, access')
          .eq('owner_id', _uid!);
      _outboundCache =
          [for (final r in out) shareFromRow(Map<String, dynamic>.from(r))];
      _outbound.add(_outboundCache);
    } catch (_) {/* keep cache */}

    try {
      // Note: owner email isn't joinable via PostgREST (owner_id references
      // auth.users); the card shows a generic label until a profile-email
      // mirror column exists.
      final inb = await client
          .from('account_shares')
          .select('account_id, access, accounts(name, currency)')
          .eq('member_email', _email);
      _inboundCache = [
        for (final r in inb)
          InboundShare(
            accountId: r['account_id'] as String,
            accountName:
                (r['accounts']?['name'] as String?) ?? 'Shared account',
            currency: (r['accounts']?['currency'] as String?) ?? '',
            ownerEmail: (r['owner_email'] as String?) ?? 'Family member',
            access: shareAccessFromText(r['access'] as String?),
          ),
      ];
      _inbound.add(_inboundCache);
    } catch (_) {/* keep cache */}
  }

  @override
  Future<void> upsert(AccountShare share) async {
    final row = shareToRow(share)..['owner_id'] = _uid;
    await client.from('account_shares').upsert(row);
    await refresh();
  }

  @override
  Future<void> remove(String id) async {
    await client.from('account_shares').delete().eq('id', id);
    await refresh();
  }

  void dispose() {
    _outbound.close();
    _inbound.close();
  }
}
