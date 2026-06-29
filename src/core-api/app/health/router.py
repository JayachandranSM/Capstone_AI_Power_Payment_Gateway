import uuid, json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth.security import CurrentUser, require_admin, require_merchant, require_any_auth
from app.utils.logging import get_logger
from db.redis_client import get_redis
from db.session import get_db

log = get_logger(__name__)

# ── Health ────────────────────────────────────────────────────
health_router = APIRouter(tags=["Health"])

@health_router.get("/health")
async def health(db: AsyncSession = Depends(get_db)):
    db_status = "ok"
    redis_status = "ok"
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        db_status = "error"
    try:
        redis = await get_redis()
        await redis.ping()
    except Exception:
        redis_status = "error"
    overall = "ok" if db_status == "ok" and redis_status == "ok" else "degraded"
    return {"status": overall, "db": db_status, "redis": redis_status, "version": "1.0.0"}

@health_router.get("/ready")
async def ready():
    return {"status": "ready"}

# ── Merchants ─────────────────────────────────────────────────
merchant_router = APIRouter(prefix="/merchants", tags=["Merchants"])

@merchant_router.get("/me")
async def get_my_merchant(
    current_user: CurrentUser = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(
        text("SELECT * FROM core.merchants WHERE user_id=:uid AND is_active=TRUE"),
        {"uid": current_user.user_id},
    )
    merchant = row.fetchone()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    m = dict(merchant._mapping)
    m.pop("api_secret_hash", None)
    return m

@merchant_router.get("/transactions")
async def merchant_transactions(
    page: int = 1, size: int = 20,
    current_user: CurrentUser = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
):
    m_row = await db.execute(
        text("SELECT id FROM core.merchants WHERE user_id=:uid"), {"uid": current_user.user_id}
    )
    merchant = m_row.fetchone()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant not found")

    offset = (page - 1) * size
    rows = await db.execute(
        text("""SELECT t.*, u.full_name as sender_name, u.email as sender_email
                FROM ledger.transactions t
                LEFT JOIN core.users u ON u.id = t.sender_id
                WHERE t.merchant_id=:mid
                ORDER BY t.created_at DESC
                LIMIT :limit OFFSET :offset"""),
        {"mid": merchant.id, "limit": size, "offset": offset},
    )
    transactions = [dict(r._mapping) for r in rows.fetchall()]

    stats_row = await db.execute(
        text("""SELECT COUNT(*) as total,
                SUM(CASE WHEN status='success' THEN amount ELSE 0 END) as total_revenue,
                COUNT(CASE WHEN status='success' THEN 1 END) as success_count,
                COUNT(CASE WHEN status='failed'  THEN 1 END) as failed_count,
                COUNT(CASE WHEN status='flagged' THEN 1 END) as flagged_count
                FROM ledger.transactions WHERE merchant_id=:mid"""),
        {"mid": merchant.id},
    )
    stats = dict(stats_row.fetchone()._mapping)
    return {"transactions": transactions, "stats": stats, "page": page, "size": size}

@merchant_router.get("/settlements")
async def merchant_settlements(
    current_user: CurrentUser = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
):
    m_row = await db.execute(
        text("SELECT id FROM core.merchants WHERE user_id=:uid"), {"uid": current_user.user_id}
    )
    merchant = m_row.fetchone()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant not found")

    # Update p2p transactions to merchant_payment type
    await db.execute(
        text("""UPDATE ledger.transactions
                SET merchant_id = :mid, type = 'merchant_payment'
                WHERE receiver_id = :uid
                AND upi_handle_receiver IS NOT NULL
                AND merchant_id IS NULL"""),
        {"mid": merchant.id, "uid": current_user.user_id},
    )
    await db.commit()

    # Calculate settlements dynamically from actual transactions
    # Group by week (last 8 weeks)
    weekly = await db.execute(
        text("""
            SELECT
                date_trunc('week', created_at) as week_start,
                date_trunc('week', created_at) + INTERVAL '7 days' as week_end,
                currency,
                COUNT(*) as tx_count,
                ROUND(SUM(CASE WHEN status='success' THEN amount ELSE 0 END)::numeric, 2) as gross_amount,
                COUNT(CASE WHEN status='failed' THEN 1 END) as failed_count,
                COUNT(CASE WHEN chargeback_flag THEN 1 END) as chargebacks
            FROM ledger.transactions
            WHERE merchant_id = :mid
            AND created_at > NOW() - INTERVAL '8 weeks'
            GROUP BY date_trunc('week', created_at), currency
            ORDER BY week_start DESC
            LIMIT 12
        """),
        {"mid": merchant.id},
    )
    weekly_rows = weekly.fetchall()

    # Also get pre-seeded settlements from table
    seeded = await db.execute(
        text("SELECT * FROM ledger.settlements WHERE merchant_id=:mid ORDER BY created_at DESC LIMIT 10"),
        {"mid": merchant.id},
    )
    seeded_rows = [dict(r._mapping) for r in seeded.fetchall()]

    # Build dynamic settlement records from actual transactions
    dynamic = []
    for row in weekly_rows:
        r = dict(row._mapping)
        gross   = float(r.get("gross_amount") or 0)
        tx_cnt  = int(r.get("tx_count") or 0)
        cur     = r.get("currency", "INR")
        fees    = round(gross * 0.02, 2)
        gst     = round(fees * 0.18, 2)
        net     = round(gross - fees - gst, 2)
        w_start = r.get("week_start")
        w_end   = r.get("week_end")
        failed  = int(r.get("failed_count") or 0)
        cb      = int(r.get("chargebacks") or 0)

        if gross == 0 and tx_cnt == 0:
            continue

        dynamic.append({
            "id":           str(hash(f"{merchant.id}{w_start}{cur}"))[:8].replace("-",""),
            "merchant_id":  str(merchant.id),
            "period_start": w_start.isoformat() if w_start else None,
            "period_end":   w_end.isoformat() if w_end else None,
            "gross_amount": gross,
            "fees":         fees,
            "tax":          gst,
            "net_amount":   net,
            "currency":     cur,
            "status":       "settled",
            "tx_count":     tx_cnt,
            "failed_count": failed,
            "chargebacks":  cb,
            "summary_ai": (
                f"Week {w_start.strftime('%d %b') if w_start else ''} — "
                f"{w_end.strftime('%d %b %Y') if w_end else ''}. "
                f"Gross: {cur} {gross:,.2f} across {tx_cnt} transactions. "
                f"Platform fee (2%): {fees:,.2f}. GST (18% on fee): {gst:,.2f}. "
                f"Net payout: {net:,.2f}."
                + (f" Failed: {failed}." if failed else "")
                + (f" Chargebacks: {cb}." if cb else "")
            ),
            "forecast_next": round(gross * 1.1, 2),
            "created_at":   w_start.isoformat() if w_start else None,
            "settled_at":   w_end.isoformat() if w_end else None,
            "source":       "dynamic",
        })

    # Merge dynamic + seeded settlements, dynamic takes priority
    # Use seeded records to fill in historical weeks not in dynamic
    seen_periods = {(s.get("period_start","")[:10], s.get("currency","")) for s in dynamic}
    for s in seeded_rows:
        key = (str(s.get("period_start",""))[:10], s.get("currency",""))
        if key not in seen_periods:
            dynamic.append(s)
            seen_periods.add(key)

    # Sort by period_start descending
    dynamic.sort(key=lambda x: str(x.get("period_start") or ""), reverse=True)
    return dynamic if dynamic else seeded_rows

# ── Admin ─────────────────────────────────────────────────────
admin_router = APIRouter(prefix="/admin", tags=["Admin"])

@admin_router.get("/fraud-alerts")
async def list_fraud_alerts(
    status: str = "open",
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""SELECT a.*, t.amount, t.currency, t.payment_method,
                u.full_name as sender_name, u.email as sender_email
                FROM ai.fraud_alerts a
                JOIN ledger.transactions t ON t.id = a.transaction_id
                LEFT JOIN core.users u ON u.id = t.sender_id
                WHERE a.status=:status
                ORDER BY a.fraud_score DESC, a.created_at DESC LIMIT 100"""),
        {"status": status},
    )
    return [dict(r._mapping) for r in rows.fetchall()]

@admin_router.patch("/fraud-alerts/{alert_id}/resolve")
async def resolve_alert(
    alert_id: uuid.UUID, payload: dict,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    new_status = payload.get("status", "resolved")
    feedback   = payload.get("feedback", "resolved")

    await db.execute(
        text("""UPDATE ai.fraud_alerts
                SET status=:status, resolved_by=:uid, feedback=:fb, updated_at=NOW()
                WHERE id=:id"""),
        {"status": new_status, "uid": current_user.user_id, "fb": feedback, "id": alert_id},
    )

    # Feedback loop: if false_positive, reduce rule weight
    if new_status == "false_positive":
        row = await db.execute(
            text("SELECT rules_triggered FROM ai.fraud_alerts WHERE id=:id"), {"id": alert_id}
        )
        alert = row.fetchone()
        if alert and alert.rules_triggered:
            rules = alert.rules_triggered if isinstance(alert.rules_triggered, list) \
                    else json.loads(alert.rules_triggered)
            for r in rules:
                await db.execute(
                    text("""UPDATE ai.fraud_patterns
                            SET false_positive = false_positive + 1,
                                weight = GREATEST(weight - 0.01, 0.05),
                                last_updated = NOW()
                            WHERE rule_name=:rule"""),
                    {"rule": r.get("rule")},
                )

    await db.commit()
    return {"message": f"Alert marked as {new_status}"}

@admin_router.get("/users")
async def list_users(
    role: str | None = None, page: int = 1, size: int = 20,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    where  = "WHERE role=:role" if role else "WHERE 1=1"
    params = {"role": role} if role else {}
    offset = (page - 1) * size
    rows = await db.execute(
        text(f"""SELECT id, email, full_name, role, kyc_status, is_active,
                 country_code, preferred_currency, created_at
                 FROM core.users {where}
                 ORDER BY created_at DESC LIMIT :limit OFFSET :offset"""),
        {**params, "limit": size, "offset": offset},
    )
    return [dict(r._mapping) for r in rows.fetchall()]

@admin_router.get("/fraud-patterns")
async def get_fraud_patterns(
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get fraud rule weights for feedback loop visibility."""
    rows = await db.execute(
        text("""
            SELECT rule_name, weight, hit_count, false_positive, last_updated
            FROM ai.fraud_patterns
            ORDER BY hit_count DESC
        """)
    )
    return [dict(r._mapping) for r in rows.fetchall()]


@admin_router.get("/tickets")
async def list_tickets(
    status: str = "open",
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""SELECT t.*, u.full_name, u.email
                FROM ops.tickets t
                JOIN core.users u ON u.id = t.user_id
                WHERE t.status=:status
                ORDER BY
                  CASE t.priority
                    WHEN 'urgent' THEN 1 WHEN 'high' THEN 2
                    WHEN 'medium' THEN 3 ELSE 4 END,
                  t.created_at DESC LIMIT 100"""),
        {"status": status},
    )
    return [dict(r._mapping) for r in rows.fetchall()]

@admin_router.patch("/tickets/{ticket_id}/assign")
async def assign_ticket(
    ticket_id: uuid.UUID, payload: dict,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        text("""UPDATE ops.tickets
                SET assigned_to=:agent, status='in_progress', updated_at=NOW()
                WHERE id=:id"""),
        {"agent": payload.get("agent_id", str(current_user.user_id)), "id": ticket_id},
    )
    await db.commit()
    return {"message": "Ticket assigned"}

@admin_router.patch("/tickets/{ticket_id}/resolve")
async def resolve_ticket(
    ticket_id: uuid.UUID, payload: dict,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        text("""UPDATE ops.tickets
                SET status='resolved', resolution=:res, updated_at=NOW()
                WHERE id=:id"""),
        {"res": payload.get("resolution", ""), "id": ticket_id},
    )
    await db.commit()
    return {"message": "Ticket resolved"}

@admin_router.patch("/users/{user_id}/toggle-status")
async def toggle_user_status(
    user_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Activate or deactivate a user account."""
    row = await db.execute(
        text("SELECT id, is_active, full_name FROM core.users WHERE id = :uid"),
        {"uid": user_id},
    )
    user = row.fetchone()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    new_status = not user.is_active
    await db.execute(
        text("UPDATE core.users SET is_active = :status, updated_at = NOW() WHERE id = :uid"),
        {"status": new_status, "uid": user_id},
    )
    await db.execute(
        text("""INSERT INTO ops.audit_log (actor_id, action, entity_type, entity_id, new_values)
                VALUES (:actor, :action, 'user', :uid, CAST(:vals AS jsonb))"""),
        {
            "actor":  current_user.user_id,
            "action": "user_activated" if new_status else "user_deactivated",
            "uid":    user_id,
            "vals":   f'{{"is_active": {str(new_status).lower()}, "user_name": "{user.full_name}"}}',
        },
    )
    await db.commit()
    return {"user_id": str(user_id), "is_active": new_status,
            "message": f"User {'activated' if new_status else 'deactivated'} successfully"}


@admin_router.patch("/users/{user_id}/kyc")
async def update_kyc_status(
    user_id: uuid.UUID,
    payload: dict,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update KYC verification status."""
    kyc_status = payload.get("kyc_status", "verified")
    if kyc_status not in ("pending", "verified", "failed", "expired"):
        raise HTTPException(status_code=400, detail="Invalid KYC status")

    await db.execute(
        text("UPDATE core.users SET kyc_status = :kyc, updated_at = NOW() WHERE id = :uid"),
        {"kyc": kyc_status, "uid": user_id},
    )
    await db.execute(
        text("""INSERT INTO ops.audit_log (actor_id, action, entity_type, entity_id, new_values)
                VALUES (:actor, 'kyc_status_updated', 'user', :uid, CAST(:vals AS jsonb))"""),
        {
            "actor": current_user.user_id,
            "uid":   user_id,
            "vals":  f'{{"kyc_status": "{kyc_status}"}}',
        },
    )
    await db.commit()
    return {"user_id": str(user_id), "kyc_status": kyc_status,
            "message": f"KYC status updated to {kyc_status}"}


@admin_router.get("/users/{user_id}/summary")
async def get_user_summary(
    user_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get full user summary with wallets, transactions, disputes."""
    user_row = await db.execute(
        text("SELECT * FROM core.users WHERE id = :uid"), {"uid": user_id}
    )
    user = user_row.fetchone()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    wallets_row = await db.execute(
        text("SELECT * FROM core.wallets WHERE user_id = :uid"), {"uid": user_id}
    )
    wallets = [dict(r._mapping) for r in wallets_row.fetchall()]

    tx_row = await db.execute(
        text("""SELECT COUNT(*) as total,
                SUM(CASE WHEN status='success' THEN amount_usd ELSE 0 END) as volume_usd,
                COUNT(CASE WHEN status='failed' THEN 1 END) as failed,
                COUNT(CASE WHEN status='flagged' THEN 1 END) as flagged,
                AVG(fraud_score) as avg_fraud
                FROM ledger.transactions WHERE sender_id = :uid"""),
        {"uid": user_id},
    )
    tx_stats = dict(tx_row.fetchone()._mapping)

    disputes_row = await db.execute(
        text("SELECT COUNT(*) as total FROM ledger.disputes WHERE raised_by = :uid"),
        {"uid": user_id},
    )
    disputes = dict(disputes_row.fetchone()._mapping)

    upi_row = await db.execute(
        text("SELECT handle FROM core.upi_handles WHERE user_id = :uid AND is_primary = TRUE"),
        {"uid": user_id},
    )
    upi = upi_row.fetchone()

    u = dict(user._mapping)
    u.pop("hashed_password", None)
    u.pop("mfa_secret", None)

    return {
        "user":       u,
        "wallets":    wallets,
        "tx_stats":   tx_stats,
        "disputes":   disputes,
        "upi_handle": upi.handle if upi else None,
    }


@admin_router.get("/analytics")
async def platform_analytics(
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    stats = await db.execute(text("""
        SELECT
            COUNT(*) as total_transactions,
            SUM(CASE WHEN status='success' THEN amount_usd ELSE 0 END) as total_volume_usd,
            COUNT(CASE WHEN status='success' THEN 1 END) as success_count,
            COUNT(CASE WHEN status='failed'  THEN 1 END) as failed_count,
            COUNT(CASE WHEN status='flagged' THEN 1 END) as flagged_count,
            AVG(fraud_score) as avg_fraud_score,
            COUNT(CASE WHEN chargeback_flag THEN 1 END) as total_chargebacks
        FROM ledger.transactions
        WHERE created_at > NOW() - INTERVAL '30 days'
    """))
    s = dict(stats.fetchone()._mapping)

    # Currency breakdown
    cur_rows = await db.execute(text("""
        SELECT currency, COUNT(*) as count,
               SUM(CASE WHEN status='success' THEN amount ELSE 0 END) as volume
        FROM ledger.transactions
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY currency ORDER BY volume DESC
    """))
    currencies = [dict(r._mapping) for r in cur_rows.fetchall()]

    # Daily trend (last 7 days)
    trend_rows = await db.execute(text("""
        SELECT DATE(created_at) as date,
               COUNT(*) as count,
               SUM(CASE WHEN status='success' THEN amount_usd ELSE 0 END) as volume_usd
        FROM ledger.transactions
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY DATE(created_at) ORDER BY date
    """))
    trend = [dict(r._mapping) for r in trend_rows.fetchall()]

    return {"summary": s, "currency_breakdown": currencies, "daily_trend": trend}


@admin_router.get("/transactions")
async def admin_list_transactions(
    page: int = 1,
    size: int = 20,
    status: str = None,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin view all transactions with filters."""
    offset = (page - 1) * size
    where  = "WHERE t.status = :status" if status else ""
    params = {"limit": size, "offset": offset}
    if status:
        params["status"] = status
    rows = await db.execute(
        text(f"""
            SELECT t.id, t.amount, t.currency, t.status, t.payment_method,
                   t.fraud_score, t.failure_reason, t.created_at,
                   u.full_name as sender_name, u.email as sender_email
            FROM ledger.transactions t
            JOIN core.users u ON u.id = t.sender_id
            {where}
            ORDER BY t.created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    items = [dict(r._mapping) for r in rows.fetchall()]
    total_row = await db.execute(text("SELECT COUNT(*) FROM ledger.transactions"))
    total = total_row.scalar()
    return {"items": items, "total": total, "page": page, "size": size}


@admin_router.get("/refunds")
async def admin_list_refunds(
    status: str = None,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin view all refund requests."""
    where  = "WHERE r.status = :status" if status else ""
    params = {"status": status} if status else {}
    rows = await db.execute(
        text(f"""
            SELECT r.id, r.original_tx_id as transaction_id, r.amount, r.currency,
                   r.reason, r.status, r.created_at,
                   u.full_name as customer_name, u.email as customer_email
            FROM ledger.refunds r
            JOIN core.users u ON u.id = r.requester_id
            {where}
            ORDER BY r.created_at DESC LIMIT 100
        """),
        params,
    )
    return [dict(r._mapping) for r in rows.fetchall()]

@admin_router.get("/disputes")
async def list_disputes(
    status: str = None,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """List all disputes with transaction and user details."""
    query = """
        SELECT d.id, d.transaction_id, d.raised_by, d.reason,
               d.status, d.priority, d.created_at,
               t.amount, t.currency, t.payment_method,
               u.full_name as customer_name, u.email as customer_email
        FROM ledger.disputes d
        JOIN ledger.transactions t ON t.id = d.transaction_id
        JOIN core.users u ON u.id = d.raised_by
        {where}
        ORDER BY d.created_at DESC LIMIT 100
    """
    where = "WHERE d.status = :status" if status else ""
    query = query.format(where=where)
    params = {"status": status} if status else {}
    rows = await db.execute(text(query), params)
    return [dict(r._mapping) for r in rows.fetchall()]

