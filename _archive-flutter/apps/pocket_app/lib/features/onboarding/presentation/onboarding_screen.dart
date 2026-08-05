import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme.dart';
import '../../dashboard/application/dashboard_providers.dart';
import '../application/onboarding_controller.dart';

/// First-run welcome shown to a brand-new cloud user before any data exists.
/// Picks a home currency and seeds default categories so the app is usable
/// immediately — the port of legacy `CurrencySetupModal` + `seed.js`.
class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  String? _currency;
  bool _busy = false;

  Future<void> _start() async {
    final currency = _currency;
    if (currency == null) return;
    setState(() => _busy = true);
    try {
      await ref
          .read(onboardingControllerProvider)
          .complete(homeCurrency: currency);
      // No navigation needed: seeding categories flips isFirstRunProvider to
      // false, so AppShell rebuilds into the normal app.
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Setup failed: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final currencies = ref.watch(fxProvider).rates.keys.toList()..sort();
    _currency ??= ref.read(homeCurrencyProvider);
    final hint = Theme.of(context).hintColor;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: ListView(
              shrinkWrap: true,
              padding: const EdgeInsets.all(24),
              children: [
                Center(
                  child: Container(
                    width: 64,
                    height: 64,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: PocketTheme.seed,
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: const Text('P',
                        style: TextStyle(
                            color: Colors.white,
                            fontSize: 30,
                            fontWeight: FontWeight.bold)),
                  ),
                ),
                const SizedBox(height: 20),
                Text('Welcome to Pocket',
                    textAlign: TextAlign.center,
                    style: Theme.of(context)
                        .textTheme
                        .headlineSmall
                        ?.copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                Text(
                  'Pick your main currency to get started. We’ll set up a '
                  'starter set of categories you can rename or change anytime.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 13, color: hint),
                ),
                const SizedBox(height: 24),
                DropdownButtonFormField<String>(
                  initialValue:
                      currencies.contains(_currency) ? _currency : null,
                  decoration: const InputDecoration(
                    labelText: 'Home currency',
                    helperText: 'Used for your net worth and report totals.',
                  ),
                  items: [
                    for (final c in currencies)
                      DropdownMenuItem(value: c, child: Text(c)),
                  ],
                  onChanged:
                      _busy ? null : (v) => setState(() => _currency = v),
                ),
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: _busy ? null : _start,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: _busy
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child:
                                CircularProgressIndicator(strokeWidth: 2))
                        : const Text('Get started'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
