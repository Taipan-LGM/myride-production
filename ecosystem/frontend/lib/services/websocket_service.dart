import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:my_ride/core/api/api_config.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

enum WebSocketStatus { connecting, connected, disconnected, error }

typedef WsEventHandler = void Function(String event, Map<String, dynamic> data);

/// WebSocket manager with auto-reconnect, heartbeat, debug logging, and event routing.
class WebSocketService extends ChangeNotifier {
  WebSocketService({this.path = '', this.onEvent});

  final String path;
  final WsEventHandler? onEvent;

  WebSocketChannel? _channel;
  StreamSubscription? _sub;
  Timer? _heartbeat;
  WebSocketStatus status = WebSocketStatus.disconnected;
  int _reconnectAttempts = 0;
  static const _maxReconnect = 5;
  String? _lastUrl;

  void connect({String? overridePath}) {
    disconnect();
    status = WebSocketStatus.connecting;
    notifyListeners();

    final p = overridePath ?? path;
    final uri = ApiConfig.wsUri(p);
    _lastUrl = uri.toString();

    if (kDebugMode) {
      debugPrint('🔌 WebSocket connecting to: $_lastUrl');
    }

    try {
      _channel = WebSocketChannel.connect(uri);
      status = WebSocketStatus.connected;
      _reconnectAttempts = 0;
      _sub = _channel!.stream.listen(_onMessage, onError: _onError, onDone: _onDone);
      _heartbeat = Timer.periodic(const Duration(seconds: 30), (_) {
        _channel?.sink.add(jsonEncode({'type': 'ping'}));
      });
      notifyListeners();
      if (kDebugMode) debugPrint('✅ WebSocket connected: $_lastUrl');
    } catch (e) {
      if (kDebugMode) debugPrint('❌ WebSocket connect error: $e');
      status = WebSocketStatus.error;
      notifyListeners();
      _scheduleReconnect(overridePath: overridePath);
    }
  }

  void _onMessage(dynamic raw) {
    if (kDebugMode) {
      debugPrint('📩 WebSocket message received: $raw');
    }
    try {
      final map = jsonDecode(raw as String) as Map<String, dynamic>;
      final event = map['event'] as String? ?? map['type'] as String? ?? 'message';
      final data = (map['data'] as Map<String, dynamic>?) ?? map;
      onEvent?.call(event, data);
    } catch (e) {
      if (kDebugMode) debugPrint('❌ WebSocket parse error: $e');
    }
  }

  void _onError(Object error) {
    if (kDebugMode) debugPrint('❌ WebSocket error: $error');
    status = WebSocketStatus.error;
    notifyListeners();
    _scheduleReconnect();
  }

  void _onDone() {
    if (kDebugMode) debugPrint('🔌 WebSocket closed: $_lastUrl');
    status = WebSocketStatus.disconnected;
    notifyListeners();
    _scheduleReconnect();
  }

  void _scheduleReconnect({String? overridePath}) {
    if (_reconnectAttempts >= _maxReconnect) {
      if (kDebugMode) debugPrint('❌ WebSocket max reconnect attempts reached');
      return;
    }
    _reconnectAttempts++;
    final delay = Duration(seconds: 1 << _reconnectAttempts.clamp(1, 4));
    if (kDebugMode) {
      debugPrint('🔄 WebSocket reconnect in ${delay.inSeconds}s (attempt $_reconnectAttempts)');
    }
    Future.delayed(delay, () {
      if (status != WebSocketStatus.connected) connect(overridePath: overridePath);
    });
  }

  void send(Map<String, dynamic> payload) {
    if (kDebugMode) debugPrint('📤 WebSocket send: $payload');
    _channel?.sink.add(jsonEncode(payload));
  }

  void disconnect() {
    _heartbeat?.cancel();
    _sub?.cancel();
    _channel?.sink.close();
    _channel = null;
    status = WebSocketStatus.disconnected;
  }

  @override
  void dispose() {
    disconnect();
    super.dispose();
  }
}
