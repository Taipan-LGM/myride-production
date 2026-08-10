class VehicleInfo {
  const VehicleInfo({
    this.make,
    this.model,
    this.color,
    required this.plateNumber,
    required this.vehicleType,
  });

  final String? make;
  final String? model;
  final String? color;
  final String plateNumber;
  final String vehicleType;

  factory VehicleInfo.fromJson(Map<String, dynamic> json) => VehicleInfo(
        make: json['make'] as String?,
        model: json['model'] as String?,
        color: json['color'] as String?,
        plateNumber: json['plate_number'] as String? ?? json['plate'] as String? ?? '',
        vehicleType: json['vehicle_type'] as String? ?? 'Car',
      );
}

class DriverLocation {
  const DriverLocation({
    required this.lat,
    required this.lng,
    required this.bearing,
    required this.speed,
    required this.lastUpdated,
  });

  final double lat;
  final double lng;
  final int bearing;
  final double speed;
  final DateTime lastUpdated;

  factory DriverLocation.fromJson(Map<String, dynamic> json) {
    final raw = json['last_updated'] ?? json['timestamp'];
    DateTime updated = DateTime.now();
    if (raw is String) {
      updated = DateTime.tryParse(raw) ?? updated;
    }
    return DriverLocation(
      lat: (json['lat'] as num).toDouble(),
      lng: (json['lng'] as num).toDouble(),
      bearing: (json['bearing'] as num?)?.round() ?? 0,
      speed: (json['speed'] as num?)?.toDouble() ?? 0,
      lastUpdated: updated,
    );
  }
}

class NearbyDriver {
  const NearbyDriver({
    required this.driverId,
    required this.userId,
    required this.name,
    required this.rating,
    required this.vehicle,
    required this.location,
    required this.distance,
    required this.isAvailable,
  });

  final String driverId;
  final String userId;
  final String name;
  final double rating;
  final VehicleInfo vehicle;
  final DriverLocation location;
  final int distance;
  final bool isAvailable;

  factory NearbyDriver.fromJson(Map<String, dynamic> json) => NearbyDriver(
        driverId: json['driver_id']?.toString() ?? json['user_id']?.toString() ?? '',
        userId: json['user_id']?.toString() ?? json['driver_id']?.toString() ?? '',
        name: json['name'] as String? ?? 'Driver',
        rating: (json['rating'] as num?)?.toDouble() ?? 0,
        vehicle: VehicleInfo.fromJson(
          (json['vehicle'] as Map<String, dynamic>?) ?? const {},
        ),
        location: DriverLocation.fromJson(
          (json['location'] as Map<String, dynamic>?) ?? const {'lat': 0, 'lng': 0},
        ),
        distance: (json['distance'] as num?)?.round() ?? 0,
        isAvailable: json['is_available'] as bool? ?? true,
      );

  String get formattedDistance {
    if (distance < 1000) return '${distance}m';
    return '${(distance / 1000).toStringAsFixed(1)}km';
  }

  int get etaMinutes {
    const avgSpeedMs = 8.33;
    return (distance / avgSpeedMs / 60).ceil().clamp(1, 99);
  }
}
