"""
Multi-Agent Orchestrator
Coordinates: FraudAgent | SettlementAgent | DisputeAgent | ComplianceAgent
Each agent has tools, memory, and can communicate via shared context.
"""
import json
import uuid
from datetime import datetime, timezone
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.llm_client import call_llm, PAYMENT_TOOLS, summarise_for_context, strip_markdown
import structlog

log = structlog.get_logger(__name__)

# ── Base Agent ────────────────────────────────────────────────
class BaseAgent:
    def __init__(self, name: str, role: str):
        self.name    = name
        self.role    = role
        self.results: dict = {}

    async def run(self, context: dict, db: AsyncSession) -> dict:
        raise NotImplementedError

# ── Fraud Agent ───────────────────────────────────────────────
class FraudAgent(BaseAgent):
    def __init__(self):
        super().__init__("FraudAgent", "fraud_detection")

    async def run(self, context: dict, db: AsyncSession) -> dict:
        log.info("fraud_agent_started", tx_id=context.get("transaction_id"))

        tx_id       = context.get("transaction_id")
        fraud_score = context.get("fraud_score", 0)
        rules       = context.get("rules_triggered", [])

        rules_summary = "\n".join([
            f"- {r['rule']}: {r.get('detail','')} (weight: {r.get('weight',0):.2f})"
            for r in rules
        ])

        prompt = f"""You are a fraud analyst agent. Analyze this transaction:

Transaction ID: {tx_id}
Fraud Score: {fraud_score:.3f} / 1.000
Rules triggered:
{rules_summary}

Provide:
1. Risk assessment (LOW/MEDIUM/HIGH/CRITICAL)
2. Primary fraud pattern detected
3. Recommended action (APPROVE/REVIEW/BLOCK)
4. Confidence level (0-100%)
5. One-line explanation for the customer

Respond as JSON:
{{"risk_level":"HIGH","pattern":"velocity_abuse","action":"BLOCK","confidence":87,"customer_message":"Your transaction was paused for security review. Please contact support."}}"""

        raw = await call_llm(prompt, model="mini", max_tokens=300)
        try:
            clean = raw.replace("```json","").replace("```","").strip()
            result = json.loads(clean)
        except Exception:
            result = {
                "risk_level": "HIGH" if fraud_score > 0.7 else "MEDIUM",
                "pattern": "anomaly_detected",
                "action": "BLOCK" if fraud_score > 0.75 else "REVIEW",
                "confidence": int(fraud_score * 100),
                "customer_message": "Transaction flagged for security review.",
            }

        result["agent"]       = self.name
        result["fraud_score"] = fraud_score
        result["tx_id"]       = str(tx_id)
        self.results          = result

        log.info("fraud_agent_complete", action=result.get("action"))
        return result

