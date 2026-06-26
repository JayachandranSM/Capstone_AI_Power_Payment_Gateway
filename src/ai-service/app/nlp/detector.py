"""
NLP failure detection with structured confidence scoring.
"""
import json
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.llm_client import call_llm, FAILURE_FIX_MAP, summarise_for_context
import structlog

log = structlog.get_logger(__name__)

INTENT_KEYWORDS = {
    "card":       ["card","declined","cvv","expir","visa","master","credit","debit","chargeback"],
    "upi":        ["upi","vpa","handle","pin","bhim","gpay","phonepe","upi id"],
    "network":    ["timeout","network","gateway","server","down","error","failed to connect","503","502"],
    "fraud":      ["fraud","suspicious","flagged","blocked","risk","unusual","structuring"],
    "balance":    ["balance","insufficient","funds","limit","exceed","low"],
    "kyc":        ["kyc","verify","verification","document","identity","pan","aadhar","kyc pending"],
    "refund":     ["refund","reversal","chargeback","return","money back","credit back"],
    "settlement": ["settlement","payout","merchant","reconcil","neft","rtgs"],
    "velocity":   ["multiple","repeated","too many","velocity","frequent","rapid"],
}

CONFIDENCE_WEIGHTS = {
    "exact_match":   0.40,
    "semantic":      0.35,
    "result_count":  0.15,
    "intent_match":  0.10,
}

def extract_intent(query: str) -> list[str]:
    q = query.lower()
    return [intent for intent, keywords in INTENT_KEYWORDS.items()
            if any(kw in q for kw in keywords)] or ["general"]

def calculate_confidence(intents: list[str], results: list[dict],
                          analysis: dict) -> float:
    """Multi-factor confidence scoring."""
    # Intent match score
    intent_score = min(len(intents) / 3, 1.0) if intents != ["general"] else 0.3

    # Result count score
    count = len(results)
    result_score = 1.0 if count >= 5 else count / 5

    # Pattern confidence from LLM
    patterns      = analysis.get("patterns", [])
    pattern_score = max((p.get("confidence", 0) for p in patterns), default=0.5)

    # Overall confidence
    confidence = (
        CONFIDENCE_WEIGHTS["intent_match"]  * intent_score  +
        CONFIDENCE_WEIGHTS["result_count"]  * result_score  +
        CONFIDENCE_WEIGHTS["semantic"]      * pattern_score +
        CONFIDENCE_WEIGHTS["exact_match"]   * (1.0 if count > 0 else 0.0)
    )
    return round(min(confidence, 0.98), 3)

def build_sql_filter(intents: list[str]) -> tuple[str, dict]:
    conditions = []
    params: dict = {}

    if "card" in intents:
        conditions.append("payment_method = 'card'")
    if "upi" in intents:
        conditions.append("payment_method = 'upi'")
    if "fraud" in intents or "velocity" in intents:
        conditions.append("(status = 'flagged' OR fraud_score > 0.5)")
    if "balance" in intents:
        conditions.append("failure_reason ILIKE '%balance%'")
    if "network" in intents:
        conditions.append("(failure_reason ILIKE '%network%' OR failure_reason ILIKE '%timeout%')")
    if "kyc" in intents:
        conditions.append("(failure_reason ILIKE '%kyc%' OR failure_reason ILIKE '%verif%')")
    if "refund" in intents:
        conditions.append("status IN ('reversed','refund')")

    if not conditions:
        conditions.append("status IN ('failed','flagged')")

    return " AND ".join(conditions), params


async def detect_failure_reasons(query: str, db: AsyncSession,
                                  top_k: int = 10) -> dict:
    intents = extract_intent(query)
    log.info("nlp_intent_extracted", query=query, intents=intents)

    where_clause, params = build_sql_filter(intents)

    rows = await db.execute(
        text(f"""
            SELECT id, status, failure_reason, amount, currency,
                   payment_method, fraud_score, created_at, chargeback_flag
            FROM ledger.transactions
            WHERE {where_clause}
            ORDER BY created_at DESC LIMIT :k
        """),
        {**params, "k": top_k},
    )
    transactions = [dict(r._mapping) for r in rows.fetchall()]

    if not transactions:
        return {
            "answer":             f"No transactions matching '{query}' found in the last 30 days.",
            "transactions":       [],
            "structured_reasons": [],
            "fix_suggestions":    [],
            "confidence":         0.1,
            "intents_detected":   intents,
            "escalation_needed":  False,
        }

    context = summarise_for_context(transactions, max_tokens=1200)

    prompt = f"""You are a payment support specialist analyzing failed transactions.

Agent query: "{query}"
Detected intents: {intents}

Recent matching transactions:
{context}

Provide structured analysis as JSON:
{{
  "summary": "2-3 sentence summary of what you found",
  "patterns": [
    {{
      "pattern": "card_declined",
      "count": 5,
      "confidence": 0.90,
      "root_cause": "Card blocked by issuing bank for international transactions",
      "fix": "Ask customer to enable international transactions in banking app",
      "escalate": false,
      "severity": "medium"
    }}
  ],
  "overall_confidence": 0.85,
  "escalation_needed": false,
  "escalation_reason": "",
  "recommended_priority": "medium"
}}"""

    raw = await call_llm(prompt, model="mini", max_tokens=700)

    try:
        clean    = raw.replace("```json","").replace("```","").strip()
        analysis = json.loads(clean)
    except Exception:
        failure_counts: dict = {}
        for tx in transactions:
            reason = tx.get("failure_reason") or "unknown"
            failure_counts[reason] = failure_counts.get(reason, 0) + 1

        analysis = {
            "summary": f"Found {len(transactions)} transactions matching your query. Most common issue: {max(failure_counts, key=failure_counts.get) if failure_counts else 'unknown'}",
            "patterns": [
                {
                    "pattern":    reason,
                    "count":      count,
                    "confidence": 0.65,
                    "root_cause": reason,
                    "fix":        "Retry transaction or contact support",
                    "escalate":   False,
                    "severity":   "medium",
                }
                for reason, count in sorted(failure_counts.items(), key=lambda x: x[1], reverse=True)[:3]
            ],
            "overall_confidence": 0.60,
            "escalation_needed":  False,
            "escalation_reason":  "",
        }

    # Calculate multi-factor confidence
    confidence = calculate_confidence(intents, transactions, analysis)

    # Enrich with fix map
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
            "severity":   pattern.get("severity", "medium"),
        })
        if fix_data:
            fix_suggestions.append({
                "pattern":  p_name,
                "fixes":    fix_data.get("fixes", []),
                "escalate": fix_data.get("escalate", False),
            })
        elif pattern.get("fix"):
            fix_suggestions.append({
                "pattern":  p_name,
                "fixes":    [pattern["fix"]],
                "escalate": pattern.get("escalate", False),
            })

    return {
        "answer":             analysis.get("summary", ""),
        "transactions":       transactions,
        "structured_reasons": structured_reasons,
        "fix_suggestions":    fix_suggestions,
        "confidence":         confidence,
        "confidence_breakdown": {
            "intent_match":  round(min(len(intents)/3, 1.0) if intents != ["general"] else 0.3, 2),
            "result_count":  round(min(len(transactions)/5, 1.0), 2),
            "llm_pattern":   analysis.get("overall_confidence", 0.5),
        },
        "escalation_needed":  analysis.get("escalation_needed", False),
        "escalation_reason":  analysis.get("escalation_reason", ""),
        "intents_detected":   intents,
        "recommended_priority": analysis.get("recommended_priority", "medium"),
        "analysis":           analysis,
    }
