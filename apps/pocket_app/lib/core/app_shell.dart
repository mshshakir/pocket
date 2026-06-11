import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../features/accounts/presentation/accounts_screen.dart';
import '../features/budgets/presentation/budgets_screen.dart';
import '../features/categories/presentation/categories_screen.dart';
import '../features/dashboard/presentation/dashboard_screen.dart';
import '../features/debts/presentation/debts_screen.dart';
import '../features/family/presentation/family_screen.dart';
import '../features/regular/presentation/regular_items_screen.dart';
import '../features/reports/presentation/reports_screen.dart';
import '../features/settings/application/settings_controller.dart';
import '../features/settings/presentation/settings_screen.dart';
import '../features/transactions/presentation/transactions_screen.dart';
import '../sync/sync_config.dart';
import 'theme.dart';

/// One navigation entry: its label, icons, and the page it shows.
class NavItem {
  final String label;
  final IconData icon;
  final IconData selectedIcon;
  final Widget page;
  const NavItem(this.label, this.icon, this.selectedIcon, this.page);
}

const _navItems = <NavItem>[
  NavItem('Dashboard', Icons.dashboard_outlined, Icons.dashboard, DashboardScreen()),
  NavItem('Transactions', Icons.swap_horiz, Icons.swap_horiz, TransactionsScreen()),
  NavItem('Accounts', Icons.account_balance_wallet_outlined, Icons.account_balance_wallet, AccountsScreen()),
  NavItem('Budgets', Icons.savings_outlined, Icons.savings, BudgetsScreen()),
  NavItem('Debts', Icons.request_quote_outlined, Icons.request_quote, DebtsScreen()),
  NavItem('Regular Purchases', Icons.shopping_basket_outlined, Icons.shopping_basket, RegularItemsScreen()),
  NavItem('Categories', Icons.label_outline, Icons.label, CategoriesScreen()),
  NavItem('Reports', Icons.pie_chart_outline, Icons.pie_chart, ReportsScreen()),
  NavItem('Family', Icons.group_outlined, Icons.group, FamilyScreen()),
  NavItem('Settings', Icons.settings_outlined, Icons.settings, SettingsScreen()),
];

/// Responsive app frame: a persistent sidebar on wide screens, a drawer on
/// narrow ones. The selected page is kept alive in an IndexedStack.
class AppShell extends ConsumerStatefulWidget {
  const AppShell({super.key});

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 900;
    final body = IndexedStack(
      index: _index,
      children: [for (final it in _navItems) it.page],
    );

    if (wide) {
      return Scaffold(
        body: Row(
          children: [
            _Sidebar(selected: _index, onSelect: (i) => setState(() => _index = i)),
            const VerticalDivider(width: 1),
            Expanded(child: body),
          ],
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(title: Text(_navItems[_index].label)),
      drawer: Drawer(
        child: SafeArea(
          child: _NavList(
            selected: _index,
            onSelect: (i) {
              setState(() => _index = i);
              Navigator.of(context).pop();
            },
          ),
        ),
      ),
      body: body,
    );
  }
}

/// The list of nav tiles, reused by the sidebar and the drawer.
class _NavList extends StatelessWidget {
  final int selected;
  final ValueChanged<int> onSelect;
  const _NavList({required this.selected, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    final primary = Theme.of(context).colorScheme.primary;
    return ListView(
      padding: const EdgeInsets.all(8),
      children: [
        for (var i = 0; i < _navItems.length; i++)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: ListTile(
              selected: i == selected,
              selectedColor: primary,
              selectedTileColor: primary.withValues(alpha: 0.12),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10)),
              leading: Icon(
                  i == selected ? _navItems[i].selectedIcon : _navItems[i].icon),
              title: Text(_navItems[i].label),
              onTap: () => onSelect(i),
            ),
          ),
      ],
    );
  }
}

class _Sidebar extends ConsumerWidget {
  final int selected;
  final ValueChanged<int> onSelect;
  const _Sidebar({required this.selected, required this.onSelect});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final email = syncConfigured
        ? Supabase.instance.client.auth.currentUser?.email
        : null;

    return SizedBox(
      width: 252,
      child: Material(
        color: Theme.of(context).colorScheme.surface,
        child: SafeArea(
          child: Column(
            children: [
              // brand
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                child: Row(
                  children: [
                    Container(
                      width: 36,
                      height: 36,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: PocketTheme.seed,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Text('P',
                          style: TextStyle(
                              color: Colors.white, fontWeight: FontWeight.bold)),
                    ),
                    const SizedBox(width: 10),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Text('Pocket',
                            style: TextStyle(fontWeight: FontWeight.bold)),
                        Text('Personal finance',
                            style: TextStyle(
                                fontSize: 12,
                                color: Theme.of(context).hintColor)),
                      ],
                    ),
                  ],
                ),
              ),
              Expanded(child: _NavList(selected: selected, onSelect: onSelect)),
              const Divider(height: 1),
              if (email != null)
                ListTile(
                  leading: const CircleAvatar(
                      radius: 14, child: Icon(Icons.person, size: 16)),
                  title: Text(email,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12)),
                  subtitle: const Text('Synced', style: TextStyle(fontSize: 11)),
                  trailing: IconButton(
                    tooltip: 'Sign out',
                    icon: const Icon(Icons.logout, size: 18),
                    onPressed: () => Supabase.instance.client.auth.signOut(),
                  ),
                ),
              ListTile(
                leading: const Icon(Icons.brightness_6_outlined),
                title: const Text('Toggle theme'),
                onTap: () => ref
                    .read(settingsControllerProvider)
                    .toggleTheme(
                        isDarkNow: Theme.of(context).brightness ==
                            Brightness.dark),
              ),
              const SizedBox(height: 8),
            ],
          ),
        ),
      ),
    );
  }
}
