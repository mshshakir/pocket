import 'package:pocket_domain/domain.dart';
import 'package:test/test.dart';

/// Locks the intended split behind audit B8: [LedgerMath.balances] tracks ALL
/// accounts (archived included) so history stays correct; excluding archived
/// from net worth is a presentation concern done at the provider, not here.
void main() {
  final fx = CurrencyService(const {'USD': 1.0});

  test('balances include archived accounts (history preserved)', () {
    const active =
        LedgerAccount(id: 'a', currency: 'USD', openingBalance: 1000);
    const archived = LedgerAccount(
        id: 'b', currency: 'USD', openingBalance: 500, archived: true);
    final txs = [
      const LedgerTransaction(
        id: 't1',
        type: TxType.expense,
        accountId: 'b',
        currency: 'USD',
        amount: 200,
        acctMinor: 200,
      ),
    ];

    final balances = LedgerMath.balances([active, archived], txs, fx);

    expect(balances['a'], 1000);
    expect(balances['b'], 300, reason: '500 opening − 200 expense, still tracked');
  });

  test('net worth (active-only sum) excludes the archived account', () {
    const active =
        LedgerAccount(id: 'a', currency: 'USD', openingBalance: 1000);
    const archived = LedgerAccount(
        id: 'b', currency: 'USD', openingBalance: 500, archived: true);
    final all = [active, archived];
    final balances = LedgerMath.balances(all, const [], fx);

    // Mirrors netWorthProvider: sum only non-archived accounts.
    final netWorth = [
      for (final acc in all)
        if (!acc.archived) balances[acc.id] ?? 0,
    ].fold<int>(0, (s, v) => s + v);

    expect(netWorth, 1000, reason: 'archived 500 is excluded from net worth');
  });
}
