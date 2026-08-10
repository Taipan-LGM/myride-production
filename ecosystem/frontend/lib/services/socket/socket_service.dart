import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/models/ride/ride_status.dart';
import 'package:my_ride/services/legacy/legacy_auth_service.dart';
import 'package:my_ride/services/socket/socket_constants.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

/// Socket.io client for legacy Node backend.
class SocketIoService extends ChangeNotifier {
  SocketIoService({LegacyAuthService? auth})
      : _auth = auth ?? LegacyAuthService.instance;

  final LegacyAuthService _auth;
  io.Socket? _socket;
  bool _connected = false;
  bool _connecting = false;

  final _rideIncoming = StreamController<Map<String, dynamic>>.broadcast();
  final _rideMatched = StreamController<Map<String, dynamic>>.broadcast();
  final _rideStatus = StreamController<RideStatusUpdate>.broadcast();
  final _rideEta = StreamController<Map<String, dynamic>>.broadcast();
  final _driverLocation = StreamController<Map<String, dynamic>>.broadcast();
  final _errors = StreamController<String>.broadcast();

  Stream<Map<String, dynamic>> get rideIncoming => _rideIncoming.stream;
  Stream<Map<String, dynamic>> get rideMatched => _rideMatched.stream;
  Stream<RideStatusUpdate> get rideStatus => _rideStatus.stream;
  Stream<Map<String, dynamic>> get rideEta => _rideEta.stream;
  Stream<Map<String, dynamic>> get driverLocation => _driverLocation.stream;
  Stream<String> get errors => _errors.stream;

  bool get isConnected => _connected;

  Future<void> connect() async {
    if (_connected || _connecting) return;
    _connecting = true;
    notifyListeners();

    try {
      final token = await _auth.getToken();
      if (token == null || token.isEmpty) {
        throw Exception('not_authenticated');
      }

      _socket?.dispose();
      _socket = io.io(
        AppConfig.socketBaseUrl,
        io.OptionBuilder()
            .setTransports(['websocket', 'polling'])
            .setAuth({'token': token})
            .enableAutoConnect()
            .enableReconnection()
            .setReconnectionAttempts(SocketConfig.maxReconnectAttempts)
            .setReconnectionDelay(SocketConfig.reconnectInterval.inMilliseconds)
            .build(),
      );

      _socket!
        ..onConnect((_) => _onConnect())
        ..onConnectError((e) => _onConnectError(e))
        ..onDisconnect((_) => _onDisconnect())
        ..onError((e) => _onError(e));

      _setupListeners();
    } catch (e) {
      _connecting = false;
      _errors.add(e.toString());
      notifyListeners();
    }
  }

  void disconnect() {
    _socket?.dispose();
    _socket = null;
    _connected = false;
    _connecting = false;
    notifyListeners();
  }

  void _onConnect() {
    _connected = true;
    _connecting = false;
    notifyListeners();
    if (kDebugMode) debugPrint('[SocketIo] connected');

    _auth.getUserRole().then((role) {
      if (role == 'driver') emitDriverOnline(true);
    });
  }

  void _onConnectError(dynamic error) {
    _connecting = false;
    _errors.add('$error');
    notifyListeners();
  }

  void _onDisconnect() {
    _connected = false;
    notifyListeners();
  }

  void _onError(dynamic error) {
    _errors.add('$error');
  }

  void _setupListeners() {
    void mapEvent(String event, void Function(dynamic) handler) {
      _socket?.on(event, handler);
    }

    mapEvent(SocketEvents.rideIncoming, (d) => _rideIncoming.add(_asMap(d)));
    mapEvent(SocketEvents.rideRequestLegacy, (d) {
      final m = _asMap(d);
      if (m.containsKey('ride_id') || m.containsKey('pickup')) {
        _rideIncoming.add(m);
      }
    });
    mapEvent(SocketEvents.rideMatched, (d) => _rideMatched.add(_asMap(d)));
    mapEvent(SocketEvents.rideUpdated, (d) {
      final m = _asMap(d);
      final ride = m['ride'];
      if (ride is Map<String, dynamic>) {
        _rideStatus.add(RideStatusUpdate.fromLegacyRide(ride));
      }
    });
    mapEvent(SocketEvents.rideStatusUpdate, (d) {
      _rideStatus.add(RideStatusUpdate.fromJson(_asMap(d)));
    });
    mapEvent(SocketEvents.rideRestored, (d) {
      _rideStatus.add(RideStatusUpdate.fromJson(_asMap(d)));
    });
    mapEvent(SocketEvents.rideCancelled, (d) {
      final m = _asMap(d);
      final ride = m['ride'];
      if (ride is Map<String, dynamic>) {
        _rideStatus.add(RideStatusUpdate(
          rideId: ride['id']?.toString() ?? '',
          status: 'cancelled',
          updatedAt: DateTime.now(),
          reason: m['reason'] as String?,
          rawRide: ride,
        ));
      }
    });
    mapEvent(SocketEvents.rideEtaUpdate, (d) => _rideEta.add(_asMap(d)));
    mapEvent(SocketEvents.driverLocationUpdate, (d) => _driverLocation.add(_asMap(d)));
    mapEvent(SocketEvents.socketError, (d) {
      final m = _asMap(d);
      _errors.add(m['message']?.toString() ?? m['error']?.toString() ?? 'socket_error');
    });
  }

  Map<String, dynamic> _asMap(dynamic data) {
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return Map<String, dynamic>.from(data);
    return {'value': data};
  }

  void emitDriverOnline(bool online) {
    if (!_connected) return;
    _socket?.emit(SocketEvents.driverSetOnline, {'online': online});
    _socket?.emit(SocketEvents.driverStatus, {'status': online ? 'online' : 'offline'});
  }

  void emitDriverLocation({
    required double lat,
    required double lng,
    int bearing = 0,
    double speed = 0,
  }) {
    if (!_connected) return;
    final payload = {
      'lat': lat,
      'lng': lng,
      'bearing': bearing,
      'speed': speed,
    };
    _socket?.emit(SocketEvents.driverUpdateLocation, payload);
    _socket?.emit(SocketEvents.driverLocation, payload);
  }

  void joinRide(String rideId) {
    _socket?.emit(SocketEvents.rideJoin, {'ride_id': rideId});
  }

  void requestDriverLocation(String rideId) {
    _socket?.emit(SocketEvents.locationRequest, {'ride_id': rideId});
  }

  @override
  void dispose() {
    disconnect();
    _rideIncoming.close();
    _rideMatched.close();
    _rideStatus.close();
    _rideEta.close();
    _driverLocation.close();
    _errors.close();
    super.dispose();
  }
}
