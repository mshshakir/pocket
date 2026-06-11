/// Shared design system: reusable widgets + tokens used across features.
library pocket_ui_kit;

import 'package:flutter/material.dart';

/// A simple padded card used throughout the app. Placeholder to anchor the
/// package; the design system grows here.
class AppCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;

  const AppCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
  });

  @override
  Widget build(BuildContext context) =>
      Card(child: Padding(padding: padding, child: child));
}
