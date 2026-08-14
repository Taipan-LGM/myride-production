# services/stripe_service.py
"""Stripe service with lazy loading for Render compatibility."""

import os
import logging
from typing import Optional, Dict, Any
from functools import lru_cache
from dataclasses import dataclass

try:
    import stripe
    from stripe.error import StripeError
except ImportError:
    stripe = None
    StripeError = Exception

logger = logging.getLogger(__name__)

# ========== CONFIGURATION ==========

@lru_cache()
def get_stripe_config() -> Dict[str, Any]:
    """Get Stripe configuration."""
    return {
        "secret_key": os.getenv("STRIPE_SECRET_KEY", ""),
        "webhook_secret": os.getenv("STRIPE_WEBHOOK_SECRET", ""),
        "currency": os.getenv("STRIPE_CURRENCY", "zar"),
        "mode": os.getenv("STRIPE_MODE", "test"),
    }

@lru_cache()
def get_stripe_client():
    """
    Lazy load Stripe client only when needed.
    Returns None if no key is configured or stripe is not installed.
    """
    # Check if stripe is installed
    if stripe is None:
        logger.warning("Stripe package not installed — card payments unavailable")
        return None
    
    config = get_stripe_config()
    if not config["secret_key"]:
        logger.warning("STRIPE_SECRET_KEY not set — card payments unavailable")
        return None
    
    stripe.api_key = config["secret_key"]
    return stripe

def is_stripe_configured() -> bool:
    """Check if Stripe is configured."""
    return stripe is not None and bool(get_stripe_config()["secret_key"])

# ========== PAYMENT FUNCTIONS ==========

@dataclass
class PaymentResult:
    """Payment result object."""
    success: bool
    payment_id: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    status: Optional[str] = None
    error: Optional[str] = None
    client_secret: Optional[str] = None

def create_payment_intent(
    amount: float,
    currency: str = "zar",
    metadata: Optional[Dict] = None,
    payment_method_types: Optional[list] = None,
) -> PaymentResult:
    """
    Create a Stripe PaymentIntent.
    
    Returns PaymentResult with error details if Stripe not configured.
    """
    stripe_client = get_stripe_client()
    
    if not stripe_client:
        return PaymentResult(
            success=False,
            error="Card payments are not configured. Please use cash or contact support."
        )
    
    try:
        payment_method_types = payment_method_types or ["card"]
        metadata = metadata or {}
        
        intent = stripe_client.PaymentIntent.create(
            amount=int(amount * 100),  # Convert to cents
            currency=currency,
            payment_method_types=payment_method_types,
            metadata=metadata,
        )
        
        return PaymentResult(
            success=True,
            payment_id=intent.id,
            amount=amount,
            currency=currency,
            status=intent.status,
            client_secret=intent.client_secret,
        )
        
    except StripeError as e:
        logger.error(f"Stripe error: {e}")
        return PaymentResult(
            success=False,
            error=f"Payment error: {str(e)}"
        )
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return PaymentResult(
            success=False,
            error=f"Unexpected error: {str(e)}"
        )

def confirm_payment(payment_intent_id: str) -> PaymentResult:
    """Confirm a PaymentIntent."""
    stripe_client = get_stripe_client()
    
    if not stripe_client:
        return PaymentResult(
            success=False,
            error="Stripe is not configured."
        )
    
    try:
        intent = stripe_client.PaymentIntent.confirm(payment_intent_id)
        return PaymentResult(
            success=True,
            payment_id=intent.id,
            status=intent.status,
        )
    except StripeError as e:
        return PaymentResult(
            success=False,
            error=str(e)
        )

def cancel_payment(payment_intent_id: str) -> PaymentResult:
    """Cancel a PaymentIntent."""
    stripe_client = get_stripe_client()
    
    if not stripe_client:
        return PaymentResult(
            success=False,
            error="Stripe is not configured."
        )
    
    try:
        intent = stripe_client.PaymentIntent.cancel(payment_intent_id)
        return PaymentResult(
            success=True,
            payment_id=intent.id,
            status=intent.status,
        )
    except StripeError as e:
        return PaymentResult(
            success=False,
            error=str(e)
        )

def create_refund(
    payment_intent_id: str,
    amount: Optional[float] = None,
) -> PaymentResult:
    """Create a refund."""
    stripe_client = get_stripe_client()
    
    if not stripe_client:
        return PaymentResult(
            success=False,
            error="Stripe is not configured."
        )
    
    try:
        refund_params = {"payment_intent": payment_intent_id}
        if amount is not None:
            refund_params["amount"] = int(amount * 100)
        
        refund = stripe_client.Refund.create(**refund_params)
        
        return PaymentResult(
            success=True,
            payment_id=refund.id,
            status=refund.status,
            amount=amount,
        )
    except StripeError as e:
        return PaymentResult(
            success=False,
            error=str(e)
        )

# ========== WEBHOOK HANDLER ==========

def verify_webhook_signature(payload: bytes, signature_header: str) -> bool:
    """
    Verify Stripe webhook signature.
    Returns True if signature is valid.
    """
    config = get_stripe_config()
    webhook_secret = config.get("webhook_secret")
    if not webhook_secret:
        development = os.getenv("ENVIRONMENT", "development") == "development"
        logger.warning("STRIPE_WEBHOOK_SECRET not set — webhook accepted only in development")
        return development
    if stripe is None:
        logger.error("Stripe package unavailable — webhook signature cannot be verified")
        return False
    
    try:
        stripe.Webhook.construct_event(
            payload=payload,
            sig_header=signature_header,
            secret=webhook_secret,
        )
        return True
    except ValueError:
        # Invalid payload
        return False
    except Exception:
        # Invalid signature
        return False

# ========== MOCK MODE ==========

def create_mock_payment_intent(amount: float) -> PaymentResult:
    """Mock payment for testing when Stripe is not available."""
    import os
    return PaymentResult(
        success=True,
        payment_id=f"mock_{int(amount * 100)}_{os.urandom(4).hex()}",
        amount=amount,
        currency="zar",
        status="succeeded",
        client_secret="mock_secret_123",
    )

# ========== FASTAPI ROUTES ==========

def create_payment_routes(router):
    """Add Stripe routes to FastAPI router."""
    from fastapi import HTTPException, Request
    
    @router.post("/payments/create-intent")
    async def create_intent(amount: float, currency: str = "zar"):
        """Create a payment intent."""
        result = create_payment_intent(amount, currency)
        if not result.success:
            raise HTTPException(status_code=400, detail=result.error)
        return {
            "client_secret": result.client_secret,
            "payment_id": result.payment_id,
            "amount": result.amount,
            "currency": result.currency,
        }
    
    @router.post("/payments/confirm/{payment_intent_id}")
    async def confirm_intent(payment_intent_id: str):
        """Confirm a payment intent."""
        result = confirm_payment(payment_intent_id)
        if not result.success:
            raise HTTPException(status_code=400, detail=result.error)
        return {"status": result.status, "payment_id": result.payment_id}
    
    @router.post("/payments/webhook")
    async def stripe_webhook(request: Request):
        """Handle Stripe webhook."""
        body = await request.body()
        signature = request.headers.get("stripe-signature", "")
        
        if not verify_webhook_signature(body, signature):
            raise HTTPException(status_code=400, detail="Invalid signature")
        
        # Process webhook event
        # ... handle various event types
        
        return {"status": "success"}
    
    return router
