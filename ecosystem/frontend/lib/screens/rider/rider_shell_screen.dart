import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:my_ride/screens/rider/home_screen.dart';
import 'package:my_ride/screens/rider/ride_history_screen.dart';
import 'package:my_ride/screens/rider/rider_profile_screen.dart';
import 'package:my_ride/screens/rider/rider_wallet_screen.dart';
import 'package:my_ride/theme/mr_tokens.dart';

/// Rider shell — 4-tab bottom navigation with lazy-loaded tabs (AutomaticKeepAlive).
class RiderShellScreen extends ConsumerStatefulWidget {
  const RiderShellScreen({super.key, this.initialTab = 0});

  final int initialTab;

  @override
  ConsumerState<RiderShellScreen> createState() => _RiderShellScreenState();
}

class _RiderShellScreenState extends ConsumerState<RiderShellScreen> {
  late int _index = widget.initialTab.clamp(0, 3);

  static const _tabs = [
    (icon: Icons.home_rounded, label: 'Home'),
    (icon: Icons.history_rounded, label: 'History'),
    (icon: Icons.account_balance_wallet_rounded, label: 'Wallet'),
    (icon: Icons.person_rounded, label: 'Profile'),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _index,
        children: const [
          _KeepAliveTab(child: HomeScreen()),
          _KeepAliveTab(child: RideHistoryScreen()),
          _KeepAliveTab(child: RiderWalletScreen()),
          _KeepAliveTab(child: RiderProfileScreen()),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        backgroundColor: Theme.of(context).colorScheme.primary,
        indicatorColor: MrColors.secondary.withValues(alpha: 0.25),
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        destinations: _tabs
            .map(
              (t) => NavigationDestination(
                icon: Icon(t.icon, color: Colors.white70),
                selectedIcon: Icon(t.icon, color: MrColors.secondary),
                label: t.label,
              ),
            )
            .toList(),
      ),
    );
  }
}

/// Keeps tab state alive when switching bottom navigation items.
class _KeepAliveTab extends StatefulWidget {
  const _KeepAliveTab({required this.child});
  final Widget child;

  @override
  State<_KeepAliveTab> createState() => _KeepAliveTabState();
}

class _KeepAliveTabState extends State<_KeepAliveTab> with AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return widget.child;
  }
}
