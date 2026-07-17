import 'package:flutter_riverpod/flutter_riverpod.dart';

class AppNotification {
  const AppNotification({required this.title, required this.body, this.type, this.tripId});
  final String title;
  final String body;
  final String? type;
  final String? tripId;
}

class NotificationState {
  const NotificationState({this.pushEnabled = false, this.inApp = const []});
  final bool pushEnabled;
  final List<AppNotification> inApp;

  NotificationState copyWith({bool? pushEnabled, List<AppNotification>? inApp}) =>
      NotificationState(pushEnabled: pushEnabled ?? this.pushEnabled, inApp: inApp ?? this.inApp);
}

final notificationProvider = StateNotifierProvider<NotificationNotifier, NotificationState>((ref) => NotificationNotifier());

class NotificationNotifier extends StateNotifier<NotificationState> {
  NotificationNotifier() : super(const NotificationState());

  void setPushEnabled(bool v) => state = state.copyWith(pushEnabled: v);

  void push(AppNotification n) => state = state.copyWith(inApp: [n, ...state.inApp]);

  void clear() => state = state.copyWith(inApp: []);
}
