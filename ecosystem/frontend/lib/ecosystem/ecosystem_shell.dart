import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/ecosystem/admin/admin_app_screen.dart';
import 'package:my_ride/ecosystem/driver/driver_app_screen.dart';
import 'package:my_ride/ecosystem/rider/rider_app_screen.dart';
import 'package:my_ride/l10n/app_localizations.dart';
import 'package:my_ride/services/app_settings_service.dart';
import 'package:my_ride/services/live_data_service.dart';
import 'package:my_ride/services/trip_session_service.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/utils/mr_logger.dart';
import 'package:my_ride/widgets/brand/mr_logo.dart';

/// Root shell — bottom navigation across Rider, Driver, and Admin.
class EcosystemShell extends StatefulWidget {
  const EcosystemShell({super.key, this.initialTab = 0});

  final int initialTab;

  @override
  State<EcosystemShell> createState() => _EcosystemShellState();
}

class _EcosystemShellState extends State<EcosystemShell> {
  late int _index = widget.initialTab.clamp(0, 2);

  @override
  void initState() {
    super.initState();
    MrLogger.hubLoaded();
    AppSettingsService.instance.addListener(_onSettings);
    TripSessionService.instance.addListener(_onSettings);
    LiveDataService.instance.startRiderLive();
    LiveDataService.instance.startDriverLive();
    LiveDataService.instance.startAdminLive();
  }

  void _onSettings() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    AppSettingsService.instance.removeListener(_onSettings);
    TripSessionService.instance.removeListener(_onSettings);
    LiveDataService.instance.stopRiderLive();
    LiveDataService.instance.stopDriverLive();
    LiveDataService.instance.stopAdminLive();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final navBg = isDark ? const Color(0xFF0A2540) : MrColors.primary;
    final session = TripSessionService.instance;
    final tabs = [
      (icon: Icons.person_pin_circle_rounded, label: l10n.tabRider),
      (icon: Icons.local_taxi_rounded, label: l10n.tabDriver),
      (icon: Icons.dashboard_rounded, label: l10n.tabAdmin),
    ];

    return Scaffold(
      backgroundColor: navBg,
      appBar: AppBar(
        backgroundColor: navBg,
        foregroundColor: Colors.white,
        elevation: 0,
        title: const MrLogo.appBar(),
        actions: [
          IconButton(
            tooltip: 'WhatsApp chat',
            onPressed: () => context.push('/chat'),
            icon: const Icon(Icons.chat_bubble_outline),
          ),
          IconButton(
            tooltip: 'Voice booking',
            onPressed: () => context.push('/voice'),
            icon: const Icon(Icons.mic_none),
          ),
          IconButton(
            tooltip: l10n.settings,
            onPressed: () => context.push('/settings'),
            icon: const Icon(Icons.settings_outlined),
          ),
        ],
      ),
      body: Column(
        children: [
          if (!session.backendOnline)
            MaterialBanner(
              backgroundColor: MrColors.accent.withValues(alpha: 0.15),
              content: Text(
                session.error ?? 'FastAPI offline — start: cd backend && ./start_api.sh',
                style: MrText.sans(size: 12),
              ),
              actions: [
                TextButton(
                  onPressed: TripSessionService.instance.bootstrap,
                  child: const Text('Retry'),
                ),
              ],
            ),
          Expanded(
            child: IndexedStack(
              index: _index,
              children: const [
                RiderAppScreen(),
                DriverAppScreen(),
                AdminAppScreen(),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) {
          setState(() => _index = i);
          MrLogger.screenOpen(tabs[i].label);
        },
        backgroundColor: navBg,
        indicatorColor: MrColors.secondary.withValues(alpha: 0.25),
        destinations: tabs
            .map((t) => NavigationDestination(
                  icon: Icon(t.icon, color: Colors.white54),
                  selectedIcon: Icon(t.icon, color: MrColors.secondary),
                  label: t.label,
                ))
            .toList(),
      ),
    );
  }
}
