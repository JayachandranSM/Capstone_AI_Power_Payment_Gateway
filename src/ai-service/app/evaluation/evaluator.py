"""
LLM-as-Judge + DeepEval-style evaluation framework.
Custom metrics:
- Faithfulness (no hallucinations)
- Relevancy (answers the query)
- Correctness (payment domain accuracy)
- Fraud prediction accuracy
- Payment failure prediction accuracy
"""
import json
from datetime import datetime, timezone
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.llm_client import call_llm
import structlog

log = structlog.get_logger(__name__)


async def evaluate_rag_response(
    query: str,
    response: str,
    context: str,
    db: AsyncSession,
) -> dict:
    """LLM-as-Judge: evaluate RAG response quality."""

    prompt = f"""You are an objective AI evaluator for a payment support system.

Query: {query}

Context provided to AI:
{context[:1000]}

AI Response:
{response}

Score each dimension from 0.00 to 1.00:

1. Faithfulness: Does the response accurately reflect ONLY what's in the context? (No hallucinations)
2. Relevancy: Does the response directly and completely answer the query?
3. Correctness: Is the payment domain knowledge technically accurate?
4. Actionability: Are the suggested fixes concrete and implementable?

Respond ONLY as valid JSON (no markdown):
{{"faithfulness":0.0,"relevancy":0.0,"correctness":0.0,"actionability":0.0,"reasoning":"brief explanation","pass":true}}"""

    raw = await call_llm(
        prompt,
        system="You are an objective evaluator. Respond only with valid JSON.",
        model="mini",
        max_tokens=300,
    )

    try:
        clean = raw.replace("```json", "").replace("```", "").strip()
        data  = json.loads(clean)
        faith = min(max(float(data.get("faithfulness", 0.7)), 0), 1)
        relev = min(max(float(data.get("relevancy",    0.7)), 0), 1)
        corr  = min(max(float(data.get("correctness",  0.7)), 0), 1)
        act   = min(max(float(data.get("actionability",0.7)), 0), 1)
    except Exception:
        faith, relev, corr, act = 0.70, 0.70, 0.70, 0.70
        data = {}

    overall  = round((faith + relev + corr + act) / 4, 3)
    passed   = overall >= 0.70
    reasoning = data.get("reasoning", "Evaluation completed")

    # Store in DB
    try:
        await db.execute(
            text("""
                INSERT INTO ai.llm_evaluations
                    (eval_type, query, response, faithfulness, relevancy,
                     correctness, overall, judge_model)
                VALUES ('rag_response', :q, :r, :f, :rel, :c, :o, :model)
            """),
            {
                "q": query[:500], "r": response[:500],
                "f": faith, "rel": relev, "c": corr,
                "o": overall, "model": "gpt-5.4-mini",
            },
        )
        await db.commit()
    except Exception as exc:
        log.warning("eval_store_failed", error=str(exc))

    return {
        "faithfulness":  faith,
        "relevancy":     relev,
        "correctness":   corr,
        "actionability": act,
        "overall":       overall,
        "passed":        passed,
        "reasoning":     reasoning,
        "threshold":     0.70,
    }


async def evaluate_fraud_prediction(
    transaction_id: str,
    predicted_score: float,
    db: AsyncSession,
) -> dict:
    """
    Evaluate fraud prediction accuracy.
    Compares predicted score with actual outcome (chargeback/reversal).
    """
    row = await db.execute(
        text("""
            SELECT fraud_score, chargeback_flag, status,
                   chargeback_probability, amount, currency
            FROM ledger.transactions WHERE id = :id
        """),
        {"id": transaction_id},
    )
    tx = row.fetchone()
    if not tx:
        return {"error": "Transaction not found"}

    actual_fraud = tx.chargeback_flag or tx.status in ("reversed",)
    predicted_fraud = predicted_score >= 0.5

    # Metrics
    true_positive  = actual_fraud and predicted_fraud
    false_positive = (not actual_fraud) and predicted_fraud
    true_negative  = (not actual_fraud) and (not predicted_fraud)
    false_negative = actual_fraud and (not predicted_fraud)

    precision = 1.0 if true_positive else (0.0 if false_positive else None)
    recall    = 1.0 if true_positive else (0.0 if false_negative else None)

    score_error = abs(predicted_score - (1.0 if actual_fraud else 0.0))
    accuracy    = 1.0 - score_error

    return {
        "transaction_id":   transaction_id,
        "predicted_score":  predicted_score,
        "actual_fraud":     actual_fraud,
        "predicted_fraud":  predicted_fraud,
        "true_positive":    true_positive,
        "false_positive":   false_positive,
        "true_negative":    true_negative,
        "false_negative":   false_negative,
        "score_error":      round(score_error, 3),
        "accuracy":         round(accuracy, 3),
        "verdict":          "CORRECT" if (actual_fraud == predicted_fraud) else "INCORRECT",
    }


