import uuid
import json
from decimal import Decimal
from datetime import datetime, timezone
from fastapi import Request,  APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth.security import CurrentUser, require_any_auth
from app.utils.logging import get_logger
from db.session import get_db
from db.redis_client import get_redis
from app.utils.fx import get_fx_rate_live

router = APIRouter(prefix="/payments", tags=["Payments"])
log = get_logger(__name__)

FALLBACK_FX = {
    ("INR","USD"):Decimal("0.012"), ("USD","INR"):Decimal("83.5"),
    ("EUR","USD"):Decimal("1.09"),  ("USD","EUR"):Decimal("0.92"),
    ("GBP","USD"):Decimal("1.27"),  ("USD","GBP"):Decimal("0.79"),
    ("SGD","USD"):Decimal("0.74"),  ("USD","SGD"):Decimal("1.35"),
    ("AED","USD"):Decimal("0.27"),  ("USD","AED"):Decimal("3.67"),
}

async def get_fx_rate(from_cur: str, to_cur: str, db: AsyncSession) -> Decimal:
    if from_cur == to_cur:
        return Decimal("1.0")
    row = await db.execute(
        text("SELECT rate FROM core.fx_rates WHERE base_currency=:b AND quote_currency=:q"),
        {"b": from_cur, "q": to_cur},
    )
    result = row.fetchone()
    if result:
        return Decimal(str(result.rate))
    return FALLBACK_FX.get((from_cur, to_cur), Decimal("1.0"))

async def run_fraud_engine(sender_id, amount, currency, method, db):
    score = Decimal("0.0")
    rules_hit = []

    weights_row = await db.execute(text("SELECT rule_name, weight FROM ai.fraud_patterns"))
    weights = {r.rule_name: Decimal(str(r.weight)) for r in weights_row.fetchall()}

    def w(rule, default):
        return weights.get(rule, Decimal(str(default)))

    def hit(rule, detail, weight_key, default):
        weight = w(weight_key, default)
        rules_hit.append({"rule": rule, "weight": float(weight), "detail": detail})
        return weight

    if amount > 100_000:
        score += hit("HIGH_AMOUNT", f"Amount {amount} > 100K", "HIGH_AMOUNT", 0.3)

    row = await db.execute(text("SELECT created_at FROM core.users WHERE id=:uid"), {"uid": sender_id})
    user = row.fetchone()
    if user:
        from datetime import timedelta
        age = datetime.now(timezone.utc) - user.created_at.replace(tzinfo=timezone.utc)
        if age.days < 7:
            score += hit("NEW_ACCOUNT", f"Account {age.days} days old", "NEW_ACCOUNT", 0.25)

    v_row = await db.execute(
        text("SELECT COUNT(*) as cnt FROM ledger.transactions WHERE sender_id=:uid AND created_at > NOW() - INTERVAL '10 minutes'"),
        {"uid": sender_id},
    )
    v = v_row.fetchone()
    if v and v.cnt > 5:
        score += hit("HIGH_VELOCITY", f"{v.cnt} txns in 10min", "HIGH_VELOCITY", 0.35)

    if amount < Decimal("10") and amount == int(amount):
        score += hit("MICRO_ROUND_AMOUNT", "Micro round-number", "MICRO_ROUND_AMOUNT", 0.2)

    if method == "card" and currency not in ("INR",):
        score += hit("INTL_CARD", "International card", "INTL_CARD", 0.15)

    kyc_row = await db.execute(text("SELECT kyc_status FROM core.users WHERE id=:uid"), {"uid": sender_id})
    kyc = kyc_row.fetchone()
    if kyc and kyc.kyc_status != "verified":
        score += hit("KYC_UNVERIFIED", f"KYC: {kyc.kyc_status}", "KYC_UNVERIFIED", 0.2)

    if Decimal("9800") <= amount <= Decimal("9999"):
        score += hit("STRUCTURING", "Near 10K threshold", "STRUCTURING", 0.25)

    fail_row = await db.execute(
        text("SELECT COUNT(*) as cnt FROM ledger.transactions WHERE sender_id=:uid AND status='failed' AND created_at > NOW() - INTERVAL '1 hour'"),
        {"uid": sender_id},
    )
    fails = fail_row.fetchone()
    if fails and fails.cnt >= 3:
        score += hit("RECENT_FAILURES", f"{fails.cnt} failures in 1hr", "RECENT_FAILURES", 0.3)

    for r in rules_hit:
        await db.execute(
            text("UPDATE ai.fraud_patterns SET hit_count = hit_count + 1, last_updated = NOW() WHERE rule_name=:rule"),
            {"rule": r["rule"]},
        )

    return min(score, Decimal("1.0")), rules_hit


