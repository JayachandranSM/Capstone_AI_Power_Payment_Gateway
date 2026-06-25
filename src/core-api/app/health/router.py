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
    rows = await db.execute(
        text("SELECT * FROM ledger.settlements WHERE merchant_id=:mid ORDER BY created_at DESC LIMIT 20"),
        {"mid": merchant.id},
    )
    return [dict(r._mapping) for r in rows.fetchall()]

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
