import 'package:flutter/material.dart';
import 'package:my_ride/core/api/api_client.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:url_launcher/url_launcher.dart';

/// Shared SOS → FastAPI `/safety/sos` + dial SA emergency 112.
class SosActions {
  SosActions._();

  static Future<void> trigger(
    BuildContext context, {
    String? tripId,
    double? lat,
    double? lng,
    String note = 'Flutter SOS',
  }) async {
    try {
      await ApiClient().postJson('/safety/sos', {
        if (tripId != null && tripId.isNotEmpty) 'trip_id': tripId,
        if (lat != null) 'lat': lat,
        if (lng != null) 'lng': lng,
        'note': note,
      });
    } catch (_) {
      // Still show dial UI if API unreachable
    }
    if (!context.mounted) return;
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: MrColors.primary,
        title: Text('SOS activated', style: MrText.sans(color: Colors.white, weight: FontWeight.w700)),
        content: Text(
          'Call 112 now. My Ride safety ops notified.',
          style: MrText.body(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () async {
              final uri = Uri.parse('tel:112');
              if (await canLaunchUrl(uri)) await launchUrl(uri);
            },
            child: const Text('Call 112', style: TextStyle(color: Colors.white)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('OK', style: TextStyle(color: Colors.white70)),
          ),
        ],
      ),
    );
  }
}

class SosFab extends StatelessWidget {
  const SosFab({super.key, required this.onPressed});
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: MrColors.error,
      borderRadius: BorderRadius.circular(14),
      elevation: 3,
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Text('SOS', style: MrText.sans(color: Colors.white, weight: FontWeight.w800, size: 13)),
        ),
      ),
    );
  }
}
