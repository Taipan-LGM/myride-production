# test_stripe.py
import sys
import os

# Add the current directory to path
sys.path.insert(0, os.getcwd())

# Import the stripe service
from services.stripe_service import (
    get_stripe_client,
    create_payment_intent,
    is_stripe_configured,
    create_mock_payment_intent
)

print("=" * 50)
print("🧪 TESTING STRIPE LAZY LOADING")
print("=" * 50)

# Test 1: Get client (should not crash even without Stripe installed)
print("\n📌 Test 1: Getting Stripe client...")
client = get_stripe_client()
print(f"   Client: {client}")

# Test 2: Check if configured
print("\n📌 Test 2: Checking configuration...")
configured = is_stripe_configured()
print(f"   Is Stripe configured? {configured}")

# Test 3: Try to create a payment (will return error if no key)
print("\n📌 Test 3: Creating payment intent...")
result = create_payment_intent(50.00)
print(f"   Success: {result.success}")
print(f"   Payment ID: {result.payment_id}")
print(f"   Status: {result.status}")
if result.error:
    print(f"   Error: {result.error}")

# Test 4: Mock payment (always works)
print("\n📌 Test 4: Creating mock payment...")
mock_result = create_mock_payment_intent(50.00)
print(f"   Success: {mock_result.success}")
print(f"   Payment ID: {mock_result.payment_id}")
print(f"   Status: {mock_result.status}")

print("\n" + "=" * 50)
print("✅ TESTS COMPLETE")
print("=" * 50)
