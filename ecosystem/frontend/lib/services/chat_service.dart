import 'package:flutter/foundation.dart';
import 'package:my_ride/models/api_models.dart';
import 'package:my_ride/services/trip_session_service.dart';

/// WhatsApp-style AI chat backed by FastAPI /ai/parse.
class ChatService extends ChangeNotifier {
  ChatService._();
  static final ChatService instance = ChatService._();

  final List<ChatMessage> messages = [];
  bool isSending = false;

  void seedWelcome() {
    if (messages.isNotEmpty) return;
    messages.add(
      ChatMessage(
        text: 'Hi! I\'m My Ride assistant. Book a ride, check status, or ask for help.',
        isUser: false,
        timestamp: DateTime.now(),
      ),
    );
    notifyListeners();
  }

  Future<void> send(String text) async {
    if (text.trim().isEmpty) return;
    messages.add(ChatMessage(text: text.trim(), isUser: true, timestamp: DateTime.now()));
    isSending = true;
    notifyListeners();

    try {
      final ai = await TripSessionService.instance.parseMessage(text, channel: 'whatsapp');
      messages.add(
        ChatMessage(
          text: ai.reply ?? 'Got it.',
          isUser: false,
          timestamp: DateTime.now(),
          intent: ai.intent,
        ),
      );

      if (ai.intent == 'book_ride') {
        final trip = await TripSessionService.instance.bookFromAi(text);
        if (trip != null) {
          messages.add(
            ChatMessage(
              text: 'Ride booked · ref ${trip.id.substring(0, 8)} · ${trip.status.label}',
              isUser: false,
              timestamp: DateTime.now(),
              intent: 'trip_created',
            ),
          );
        }
      }
    } catch (e) {
      messages.add(
        ChatMessage(
          text: 'Could not reach My Ride API. Start backend: cd backend && ./start_api.sh',
          isUser: false,
          timestamp: DateTime.now(),
        ),
      );
    } finally {
      isSending = false;
      notifyListeners();
    }
  }

  void clear() {
    messages.clear();
    seedWelcome();
  }
}
