"""Promo codes + referral credits (SA launch Path A)."""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import AuthUser, require_role
from app.rider_services import get_wallet, top_up_wallet

router = APIRouter(tags=["promos"])

_PROMOS: dict[str, dict[str, Any]] = {
    "MYRIDE50": {"credit_cents": 5000, "label": "R50 welcome credit", "max_redemptions": 10_000},
    "SAFLY": {"credit_cents": 2500, "label": "R25 safety week", "max_redemptions": 10_000},
}

_redeemed: dict[str, set[str]] = {}  # code -> user ids
_referrals: dict[str, dict[str, Any]] = {}


class RedeemRequest(BaseModel):
    code: str = Field(min_length=3, max_length=32)


class ReferralRequest(BaseModel):
    friend_email: str = Field(min_length=5, max_length=120)


@router.get("/promos")
async def list_promos():
    return {
        "promos": [
            {"code": k, "label": v["label"], "credit_zar": v["credit_cents"] / 100}
            for k, v in _PROMOS.items()
        ],
        "hint": "Redeem on Wallet — credits apply to your ZAR balance.",
    }


@router.post("/promos/redeem")
async def redeem_promo(
    body: RedeemRequest,
    user: AuthUser = Depends(require_role("rider", "admin")),
):
    code = body.code.strip().upper()
    promo = _PROMOS.get(code)
    if not promo:
        raise HTTPException(400, "Unknown promo code")
    used = _redeemed.setdefault(code, set())
    if user.id in used:
        raise HTTPException(400, "You already redeemed this code")
    if len(used) >= int(promo["max_redemptions"]):
        raise HTTPException(400, "Promo fully redeemed")
    used.add(user.id)
    wallet = top_up_wallet(user.id, int(promo["credit_cents"]))
    return {
        "ok": True,
        "code": code,
        "label": promo["label"],
        "credited_cents": promo["credit_cents"],
        "wallet": wallet,
    }


@router.get("/referrals/me")
async def my_referral(user: AuthUser = Depends(require_role("rider", "admin"))):
    code = f"REF-{user.id[-6:].upper()}"
    row = _referrals.get(user.id) or {"invites": 0, "earned_cents": 0}
    return {
        "referral_code": code,
        "share_text": f"Ride with My Ride SA — use my code {code} for R25 off.",
        "invites": row["invites"],
        "earned_zar": round(row["earned_cents"] / 100, 2),
        "reward_per_friend_zar": 25,
    }


@router.post("/referrals/invite")
async def invite_friend(
    body: ReferralRequest,
    user: AuthUser = Depends(require_role("rider", "admin")),
):
    row = _referrals.setdefault(user.id, {"invites": 0, "earned_cents": 0, "emails": []})
    email = body.friend_email.strip().lower()
    if email in row.get("emails", []):
        raise HTTPException(400, "Already invited")
    row["emails"] = [*row.get("emails", []), email]
    row["invites"] = int(row["invites"]) + 1
    # Credit referrer when invite is logged (demo — production waits for friend's first trip)
    top_up_wallet(user.id, 2500)
    row["earned_cents"] = int(row["earned_cents"]) + 2500
    row["updated_at"] = time.time()
    return {
        "ok": True,
        "friend_email": email,
        "credited_cents": 2500,
        "wallet": get_wallet(user.id),
        "referral": {
            "invites": row["invites"],
            "earned_zar": round(row["earned_cents"] / 100, 2),
        },
    }
