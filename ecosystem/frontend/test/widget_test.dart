import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:my_ride/app.dart';

void main() {
  testWidgets('My Ride rider welcome screen loads', (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(child: MyRideApp()),
    );
    await tester.pump();
    expect(find.text('Continue as Rider'), findsOneWidget);
    expect(find.text('Continue as Driver'), findsOneWidget);
  });
}
