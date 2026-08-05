import 'package:flutter_test/flutter_test.dart';
import 'package:pocket_app/sync/supabase_connector.dart';

/// Golden tests for the SQLite→PostgREST row coercion. These bugs once cost a
/// day of "nothing syncs" (booleans as 0/1, tags as CSV, blank uuids), so the
/// contract is pinned here (audit C4).
void main() {
  const t = RowUploadTransformer();

  group('RowUploadTransformer', () {
    test('coerces boolean columns from 0/1', () {
      expect(t.transform('accounts', {'id': 'a', 'archived': 1})['archived'],
          true);
      expect(t.transform('accounts', {'id': 'a', 'archived': 0})['archived'],
          false);
      expect(t.transform('budgets', {'id': 'b', 'rollover': 1})['rollover'],
          true);
      expect(t.transform('profiles', {'id': 'p', 'show_hijri': 0})['show_hijri'],
          false);
    });

    test('splits CSV text into arrays for text[] columns', () {
      expect(t.transform('transactions', {'id': 't', 'tags': 'a,b'})['tags'],
          ['a', 'b']);
      expect(t.transform('transactions', {'id': 't', 'tags': ''})['tags'],
          <String>[]);
      expect(t.transform('transactions', {'id': 't', 'tags': null})['tags'],
          <String>[]);
    });

    test('already-a-List array value passes through as strings', () {
      expect(
          t.transform('transactions', {'id': 't', 'tags': ['x', 'y']})['tags'],
          ['x', 'y']);
    });

    test('profiles.custom_payment_types is treated as an array', () {
      expect(
          t.transform('profiles',
              {'id': 'p', 'custom_payment_types': 'paypal,cash'})[
              'custom_payment_types'],
          ['paypal', 'cash']);
    });

    test('blank uuid-like *_id columns become null', () {
      expect(
          t.transform('transactions', {'id': 't', 'category_id': ''})[
              'category_id'],
          isNull);
      expect(
          t.transform('transactions', {'id': 't', 'transfer_pair_id': ''})[
              'transfer_pair_id'],
          isNull);
    });

    test('non-blank ids and unknown columns pass through untouched', () {
      final out = t.transform(
          'transactions', {'id': 't', 'category_id': 'c1', 'payee': 'Shop'});
      expect(out['category_id'], 'c1');
      expect(out['payee'], 'Shop');
      expect(out['id'], 't');
    });

    test('a table with no special columns is returned as-is', () {
      final row = {'id': 'g', 'name': 'Cash', 'sort_order': 2};
      expect(t.transform('account_groups', row), row);
    });
  });
}
