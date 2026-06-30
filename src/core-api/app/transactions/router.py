import uuid, math, json
from decimal import Decimal
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth.security import CurrentUser, require_any_auth, require_admin
from app.utils.logging import get_logger
from db.session import get_db
from db.redis_client import get_redis
from app.utils.fx import get_fx_rate_live, FALLBACK_RATES

log = get_logger(__name__)

# ── Transactions ──────────────────────────────────────────────
tx_router = APIRouter(prefix="/transactions", tags=["Transactions"])

@tx_router.get("")
async def list_transactions(
    status: str | None = Query(None),
    currency: str | None = Query(None),
    payment_method: str | None = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(require_any_auth),
    db: AsyncSession = Depends(get_db),
):
    conditions = []
    params: dict = {}

    if current_user.role == "admin":
        conditions.append("1=1")
    else:
        conditions.append("(t.sender_id = :uid OR t.receiver_id = :uid)")
        params["uid"] = current_user.user_id

    if status:
        conditions.append("t.status = :status")
        params["status"] = status
    if currency:
        conditions.append("t.currency = :currency")
        params["currency"] = currency
    if payment_method:
        conditions.append("t.payment_method = :pm")
        params["pm"] = payment_method

    where = " AND ".join(conditions)
    count_row = await db.execute(
        text(f"SELECT COUNT(*) FROM ledger.transactions t WHERE {where}"), params
    )
    total = count_row.scalar() or 0

    offset = (page - 1) * size
    rows = await db.execute(
        text(f"""
            SELECT t.* FROM ledger.transactions t
            WHERE {where}
            ORDER BY t.created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        {**params, "limit": size, "offset": offset},
    )
    items = [dict(r._mapping) for r in rows.fetchall()]
    return {
        "items": items, "total": total, "page": page,
        "size": size, "pages": math.ceil(total / size) if total else 1,
    }

@tx_router.get("/{tx_id}")
async def get_transaction(
    tx_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_any_auth),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(
        text("SELECT * FROM ledger.transactions WHERE id = :id"), {"id": tx_id}
    )
    tx = row.fetchone()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if current_user.role != "admin":
        if tx.sender_id != current_user.user_id and tx.receiver_id != current_user.user_id:
            raise HTTPException(status_code=403, detail="Access denied")
    return dict(tx._mapping)

# ── Refunds ───────────────────────────────────────────────────
refund_router = APIRouter(prefix="/refunds", tags=["Refunds"])

@refund_router.post("", status_code=201)
async def request_refund(
    payload: dict,
    current_user: CurrentUser = Depends(require_any_auth),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(
        text("SELECT * FROM ledger.transactions WHERE id = :id"),
        {"id": payload["transaction_id"]},
    )
    tx = row.fetchone()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if str(tx.sender_id) != str(current_user.user_id) and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorised to refund this transaction")
    if tx.status not in ("success",):
        raise HTTPException(status_code=400, detail=f"Cannot refund a {tx.status} transaction")

    existing = await db.execute(
        text("SELECT id FROM ledger.refunds WHERE original_tx_id=:tid AND status NOT IN ('rejected')"),
        {"tid": payload["transaction_id"]},
    )
    if existing.fetchone():
        raise HTTPException(status_code=409, detail="Refund already requested")

    refund_amount = Decimal(str(payload["amount"])) if payload.get("amount") else Decimal(str(tx.amount))
    if refund_amount > Decimal(str(tx.amount)):
        raise HTTPException(status_code=400, detail="Refund exceeds transaction amount")

    refund_id = uuid.uuid4()
    await db.execute(
        text("""INSERT INTO ledger.refunds
                (id, original_tx_id, requester_id, amount, currency, reason)
                VALUES (:id, :tid, :uid, :amt, :cur, :reason)"""),
        {"id": refund_id, "tid": payload["transaction_id"],
         "uid": current_user.user_id, "amt": refund_amount,
         "cur": tx.currency, "reason": payload["reason"]},
    )
    await db.execute(
        text("""INSERT INTO ops.notifications (user_id, type, title, body, metadata)
                VALUES (:uid, 'refund', 'Refund Requested', :body, CAST(:meta AS jsonb))"""),
        {
            "uid": current_user.user_id,
            "body": f"Refund of {float(refund_amount):,.2f} {tx.currency} is being reviewed",
            "meta": json.dumps({"refund_id": str(refund_id)}),
        },
    )
    await db.commit()
    row = await db.execute(text("SELECT * FROM ledger.refunds WHERE id=:id"), {"id": refund_id})
    return dict(row.fetchone()._mapping)

@refund_router.get("")
async def list_refunds(
    current_user: CurrentUser = Depends(require_any_auth),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role == "admin":
        rows = await db.execute(
            text("SELECT * FROM ledger.refunds ORDER BY created_at DESC LIMIT 100")
        )
    else:
        rows = await db.execute(
            text("SELECT * FROM ledger.refunds WHERE requester_id=:uid ORDER BY created_at DESC"),
            {"uid": current_user.user_id},
        )
    return [dict(r._mapping) for r in rows.fetchall()]

@refund_router.get("", response_model=None)
async def list_refunds(
    status: str = "all",
    size: int = 50,
    current_user: CurrentUser = Depends(require_any_auth),
    db: AsyncSession = Depends(get_db),
):
    """List refunds — admin sees all, customer sees own."""
    import json as _json
    if current_user.role == "admin":
        where = "WHERE 1=1" if status == "all" else f"WHERE r.status = '{status}'"
        rows = await db.execute(
            text(f"""
                SELECT r.*, t.amount as tx_amount, t.currency as tx_currency
                FROM ledger.refunds r
                LEFT JOIN ledger.transactions t ON t.id = r.original_tx_id
                {where}
                ORDER BY r.created_at DESC LIMIT :size
            """),
            {"size": size},
        )
    else:
        where = "AND r.status = :status" if status != "all" else ""
        params = {"uid": current_user.user_id, "size": size}
        if status != "all":
            params["status"] = status
        rows = await db.execute(
            text(f"""
                SELECT r.*, t.amount as tx_amount, t.currency as tx_currency
                FROM ledger.refunds r
                LEFT JOIN ledger.transactions t ON t.id = r.original_tx_id
                WHERE r.requester_id = :uid {where}
                ORDER BY r.created_at DESC LIMIT :size
            """),
            params,
        )
    items = [dict(r._mapping) for r in rows.fetchall()]
    return {"items": items, "total": len(items)}


@refund_router.patch("/{refund_id}/approve")
async def approve_refund(
    refund_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(text("SELECT * FROM ledger.refunds WHERE id=:id"), {"id": refund_id})
    refund = row.fetchone()
    if not refund:
        raise HTTPException(status_code=404, detail="Refund not found")
    if refund.status != "requested":
        raise HTTPException(status_code=400, detail=f"Refund already {refund.status}")

    await db.execute(
        text("""UPDATE ledger.refunds
                SET status='approved', approved_by=:uid, updated_at=NOW()
                WHERE id=:id"""),
        {"uid": current_user.user_id, "id": refund_id},
    )

    # ── Credit wallet back to customer ──────────────────────────
    # Use direct UPDATE to avoid any ON CONFLICT issues
    wallet_row = await db.execute(
        text("SELECT id, balance FROM core.wallets WHERE user_id=:uid AND currency=:cur"),
        {"uid": refund.requester_id, "cur": refund.currency},
    )
    wallet = wallet_row.fetchone()
    if wallet:
        new_balance = Decimal(str(wallet.balance)) + Decimal(str(refund.amount))
        await db.execute(
            text("""UPDATE core.wallets
                    SET balance=:bal, version=version+1, updated_at=NOW()
                    WHERE id=:wid"""),
            {"bal": new_balance, "wid": wallet.id},
        )
    else:
        # Create wallet if not exists
        await db.execute(
            text("""INSERT INTO core.wallets (user_id, currency, balance)
                    VALUES (:uid, :cur, :amt)"""),
            {"uid": refund.requester_id, "cur": refund.currency, "amt": refund.amount},
        )

    # ── Create refund transaction in ledger ─────────────────────
    import uuid as _uuid
    refund_tx_id = _uuid.uuid4()
    await db.execute(
        text("""
            INSERT INTO ledger.transactions
                (id, idempotency_key, sender_id, receiver_id,
                 amount, currency, amount_usd, fx_rate,
                 type, status, payment_method, metadata)
            VALUES
                (:id, :idem, :sender, :receiver,
                 :amount, :currency, :amount_usd, :fx_rate,
                 'refund', 'success', 'wallet', CAST(:meta AS jsonb))
        """),
        {
            "id":         refund_tx_id,
            "idem":       f"refund-{refund_id}",
            "sender":     refund.requester_id,
            "receiver":   refund.requester_id,
            "amount":     refund.amount,
            "currency":   refund.currency,
            "amount_usd": refund.amount * Decimal("0.012") if refund.currency == "INR" else refund.amount,
            "fx_rate":    Decimal("0.012") if refund.currency == "INR" else Decimal("1.0"),
            "meta":       json.dumps({"original_tx_id": str(refund.original_tx_id), "refund_id": str(refund_id)}),
        },
    )

    # Update refund with refund_tx_id
    await db.execute(
        text("UPDATE ledger.refunds SET refund_tx_id=:txid WHERE id=:id"),
        {"txid": refund_tx_id, "id": refund_id},
    )

    # ── Notification to customer ─────────────────────────────────
    await db.execute(
        text("""INSERT INTO ops.notifications (user_id, type, title, body, metadata)
                VALUES (:uid, 'refund', 'Refund Approved ✓', :body, CAST(:meta AS jsonb))"""),
        {
            "uid":  refund.requester_id,
            "body": f"Your refund of {float(refund.amount):,.2f} {refund.currency} has been credited to your wallet",
            "meta": json.dumps({"refund_id": str(refund_id), "amount": float(refund.amount)}),
        },
    )
    await db.commit()
    row = await db.execute(text("SELECT * FROM ledger.refunds WHERE id=:id"), {"id": refund_id})
    return dict(row.fetchone()._mapping)

@refund_router.patch("/{refund_id}/reject")
async def reject_refund(
    refund_id: uuid.UUID,
    payload: dict,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        text("""UPDATE ledger.refunds
                SET status='rejected', rejection_reason=:reason,
                    approved_by=:uid, updated_at=NOW()
                WHERE id=:id"""),
        {"reason": payload.get("reason", "Rejected by admin"),
         "uid": current_user.user_id, "id": refund_id},
    )
    await db.commit()
    return {"status": "rejected", "message": "Refund rejected", "id": str(refund_id)}

# ── Disputes ──────────────────────────────────────────────────
dispute_router = APIRouter(prefix="/disputes", tags=["Disputes"])

@dispute_router.post("", status_code=201)
async def raise_dispute(
    payload: dict,
    current_user: CurrentUser = Depends(require_any_auth),
    db: AsyncSession = Depends(get_db),
):
    tx_row = await db.execute(
        text("SELECT * FROM ledger.transactions WHERE id=:id"),
        {"id": payload["transaction_id"]},
    )
    tx = tx_row.fetchone()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    # Auto-assign priority based on amount
    amount = float(tx.amount)
    priority = "urgent" if amount > 50000 else "high" if amount > 10000 else "medium"

    dispute_id = uuid.uuid4()
    await db.execute(
        text("""INSERT INTO ledger.disputes
                (id, transaction_id, raised_by, reason, evidence, priority)
                VALUES (:id, :tid, :uid, :reason, :evidence, :priority)"""),
        {
            "id": dispute_id, "tid": payload["transaction_id"],
            "uid": current_user.user_id, "reason": payload["reason"],
            "evidence": json.dumps(payload.get('evidence') or []),
            "priority": priority,
        },
    )

    # Create ticket for ops team
    await db.execute(
        text("""INSERT INTO ops.tickets
                (user_id, transaction_id, subject, description, category, priority)
                VALUES (:uid, :tid, :subject, :desc, :category, :priority)"""),
        {
            "uid":      current_user.user_id,
            "tid":      payload["transaction_id"],
            "subject":  f"Dispute: {payload['reason'][:80]}",
            "desc":     payload["reason"],
            "category": "dispute",
            "priority": priority,
        },
    )
    await db.commit()

    # Async LLM analysis via AI service (non-blocking)
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(
                "http://ai-service:8001/api/ai/agents/resolve-dispute",
                json={"dispute_id": str(dispute_id)},
            )
    except Exception:
        pass  # Non-blocking — dispute saved regardless

    row = await db.execute(text("SELECT * FROM ledger.disputes WHERE id=:id"), {"id": dispute_id})
    return dict(row.fetchone()._mapping)

@dispute_router.get("")
async def list_disputes(
    current_user: CurrentUser = Depends(require_any_auth),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role == "admin":
        rows = await db.execute(
            text("SELECT * FROM ledger.disputes ORDER BY created_at DESC LIMIT 100")
        )
    else:
        rows = await db.execute(
            text("SELECT * FROM ledger.disputes WHERE raised_by=:uid ORDER BY created_at DESC"),
            {"uid": current_user.user_id},
        )
    return [dict(r._mapping) for r in rows.fetchall()]

@dispute_router.patch("/{dispute_id}/assign")
async def assign_dispute(
    dispute_id: uuid.UUID,
    payload: dict,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        text("""UPDATE ledger.disputes
                SET assigned_to=:agent, status='under_review', updated_at=NOW()
                WHERE id=:id"""),
        {"agent": payload.get("agent_id", str(current_user.user_id)), "id": dispute_id},
    )
    await db.commit()
    return {"message": "Dispute assigned"}

@dispute_router.patch("/{dispute_id}/resolve")
async def resolve_dispute(
    dispute_id: uuid.UUID,
    payload: dict,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    new_status   = payload.get("status", "resolved_customer")
    resolution   = payload.get("resolution", "")

    await db.execute(
        text("""UPDATE ledger.disputes
                SET status=:status, resolution=:resolution, updated_at=NOW()
                WHERE id=:id"""),
        {"status": new_status, "resolution": resolution, "id": dispute_id},
    )

    # Fetch dispute to find who raised it, for the notification
    d_row = await db.execute(
        text("SELECT raised_by, reason FROM ledger.disputes WHERE id=:id"),
        {"id": dispute_id},
    )
    dispute = d_row.fetchone()

    if dispute:
        status_label = "resolved in your favor" if new_status == "resolved_customer" else \
                       "resolved in the merchant's favor" if new_status == "resolved_merchant" else \
                       new_status.replace("_", " ")
        await db.execute(
            text("""INSERT INTO ops.notifications (user_id, type, title, body, metadata)
                    VALUES (:uid, 'dispute', 'Dispute Resolved', :body, CAST(:meta AS jsonb))"""),
            {
                "uid":  dispute.raised_by,
                "body": f"Your dispute ('{dispute.reason}') has been {status_label}."
                        + (f" Note: {resolution}" if resolution else ""),
                "meta": json.dumps({"dispute_id": str(dispute_id), "status": new_status}),
            },
        )

    await db.commit()
    return {"message": f"Dispute {new_status}"}

# ── Wallets ───────────────────────────────────────────────────
wallet_router = APIRouter(prefix="/wallets", tags=["Wallets"])

@wallet_router.get("")
async def list_wallets(
    current_user: CurrentUser = Depends(require_any_auth),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("SELECT * FROM core.wallets WHERE user_id=:uid ORDER BY currency"),
        {"uid": current_user.user_id},
    )
    return [dict(r._mapping) for r in rows.fetchall()]

@wallet_router.post("/topup", status_code=201)
async def topup_wallet(
    payload: dict,
    current_user: CurrentUser = Depends(require_any_auth),
    db: AsyncSession = Depends(get_db),
):
    cur_row = await db.execute(
        text("SELECT code FROM core.currencies WHERE code=:c AND is_active=TRUE"),
        {"c": payload["currency"]},
    )
    if not cur_row.fetchone():
        raise HTTPException(status_code=400, detail=f"Currency {payload['currency']} not supported")

    amount = Decimal(str(payload["amount"]))
    await db.execute(
        text("""INSERT INTO core.wallets (user_id, currency, balance)
                VALUES (:uid, :cur, :amt)
                ON CONFLICT (user_id, currency)
                DO UPDATE SET balance = core.wallets.balance + :amt,
                              version = core.wallets.version + 1,
                              updated_at = NOW()"""),
        {"uid": current_user.user_id, "cur": payload["currency"], "amt": amount},
    )
    await db.commit()
    row = await db.execute(
        text("SELECT * FROM core.wallets WHERE user_id=:uid AND currency=:c"),
        {"uid": current_user.user_id, "c": payload["currency"]},
    )
    return dict(row.fetchone()._mapping)

@wallet_router.get("/currencies")
async def list_currencies(db: AsyncSession = Depends(get_db)):
    rows = await db.execute(
        text("SELECT * FROM core.currencies WHERE is_active=TRUE ORDER BY code")
    )
    return [dict(r._mapping) for r in rows.fetchall()]

@wallet_router.post("/convert")
async def convert_currency(
    payload: dict,
    current_user: CurrentUser = Depends(require_any_auth),
    db: AsyncSession = Depends(get_db),
):
    from_cur  = payload["from_currency"]
    to_cur    = payload["to_currency"]
    amount    = Decimal(str(payload["amount"]))
    try:
        redis = await get_redis()
        rate  = await get_fx_rate_live(from_cur, to_cur, redis)
        source = "live"
    except Exception:
        from app.payments.router import get_fx_rate
        rate   = await get_fx_rate(from_cur, to_cur, db)
        source = "fallback"
    converted = amount * rate
    return {
        "from_currency":    from_cur,
        "to_currency":      to_cur,
        "original_amount":  float(amount),
        "converted_amount": round(float(converted), 4),
        "fx_rate":          float(rate),
        "rate_source":      source,
        "timestamp":        __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    }

# ── Notifications ─────────────────────────────────────────────
notif_router = APIRouter(prefix="/notifications", tags=["Notifications"])

@notif_router.get("")
async def list_notifications(
    unread_only: bool = Query(False),
    current_user: CurrentUser = Depends(require_any_auth),
    db: AsyncSession = Depends(get_db),
):
    extra = "AND status != 'read'" if unread_only else ""
    rows = await db.execute(
        text(f"""SELECT * FROM ops.notifications
                 WHERE user_id=:uid {extra}
                 ORDER BY created_at DESC LIMIT 50"""),
        {"uid": current_user.user_id},
    )
    return [dict(r._mapping) for r in rows.fetchall()]

@notif_router.patch("/{notif_id}/read")
async def mark_read(
    notif_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_any_auth),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        text("""UPDATE ops.notifications
                SET status='read', read_at=NOW()
                WHERE id=:id AND user_id=:uid"""),
        {"id": notif_id, "uid": current_user.user_id},
    )
    await db.commit()
    return {"message": "Marked as read"}

@notif_router.patch("/read-all")
async def mark_all_read(
    current_user: CurrentUser = Depends(require_any_auth),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        text("""UPDATE ops.notifications
                SET status='read', read_at=NOW()
                WHERE user_id=:uid AND status!='read'"""),
        {"uid": current_user.user_id},
    )
    await db.commit()
    return {"message": "All marked as read"}
