import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/core/api/api_config.dart';
import 'package:my_ride/models/app_user.dart';
import 'package:my_ride/providers/auth_provider.dart';
import 'package:my_ride/services/auth_service.dart';
import 'package:my_ride/services/secure_storage_service.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/widgets/motion/mr_glow_button.dart';

class ProfileSetupScreen extends ConsumerStatefulWidget {
  const ProfileSetupScreen({super.key});

  @override
  ConsumerState<ProfileSetupScreen> createState() => _ProfileSetupScreenState();
}

class _ProfileSetupScreenState extends ConsumerState<ProfileSetupScreen> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _vehicleMake = TextEditingController();
  final _vehicleModel = TextEditingController();
  final _vehiclePlate = TextEditingController();
  bool _loading = false;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _vehicleMake.dispose();
    _vehicleModel.dispose();
    _vehiclePlate.dispose();
    super.dispose();
  }

  Future<void> _complete() async {
    if (_name.text.trim().isEmpty) return;
    setState(() => _loading = true);
    final auth = ref.read(authProvider);
    final existingUser = auth.user;
    final role = existingUser?.role ?? auth.pendingRole ?? UserRole.rider;
    if (existingUser == null && !AppConfig.useMockAuth) {
      setState(() => _loading = false);
      throw StateError('Verified login required before profile setup');
    }
    final id = existingUser?.id ??
        (role == UserRole.driver ? ApiConfig.defaultDriverId : ApiConfig.defaultRiderId);
    final user = AppUser(
      id: id,
      role: role,
      name: _name.text.trim(),
      email: _email.text.trim().isEmpty ? null : _email.text.trim(),
      phone: AuthService.instance.phoneNumber,
      vehicleMake: role == UserRole.driver ? _vehicleMake.text.trim() : null,
      vehicleModel: role == UserRole.driver ? _vehicleModel.text.trim() : null,
      vehiclePlate: role == UserRole.driver ? _vehiclePlate.text.trim() : null,
      profileComplete: true,
    );
    await SecureStorageService.instance.saveUser(user);
    ref.read(authProvider.notifier).setUser(user);
    if (!mounted) return;
    context.go(role == UserRole.driver ? '/driver/home' : '/rider/home');
  }

  @override
  Widget build(BuildContext context) {
    final isDriver = ref.watch(authProvider).pendingRole == UserRole.driver;
    return Scaffold(
      appBar: AppBar(title: const Text('Complete profile')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Center(
            child: GestureDetector(
              onTap: () {},
              child: CircleAvatar(
                radius: 48,
                backgroundColor: Colors.grey.shade200,
                child: const Icon(Icons.camera_alt, size: 32),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Center(child: Text('Profile photo (optional)', style: MrText.sans(size: 12))),
          const SizedBox(height: 24),
          TextField(controller: _name, decoration: const InputDecoration(labelText: 'Full name *', border: OutlineInputBorder())),
          const SizedBox(height: 12),
          TextField(controller: _email, decoration: const InputDecoration(labelText: 'Email', border: OutlineInputBorder()), keyboardType: TextInputType.emailAddress),
          if (isDriver) ...[
            const SizedBox(height: 12),
            TextField(controller: _vehicleMake, decoration: const InputDecoration(labelText: 'Vehicle make', border: OutlineInputBorder())),
            const SizedBox(height: 12),
            TextField(controller: _vehicleModel, decoration: const InputDecoration(labelText: 'Vehicle model', border: OutlineInputBorder())),
            const SizedBox(height: 12),
            TextField(controller: _vehiclePlate, decoration: const InputDecoration(labelText: 'License plate', border: OutlineInputBorder())),
          ],
          const SizedBox(height: 32),
          MrGlowButton(label: _loading ? 'Saving…' : 'Get started', fullWidth: true, onPressed: _loading ? null : _complete),
        ],
      ),
    );
  }
}
