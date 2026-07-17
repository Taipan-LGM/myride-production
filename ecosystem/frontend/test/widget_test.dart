import 'package:flutter_test/flutter_test.dart';
import 'package:my_ride/app.dart';

void main() {
  testWidgets('My Ride ecosystem shell loads', (WidgetTester tester) async {
    await tester.pumpWidget(const MyRideApp());
    await tester.pump();
    expect(find.text('My Ride'), findsOneWidget);
    expect(find.text('Rider'), findsWidgets);
    expect(find.text('Driver'), findsOneWidget);
    expect(find.text('Admin'), findsOneWidget);
  });
}
