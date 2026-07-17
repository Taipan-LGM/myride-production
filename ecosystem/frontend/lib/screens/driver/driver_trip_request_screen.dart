import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/theme/mr_theme.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/mr_button.dart';

class DriverTripRequestScreen extends StatefulWidget {
  const DriverTripRequestScreen({super.key});

  @override
  State<DriverTripRequestScreen> createState() => _DriverTripRequestScreenState();
}

class _DriverTripRequestScreenState extends State<DriverTripRequestScreen> {
  int _seconds = 12;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_seconds > 0) setState(() => _seconds--);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: myRideDriverTheme(),
      child: Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(MrSpacing.md),
            child: Column(
              children: [
                const Align(alignment: Alignment.centerLeft, child: Text('MY RIDE DRIVER', style: TextStyle(color: MrColors.success, fontWeight: FontWeight.w700, letterSpacing: 2, fontSize: 11))),
                const Spacer(),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(MrSpacing.lg),
                  decoration: BoxDecoration(
                    color: MrColors.surfaceDriverPanel,
                    borderRadius: BorderRadius.circular(MrRadius.xl),
                    boxShadow: const [BoxShadow(color: Color(0x5910B981), blurRadius: 24)],
                  ),
                  child: Column(
                    children: [
                      Text('$_seconds', style: const TextStyle(fontSize: 48, fontWeight: FontWeight.w700, color: MrColors.warning)),
                      const Text('New ride request', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: MrColors.textInverse)),
                      const SizedBox(height: 16),
                      const Text('\$18.40', style: TextStyle(fontSize: 32, fontWeight: FontWeight.w700, color: MrColors.success)),
                      const Text('est. earnings', style: TextStyle(color: MrColors.textTertiary)),
                      const SizedBox(height: 16),
                      const Text('42 Market Street → Central Station', style: TextStyle(color: MrColors.textInverse, fontWeight: FontWeight.w600)),
                      const SizedBox(height: 24),
                      Row(
                        children: [
                          Expanded(child: MrButton(label: 'Decline', variant: MrButtonVariant.secondary, onPressed: () {})),
                          const SizedBox(width: 12),
                          Expanded(child: MrButton(label: 'Accept', variant: MrButtonVariant.driverAccept, onPressed: () => context.go('/driver/earnings'))),
                        ],
                      ),
                    ],
                  ),
                ),
                const Spacer(),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
