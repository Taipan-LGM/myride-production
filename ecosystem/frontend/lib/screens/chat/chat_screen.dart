import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/models/api_models.dart';
import 'package:my_ride/providers/chat_provider.dart';
import 'package:my_ride/services/mobile_api_service.dart';
import 'package:my_ride/services/websocket_service.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/theme/mr_tokens.dart';

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key, required this.tripId});
  final String tripId;

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _controller = TextEditingController();
  final _scroll = ScrollController();
  WebSocketService? _ws;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _ws = WebSocketService(
      path: '/ws/chat/${widget.tripId}',
      onEvent: (event, data) {
        if (event == 'chat_message') {
          final sender = data['sender'] as String? ?? 'rider';
          // Rider messages are added optimistically in _send — skip WS echo + history dupes.
          if (sender == 'rider') {
            ref.read(chatProvider(widget.tripId).notifier).setTyping(false);
            return;
          }
          ref.read(chatProvider(widget.tripId).notifier).addMessageIfAbsent(
            ChatMessage(
              text: data['text'] as String? ?? '',
              isUser: false,
              timestamp: DateTime.now(),
              intent: data['intent'] as String?,
            ),
          );
          ref.read(chatProvider(widget.tripId).notifier).setTyping(false);
        } else if (event == 'trip_update') {
          final status = data['status'] as String?;
          ref.read(chatProvider(widget.tripId).notifier).addMessageIfAbsent(
            ChatMessage(text: _statusCard(status), isUser: false, timestamp: DateTime.now()),
          );
          if (status == 'cancelled' && mounted) {
            Future.microtask(() => context.go('/rider/home'));
          }
        }
      },
    )..connect();
    _flushOfflineQueue();
  }

  String _statusCard(String? status) => switch (status) {
    'driver_assigned' => '🚗 Driver Assigned: John Doe (Toyota Camry) · ETA 4 min',
    'driver_arriving' => '📍 Driver has arrived',
    'completed' => '💰 Payment confirmed · Receipt ready',
    'cancelled' => '❌ Ride cancelled',
    _ => 'Trip update: $status',
  };

  Future<void> _flushOfflineQueue() async {
    final queue = ref.read(chatProvider(widget.tripId)).offlineQueue;
    for (final msg in queue) {
      await _send(msg, fromQueue: true);
    }
    ref.read(chatProvider(widget.tripId).notifier).clearQueue();
  }

  Future<void> _send(String text, {bool fromQueue = false}) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty || _sending) return;

    _sending = true;
    ref.read(chatProvider(widget.tripId).notifier).addMessageIfAbsent(
      ChatMessage(text: trimmed, isUser: true, timestamp: DateTime.now()),
    );
    ref.read(chatProvider(widget.tripId).notifier).setTyping(true);
    try {
      await MobileApiService().sendChatMessage(tripId: widget.tripId, message: trimmed);
    } catch (_) {
      if (!fromQueue) ref.read(chatProvider(widget.tripId).notifier).queueOffline(trimmed);
    } finally {
      _sending = false;
      _controller.clear();
      _scrollToEnd();
    }
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
    });
  }

  Future<void> _cancelRide() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Cancel ride?'),
        content: const Text('Your trip will be cancelled and the driver notified.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep ride')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Cancel ride')),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    ref.read(chatProvider(widget.tripId).notifier).setTyping(true);
    try {
      await MobileApiService().cancelRide(widget.tripId);
      ref.read(chatProvider(widget.tripId).notifier).addMessageIfAbsent(
        ChatMessage(
          text: '✅ Ride cancelled. You can request a new trip anytime.',
          isUser: false,
          timestamp: DateTime.now(),
        ),
      );
      if (mounted) context.go('/rider/home');
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not cancel ride: $e')),
        );
      }
    } finally {
      ref.read(chatProvider(widget.tripId).notifier).setTyping(false);
    }
  }

  @override
  void dispose() {
    _ws?.dispose();
    _controller.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final chat = ref.watch(chatProvider(widget.tripId));
    return Scaffold(
      backgroundColor: const Color(0xFFECE5DD),
      appBar: AppBar(
        backgroundColor: const Color(0xFF075E54),
        foregroundColor: Colors.white,
        title: const Text('My Ride AI Chat'),
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView.builder(
              controller: _scroll,
              padding: const EdgeInsets.all(12),
              itemCount: chat.messages.length,
              itemBuilder: (_, i) {
                final m = chat.messages[i];
                if (i > 0 && chat.messages[i - 1].timestamp.day != m.timestamp.day) {
                  return Column(children: [
                    Text('— ${m.timestamp.toLocal()} —', style: MrText.sans(size: 10)),
                    _Bubble(message: m),
                  ]);
                }
                return _Bubble(message: m);
              },
            ),
          ),
          if (chat.isTyping) const Padding(padding: EdgeInsets.all(4), child: Text('AI is typing…')),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Row(
              children: [
                ActionChip(
                  label: const Text("Where's my driver?"),
                  onPressed: _sending ? null : () => _send("Where's my driver?"),
                ),
                ActionChip(
                  label: const Text('Cancel ride'),
                  onPressed: _sending ? null : _cancelRide,
                ),
                ActionChip(
                  label: const Text('Need help'),
                  onPressed: _sending ? null : () => _send('Need help'),
                ),
              ],
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      decoration: InputDecoration(
                        filled: true,
                        fillColor: Colors.white,
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide.none),
                        hintText: 'Message',
                      ),
                      textInputAction: TextInputAction.send,
                      onSubmitted: (value) {
                        if (value.trim().isNotEmpty) _send(value);
                      },
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.send, color: Color(0xFF25D366)),
                    onPressed: _sending ? null : () => _send(_controller.text),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message});
  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final isUser = message.isUser;
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(12),
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.75),
        decoration: BoxDecoration(
          color: isUser ? const Color(0xFFDCF8C6) : Colors.white,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(message.text, style: MrText.sans(size: 14)),
      ),
    );
  }
}
