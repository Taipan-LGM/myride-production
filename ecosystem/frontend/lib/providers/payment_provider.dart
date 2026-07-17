import 'package:flutter_riverpod/flutter_riverpod.dart';

class PaymentMethodInfo {
  const PaymentMethodInfo({required this.id, required this.brand, required this.last4, this.isDefault = false});
  final String id;
  final String brand;
  final String last4;
  final bool isDefault;
}

class TransactionInfo {
  const TransactionInfo({
    required this.id,
    required this.amountCents,
    required this.status,
    required this.date,
    this.description,
  });
  final String id;
  final int amountCents;
  final String status;
  final DateTime date;
  final String? description;
}

class PaymentState {
  const PaymentState({
    this.methods = const [],
    this.transactions = const [],
    this.walletBalance = 0,
    this.clientSecret,
    this.isLoading = false,
    this.error,
  });

  final List<PaymentMethodInfo> methods;
  final List<TransactionInfo> transactions;
  final double walletBalance;
  final String? clientSecret;
  final bool isLoading;
  final String? error;

  PaymentState copyWith({
    List<PaymentMethodInfo>? methods,
    List<TransactionInfo>? transactions,
    double? walletBalance,
    String? clientSecret,
    bool? isLoading,
    String? error,
  }) =>
      PaymentState(
        methods: methods ?? this.methods,
        transactions: transactions ?? this.transactions,
        walletBalance: walletBalance ?? this.walletBalance,
        clientSecret: clientSecret ?? this.clientSecret,
        isLoading: isLoading ?? this.isLoading,
        error: error,
      );
}

final paymentProvider = StateNotifierProvider<PaymentNotifier, PaymentState>((ref) => PaymentNotifier());

class PaymentNotifier extends StateNotifier<PaymentState> {
  PaymentNotifier()
      : super(
          const PaymentState(
            methods: [PaymentMethodInfo(id: 'pm_1', brand: 'Visa', last4: '4242', isDefault: true)],
            walletBalance: 24.50,
          ),
        );

  void setClientSecret(String? secret) => state = state.copyWith(clientSecret: secret);

  void setLoading(bool v) => state = state.copyWith(isLoading: v);

  void addTransaction(TransactionInfo tx) => state = state.copyWith(transactions: [tx, ...state.transactions]);
}