# ── Settlement Agent ──────────────────────────────────────────
class SettlementAgent(BaseAgent):
    def __init__(self):
        super().__init__("SettlementAgent", "settlement_reconciliation")

    async def run(self, context: dict, db: AsyncSession) -> dict:
        merchant_id = context.get("merchant_id")
        log.info("settlement_agent_started", merchant_id=merchant_id)

        # Fetch 30-day stats
        stats_row = await db.execute(
            text("""
                SELECT
                    COUNT(*) as tx_count,
                    SUM(CASE WHEN status='success' THEN amount ELSE 0 END) as gross,
                    COUNT(CASE WHEN chargeback_flag THEN 1 END) as chargebacks,
                    COUNT(CASE WHEN status='failed' THEN 1 END) as failed,
                    AVG(CASE WHEN status='success' THEN amount END) as avg_tx,
                    currency
                FROM ledger.transactions
                WHERE merchant_id = :mid
                AND created_at > NOW() - INTERVAL '30 days'
                GROUP BY currency
            """),
            {"mid": merchant_id},
        )
        stats = [dict(r._mapping) for r in stats_row.fetchall()]

        if not stats:
            return {"agent": self.name, "summary": "No transactions in last 30 days",
                    "forecast": 0, "anomalies": []}

        # Build prompt with REAL numbers directly — do not summarise
        stats_lines = []
        total_gross = 0.0
        total_tx    = 0
        total_cb    = 0
        total_fail  = 0
        for s in stats:
            g   = float(s.get("gross") or 0)
            cnt = int(s.get("tx_count") or 0)
            cb  = int(s.get("chargebacks") or 0)
            fl  = int(s.get("failed") or 0)
            avg = float(s.get("avg_tx") or 0)
            cur = s.get("currency","INR")
            total_gross += g
            total_tx    += cnt
            total_cb    += cb
            total_fail  += fl
            fees_s  = round(g * 0.02, 2)
            gst_s   = round(fees_s * 0.18, 2)
            net_s   = round(g - fees_s - gst_s, 2)
            stats_lines.append(
                f"  Currency: {cur} | Transactions: {cnt} | Gross: {g:.2f} | "
                f"Avg: {avg:.2f} | Chargebacks: {cb} | Failed: {fl} | "
                f"Platform fee (2%): {fees_s:.2f} | GST (18% on fee): {gst_s:.2f} | Net: {net_s:.2f}"
            )

        total_fees = round(total_gross * 0.02, 2)
        total_gst  = round(total_fees * 0.18, 2)
        total_net  = round(total_gross - total_fees - total_gst, 2)
        forecast   = round(total_gross * 1.1, 2)
        cb_rate    = round((total_cb / total_tx * 100), 2) if total_tx else 0
        cb_risk    = "HIGH" if cb_rate > 2 else "MEDIUM" if cb_rate > 1 else "LOW"

        stats_summary = "\n".join(stats_lines)

        prompt = f"""You are a settlement reconciliation agent for a payment gateway. Analyze this merchant data:

MERCHANT 30-DAY SETTLEMENT DATA:
{stats_summary}

TOTALS:
  Total transactions: {total_tx}
  Total gross revenue: {total_gross:.2f}
  Total platform fee (2%): {total_fees:.2f}
  Total GST (18% on fee): {total_gst:.2f}
  Total net payout: {total_net:.2f}
  Chargeback count: {total_cb} ({cb_rate}% rate) — Risk: {cb_risk}
  Failed transactions: {total_fail}
  Forecast next 30 days (+10% growth): {forecast:.2f}

Generate a professional plain-English settlement summary explaining:
1. How much the merchant earned and what was deducted
2. Chargeback risk assessment
3. Revenue forecast for next 30 days
4. Any anomalies or recommendations

Respond ONLY as JSON (no markdown):
{{"gross":{total_gross},"fees":{total_fees},"tax":{total_gst},"net":{total_net},"forecast_next_30":{forecast},"chargeback_risk":"{cb_risk}","anomalies":[],"recommended_settlement_date":"","summary":"..."}}"""

        raw = await call_llm(prompt, model="mini", max_tokens=400)
        try:
            clean = raw.replace("```json","").replace("```","").strip()
            result = json.loads(clean)
        except Exception:
            result = {
                "gross": total_gross, "fees": total_fees,
                "tax": total_gst, "net": total_net,
                "forecast_next_30": forecast,
                "chargeback_risk": cb_risk,
                "anomalies": [],
                "summary": (
                    f"Processed {total_tx} transactions totalling {total_gross:.2f}. "
                    f"Platform fee: {total_fees:.2f} (2%). GST: {total_gst:.2f} (18% on fee). "
                    f"Net payout: {total_net:.2f}. Chargeback risk: {cb_risk}. "
                    f"Forecast next 30 days: {forecast:.2f}."
                ),
            }

        result["agent"]  = self.name
        result["stats"]  = stats
        self.results     = result

        log.info("settlement_agent_complete", net=result.get("net"))
        return result

