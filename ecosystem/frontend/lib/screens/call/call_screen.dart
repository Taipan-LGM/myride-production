import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/providers/voice_call_provider.dart';
import 'package:my_ride/services/mobile_api_service.dart';
import 'package:my_ride/services/websocket_service.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/common/mr_error_snackbar.dart';

const _defaultWelcome =
    "Hi, I'm My Ride AI. Type your message and tap send — I can help with your trip, cancel, or check status.";

/// Opens Call AI as a full-screen overlay (reliable on Flutter web).
Future<void> openCallAiDialog(BuildContext context, {String? tripId}) {
  return showGeneralDialog<void>(
    context: context,
    barrierDismissible: false,
    barrierLabel: 'Call AI',
    transitionDuration: const Duration(milliseconds: 250),
    pageBuilder: (_, __, ___) => CallScreen(tripId: tripId),
    transitionBuilder: (_, animation, __, child) => FadeTransition(opacity: animation, child: child),
  );
}

class CallScreen extends ConsumerStatefulWidget {
  const CallScreen({super.key, this.tripId});
  final String? tripId;

  @override
  ConsumerState<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends ConsumerState<CallScreen> {
  WebSocketService? _ws;
  Timer? _timer;
  final _speechController = TextEditingController();
  final _api = MobileApiService();
  String _callId = '';
  bool _wsReady = false;
  bool _sending = false;
  bool _started = false;

  @override
  void initState() {
    super.initState();
    _callId = 'call-${DateTime.now().millisecondsSinceEpoch}';
    WidgetsBinding.instance.addPostFrameCallback((_) => _startCall());
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) ref.read(voiceCallProvider.notifier).tick();
    });
  }

  Future<void> _startCall() async {
    if (!mounted || _started) return;
    _started = true;

    ref.read(voiceCallProvider.notifier).reset();
    ref.read(voiceCallProvider.notifier).startCall(_callId);
    ref.read(voiceCallProvider.notifier).addTranscript(_defaultWelcome, isRider: false);

    if (kIsWeb) {
      try {
        final res = await _api.voiceWelcome();
        final data = res['data'] as Map<String, dynamic>? ?? res;
        final text = data['text'] as String?;
        if (text != null && text.isNotEmpty && mounted) {
          ref.read(voiceCallProvider.notifier).reset();
          ref.read(voiceCallProvider.notifier).startCall(_callId);
          ref.read(voiceCallProvider.notifier).addTranscript(text, isRider: false);
        }
      } catch (_) {
        // Keep local welcome — API optional on web.
      }
    } else {
      _connectWs();
    }
  }

  void _connectWs() {
    _ws = WebSocketService(
      path: '/ws/voice/$_callId',
      onEvent: (event, data) {
        if (event == 'connected') {
          if (mounted) setState(() => _wsReady = true);
          return;
        }
        if (event == 'voice_transcription') {
          final speaker = data['speaker'] as String? ?? 'ai';
          if (speaker == 'ai' && ref.read(voiceCallProvider).transcripts.isEmpty) {
            ref.read(voiceCallProvider.notifier).addTranscript(
              data['text'] as String? ?? _defaultWelcome,
              isRider: false,
            );
          } else if (speaker == 'ai') {
            ref.read(voiceCallProvider.notifier).addTranscript(
              data['text'] as String? ?? '',
              isRider: false,
            );
          }
          if (speaker == 'ai') {
            ref.read(voiceCallProvider.notifier).setAiProcessing(false);
          }
        }
      },
    )..connect();
  }

  Future<void> _sendSpeech() async {
    final text = _speechController.text.trim();
    if (text.isEmpty || _sending) return;

    setState(() => _sending = true);
    ref.read(voiceCallProvider.notifier).addTranscript(text, isRider: true);
    ref.read(voiceCallProvider.notifier).setAiProcessing(true);
    _speechController.clear();

    try {
      if (kIsWeb || !_wsReady) {
        await _sendViaHttp(text);
      } else {
        _ws?.send({
          'type': 'speech',
          'text': text,
          if (widget.tripId != null) 'trip_id': widget.tripId,
        });
      }
    } catch (e) {
      if (mounted) MrErrorSnackbar.showException(context, e);
      ref.read(voiceCallProvider.notifier).setAiProcessing(false);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _sendViaHttp(String text) async {
    final res = await _api.sendVoiceMessage(text: text, tripId: widget.tripId, callId: _callId);
    final data = res['data'] as Map<String, dynamic>? ?? res;
    ref.read(voiceCallProvider.notifier).addTranscript(
      data['text'] as String? ?? 'How can I help?',
      isRider: false,
    );
    ref.read(voiceCallProvider.notifier).setAiProcessing(false);
  }

  void _endCall() {
    ref.read(voiceCallProvider.notifier).endCall(tripId: widget.tripId);
    final navigator = Navigator.of(context);
    if (navigator.canPop()) {
      navigator.pop();
      return;
    }
    if (widget.tripId != null && mounted) {
      context.go('/rider/tracking/${widget.tripId}');
    }
  }

  @override
  void dispose() {
    _ws?.dispose();
    _timer?.cancel();
    _speechController.dispose();
    super.dispose();
  }

  String _formatDuration(int secs) {
    final m = (secs ~/ 60).toString().padLeft(2, '0');
    final s = (secs % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    final call = ref.watch(voiceCallProvider);
    final titleStyle = Theme.of(context).textTheme.headlineSmall?.copyWith(
          color: Colors.white,
          fontWeight: FontWeight.w700,
        );
    final monoStyle = Theme.of(context).textTheme.bodyMedium?.copyWith(
          color: Colors.white70,
          fontFamily: 'monospace',
        );

    return Scaffold(
      backgroundColor: MrColors.primary,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        foregroundColor: Colors.white,
        title: const Text('Call AI'),
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: _endCall,
        ),
      ),
      body: SafeArea(
        top: false,
        child: Column(
          children: [
            const SizedBox(height: 8),
            const CircleAvatar(
              radius: 48,
              backgroundColor: MrColors.secondary,
              child: Icon(Icons.support_agent, size: 40, color: MrColors.primary),
            ),
            const SizedBox(height: 12),
            Text('My Ride AI', style: titleStyle),
            Text(_formatDuration(call.durationSeconds), style: monoStyle),
            const SizedBox(height: 16),
            Expanded(
              child: ListView.builder(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                itemCount: call.transcripts.length + (call.isAiProcessing ? 1 : 0),
                itemBuilder: (_, i) {
                  if (call.isAiProcessing && i == call.transcripts.length) {
                    return const Align(
                      alignment: Alignment.centerLeft,
                      child: Text('AI is processing…', style: TextStyle(color: Colors.white54)),
                    );
                  }
                  final line = call.transcripts[i];
                  return Align(
                    alignment: line.isRider ? Alignment.centerRight : Alignment.centerLeft,
                    child: Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: line.isRider ? Colors.blue.shade700 : Colors.green.shade700,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(line.text, style: const TextStyle(color: Colors.white)),
                    ),
                  );
                },
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextField(
                controller: _speechController,
                style: const TextStyle(color: Colors.white),
                enabled: !_sending,
                decoration: InputDecoration(
                  hintText: 'Type your message…',
                  hintStyle: const TextStyle(color: Colors.white38),
                  suffixIcon: IconButton(
                    icon: const Icon(Icons.send, color: Colors.white),
                    onPressed: _sending ? null : _sendSpeech,
                  ),
                ),
                textInputAction: TextInputAction.send,
                onSubmitted: _sending ? null : (_) => _sendSpeech(),
              ),
            ),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                _ctrl(Icons.mic_off, 'Mute'),
                _ctrl(Icons.volume_up, 'Speaker'),
                _ctrl(Icons.call_end, 'End', color: Colors.red, onTap: _endCall),
              ],
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }

  Widget _ctrl(IconData icon, String label, {Color? color, VoidCallback? onTap}) => Column(
        children: [
          IconButton(onPressed: onTap, icon: Icon(icon, color: color ?? Colors.white, size: 32)),
          Text(label, style: const TextStyle(color: Colors.white70, fontSize: 12)),
        ],
      );
}
