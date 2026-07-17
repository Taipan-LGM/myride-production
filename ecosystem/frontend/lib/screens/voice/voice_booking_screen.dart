import 'package:flutter/material.dart';
import 'package:my_ride/models/api_models.dart';
import 'package:my_ride/services/trip_session_service.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/motion/mr_glow_button.dart';

/// Voice-style booking via AI parse (channel=voice). Uses mic simulation + speech text.
class VoiceBookingScreen extends StatefulWidget {
  const VoiceBookingScreen({super.key});

  @override
  State<VoiceBookingScreen> createState() => _VoiceBookingScreenState();
}

class _VoiceBookingScreenState extends State<VoiceBookingScreen> with SingleTickerProviderStateMixin {
  final _controller = TextEditingController(
    text: 'Book a ride from Cape Town CBD to V&A Waterfront',
  );
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  )..repeat(reverse: true);

  bool _listening = false;
  String? _transcript;
  AiParseResponse? _lastAi;
  bool _booking = false;

  @override
  void dispose() {
    _pulse.dispose();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _toggleListen() async {
    setState(() {
      _listening = !_listening;
      if (_listening) {
        _transcript = 'Listening… (tap again to stop)';
      } else {
        _transcript = _controller.text;
      }
    });
    if (!_listening) {
      await _parseVoice();
    }
  }

  Future<void> _parseVoice() async {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    final ai = await TripSessionService.instance.parseMessage(text, channel: 'voice');
    setState(() => _lastAi = ai);
  }

  Future<void> _bookRide() async {
    setState(() => _booking = true);
    final trip = await TripSessionService.instance.bookFromAi(_controller.text);
    setState(() => _booking = false);
    if (!mounted) return;
    if (trip != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Ride booked · ${trip.id.substring(0, 8)}')),
      );
      Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: MrColors.primary,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text('Voice booking'),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              Text(
                'Speak or edit your request',
                style: MrText.sans(size: 16, color: Colors.white70),
              ),
              const SizedBox(height: 24),
              GestureDetector(
                onTap: _toggleListen,
                child: AnimatedBuilder(
                  animation: _pulse,
                  builder: (_, __) {
                    final scale = _listening ? 1.0 + _pulse.value * 0.08 : 1.0;
                    return Transform.scale(
                      scale: scale,
                      child: Container(
                        width: 120,
                        height: 120,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: _listening ? MrColors.secondary : Colors.white24,
                          boxShadow: _listening
                              ? [BoxShadow(color: MrColors.secondary.withValues(alpha: 0.4), blurRadius: 24, spreadRadius: 4)]
                              : null,
                        ),
                        child: Icon(
                          _listening ? Icons.mic : Icons.mic_none,
                          color: _listening ? MrColors.primary : Colors.white,
                          size: 48,
                        ),
                      ),
                    );
                  },
                ),
              ),
              const SizedBox(height: 16),
              Text(
                _transcript ?? 'Tap microphone to simulate voice input',
                textAlign: TextAlign.center,
                style: MrText.sans(size: 13, color: Colors.white60),
              ),
              const SizedBox(height: 24),
              TextField(
                controller: _controller,
                style: MrText.sans(color: Colors.white),
                maxLines: 3,
                decoration: InputDecoration(
                  filled: true,
                  fillColor: Colors.white12,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none),
                  hintText: 'Where to?',
                  hintStyle: MrText.sans(color: Colors.white38),
                ),
              ),
              const SizedBox(height: 16),
              if (_lastAi != null)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('AI intent: ${_lastAi!.intent}', style: MrText.sans(color: Colors.white, weight: FontWeight.w600)),
                      const SizedBox(height: 8),
                      Text(_lastAi!.reply ?? '', style: MrText.sans(color: Colors.white70, size: 13)),
                    ],
                  ),
                ),
              const Spacer(),
              MrGlowButton(
                label: _booking ? 'Booking…' : 'Book with AI voice',
                fullWidth: true,
                onPressed: _booking ? null : _bookRide,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
