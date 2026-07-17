import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/providers/auth_provider.dart';
import 'package:my_ride/services/secure_storage_service.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/common/mr_cached_avatar.dart';

/// Rider profile tab — settings, logout, account info.
class RiderProfileScreen extends ConsumerWidget {
  const RiderProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authProvider).user;
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Row(
            children: [
              MrCachedAvatar(name: user?.name, radius: 36),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(user?.name ?? 'Rider', style: MrText.sans(size: 20, weight: FontWeight.w700)),
                    Text(user?.phone ?? user?.email ?? '', style: MrText.sans(color: MrColors.textSecondary)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          ListTile(
            leading: const Icon(Icons.settings_outlined),
            title: const Text('Settings'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/settings'),
          ),
          ListTile(
            leading: const Icon(Icons.chat_bubble_outline),
            title: const Text('AI Chat'),
            onTap: () => context.push('/chat'),
          ),
          ListTile(
            leading: const Icon(Icons.mic_none),
            title: const Text('Voice booking'),
            onTap: () => context.push('/voice'),
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.logout, color: MrColors.accent),
            title: const Text('Log out'),
            onTap: () async {
              await SecureStorageService.instance.clear();
              ref.read(authProvider.notifier).logout();
              if (context.mounted) context.go('/welcome');
            },
          ),
        ],
      ),
    );
  }
}
