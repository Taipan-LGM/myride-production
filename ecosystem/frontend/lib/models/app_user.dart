enum UserRole { rider, driver, admin }

class AppUser {
  const AppUser({
    required this.id,
    required this.role,
    required this.name,
    this.email,
    this.phone,
    this.photoUrl,
    this.vehicleMake,
    this.vehicleModel,
    this.vehiclePlate,
    this.profileComplete = false,
  });

  final String id;
  final UserRole role;
  final String name;
  final String? email;
  final String? phone;
  final String? photoUrl;
  final String? vehicleMake;
  final String? vehicleModel;
  final String? vehiclePlate;
  final bool profileComplete;

  AppUser copyWith({
    String? id,
    UserRole? role,
    String? name,
    String? email,
    String? phone,
    String? photoUrl,
    String? vehicleMake,
    String? vehicleModel,
    String? vehiclePlate,
    bool? profileComplete,
  }) =>
      AppUser(
        id: id ?? this.id,
        role: role ?? this.role,
        name: name ?? this.name,
        email: email ?? this.email,
        phone: phone ?? this.phone,
        photoUrl: photoUrl ?? this.photoUrl,
        vehicleMake: vehicleMake ?? this.vehicleMake,
        vehicleModel: vehicleModel ?? this.vehicleModel,
        vehiclePlate: vehiclePlate ?? this.vehiclePlate,
        profileComplete: profileComplete ?? this.profileComplete,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'role': role.name,
        'name': name,
        'email': email,
        'phone': phone,
        'photoUrl': photoUrl,
        'vehicleMake': vehicleMake,
        'vehicleModel': vehicleModel,
        'vehiclePlate': vehiclePlate,
        'profileComplete': profileComplete,
      };

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
        id: json['id'] as String,
        role: UserRole.values.byName(json['role'] as String? ?? 'rider'),
        name: json['name'] as String? ?? '',
        email: json['email'] as String?,
        phone: json['phone'] as String?,
        photoUrl: json['photoUrl'] as String?,
        vehicleMake: json['vehicleMake'] as String?,
        vehicleModel: json['vehicleModel'] as String?,
        vehiclePlate: json['vehiclePlate'] as String?,
        profileComplete: json['profileComplete'] as bool? ?? false,
      );
}
