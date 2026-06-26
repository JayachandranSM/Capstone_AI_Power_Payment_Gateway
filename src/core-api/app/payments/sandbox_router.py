import uuid
from decimal import Decimal
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth.security import CurrentUser, require_any_auth
from app.payments.sandbox import razorpay_sandbox, RAZORPAY_TEST_CARDS
from app.utils.logging import get_logger
from db.session import get_db

router = APIRouter(prefix="/sandbox", tags=["Sandbox"])
log    = get_logger(__name__)


@router.get("/status")
async def sandbox_status():
    connected = await razorpay_sandbox.check_connectivity()
    return {
        "provider":  "Razorpay",
        "mode":      "sandbox/test",
        "connected": connected,
        "key_id":    razorpay_sandbox.key_id,
        "features":  ["orders", "payments", "refunds", "webhooks"],
    }


@router.get("/test-cards")
async def get_test_cards():
    return {
        "provider":   "Razorpay",
        "mode":       "sandbox",
        "test_cards": RAZORPAY_TEST_CARDS,
        "test_upis": [
            {"vpa": "success@razorpay", "note": "Always succeeds"},
            {"vpa": "failure@razorpay", "note": "Always fails"},
        ],
    }


@router.post("/create-order")
async def create_sandbox_order(
    payload: dict,
    current_user: CurrentUser = Depends(require_any_auth),
    db: AsyncSession = Depends(get_db),
):
    amount  = Decimal(str(payload.get("amount", 100)))
    receipt = f"rcpt_{str(current_user.user_id)[:8]}_{uuid.uuid4().hex[:6]}"
    order   = await razorpay_sandbox.create_order(amount, "INR", receipt)
    return {
        **order,
        "test_cards":   RAZORPAY_TEST_CARDS,
        "key_id":       razorpay_sandbox.key_id,
        "instructions": "Use card 4111 1111 1111 1111 / expiry 12/25 / CVV 123",
    }


@router.post("/simulate-payment")
async def simulate_payment(
    payload: dict,
    current_user: CurrentUser = Depends(require_any_auth),
    db: AsyncSession = Depends(get_db),
):
    amount   = Decimal(str(payload.get("amount", 500)))
    scenario = payload.get("scenario", "success")

    if scenario == "success":
        status      = "captured"
        payment_ref = f"pay_{uuid.uuid4().hex[:14].upper()}"
        message     = "Payment successful via Razorpay sandbox"
    elif scenario == "failure":
        status      = "failed"
        payment_ref = f"pay_{uuid.uuid4().hex[:14].upper()}"
        message     = "Payment declined - insufficient funds (test)"
    else:
        status      = "pending"
        payment_ref = f"pay_{uuid.uuid4().hex[:14].upper()}"
        message     = "Payment pending verification"

    if status == "captured":
        await db.execute(
            text("""INSERT INTO ops.notifications (user_id, type, title, body, metadata)
                    VALUES (:uid, 'payment', 'Razorpay Payment Captured', :body, CAST(:meta AS jsonb))"""),
            {
                "uid":  current_user.user_id,
                "body": f"INR {amount} payment via Razorpay sandbox captured",
                "meta": f'{{"payment_ref":"{payment_ref}","provider":"razorpay","sandbox":true}}',
            },
        )
        await db.commit()

    return {
        "scenario":    scenario,
        "status":      status,
        "payment_ref": payment_ref,
        "amount":      float(amount),
        "currency":    "INR",
        "provider":    "razorpay",
        "sandbox":     True,
        "message":     message,
        "card_used":   RAZORPAY_TEST_CARDS.get(scenario, RAZORPAY_TEST_CARDS["success"]),
    }


@router.post("/refund")
async def sandbox_refund(
    payload: dict,
    current_user: CurrentUser = Depends(require_any_auth),
):
    payment_id   = payload.get("payment_id", f"pay_MOCK_{uuid.uuid4().hex[:14]}")
    amount_paise = int(Decimal(str(payload.get("amount", 100))) * 100)
    return await razorpay_sandbox.create_refund(payment_id, amount_paise)
