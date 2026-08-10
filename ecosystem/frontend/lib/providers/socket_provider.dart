import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/models/ride/ride_status.dart';
import 'package:my_ride/services/legacy/legacy_auth_service.dart';
import 'package:my_ride/services/socket/socket_service.dart';

final legacyAuthProvider = Provider<LegacyAuthService>((ref) => LegacyAuthService.instance);

final socketIoServiceProvider = Provider<SocketIoService>((ref) {
  final service = SocketIoService();
  ref.onDispose(service.dispose);
  return service;
});

/// Connect Socket.io when legacy backend + JWT session is active.
final socketConnectionProvider = Provider<void>((ref) {
  if (!AppConfig.legacyBackend) return;

  final auth = ref.watch(legacyAuthProvider);
  final socket = ref.watch(socketIoServiceProvider);

  if (auth.isAuthenticated && !socket.isConnected) {
    unawaited(socket.connect());
  }
});

final rideStatusStreamProvider = StreamProvider<RideStatusUpdate>((ref) {
  ref.watch(socketConnectionProvider);
  return ref.watch(socketIoServiceProvider).rideStatus;
});

final driverLocationStreamProvider = StreamProvider<Map<String, dynamic>>((ref) {
  ref.watch(socketConnectionProvider);
  return ref.watch(socketIoServiceProvider).driverLocation;
});

final rideEtaStreamProvider = StreamProvider<Map<String, dynamic>>((ref) {
  ref.watch(socketConnectionProvider);
  return ref.watch(socketIoServiceProvider).rideEta;
});

final incomingRideStreamProvider = StreamProvider<Map<String, dynamic>>((ref) {
  ref.watch(socketConnectionProvider);
  final socket = ref.watch(socketIoServiceProvider);
  return Stream.multi((controller) {
    final subs = [
      socket.rideIncoming.listen(controller.add),
      socket.rideMatched.listen(controller.add),
    ];
    controller.onCancel = () {
      for (final s in subs) {
        s.cancel();
      }
    };
  });
});
