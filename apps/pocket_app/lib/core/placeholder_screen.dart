import 'package:flutter/material.dart';

/// Temporary screen for sections not yet built (Budgets, Debts, etc.).
class PlaceholderScreen extends StatelessWidget {
  final String title;
  const PlaceholderScreen(this.title, {super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title,
                  style: Theme.of(context)
                      .textTheme
                      .headlineMedium
                      ?.copyWith(fontWeight: FontWeight.bold)),
              const Expanded(
                child: Center(child: Text('Coming soon')),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
