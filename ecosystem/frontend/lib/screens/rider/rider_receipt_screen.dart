import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/mr_button.dart';
import 'package:my_ride/widgets/mr_card.dart';

class RiderReceiptScreen extends StatefulWidget {
  const RiderReceiptScreen({super.key});

  @override
  State<RiderReceiptScreen> createState() => _RiderReceiptScreenState();
}

class _RiderReceiptScreenState extends State<RiderReceiptScreen> {
  int _rating = 5;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: MrColors.brandPrimaryLight,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(MrSpacing.md),
          child: Column(
            children: [
              const CircleAvatar(radius: 40, backgroundColor: Color(0xFFD1FAE5), child: Icon(Icons.check, size: 32, color: MrColors.success)),
              const SizedBox(height: MrSpacing.md),
              const Text('Trip complete', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
              const Text('Thanks for riding with My Ride', style: TextStyle(color: MrColors.textSecondary)),
              const SizedBox(height: MrSpacing.lg),
              MrCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('RECEIPT · #MR-8842', style: TextStyle(fontSize: 12, color: MrColors.textSecondary)),
                    const Text('\$18.40', style: TextStyle(fontSize: 36, fontWeight: FontWeight.w700)),
                    const Divider(),
                    _line('Base fare', '\$5.00'),
                    _line('Distance (4.2 mi)', '\$10.50'),
                    _line('Promo: RIDE10', '−\$2.00', green: true),
                    _line('Paid via Visa ···4242', '', bold: true),
                  ],
                ),
              ),
              const SizedBox(height: MrSpacing.lg),
              const Text('Rate your driver', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(5, (i) {
                  return IconButton(
                    onPressed: () => setState(() => _rating = i + 1),
                    icon: Icon(i < _rating ? Icons.star : Icons.star_border, color: MrColors.warning, size: 32),
                  );
                }),
              ),
              const Spacer(),
              MrButton(label: 'Submit rating', fullWidth: true, onPressed: () => context.go('/rider/home')),
            ],
          ),
        ),
      ),
    );
  }

  Widget _line(String left, String right, {bool green = false, bool bold = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(left, style: TextStyle(fontWeight: bold ? FontWeight.w600 : FontWeight.normal, color: green ? MrColors.success : MrColors.textSecondary)),
          if (right.isNotEmpty) Text(right, style: TextStyle(color: green ? MrColors.success : MrColors.textPrimary, fontWeight: bold ? FontWeight.w600 : FontWeight.normal)),
        ],
      ),
    );
  }
}
