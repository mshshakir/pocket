import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pocket_app/app.dart';

void main() {
  testWidgets('app builds and shows the dashboard', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: PocketApp()));
    expect(find.text('Pocket Budget'), findsWidgets);
  });
}
