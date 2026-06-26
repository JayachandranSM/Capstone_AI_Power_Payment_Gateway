"""
Sandbox Payment Provider — Razorpay Test Mode
"""
import uuid
import hashlib
import hmac
from decimal import Decimal
import httpx
from app.utils.logging import get_logger

log = get_logger(__name__)

RAZORPAY_KEY_ID     = "rzp_test_1DP5mmOlF5G5ag"
RAZORPAY_KEY_SECRET = "thisissecret"
RAZORPAY_BASE_URL   = "https://api.razorpay.com/v1"

RAZORPAY_TEST_CARDS = {
    "success": {
        "number": "4111 1111 1111 1111",
        "expiry": "12/25", "cvv": "123",
        "note":   "Always succeeds",
    },
    "failure": {
        "number": "4000 0000 0000 0002",
        "expiry": "12/25", "cvv": "123",
        "note":   "Always fails",
    },
    "international": {
        "number": "4012 8888 8888 1881",
        "expiry": "12/25", "cvv": "123",
        "note":   "International transaction",
    },
}


class RazorpaySandbox:
    def __init__(self):
        self.key_id     = RAZORPAY_KEY_ID
        self.key_secret = RAZORPAY_KEY_SECRET
        self.auth       = (self.key_id, self.key_secret)

    async def create_order(self, amount_inr: Decimal,
                            currency: str = "INR",
                            receipt: str = None) -> dict:
        amount_paise = int(amount_inr * 100)
        receipt_id   = receipt or f"rcpt_{uuid.uuid4().hex[:12]}"
        payload = {
            "amount": amount_paise, "currency": "INR",
            "receipt": receipt_id,
            "notes": {"source": "PayGateway Demo", "env": "sandbox"},
        }
        try:
            async with httpx.AsyncClient(auth=self.auth, timeout=10) as client:
                r = await client.post(f"{RAZORPAY_BASE_URL}/orders", json=payload)
                if r.status_code == 200:
                    data = r.json()
                    log.info("razorpay_order_created", order_id=data.get("id"))
                    return {
                        "success":  True,
                        "order_id": data.get("id"),
                        "amount":   float(amount_inr),
                        "currency": currency,
                        "receipt":  receipt_id,
                        "status":   data.get("status", "created"),
                        "provider": "razorpay",
                        "sandbox":  True,
                    }
        except Exception as exc:
            log.warning("razorpay_fallback", error=str(exc))

        return {
            "success":  True,
            "order_id": f"order_MOCK_{uuid.uuid4().hex[:14].upper()}",
            "amount":   float(amount_inr),
            "currency": currency,
            "receipt":  receipt_id,
            "status":   "created",
            "provider": "razorpay_mock",
            "sandbox":  True,
        }

    async def create_refund(self, payment_id: str, amount_paise: int) -> dict:
        try:
            async with httpx.AsyncClient(auth=self.auth, timeout=10) as client:
                r = await client.post(
                    f"{RAZORPAY_BASE_URL}/payments/{payment_id}/refund",
                    json={"amount": amount_paise},
                )
                if r.status_code == 200:
                    data = r.json()
                    return {"success": True, "refund_id": data.get("id"),
                            "status": data.get("status"), "amount": amount_paise / 100}
        except Exception:
            pass
        return {
            "success":   True,
            "refund_id": f"rfnd_MOCK_{uuid.uuid4().hex[:14].upper()}",
            "status":    "processed",
            "mock":      True,
            "amount":    amount_paise / 100,
        }

    async def check_connectivity(self) -> bool:
        try:
            async with httpx.AsyncClient(auth=self.auth, timeout=5) as client:
                r = await client.get(f"{RAZORPAY_BASE_URL}/payments?count=1")
                return r.status_code in (200, 400)
        except Exception:
            return False


razorpay_sandbox = RazorpaySandbox()
