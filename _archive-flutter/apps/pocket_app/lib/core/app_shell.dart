import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../features/accounts/presentation/accounts_screen.dart';
import '../features/dashboard/application/dashboard_providers.dart';
import '../features/budgets/presentation/budgets_screen.dart';
import '../features/calendar/presentation/calendar_screen.dart';
import '../features/categories/presentation/categories_screen.dart';
import '../features/dashboard/presentation/dashboard_screen.dart';
import '../features/debts/presentation/debts_screen.dart';
import '../features/family/presentation/family_screen.dart';
import '../features/onboarding/application/onboarding_controller.dart';
import '../features/onboarding/presentation/onboarding_screen.dart';
import '../features/updates/application/update_service.dart';
import '../features/regular/presentation/regular_items_screen.dart';
import '../features/reports/presentation/reports_screen.dart';
import '../features/settings/application/settings_controller.dart';
import '../features/settings/presentation/settings_screen.dart';
import '../features/transactions/application/recurring_processor.dart';
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
  NavItem('Calendar', Icons.calendar_month_outlined, Icons.calendar_month, CalendarScreen()),
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
  void initState() {
    super.initState();
    // Check for an OTA patch after the first frame (no-op outside a Shorebird
    // release). Never gate startup on the network call.
    WidgetsBinding.instance.addPostFrameCallback((_) => _checkForUpdate());
  }

  Future<void> _checkForUpdate() async {
    final service = ref.read(updateServiceProvider);
    if (!service.isAvailable) return;
    final outdated = await service.isOutdated();
    if (!outdated || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    messenger.showSnackBar(SnackBar(
      duration: const Duration(seconds: 10),
      content: const Text('An update is available.'),
      action: SnackBarAction(
        label: 'Update',
        onPressed: () => _downloadUpdate(messenger),
      ),
    ));
  }

  Future<void> _downloadUpdate(ScaffoldMessengerState messenger) async {
    messenger.showSnackBar(
        const SnackBar(content: Text('Downloading update…')));
    try {
      await ref.read(updateServiceProvider).downloadUpdate();
      messenger.showSnackBar(const SnackBar(
          content: Text('Update ready — restart the app to apply.')));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Update failed: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    // Brand-new cloud user with no data yet: guide them through first-run
    // setup (currency pick + seed categories) before showing the app.
    if (ref.watch(isFirstRunProvider)) {
      return const OnboardingScreen();
    }

    // Backfill recurring instances whenever the ledger changes (idempotent —
    // deterministic ids make repeat runs no-ops). Only once PowerSync has
    // finished its initial sync, so two devices don't briefly race to backfill
    // the same instances before the ledger has fully arrived (audit B2). In
    // sample mode `syncedProvider` is always true.
    void runRecurringIfReady() {
      if (ref.read(syncedProvider).valueOrNull != true) return;
      final txs = ref.read(transactionsProvider).valueOrNull;
      if (txs != null && txs.isNotEmpty) {
        ref.read(recurringProcessorProvider).process(txs);
      }
    }

    ref.listen(transactionsProvider, (_, __) => runRecurringIfReady());
    ref.listen(syncedProvider, (_, __) => runRecurringIfReady());

    // Refresh global FX rates once per session (no-op when fresh or offline).
    if (syncConfigured) {
      ref.read(fxRefreshServiceProvider).refreshIfStale();
    }

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

/// Makes silent sync failures visible: if the local PowerSync DB failed to
/// open (e.g. web workers missing), the user must know they're on sample data.
class _SyncStatusTile extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(syncStatusProvider);
    final (label, icon, color) = switch (status) {
      SyncStatus.syncing => (
          'Synced with cloud',
          Icons.cloud_done_outlined,
          const Color(0xFF10B981)
        ),
      SyncStatus.connecting => (
          'Connecting…',
          Icons.cloud_sync_outlined,
          const Color(0xFFF59E0B)
        ),
      SyncStatus.error => (
          'SAMPLE DATA — sync failed, see console',
          Icons.cloud_off_outlined,
          const Color(0xFFEF4444)
        ),
      SyncStatus.sampleMode => (
          'Offline sample mode',
          Icons.cloud_off_outlined,
          const Color(0xFF71717A)
        ),
    };
    final issues = ref.watch(syncIssuesProvider);
    return ListTile(
      dense: true,
      leading: Icon(icon, size: 16, color: color),
      title: Text(label, style: TextStyle(fontSize: 11, color: color)),
      subtitle: issues.hasIssues
          ? Text(
              '${issues.skippedCount} change${issues.skippedCount == 1 ? '' : 's'} not uploaded — see console',
              style: const TextStyle(fontSize: 10, color: Color(0xFFEF4444)),
            )
          : null,
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
                  trailing: IconButton(
                    tooltip: 'Sign out',
                    icon: const Icon(Icons.logout, size: 18),
                    onPressed: () => Supabase.instance.client.auth.signOut(),
                  ),
                ),
              // Live sync state sits right below the account row (replaces
              // the old static "Synced" label).
              _SyncStatusTile(),
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
