import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:my_ride/models/api_models.dart';
import 'package:my_ride/providers/payment_provider.dart';
import 'package:my_ride/services/payment_service.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/motion/mr_glow_button.dart';

class PaymentScreen extends ConsumerWidget {
  const PaymentScreen({super.key, this.trip});

  final Trip? trip;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final payment = ref.watch(paymentProvider);
    final fare = trip?.fareEstimate ?? 24.50;

    return Scaffold(
      appBar: AppBar(title: const Text('Payment')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (trip != null) ...[
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(color: MrColors.secondary.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(16)),
              child: Column(
                children: [
                  const Icon(Icons.check_circle, color: MrColors.secondary, size: 48),
                  const SizedBox(height: 8),
                  Text('Ride completed', style: MrText.sans(size: 18, weight: FontWeight.w700)),
                  Text('R${fare.toStringAsFixed(2)}', style: MrText.mono(size: 32, weight: FontWeight.w800)),
                ],
              ),
            ),
            const SizedBox(height: 24),
            _ReceiptRow('Fare', fare * 0.85),
            _ReceiptRow('Service fee', fare * 0.10),
            _ReceiptRow('Tax', fare * 0.05),
            const Divider(),
            _ReceiptRow('Total', fare, bold: true),
            const SizedBox(height: 24),
          ],
          Text('Payment methods', style: MrText.sans(size: 16, weight: FontWeight.w700)),
          const SizedBox(height: 8),
          ...payment.methods.map((m) => ListTile(
            leading: Icon(Icons.credit_card, color: m.isDefault ? MrColors.secondary : null),
            title: Text('${m.brand} •••• ${m.last4}'),
            trailing: m.isDefault ? const Text('Default') : null,
          )),
          MrGlowButton(
            label: 'Add payment method',
            fullWidth: true,
            onPressed: () async {
              await PaymentService.instance.topUp(amountUsd: 0);
            },
          ),
          const SizedBox(height: 16),
          Text('Wallet balance: R${payment.walletBalance.toStringAsFixed(2)}', style: MrText.sans(color: MrColors.textSecondary)),
          const SizedBox(height: 24),
          Text('Transaction history', style: MrText.sans(size: 16, weight: FontWeight.w700)),
          ...payment.transactions.map((t) => ListTile(
            title: Text(t.description ?? t.id),
            subtitle: Text(t.status),
            trailing: Text('R${(t.amountCents / 100).toStringAsFixed(2)}'),
          )),
        ],
      ),
    );
  }
}

class _ReceiptRow extends StatelessWidget {
  const _ReceiptRow(this.label, this.amount, {this.bold = false});
  final String label;
  final double amount;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: MrText.sans(weight: bold ? FontWeight.w700 : FontWeight.w400)),
          Text('R${amount.toStringAsFixed(2)}', style: MrText.mono(weight: bold ? FontWeight.w800 : FontWeight.w500)),
        ],
      ),
    );
  }
}
