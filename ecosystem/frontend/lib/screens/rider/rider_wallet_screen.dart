import 'package:flutter/material.dart';
import 'package:my_ride/services/api/wallet_api_service.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/mr_button.dart';

class RiderWalletScreen extends StatefulWidget {
  const RiderWalletScreen({super.key});

  @override
  State<RiderWalletScreen> createState() => _RiderWalletScreenState();
}

class _RiderWalletScreenState extends State<RiderWalletScreen> {
  final _api = WalletApiService();
  final _promoCtrl = TextEditingController();
  bool _loading = false;
  String? _message;
  double _balanceZar = 0;
  String _loyaltyLine = '—';

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  @override
  void dispose() {
    _promoCtrl.dispose();
    super.dispose();
  }

  Future<void> _redeemPromo() async {
    final code = _promoCtrl.text.trim();
    if (code.isEmpty) return;
    setState(() => _loading = true);
    try {
      final res = await _api.redeemPromo(code);
      await _refresh();
      if (mounted) {
        setState(() {
          _message = 'Credited R${((res['credited_cents'] as num?) ?? 0) / 100}';
        });
      }
    } catch (e) {
      if (mounted) setState(() { _loading = false; _message = e.toString(); });
    }
  }

  Future<void> _refresh() async {
    setState(() => _loading = true);
    try {
      final wallet = await _api.getWallet();
      final loyalty = await _api.getLoyalty();
      if (!mounted) return;
      setState(() {
        _balanceZar = (wallet['balance_zar'] as num?)?.toDouble() ?? 0;
        final tier = loyalty['tier']?.toString() ?? 'bronze';
        final pts = loyalty['points'] ?? 0;
        _loyaltyLine = '${tier.toUpperCase()} · $pts pts';
        _loading = false;
        _message = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _message = e.toString();
      });
    }
  }

  Future<void> _topUp(int amountCents) async {
    setState(() {
      _loading = true;
      _message = null;
    });
    try {
      await _api.topUp(amountCents: amountCents);
      await _refresh();
      if (mounted) {
        setState(() => _message = 'Top-up successful');
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _message = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My Ride Wallet'),
        automaticallyImplyLeading: Navigator.of(context).canPop(),
        actions: [
          IconButton(onPressed: _loading ? null : _refresh, icon: const Icon(Icons.refresh)),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(MrSpacing.md),
        children: [
          Container(
            padding: const EdgeInsets.all(MrSpacing.lg),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(MrRadius.xl),
              gradient: const LinearGradient(colors: [MrColors.brandPrimaryDark, MrColors.brandPrimary]),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Available balance', style: TextStyle(color: MrColors.brandPrimaryMuted)),
                const SizedBox(height: 8),
                Text(
                  _loading && _balanceZar == 0 ? '…' : 'R${_balanceZar.toStringAsFixed(2)}',
                  style: const TextStyle(fontSize: 42, fontWeight: FontWeight.w700, color: Colors.white),
                ),
                const SizedBox(height: 8),
                Text(_loyaltyLine, style: const TextStyle(fontSize: 13, color: MrColors.brandPrimaryMuted)),
              ],
            ),
          ),
          if (_message != null) ...[
            const SizedBox(height: MrSpacing.sm),
            Text(
              _message!,
              style: TextStyle(
                color: _message!.toLowerCase().contains('success') ? MrColors.success : MrColors.error,
              ),
            ),
          ],
          const SizedBox(height: MrSpacing.lg),
          const Text('Top up (ZAR)', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
          const SizedBox(height: MrSpacing.sm),
          Wrap(
            spacing: 8,
            children: [
              _TopUpChip(label: 'R50', loading: _loading, onTap: () => _topUp(5000)),
              _TopUpChip(label: 'R100', loading: _loading, onTap: () => _topUp(10000)),
              _TopUpChip(label: 'R250', loading: _loading, onTap: () => _topUp(25000)),
            ],
          ),
          const SizedBox(height: MrSpacing.lg),
          const Text('Promo / referral', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
          const SizedBox(height: MrSpacing.sm),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _promoCtrl,
                  decoration: const InputDecoration(
                    hintText: 'MYRIDE50',
                    border: OutlineInputBorder(),
                    isDense: true,
                  ),
                  textCapitalization: TextCapitalization.characters,
                ),
              ),
              const SizedBox(width: 8),
              MrButton(label: 'Redeem', onPressed: _loading ? null : _redeemPromo),
            ],
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: _loading
                ? null
                : () async {
                    try {
                      final d = await _api.referralMe();
                      setState(() => _message = d['share_text']?.toString() ?? d.toString());
                    } catch (e) {
                      setState(() => _message = e.toString());
                    }
                  },
            child: const Text('Show my referral code'),
          ),
          const SizedBox(height: MrSpacing.lg),
          MrButton(
            label: 'Refresh from server',
            onPressed: _loading ? null : _refresh,
          ),
        ],
      ),
    );
  }
}

class _TopUpChip extends StatelessWidget {
  const _TopUpChip({required this.label, required this.loading, required this.onTap});
  final String label;
  final bool loading;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ActionChip(
      label: Text(label),
      onPressed: loading ? null : onTap,
    );
  }
}
