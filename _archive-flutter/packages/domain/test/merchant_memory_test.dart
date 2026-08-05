import 'package:pocket_domain/domain.dart';
import 'package:test/test.dart';

void main() {
  group('MerchantMemory', () {
    final memory = MerchantMemory(const [
      MerchantCategory(merchant: 'starbucks', categoryId: 'cat-coffee'),
      MerchantCategory(merchant: 'shell', categoryId: 'cat-fuel'),
    ]);

    test('normalize trims and lower-cases', () {
      expect(MerchantMemory.normalize('  Starbucks '), 'starbucks');
      expect(MerchantMemory.normalize('SHELL'), 'shell');
    });

    test('returns the remembered category for a known payee', () {
      expect(memory.categoryFor('Starbucks'), 'cat-coffee');
      expect(memory.categoryFor('  shell  '), 'cat-fuel');
    });

    test('returns null for an unknown or blank payee', () {
      expect(memory.categoryFor('Unknown Cafe'), isNull);
      expect(memory.categoryFor('   '), isNull);
      expect(memory.categoryFor(''), isNull);
    });

    test('last entry wins for a duplicate merchant', () {
      final m = MerchantMemory(const [
        MerchantCategory(merchant: 'amazon', categoryId: 'cat-a'),
        MerchantCategory(merchant: 'amazon', categoryId: 'cat-b'),
      ]);
      expect(m.categoryFor('Amazon'), 'cat-b');
    });
  });
}
