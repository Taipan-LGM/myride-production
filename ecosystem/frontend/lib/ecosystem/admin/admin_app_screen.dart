import 'package:flutter/material.dart';
import 'package:my_ride/screens/showcase/admin_live_screen.dart';

class AdminAppScreen extends StatelessWidget {
  const AdminAppScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const AdminLiveScreen(embed: true);
  }
}
