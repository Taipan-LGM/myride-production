import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:my_ride/models/api_models.dart';

final chatProvider = StateNotifierProvider.family<ChatNotifier, ChatState, String>((ref, tripId) => ChatNotifier(tripId));

class ChatState {
  const ChatState({
    this.messages = const [],
    this.isTyping = false,
    this.unreadCount = 0,
    this.offlineQueue = const [],
  });

  final List<ChatMessage> messages;
  final bool isTyping;
  final int unreadCount;
  final List<String> offlineQueue;

  ChatState copyWith({
    List<ChatMessage>? messages,
    bool? isTyping,
    int? unreadCount,
    List<String>? offlineQueue,
  }) =>
      ChatState(
        messages: messages ?? this.messages,
        isTyping: isTyping ?? this.isTyping,
        unreadCount: unreadCount ?? this.unreadCount,
        offlineQueue: offlineQueue ?? this.offlineQueue,
      );
}

class ChatNotifier extends StateNotifier<ChatState> {
  ChatNotifier(this.tripId) : super(const ChatState());

  final String tripId;

  void addMessage(ChatMessage msg) => state = state.copyWith(messages: [...state.messages, msg]);

  /// Avoid duplicate bubbles when HTTP + WebSocket both deliver the same line.
  void addMessageIfAbsent(ChatMessage msg) {
    final exists = state.messages.any((m) => m.text == msg.text && m.isUser == msg.isUser);
    if (!exists) addMessage(msg);
  }

  void setTyping(bool v) => state = state.copyWith(isTyping: v);

  void queueOffline(String text) => state = state.copyWith(offlineQueue: [...state.offlineQueue, text]);

  void clearQueue() => state = state.copyWith(offlineQueue: []);

  void markRead() => state = state.copyWith(unreadCount: 0);
}