@router.post("/process", status_code=201)
async def process_payment(
    request: Request,
    payload: dict,
    current_user: CurrentUser = Depends(require_any_auth),
    db: AsyncSession = Depends(get_db),
):
    log.info("payment_initiated", user_id=str(current_user.user_id), amount=str(payload.get("amount")))

    amount   = Decimal(str(payload["amount"]))
    currency = payload["currency"]
    method   = payload["payment_method"]
    idem_key = payload.get("idempotency_key") or request.headers.get("X-Idempotency-Key") or str(__import__("uuid").uuid4())

    # Resolve receiver
    receiver_id  = None
    upi_receiver = None

    merchant_id_resolved = None

    # Accept both field names for UPI handle
    if not payload.get("receiver_upi") and payload.get("upi_handle"):
        payload["receiver_upi"] = payload["upi_handle"]
    if payload.get("receiver_upi"):
        row = await db.execute(
            text("SELECT user_id FROM core.upi_handles WHERE handle=:h AND is_active=TRUE"),
            {"h": payload["receiver_upi"]},
        )
        handle = row.fetchone()
        if not handle:
            raise HTTPException(status_code=404, detail=f"UPI handle '{payload['receiver_upi']}' not found")
        receiver_id  = handle.user_id
        upi_receiver = payload["receiver_upi"]

        # Check if this UPI handle belongs to a merchant — if so, set merchant_id
        merchant_row = await db.execute(
            text("SELECT id FROM core.merchants WHERE user_id=:uid AND is_active=TRUE"),
            {"uid": receiver_id},
        )
        merchant_rec = merchant_row.fetchone()
        if merchant_rec:
            merchant_id_resolved = merchant_rec.id

    if payload.get("merchant_id"):
        row = await db.execute(
            text("SELECT user_id FROM core.merchants WHERE id=:mid AND is_active=TRUE"),
            {"mid": payload["merchant_id"]},
        )
        merchant = row.fetchone()
        if not merchant:
            raise HTTPException(status_code=404, detail="Merchant not found")
        receiver_id = merchant.user_id
        merchant_id_resolved = payload["merchant_id"]

    if not receiver_id:
        raise HTTPException(status_code=400, detail="receiver_upi or merchant_id required")
    if receiver_id == current_user.user_id:
        raise HTTPException(status_code=400, detail="Cannot send to yourself")

    # Check wallet
    wallet_row = await db.execute(
        text("SELECT id, balance, locked_balance, status, version FROM core.wallets WHERE user_id=:uid AND currency=:cur FOR UPDATE"),
        {"uid": current_user.user_id, "cur": currency},
    )
    wallet = wallet_row.fetchone()
    if not wallet:
        raise HTTPException(status_code=404, detail=f"No {currency} wallet. Please top up first.")
    if wallet.status != "active":
        raise HTTPException(status_code=400, detail=f"Wallet is {wallet.status}")

    available = Decimal(str(wallet.balance)) - Decimal(str(wallet.locked_balance))
    if available < amount:
        raise HTTPException(status_code=400, detail=f"Insufficient balance. Available: {available} {currency}")

    # FX + fraud
    # Try live FX rate first
    try:
        redis = await get_redis()
        fx_rate = await get_fx_rate_live(currency, "USD", redis)
    except Exception:
        fx_rate = await get_fx_rate(currency, "USD", db)
    amount_usd = amount * fx_rate
    fraud_score, rules_hit = await run_fraud_engine(current_user.user_id, amount, currency, method, db)
    chargeback_prob = min(fraud_score * Decimal("0.4") + Decimal("0.02"), Decimal("1.0"))

    tx_status = "success"
    failure_reason = None
    if fraud_score >= Decimal("0.45"):
        tx_status = "flagged"
        failure_reason = "Flagged by fraud detection system"

    tx_type = "merchant_payment" if (merchant_id_resolved or payload.get("merchant_id")) else "p2p"

    sender_upi_row = await db.execute(
        text("SELECT handle FROM core.upi_handles WHERE user_id=:uid AND is_primary=TRUE"),
        {"uid": current_user.user_id},
    )
    sender_upi = sender_upi_row.fetchone()

    sandbox_ref  = f"SANDBOX_{uuid.uuid4().hex[:12].upper()}"
    metadata_str = json.dumps(payload.get("metadata") or {})
    tx_id        = uuid.uuid4()

    # Insert transaction — use $1 style via raw asyncpg to avoid cast syntax issues
    await db.execute(
        text("""
            INSERT INTO ledger.transactions
                (id, idempotency_key, sender_id, receiver_id, merchant_id,
                 amount, currency, amount_usd, fx_rate, type, status,
                 payment_method, upi_handle_sender, upi_handle_receiver,
                 failure_reason, fraud_score, chargeback_probability,
                 sandbox_provider, sandbox_ref, metadata)
            VALUES
                (:id, :idem, :sender, :receiver, :merchant,
                 :amount, :currency, :amount_usd, :fx_rate, :type, :status,
                 :method, :upi_sender, :upi_receiver,
                 :failure, :fraud_score, :chargeback_prob,
                 'sandbox', :sandbox_ref, CAST(:metadata AS jsonb))
        """),
        {
            "id":             tx_id,
            "idem":           idem_key,
            "sender":         current_user.user_id,
            "receiver":       receiver_id,
            "merchant":       merchant_id_resolved or payload.get("merchant_id"),
            "amount":         amount,
            "currency":       currency,
            "amount_usd":     amount_usd,
            "fx_rate":        fx_rate,
            "type":           tx_type,
            "status":         tx_status,
            "method":         method,
            "upi_sender":     sender_upi.handle if sender_upi else None,
            "upi_receiver":   upi_receiver,
            "failure":        failure_reason,
            "fraud_score":    fraud_score,
            "chargeback_prob": chargeback_prob,
            "sandbox_ref":    sandbox_ref,
            "metadata":       metadata_str,
        },
    )

    # Double-entry ledger
    if tx_status == "success":
        await db.execute(
            text("UPDATE core.wallets SET balance=balance-:amount, version=version+1, updated_at=NOW() WHERE id=:wid AND version=:ver"),
            {"amount": amount, "wid": wallet.id, "ver": wallet.version},
        )
        new_bal = Decimal(str(wallet.balance)) - amount
        await db.execute(
            text("INSERT INTO ledger.entries (transaction_id, wallet_id, direction, amount, currency, balance_after) VALUES (:tx,:wid,'debit',:amt,:cur,:bal)"),
            {"tx": tx_id, "wid": wallet.id, "amt": amount, "cur": currency, "bal": new_bal},
        )
        await db.execute(
            text("""INSERT INTO core.wallets (user_id, currency, balance)
                    VALUES (:uid, :cur, :amt)
                    ON CONFLICT (user_id, currency)
                    DO UPDATE SET balance=core.wallets.balance+:amt, version=core.wallets.version+1, updated_at=NOW()"""),
            {"uid": receiver_id, "cur": currency, "amt": amount},
        )
        recv_w = await db.execute(
            text("SELECT id, balance FROM core.wallets WHERE user_id=:uid AND currency=:c"),
            {"uid": receiver_id, "c": currency},
        )
        rw = recv_w.fetchone()
        if rw:
            await db.execute(
                text("INSERT INTO ledger.entries (transaction_id, wallet_id, direction, amount, currency, balance_after) VALUES (:tx,:wid,'credit',:amt,:cur,:bal)"),
                {"tx": tx_id, "wid": rw.id, "amt": amount, "cur": currency, "bal": rw.balance},
            )

    # Fraud alert — uses SAME threshold as flagging (0.45) to avoid mismatch
    if fraud_score >= Decimal("0.45"):
        severity = ("critical" if fraud_score >= Decimal("0.85") else
                    "high"     if fraud_score >= Decimal("0.70") else "medium")
        await db.execute(
            text("INSERT INTO ai.fraud_alerts (transaction_id, fraud_score, severity, rules_triggered) VALUES (:tx,:score,:sev, CAST(:rules AS jsonb))"),
            {"tx": tx_id, "score": fraud_score, "sev": severity, "rules": json.dumps(rules_hit)},
        )

    # Notification
    notif_title = "✓ Payment Successful" if tx_status == "success" else f"Payment {tx_status}"
    await db.execute(
        text("INSERT INTO ops.notifications (user_id, type, title, body, metadata) VALUES (:uid,'payment',:title,:body, CAST(:meta AS jsonb))"),
        {
            "uid":   current_user.user_id,
            "title": notif_title,
            "body":  f"{float(amount):,.2f} {currency} sent",
            "meta":  json.dumps({"transaction_id": str(tx_id), "sandbox_ref": sandbox_ref}),
        },
    )

    await db.commit()
    log.info("payment_processed", tx_id=str(tx_id), status=tx_status, fraud_score=str(fraud_score))

    return {
        "transaction_id":       str(tx_id),
        "idempotency_key":      idem_key,
        "status":               tx_status,
        "amount":               float(amount),
        "currency":             currency,
        "amount_usd":           float(amount_usd),
        "fx_rate":              float(fx_rate),
        "fraud_score":          float(fraud_score),
        "chargeback_probability": float(chargeback_prob),
        "sandbox_ref":          sandbox_ref,
        "message":              failure_reason or "Payment processed successfully",
        "created_at":           datetime.now(timezone.utc).isoformat(),
    }
