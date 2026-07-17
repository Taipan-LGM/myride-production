import 'package:flutter/material.dart';
import 'package:my_ride/models/api_models.dart';
import 'package:my_ride/services/chat_service.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/theme/mr_tokens.dart';

/// WhatsApp-style chat UI powered by FastAPI /ai/parse.
class WhatsAppChatScreen extends StatefulWidget {
  const WhatsAppChatScreen({super.key});

  @override
  State<WhatsAppChatScreen> createState() => _WhatsAppChatScreenState();
}

class _WhatsAppChatScreenState extends State<WhatsAppChatScreen> {
  final _controller = TextEditingController();
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    ChatService.instance.addListener(_onChat);
    ChatService.instance.seedWelcome();
  }

  void _onChat() {
    if (mounted) {
      setState(() {});
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) {
          _scroll.animateTo(
            _scroll.position.maxScrollExtent,
            duration: const Duration(milliseconds: 250),
            curve: Curves.easeOut,
          );
        }
      });
    }
  }

  @override
  void dispose() {
    ChatService.instance.removeListener(_onChat);
    _controller.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final text = _controller.text;
    _controller.clear();
    await ChatService.instance.send(text);
  }

  @override
  Widget build(BuildContext context) {
    final chat = ChatService.instance;
    return Scaffold(
      backgroundColor: const Color(0xFFECE5DD),
      appBar: AppBar(
        backgroundColor: const Color(0xFF075E54),
        foregroundColor: Colors.white,
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('My Ride Assistant'),
            Text('AI · WhatsApp channel', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w400)),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Clear chat',
            onPressed: ChatService.instance.clear,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView.builder(
              controller: _scroll,
              padding: const EdgeInsets.all(12),
              itemCount: chat.messages.length,
              itemBuilder: (_, i) => _Bubble(message: chat.messages[i]),
            ),
          ),
          if (chat.isSending)
            const Padding(
              padding: EdgeInsets.only(bottom: 4),
              child: Text('My Ride is typing…', style: TextStyle(fontSize: 12, color: Colors.black54)),
            ),
          SafeArea(
            child: Container(
              color: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      decoration: InputDecoration(
                        hintText: 'Book a ride from CBD to waterfront…',
                        filled: true,
                        fillColor: MrColors.neutral100,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(24),
                          borderSide: BorderSide.none,
                        ),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      ),
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _send(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Material(
                    color: const Color(0xFF25D366),
                    shape: const CircleBorder(),
                    child: InkWell(
                      onTap: chat.isSending ? null : _send,
                      customBorder: const CircleBorder(),
                      child: const Padding(
                        padding: EdgeInsets.all(12),
                        child: Icon(Icons.send, color: Colors.white, size: 20),
                      ),
                    ),
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
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.78),
        decoration: BoxDecoration(
          color: isUser ? const Color(0xFFDCF8C6) : Colors.white,
          borderRadius: BorderRadius.circular(12),
          boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 2, offset: Offset(0, 1))],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(message.text, style: MrText.sans(size: 14)),
            if (message.intent != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(message.intent!, style: MrText.sans(size: 10, color: MrColors.textSecondary)),
              ),
          ],
        ),
      ),
    );
  }
}
