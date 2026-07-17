import 'package:flutter/material.dart';
import 'package:my_ride/models/ride_models.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/widgets/motion/mr_glow_button.dart';

class AdminFleetPanel extends StatelessWidget {
  const AdminFleetPanel({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          Text('Live fleet · 512 active trips', style: MrText.jakarta(size: 16, weight: FontWeight.w800)),
          const Spacer(),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(color: MrColors.error.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(8)),
            child: Text('3 anomalies', style: MrText.jakarta(size: 11, weight: FontWeight.w700, color: MrColors.error)),
          ),
        ]),
        const SizedBox(height: 12),
        Container(
          height: 200,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            gradient: LinearGradient(colors: [MrColors.navy, MrColors.navyMid]),
            border: Border.all(color: MrColors.borderLight),
          ),
          child: Stack(
            children: [
              ...List.generate(12, (i) {
                final left = 20.0 + (i * 28) % 280;
                final top = 30.0 + (i * 17) % 140;
                return Positioned(
                  left: left,
                  top: top,
                  child: Container(
                    width: 10,
                    height: 10,
                    decoration: BoxDecoration(shape: BoxShape.circle, color: i == 2 ? MrColors.error : MrColors.cyan, boxShadow: [BoxShadow(color: (i == 2 ? MrColors.error : MrColors.cyan).withValues(alpha: 0.6), blurRadius: 8)]),
                  ),
                );
              }),
              Positioned(left: 12, bottom: 12, child: Text('Anomaly: Trip #4821 idle 18 min', style: MrText.jakarta(size: 11, color: Colors.white70))),
            ],
          ),
        ),
        const SizedBox(height: 12),
        MrGlowButton(label: 'Bulk SMS to 24 drivers', onPressed: () {}),
      ],
    );
  }
}

class AdminUsersPanel extends StatelessWidget {
  const AdminUsersPanel({super.key});

  static const _users = [
    AdminUser(name: 'Amina K.', role: 'Rider', status: 'Active', trips: 142),
    AdminUser(name: 'James O.', role: 'Driver', status: 'Active', trips: 891),
    AdminUser(name: 'Dispatch Bot', role: 'Admin', status: 'Active', trips: 0),
  ];

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('User management', style: MrText.jakarta(size: 16, weight: FontWeight.w800)),
        const SizedBox(height: 12),
        ..._users.map((u) => _tableRow([u.name, u.role, u.status, '${u.trips}'])),
      ],
    );
  }
}

class AdminDisputesPanel extends StatelessWidget {
  const AdminDisputesPanel({super.key});

  static const _cases = [
    DisputeCase(id: '#D-1042', summary: 'Fare mismatch · cash trip', priority: 'High'),
    DisputeCase(id: '#D-1038', summary: 'Route deviation complaint', priority: 'Medium'),
  ];

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Dispute resolution', style: MrText.jakarta(size: 16, weight: FontWeight.w800)),
        const SizedBox(height: 12),
        ..._cases.map((c) => Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: c.priority == 'High' ? MrColors.error.withValues(alpha: 0.4) : MrColors.borderLight)),
              child: Row(children: [
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(c.id, style: MrText.mono(weight: FontWeight.w700)),
                  Text(c.summary, style: MrText.jakarta(size: 12, color: MrColors.textSecondary)),
                ])),
                Text(c.priority, style: MrText.jakarta(size: 11, weight: FontWeight.w700, color: c.priority == 'High' ? MrColors.error : MrColors.electric)),
              ]),
            )),
      ],
    );
  }
}

class AdminPromosPanel extends StatelessWidget {
  const AdminPromosPanel({super.key});

  static const _promos = [
    PromoCode(code: 'RIDE20', discount: '20% off', uses: 1240, active: true),
    PromoCode(code: 'AIRPORT5', discount: '\$5 flat', uses: 89, active: true),
    PromoCode(code: 'WELCOME', discount: 'First ride free', uses: 5021, active: false),
  ];

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          Text('Promo code engine', style: MrText.jakarta(size: 16, weight: FontWeight.w800)),
          const Spacer(),
          TextButton(onPressed: () {}, child: const Text('+ New code')),
        ]),
        const SizedBox(height: 12),
        ..._promos.map((p) => _tableRow([p.code, p.discount, '${p.uses} uses', p.active ? 'Active' : 'Paused'])),
      ],
    );
  }
}

class AdminOnboardingPanel extends StatelessWidget {
  const AdminOnboardingPanel({super.key});

  static const _drivers = [
    OnboardingDriver(name: 'Samuel T.', stage: 'Background check', progress: 0.75),
    OnboardingDriver(name: 'Grace M.', stage: 'Vehicle inspection', progress: 0.45),
    OnboardingDriver(name: 'Peter L.', stage: 'Documents review', progress: 0.9),
  ];

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Driver onboarding pipeline', style: MrText.jakarta(size: 16, weight: FontWeight.w800)),
        const SizedBox(height: 12),
        ..._drivers.map((d) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text(d.name, style: MrText.jakarta(weight: FontWeight.w700))),
                  Text(d.stage, style: MrText.jakarta(size: 11, color: MrColors.textSecondary)),
                ]),
                const SizedBox(height: 6),
                LinearProgressIndicator(value: d.progress, minHeight: 6, borderRadius: BorderRadius.circular(4), backgroundColor: MrColors.borderLight, color: MrColors.electric),
              ]),
            )),
      ],
    );
  }
}

class AdminRetentionPanel extends StatelessWidget {
  const AdminRetentionPanel({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Retention & revenue analytics', style: MrText.jakarta(size: 16, weight: FontWeight.w800)),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: _metric('D7 retention', '68%', MrColors.mint)),
          const SizedBox(width: 10),
          Expanded(child: _metric('D30 retention', '41%', MrColors.cyan)),
        ]),
        const SizedBox(height: 10),
        Row(children: [
          Expanded(child: _metric('Revenue MTD', '\$284K', MrColors.electric)),
          const SizedBox(width: 10),
          Expanded(child: _metric('Avg fare', '\$16.40', MrColors.textPrimary)),
        ]),
      ],
    );
  }

  Widget _metric(String label, String value, Color color) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(12)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: MrText.jakarta(size: 11, color: MrColors.textSecondary)),
        Text(value, style: MrText.mono(size: 20, weight: FontWeight.w800, color: color)),
      ]),
    );
  }
}

Widget _tableRow(List<String> cells) {
  return Container(
    margin: const EdgeInsets.only(bottom: 6),
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(10), border: Border.all(color: MrColors.borderLight)),
    child: Row(
      children: cells.map((c) => Expanded(child: Text(c, style: MrText.jakarta(size: 12, weight: FontWeight.w600)))).toList(),
    ),
  );
}