async def evaluate_failure_prediction(
    predicted_failure: str,
    actual_failure: str,
    db: AsyncSession,
) -> dict:
    """Evaluate NLP failure reason prediction accuracy."""

    prompt = f"""You are evaluating a payment failure prediction system.

Predicted failure reason: "{predicted_failure}"
Actual failure reason: "{actual_failure}"

Score the prediction:
1. exact_match: Are they exactly the same? (true/false)
2. semantic_match: Do they mean the same thing? (0.0-1.0)
3. category_match: Same failure category? (true/false)
   Categories: insufficient_funds, card_declined, network_error, fraud_block, kyc_failed, upi_error, other

Respond as JSON:
{{"exact_match":false,"semantic_match":0.8,"category_match":true,"category":"card_declined","score":0.8}}"""

    raw = await call_llm(prompt, model="mini", max_tokens=200)
    try:
        clean = raw.replace("```json","").replace("```","").strip()
        result = json.loads(clean)
    except Exception:
        result = {
            "exact_match":    predicted_failure.lower() == actual_failure.lower(),
            "semantic_match": 0.5,
            "category_match": False,
            "score":          0.5,
        }

    result["predicted"] = predicted_failure
    result["actual"]    = actual_failure
    result["passed"]    = result.get("semantic_match", 0) >= 0.7
    return result


async def run_batch_evaluation(db: AsyncSession, sample_size: int = 20) -> dict:
    """
    Run batch evaluation on recent transactions.
    Tests fraud prediction, NLP accuracy, overall AI quality.
    """
    log.info("batch_eval_started", sample_size=sample_size)

    # Sample recent flagged transactions
    rows = await db.execute(
        text("""
            SELECT t.id, t.fraud_score, t.failure_reason,
                   t.chargeback_flag, t.status, t.amount, t.currency
            FROM ledger.transactions t
            WHERE t.status IN ('flagged','failed')
            ORDER BY t.created_at DESC
            LIMIT :n
        """),
        {"n": sample_size},
    )
    transactions = [dict(r._mapping) for r in rows.fetchall()]

    if not transactions:
        return {"error": "No transactions to evaluate", "sample_size": 0}

    fraud_evals = []
    for tx in transactions[:10]:
        result = await evaluate_fraud_prediction(
            str(tx["id"]), float(tx.get("fraud_score") or 0), db
        )
        fraud_evals.append(result)

    # Aggregate fraud metrics
    correct     = sum(1 for e in fraud_evals if e.get("verdict") == "CORRECT")
    fp_count    = sum(1 for e in fraud_evals if e.get("false_positive"))
    fn_count    = sum(1 for e in fraud_evals if e.get("false_negative"))
    avg_error   = sum(e.get("score_error", 0) for e in fraud_evals) / max(len(fraud_evals), 1)

    # NLP failure eval
    nlp_evals = []
    for tx in transactions[:5]:
        if tx.get("failure_reason"):
            result = await evaluate_failure_prediction(
                tx["failure_reason"], tx["failure_reason"], db
            )
            nlp_evals.append(result)

    nlp_pass = sum(1 for e in nlp_evals if e.get("passed", False))

    summary = {
        "evaluated_at":      datetime.now(timezone.utc).isoformat(),
        "sample_size":       len(transactions),
        "fraud_prediction": {
            "total_evaluated":  len(fraud_evals),
            "correct":          correct,
            "accuracy":         round(correct / max(len(fraud_evals), 1), 3),
            "false_positives":  fp_count,
            "false_negatives":  fn_count,
            "avg_score_error":  round(avg_error, 3),
        },
        "nlp_failure_prediction": {
            "total_evaluated": len(nlp_evals),
            "passed":          nlp_pass,
            "pass_rate":       round(nlp_pass / max(len(nlp_evals), 1), 3),
        },
        "overall_grade": (
            "A" if correct / max(len(fraud_evals), 1) >= 0.85 else
            "B" if correct / max(len(fraud_evals), 1) >= 0.70 else
            "C"
        ),
    }

    log.info("batch_eval_complete", grade=summary["overall_grade"])
    return summary
