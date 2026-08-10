import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:my_ride/models/app_user.dart';

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) => AuthNotifier());

class AuthState {
  const AuthState({
    this.user,
    this.isLoading = false,
    this.isAuthenticated = false,
    this.error,
    this.pendingRole,
  });

  final AppUser? user;
  final bool isLoading;
  final bool isAuthenticated;
  final String? error;
  final UserRole? pendingRole;

  UserRole? get userRole => user?.role;

  AuthState copyWith({
    AppUser? user,
    bool? isLoading,
    bool? isAuthenticated,
    String? error,
    UserRole? pendingRole,
  }) =>
      AuthState(
        user: user ?? this.user,
        isLoading: isLoading ?? this.isLoading,
        isAuthenticated: isAuthenticated ?? this.isAuthenticated,
        error: error,
        pendingRole: pendingRole ?? this.pendingRole,
      );
}

class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier() : super(const AuthState());

  void setPendingRole(UserRole role) => state = state.copyWith(pendingRole: role);

  void setUser(AppUser user) => state = state.copyWith(user: user, isAuthenticated: true, isLoading: false);

  void setLoading(bool v) => state = state.copyWith(isLoading: v);

  void setError(String? e) => state = state.copyWith(error: e, isLoading: false);

  void logout() => state = const AuthState();
}