# ── Dispute Agent ─────────────────────────────────────────────
class DisputeAgent(BaseAgent):
    def __init__(self):
        super().__init__("DisputeAgent", "dispute_resolution")

    async def run(self, context: dict, db: AsyncSession) -> dict:
        dispute_id = context.get("dispute_id")
        log.info("dispute_agent_started", dispute_id=dispute_id)

        # Fetch dispute + transaction details
        d_row = await db.execute(
            text("""
                SELECT d.*, t.amount, t.currency, t.payment_method,
                       t.fraud_score, t.status as tx_status,
                       u.full_name as customer_name
                FROM ledger.disputes d
                JOIN ledger.transactions t ON t.id = d.transaction_id
                JOIN core.users u ON u.id = d.raised_by
                WHERE d.id = :did
            """),
            {"did": dispute_id},
        )
        dispute = d_row.fetchone()
        if not dispute:
            return {"agent": self.name, "error": "Dispute not found"}

        d = dict(dispute._mapping)

        prompt = f"""You are a dispute resolution agent. Analyze this dispute:

Customer: {d.get('customer_name')}
Transaction: {d.get('currency')} {float(d.get('amount') or 0):.2f} via {d.get('payment_method')}
Fraud Score: {d.get('fraud_score')}
Dispute Reason: {d.get('reason')}

Rank these hypotheses by likelihood and provide resolution steps:

Respond as JSON:
{{
  "root_cause_ranking": [
    {{"hypothesis": "merchant_error", "likelihood": 0.7, "evidence": "reason mentions wrong amount"}},
    {{"hypothesis": "fraud", "likelihood": 0.2, "evidence": "fraud score moderate"}},
    {{"hypothesis": "customer_error", "likelihood": 0.1, "evidence": "no supporting evidence"}}
  ],
  "recommended_resolution": "resolved_customer",
  "resolution_steps": ["Step 1", "Step 2"],
  "escalate": false,
  "estimated_resolution_days": 3,
  "llm_analysis": "Based on the evidence..."
}}"""

        raw = await call_llm(prompt, model="mini", max_tokens=500)
        try:
            clean = raw.replace("```json","").replace("```","").strip()
            result = json.loads(clean)
        except Exception:
            result = {
                "root_cause_ranking": [
                    {"hypothesis": "merchant_error", "likelihood": 0.6,
                     "evidence": "Customer dispute filed"},
                ],
                "recommended_resolution": "resolved_customer",
                "resolution_steps": ["Review transaction", "Contact merchant", "Issue refund if valid"],
                "escalate": False,
                "estimated_resolution_days": 5,
                "llm_analysis": "Manual review required.",
            }

        # Update dispute with AI analysis
        await db.execute(
            text("""
                UPDATE ledger.disputes
                SET llm_analysis = :analysis,
                    root_cause_rank = :ranking,
                    updated_at = NOW()
                WHERE id = :did
            """),
            {
                "analysis": result.get("llm_analysis", ""),
                "ranking": json.dumps(result.get("root_cause_ranking", [])),
                "did": dispute_id,
            },
        )
        await db.commit()

        result["agent"]      = self.name
        result["dispute_id"] = str(dispute_id)
        self.results         = result

        log.info("dispute_agent_complete",
                 resolution=result.get("recommended_resolution"))
        return result

# ── Compliance Agent ──────────────────────────────────────────
class ComplianceAgent(BaseAgent):
    def __init__(self):
        super().__init__("ComplianceAgent", "aml_kyc_gdpr")

    async def run(self, context: dict, db: AsyncSession) -> dict:
        user_id = context.get("user_id")
        log.info("compliance_agent_started", user_id=user_id)

        u_row = await db.execute(
            text("""
                SELECT u.*, w.balance, w.currency
                FROM core.users u
                LEFT JOIN core.wallets w ON w.user_id = u.id
                WHERE u.id = :uid
            """),
            {"uid": user_id},
        )
        user = u_row.fetchone()
        if not user:
            return {"agent": self.name, "error": "User not found"}

        tx_row = await db.execute(
            text("""
                SELECT COUNT(*) as tx_count,
                       SUM(amount_usd) as total_volume_usd,
                       MAX(amount_usd) as max_single_tx
                FROM ledger.transactions
                WHERE sender_id = :uid
                AND created_at > NOW() - INTERVAL '30 days'
                AND status = 'success'
            """),
            {"uid": user_id},
        )
        tx_stats = dict(tx_row.fetchone()._mapping)

        aml_triggered = []
        total_volume  = float(tx_stats.get("total_volume_usd") or 0)
        max_tx        = float(tx_stats.get("max_single_tx") or 0)

        if total_volume > 10000:
            aml_triggered.append("HIGH_VOLUME_30D")
        if max_tx > 5000:
            aml_triggered.append("LARGE_SINGLE_TX")
        if user.kyc_status != "verified":
            aml_triggered.append("KYC_NOT_VERIFIED")

        result = {
            "agent":          self.name,
            "user_id":        str(user_id),
            "kyc_status":     user.kyc_status,
            "aml_flags":      aml_triggered,
            "total_volume_usd": total_volume,
            "kyc_reverify_required": user.kyc_status != "verified" or total_volume > 10000,
            "gdpr_data_subject": {
                "can_request_deletion": True,
                "data_retention_days": 2555,
                "pii_fields": ["email", "phone", "full_name"],
            },
            "recommendation": "REVERIFY" if aml_triggered else "CLEAR",
        }

        self.results = result
        log.info("compliance_agent_complete",
                 recommendation=result["recommendation"])
        return result

