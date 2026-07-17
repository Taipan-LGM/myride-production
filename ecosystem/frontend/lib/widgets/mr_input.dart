import 'package:flutter/material.dart';
import '../theme/mr_tokens.dart';

class MrInput extends StatelessWidget {
  const MrInput({
    super.key,
    this.label,
    this.hint,
    this.errorText,
    this.controller,
    this.keyboardType,
    this.obscureText = false,
    this.onChanged,
  });

  final String? label;
  final String? hint;
  final String? errorText;
  final TextEditingController? controller;
  final TextInputType? keyboardType;
  final bool obscureText;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (label != null)
          Padding(
            padding: const EdgeInsets.only(bottom: MrSpacing.sm / 2),
            child: Text(label!, style: const TextStyle(fontSize: 13, color: MrColors.textSecondary)),
          ),
        SizedBox(
          height: MrSpacing.inputHeight,
          child: TextField(
            controller: controller,
            keyboardType: keyboardType,
            obscureText: obscureText,
            onChanged: onChanged,
            decoration: InputDecoration(
              hintText: hint,
              errorText: errorText,
              contentPadding: const EdgeInsets.symmetric(horizontal: MrSpacing.md),
            ),
          ),
        ),
      ],
    );
  }
}
