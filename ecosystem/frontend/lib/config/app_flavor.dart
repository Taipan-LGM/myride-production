/// My Ride app flavor — separate rider/driver builds.
enum AppFlavor {
  /// Dev hub: pick Rider or Driver journey.
  dev,

  /// Rider app (`com.myride.rider`).
  rider,

  /// Driver app (`com.myride.driver`).
  driver,

  /// Admin console (`com.myride.admin`).
  admin,
}

extension AppFlavorX on AppFlavor {
  String get displayName => switch (this) {
        AppFlavor.dev => 'My Ride Dev',
        AppFlavor.rider => 'My Ride',
        AppFlavor.driver => 'My Ride Driver',
        AppFlavor.admin => 'My Ride Admin',
      };

  String get androidApplicationId => switch (this) {
        AppFlavor.dev => 'com.myride.dev',
        AppFlavor.rider => 'com.myride.rider',
        AppFlavor.driver => 'com.myride.driver',
        AppFlavor.admin => 'com.myride.admin',
      };

  String get initialRoute => switch (this) {
        AppFlavor.dev => '/',
        AppFlavor.rider => '/rider/login',
        AppFlavor.driver => '/driver/login',
        AppFlavor.admin => '/admin/login',
      };

  bool get isRider => this == AppFlavor.rider || this == AppFlavor.dev;
  bool get isDriver => this == AppFlavor.driver || this == AppFlavor.dev;
}