# ── Orchestrator ──────────────────────────────────────────────
class PaymentOrchestrator:
    """
    Coordinates all agents for collaborative root cause analysis.
    Agents share context and results with each other.
    """

    def __init__(self):
        self.fraud_agent      = FraudAgent()
        self.settlement_agent = SettlementAgent()
        self.dispute_agent    = DisputeAgent()
        self.compliance_agent = ComplianceAgent()

    async def analyze_transaction(self, transaction_id: str,
                                   db: AsyncSession) -> dict:
        """Full transaction analysis: fraud + compliance."""
        log.info("orchestrator_analyze_transaction", tx_id=transaction_id)

        tx_row = await db.execute(
            text("""
                SELECT t.*, u.id as uid
                FROM ledger.transactions t
                LEFT JOIN core.users u ON u.id = t.sender_id
                WHERE t.id = :id
            """),
            {"id": transaction_id},
        )
        tx = tx_row.fetchone()
        if not tx:
            return {"error": "Transaction not found"}

        alert_row = await db.execute(
            text("SELECT * FROM ai.fraud_alerts WHERE transaction_id=:id ORDER BY created_at DESC LIMIT 1"),
            {"id": transaction_id},
        )
        alert = alert_row.fetchone()
        rules = []
        if alert and alert.rules_triggered:
            rules = alert.rules_triggered if isinstance(alert.rules_triggered, list) \
                    else json.loads(alert.rules_triggered)

        # Shared context passed between agents
        context = {
            "transaction_id": transaction_id,
            "fraud_score":    float(tx.fraud_score or 0),
            "rules_triggered": rules,
            "user_id":        str(tx.uid) if tx.uid else None,
            "amount":         float(tx.amount),
            "currency":       tx.currency,
        }

        # Run agents in parallel where possible
        import asyncio
        fraud_result, compliance_result = await asyncio.gather(
            self.fraud_agent.run(context, db),
            self.compliance_agent.run({**context, "user_id": context["user_id"]}, db)
            if context["user_id"] else asyncio.sleep(0),
        )

        # Agent-to-agent: compliance informs fraud
        if isinstance(compliance_result, dict) and compliance_result.get("aml_flags"):
            fraud_result["aml_flags"]    = compliance_result["aml_flags"]
            fraud_result["compliance_note"] = "AML flags detected — escalation recommended"

        # Synthesize
        synthesis_prompt = f"""You are the orchestrator. Two agents have analyzed this transaction:

FraudAgent result: {json.dumps(fraud_result, indent=2)}
ComplianceAgent result: {json.dumps(compliance_result if isinstance(compliance_result, dict) else {}, indent=2)}

Provide a final unified recommendation in 2-3 sentences covering:
1. Overall risk verdict
2. Recommended action
3. Any escalation needed"""

        final_synthesis = await call_llm(synthesis_prompt, model="mini", max_tokens=200)

        return {
            "orchestrator": "PaymentOrchestrator",
            "transaction_id": transaction_id,
            "fraud_analysis": fraud_result,
            "compliance_analysis": compliance_result if isinstance(compliance_result, dict) else {},
            "final_synthesis": final_synthesis,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    async def resolve_dispute(self, dispute_id: str, db: AsyncSession) -> dict:
        """Dispute resolution with fraud + dispute agents."""
        log.info("orchestrator_resolve_dispute", dispute_id=dispute_id)

        context = {"dispute_id": dispute_id}
        dispute_result = await self.dispute_agent.run(context, db)

        return {
            "orchestrator":    "PaymentOrchestrator",
            "dispute_id":      dispute_id,
            "dispute_analysis": dispute_result,
            "timestamp":       datetime.now(timezone.utc).isoformat(),
        }

    async def merchant_settlement(self, merchant_id: str, db: AsyncSession) -> dict:
        """Settlement + compliance analysis for merchant."""
        log.info("orchestrator_merchant_settlement", merchant_id=merchant_id)

        context = {"merchant_id": merchant_id}
        settlement_result = await self.settlement_agent.run(context, db)

        return {
            "orchestrator":      "PaymentOrchestrator",
            "merchant_id":       merchant_id,
            "settlement_analysis": settlement_result,
            "timestamp":         datetime.now(timezone.utc).isoformat(),
        }
