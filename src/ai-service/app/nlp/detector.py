"""
NLP-enabled transaction failure reason detection.
Support agents query failed transactions in natural language.
Returns structured failure reasons + confidence scores + fix suggestions.
"""
import json
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.llm_client import call_llm, FAILURE_FIX_MAP, summarise_for_context
import structlog

log = structlog.get_logger(__name__)

INTENT_KEYWORDS = {
    "card":        ["card", "declined", "cvv", "expir", "visa", "master", "credit", "debit"],
    "upi":         ["upi", "vpa", "handle", "pin", "bhim", "gpay", "phonepe"],
    "network":     ["timeout", "network", "gateway", "server", "down", "error", "failed to connect"],
    "fraud":       ["fraud", "suspicious", "flagged", "blocked", "risk", "unusual"],
    "balance":     ["balance", "insufficient", "funds", "limit", "exceed"],
    "kyc":         ["kyc", "verify", "verification", "document", "identity", "pan", "aadhar"],
    "refund":      ["refund", "reversal", "chargeback", "return", "money back"],
    "settlement":  ["settlement", "payout", "merchant", "reconcil"],
}


def extract_intent(query: str) -> list[str]:
    q = query.lower()
    intents = []
    for intent, keywords in INTENT_KEYWORDS.items():
        if any(kw in q for kw in keywords):
            intents.append(intent)
    return intents or ["general"]


def build_sql_filter(intents: list[str]) -> tuple[str, dict]:
    conditions = ["1=1"]
    params: dict = {}

    if "card" in intents:
        conditions.append("payment_method = 'card'")
    if "upi" in intents:
        conditions.append("payment_method = 'upi'")
    if "fraud" in intents:
        conditions.append("(status = 'flagged' OR fraud_score > 0.5)")
    if "balance" in intents:
        conditions.append("failure_reason ILIKE '%balance%'")
    if "network" in intents:
        conditions.append("failure_reason ILIKE '%network%' OR failure_reason ILIKE '%timeout%'")
    if "kyc" in intents:
        conditions.append("failure_reason ILIKE '%kyc%' OR failure_reason ILIKE '%verif%'")

    if set(intents) == {"general"}:
        conditions.append("status IN ('failed','flagged')")

    return " AND ".join(conditions), params


async def detect_failure_reasons(
    query: str,
    db: AsyncSession,
    top_k: int = 10,
) -> dict:
    """
    Full NLP failure detection pipeline:
    1. Intent extraction
    2. SQL filter construction
    3. Transaction retrieval
    4. LLM structured analysis with confidence scoring
    5. Fix suggestions
    """
    intents = extract_intent(query)
    log.info("nlp_intent_extracted", query=query, intents=intents)

    where_clause, params = build_sql_filter(intents)

    rows = await db.execute(
        text(f"""
            SELECT id, status, failure_reason, amount, currency,
                   payment_method, fraud_score, created_at, chargeback_flag
            FROM ledger.transactions
            WHERE {where_clause}
            ORDER BY created_at DESC
            LIMIT :k
        """),
        {**params, "k": top_k},
    )
    transactions = [dict(r._mapping) for r in rows.fetchall()]

    if not transactions:
        return {
            "answer":              "No matching transactions found for your query.",
            "transactions":        [],
            "structured_reasons":  [],
            "fix_suggestions":     [],
            "confidence":          0.0,
            "intents_detected":    intents,
        }

    # Summarise for token efficiency
    context = summarise_for_context(transactions, max_tokens=1200)

    prompt = f"""You are a payment support specialist analyzing failed transactions.

Agent query: "{query}"
Detected intents: {intents}

Recent matching transactions:
{context}

Provide structured analysis:
1. Summary of failure patterns (most common first)
2. Root cause for each pattern
3. Confidence score per pattern (0-1)
4. Fix recommendations per pattern
5. Escalation needed? (yes/no + reason)

Respond as JSON:
{{
  "summary": "...",
  "patterns": [
    {{
      "pattern": "card_declined",
      "count": 5,
      "confidence": 0.9,
      "root_cause": "...",
      "fix": "...",
      "escalate": false
    }}
  ],
  "overall_confidence": 0.85,
  "escalation_needed": false,
  "escalation_reason": ""
}}"""

    raw = await call_llm(prompt, model="mini", max_tokens=600)

    try:
        clean = raw.replace("```json","").replace("```","").strip()
        analysis = json.loads(clean)
    except Exception:
        # Fallback: structured from keywords
        failure_counts: dict = {}
        for tx in transactions:
            reason = tx.get("failure_reason") or "unknown"
            failure_counts[reason] = failure_counts.get(reason, 0) + 1

        analysis = {
            "summary": f"Found {len(transactions)} matching transactions",
            "patterns": [
                {
                    "pattern":    reason,
                    "count":      count,
                    "confidence": 0.7,
                    "root_cause": reason,
                    "fix":        FAILURE_FIX_MAP.get("network_error", {}).get("fixes", ["Retry"])[0],
                    "escalate":   False,
                }
                for reason, count in sorted(
                    failure_counts.items(), key=lambda x: x[1], reverse=True
                )[:3]
            ],
            "overall_confidence": 0.65,
            "escalation_needed":  False,
            "escalation_reason":  "",
        }

    # Enrich patterns with fix map
    structured_reasons = []
    fix_suggestions    = []
    for pattern in analysis.get("patterns", []):
        p_name = pattern.get("pattern", "")
        fix_data = FAILURE_FIX_MAP.get(p_name, {})
        structured_reasons.append({
            "reason":     p_name,
            "count":      pattern.get("count", 0),
            "confidence": pattern.get("confidence", 0.5),
            "root_cause": pattern.get("root_cause", ""),
        })
        if fix_data:
            fix_suggestions.append({
                "pattern": p_name,
                "fixes":   fix_data.get("fixes", []),
                "escalate": fix_data.get("escalate", False),
            })

    return {
        "answer":             analysis.get("summary", ""),
        "transactions":       transactions,
        "structured_reasons": structured_reasons,
        "fix_suggestions":    fix_suggestions,
        "confidence":         analysis.get("overall_confidence", 0.7),
        "escalation_needed":  analysis.get("escalation_needed", False),
        "escalation_reason":  analysis.get("escalation_reason", ""),
        "intents_detected":   intents,
        "analysis":           analysis,
    }
