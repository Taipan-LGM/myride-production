/// Socket.io event names — aligned with legacy Node backend.
abstract final class SocketEvents {
  // Driver → server
  static const driverSetOnline = 'driver:setOnline';
  static const driverStatus = 'driver:status';
  static const driverUpdateLocation = 'driver:updateLocation';
  static const driverLocation = 'driver:location';
  static const rideAccept = 'ride:accept';
  static const rideDecline = 'ride:decline';
  static const rideStart = 'ride:start';
  static const rideComplete = 'ride:complete';

  // Customer → server
  static const rideJoin = 'ride:join';
  static const rideRequest = 'ride:request';
  static const rideCancel = 'ride:cancel';
  static const locationRequest = 'location:request';
  static const chatMessage = 'chat:message';

  // Server → client
  static const hello = 'hello';
  static const rideIncoming = 'ride:incoming';
  static const rideRequestLegacy = 'ride:request';
  static const rideMatched = 'ride:matched';
  static const rideUpdated = 'ride:updated';
  static const rideCancelled = 'ride:cancelled';
  static const rideStatusUpdate = 'ride:status_update';
  static const rideEtaUpdate = 'ride:eta_update';
  static const rideRestored = 'ride:restored';
  static const driverLocationUpdate = 'driver:location_update';
  static const driverStatusChanged = 'driver:status_changed';
  static const socketError = 'socket:error';

  static const ping = 'ping';
  static const pong = 'pong';
  static const error = 'error';
}

abstract final class SocketConfig {
  static const reconnectInterval = Duration(seconds: 2);
  static const locationInterval = Duration(seconds: 3);
  static const maxReconnectAttempts = 5;
}
