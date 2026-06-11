import 'package:pocket_data/pocket_data.dart';
import 'package:pocket_domain/domain.dart';
import 'package:test/test.dart';

void main() {
  group('debt mappers', () {
    test('round-trips through the row shape', () {
      final d = Debt(
        id: 'd1',
        type: DebtType.lent,
        counterparty: 'Ali',
        principal: 123450,
        currency: 'INR',
        accountId: 'acc1',
        dateTaken: DateTime(2026, 6, 1),
        dueDate: DateTime(2026, 7, 1),
        note: 'wedding loan',
        status: DebtStatus.paid,
        initialTxId: 'tx1',
      );
      final back = debtFromRow(debtToRow(d));
      expect(back.id, d.id);
      expect(back.type, DebtType.lent);
      expect(back.principal, 123450);
      expect(back.dateTaken, DateTime(2026, 6, 1));
      expect(back.dueDate, DateTime(2026, 7, 1));
      expect(back.status, DebtStatus.paid);
      expect(back.initialTxId, 'tx1');
    });

    test('tolerates missing optionals', () {
      final d = debtFromRow({
        'id': 'd2',
        'type': 'borrowed',
        'counterparty': 'X',
        'principal_minor': 100,
        'currency': 'USD',
      });
      expect(d.dueDate, isNull);
      expect(d.status, DebtStatus.active);
    });
  });

  group('transaction debt/regular links', () {
    test('debt fields survive the row round-trip', () {
      const t = LedgerTransaction(
        id: 't1',
        type: TxType.expense,
        accountId: 'a',
        currency: 'USD',
        amount: 100,
        debtId: 'd1',
        debtRole: 'payment',
        regularItemId: 'r1',
      );
      final back = transactionFromRow(transactionToRow(t));
      expect(back.debtId, 'd1');
      expect(back.debtRole, 'payment');
      expect(back.regularItemId, 'r1');
    });
  });

  group('regular item mappers', () {
    test('round-trips, including frequency and minor amount', () {
      const i = RegularItem(
        id: 'r1',
        name: 'Morning coffee',
        defaultAmount: 450,
        currency: 'INR',
        accountId: 'acc1',
        categoryId: 'cat1',
        icon: 'coffee',
        color: '#3b82f6',
        frequency: RegularFrequency.daily,
      );
      final back = regularItemFromRow(regularItemToRow(i));
      expect(back.name, 'Morning coffee');
      expect(back.defaultAmount, 450);
      expect(back.frequency, RegularFrequency.daily);
      expect(back.color, '#3b82f6');
    });
  });

  group('settings mappers', () {
    test('round-trips', () {
      const s = UserSettings(
        homeCurrency: 'INR',
        defaultCurrency: 'USD',
        theme: 'dark',
        showHijri: false,
        calendarMode: 'hijri',
        dateFormat: 'DD/MM/YYYY',
        hijriOffset: -1,
      );
      final back = settingsFromRow(settingsToRow(s));
      expect(back.theme, 'dark');
      expect(back.showHijri, isFalse);
      expect(back.hijriOffset, -1);
      expect(back.dateFormat, 'DD/MM/YYYY');
    });

    test('int-as-bool from SQLite and missing show_hijri default', () {
      expect(settingsFromRow({'show_hijri': 1}).showHijri, isTrue);
      expect(settingsFromRow({'show_hijri': 0}).showHijri, isFalse);
      expect(settingsFromRow({}).showHijri, isTrue);
    });
  });

  group('share mappers', () {
    test('round-trips and lower-cases the member email', () {
      const s = AccountShare(
        id: 's1',
        accountId: 'acc1',
        memberEmail: 'Sister@Example.COM',
        access: ShareAccess.edit,
      );
      final back = shareFromRow(shareToRow(s));
      expect(back.memberEmail, 'sister@example.com');
      expect(back.access, ShareAccess.edit);
    });
  });
}
