import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/services/api/wallet_api_service.dart';
import 'package:my_ride/theme/mr_theme.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/mr_button.dart';

class DriverEarningsScreen extends StatefulWidget {
  const DriverEarningsScreen({super.key});

  @override
  State<DriverEarningsScreen> createState() => _DriverEarningsScreenState();
}

class _DriverEarningsScreenState extends State<DriverEarningsScreen> {
  // Reuse earnings endpoint via thin client in wallet_api_service
  final _api = DriverEarningsApiService();
  bool _loading = true;
  String? _error;
  double _today = 0;
  double _total = 0;
  int _trips = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await _api.summary();
      if (!mounted) return;
      setState(() {
        _today = (data['today_zar'] as num?)?.toDouble() ?? 0;
        _total = (data['total_zar'] as num?)?.toDouble() ?? 0;
        _trips = (data['trips'] as num?)?.toInt() ?? 0;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final net = _today;
    final gross = _trips > 0 ? net / 0.8 : 0.0;
    final fee = gross - net;

    return Theme(
      data: myRideDriverTheme(),
      child: Scaffold(
        body: Column(
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(MrSpacing.md, 56, MrSpacing.md, MrSpacing.lg),
              decoration: const BoxDecoration(
                gradient: LinearGradient(colors: [MrColors.brandPrimaryDark, MrColors.brandPrimary]),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      IconButton(
                        onPressed: () => context.go('/driver/home'),
                        icon: const Icon(Icons.arrow_back, color: Colors.white),
                      ),
                      const Spacer(),
                      IconButton(
                        onPressed: _loading ? null : _load,
                        icon: const Icon(Icons.refresh, color: Colors.white70),
                      ),
                    ],
                  ),
                  const Text('MY RIDE DRIVER', style: TextStyle(color: MrColors.brandPrimaryMuted, fontSize: 11, letterSpacing: 2)),
                  const Text("Today's earnings", style: TextStyle(color: MrColors.brandPrimaryMuted)),
                  Text(
                    _loading ? '…' : 'R${_today.toStringAsFixed(2)}',
                    style: const TextStyle(fontSize: 48, fontWeight: FontWeight.w700, color: Colors.white),
                  ),
                  Text(
                    '$_trips trips · all-time R${_total.toStringAsFixed(2)}',
                    style: const TextStyle(color: MrColors.brandPrimaryMuted),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(MrSpacing.md),
                children: [
                  if (_error != null)
                    Text(_error!, style: const TextStyle(color: MrColors.error)),
                  _row('Trip fares (est.)', 'R${gross.toStringAsFixed(2)}'),
                  _row('My Ride fee (20%)', '−R${fee.toStringAsFixed(2)}', red: true),
                  const Divider(),
                  _row('Net earnings', 'R${net.toStringAsFixed(2)}', bold: true, green: true),
                  const SizedBox(height: 8),
                  const Text('80% driver share · ZAR', style: TextStyle(color: MrColors.textTertiary, fontSize: 12)),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(MrSpacing.md),
              child: MrButton(
                label: 'Back to home',
                fullWidth: true,
                onPressed: () => context.go('/driver/home'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _row(String label, String value, {bool green = false, bool red = false, bool bold = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(fontWeight: bold ? FontWeight.w600 : FontWeight.normal)),
          Text(
            value,
            style: TextStyle(
              fontWeight: bold ? FontWeight.w700 : FontWeight.w600,
              color: red ? MrColors.error : (green ? MrColors.success : null),
            ),
          ),
        ],
      ),
    );
  }
}
