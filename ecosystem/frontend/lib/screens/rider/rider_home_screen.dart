import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/mr_bottom_sheet.dart';
import 'package:my_ride/widgets/mr_button.dart';
import 'package:my_ride/widgets/mr_google_map.dart';
import 'package:my_ride/widgets/mr_vehicle_option.dart';

class RiderHomeScreen extends StatefulWidget {
  const RiderHomeScreen({super.key});

  @override
  State<RiderHomeScreen> createState() => _RiderHomeScreenState();
}

class _RiderHomeScreenState extends State<RiderHomeScreen> {
  int _selectedVehicle = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          Positioned.fill(child: MrGoogleMap(expand: true, showUserMarker: true)),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(MrSpacing.md),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: MrSpacing.md, vertical: MrSpacing.sm),
                decoration: BoxDecoration(color: MrColors.surfaceCard, borderRadius: BorderRadius.circular(MrRadius.pill), boxShadow: const [BoxShadow(color: Color(0x1F0F172A), blurRadius: 8)]),
                child: const Row(
                  children: [
                    Icon(Icons.circle, color: MrColors.brandPrimary, size: 12),
                    SizedBox(width: 12),
                    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('Where to?', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500)), Text('Current: 42 Market Street', style: TextStyle(fontSize: 11, color: MrColors.textSecondary))])),
                  ],
                ),
              ),
            ),
          ),
          Align(
            alignment: Alignment.bottomCenter,
            child: MrBottomSheet(
              title: 'Book a ride',
              detent: MrBottomSheetDetent.half,
              footer: MrButton(label: 'Request My Ride', fullWidth: true, onPressed: () => context.go('/rider/live-trip')),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  MrVehicleOption(name: 'Standard', fareRange: '\$8–12', icon: Icons.directions_car, selected: _selectedVehicle == 0, onTap: () => setState(() => _selectedVehicle = 0)),
                  MrVehicleOption(name: 'Comfort', fareRange: '\$12–18', icon: Icons.airport_shuttle, selected: _selectedVehicle == 1, onTap: () => setState(() => _selectedVehicle = 1)),
                  MrVehicleOption(name: 'My Ride XL', fareRange: '\$15–22', icon: Icons.electric_bolt, selected: _selectedVehicle == 2, onTap: () => setState(() => _selectedVehicle = 2)),
                ],
              ),
            ),
          ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: 0,
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.history), label: 'Activity'),
          NavigationDestination(icon: Icon(Icons.account_balance_wallet_outlined), label: 'Wallet'),
          NavigationDestination(icon: Icon(Icons.person_outline), label: 'Account'),
        ],
        onDestinationSelected: (i) {
          if (i == 2) context.go('/rider/wallet');
        },
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.go('/rider/schedule'),
        label: const Text('Schedule'),
        icon: const Icon(Icons.calendar_month),
      ),
    );
  }
}
