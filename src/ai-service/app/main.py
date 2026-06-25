"""
AI Service — Complete implementation:
- RAG with real Azure OpenAI embeddings
- Hybrid search (semantic + keyword) with reranking
- Multi-agent orchestration
- Tool-calling support
- Session memory for merchant support
- LLM-as-Judge + DeepEval evaluation
- NLP failure detection
- Fraud explanation
- Settlement summary
- Token optimisation
"""
import json
import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from pydantic import BaseModel, Field
import structlog

from app.config import get_ai_settings
from app.llm_client import (
    call_llm, get_embedding, PAYMENT_TOOLS,
    FAILURE_FIX_MAP, summarise_for_context, count_tokens,
)
from app.rag.pipeline import (
    rag_answer, hybrid_search, embed_and_store_transaction,
    embed_and_store_kb,
)
from app.nlp.detector import detect_failure_reasons
from app.agents.orchestrator import PaymentOrchestrator
from app.evaluation.evaluator import (
    evaluate_rag_response, evaluate_fraud_prediction,
    evaluate_failure_prediction, run_batch_evaluation,
)
from app.session_memory import (
    create_session, get_session, add_message,
    get_conversation_history, format_history_for_llm, delete_session,
)

settings    = get_ai_settings()
log         = structlog.get_logger(__name__)
orchestrator = PaymentOrchestrator()

structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
    logger_factory=structlog.PrintLoggerFactory(),
)

# ── DB ────────────────────────────────────────────────────────
engine = create_async_engine(
    settings.database_url, pool_size=10, pool_pre_ping=True
)
AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)

async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise

# ── Lifespan ──────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("ai_service_startup")
    # Seed knowledge base on startup
    async with AsyncSessionLocal() as db:
        await seed_knowledge_base(db)
    yield
    await engine.dispose()
    log.info("ai_service_shutdown")

# ── App ───────────────────────────────────────────────────────
app = FastAPI(
    title="AI Service",
    description="RAG, agents, evaluation, NLP, tool-calling",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── KB Seeding ────────────────────────────────────────────────
async def seed_knowledge_base(db: AsyncSession):
    count_row = await db.execute(text("SELECT COUNT(*) FROM ai.knowledge_base"))
    count = count_row.scalar()
    if count and count > 0:
        return

    articles = [
        {
            "title": "UPI Payment Failures — Troubleshooting Guide",
            "content": "UPI failures occur due to: incorrect VPA, wrong PIN, bank server downtime, "
                       "or daily limit exceeded. Steps: verify UPI handle format (name@bank), "
                       "check PIN, retry after 5 minutes, contact bank if persistent.",
            "category": "upi", "tags": ["upi", "failure", "troubleshoot"],
        },
        {
            "title": "Card Declined — Resolution Steps",
            "content": "Card declines happen when: insufficient balance, card blocked, "
                       "international transactions disabled, incorrect CVV, or card expired. "
                       "Fix: check balance, enable international payments in banking app, "
                       "verify card details, or use alternative payment method.",
            "category": "card", "tags": ["card", "declined", "cvv"],
        },
        {
            "title": "Fraud Detection — What Triggers a Flag",
            "content": "Transactions are flagged when: amount exceeds 100K, "
                       "5+ transactions in 10 minutes, amount just below 10K threshold (structuring), "
                       "new account within 7 days, or 3+ recent failures. "
                       "Flagged transactions require manual review within 24 hours.",
            "category": "fraud", "tags": ["fraud", "flagged", "risk"],
        },
        {
            "title": "Refund Policy and Processing Times",
            "content": "Refunds are processed within 3-5 business days. "
                       "Eligibility: transaction must be in success status, "
                       "refund requested within 30 days. "
                       "Partial refunds allowed. Full refund reverses original debit+credit entries.",
            "category": "refund", "tags": ["refund", "policy", "timeline"],
        },
        {
            "title": "Settlement Reconciliation for Merchants",
            "content": "Settlements processed weekly. Gross amount minus 2% platform fee "
                       "minus 18% GST on fees equals net payout. "
                       "Chargebacks deducted from next settlement. "
                       "Settlement report available in merchant portal.",
            "category": "settlement", "tags": ["settlement", "merchant", "reconciliation"],
        },
        {
            "title": "KYC Verification Requirements",
            "content": "KYC required for: transactions above 10K INR, international payments, "
                       "wallet top-ups above 50K INR monthly. "
                       "Documents: Government ID + proof of address. "
                       "Verification takes 24-48 hours.",
            "category": "kyc", "tags": ["kyc", "verification", "compliance"],
        },
        {
            "title": "Multi-Currency Payment Guide",
            "content": "Supported currencies: USD, EUR, GBP, INR, SGD, AED, JPY, CAD, AUD, CNY. "
                       "FX rates updated every hour. "
                       "International card payments incur 1.5% foreign transaction fee. "
                       "Currency conversion at time of transaction.",
            "category": "currency", "tags": ["currency", "forex", "international"],
        },
    ]

    for article in articles:
        await embed_and_store_kb(article, db)

    log.info("knowledge_base_seeded", articles=len(articles))

# ── Schemas ───────────────────────────────────────────────────
class QueryRequest(BaseModel):
    query:          str  = Field(min_length=3, max_length=500)
    top_k:          int  = Field(default=5, ge=1, le=20)
    session_id:     str | None = None
    transaction_id: str | None = None

class FraudExplainRequest(BaseModel):
    transaction_id:  str
    fraud_score:     float
    rules_triggered: list[dict] = []

class JudgeRequest(BaseModel):
    query:    str
    response: str
    context:  str = ""

class EmbedRequest(BaseModel):
    transaction_id: str

class SessionRequest(BaseModel):
    user_id:      str
    session_type: str = "support"

class ChatRequest(BaseModel):
    session_id: str
    message:    str

# ── Endpoints ─────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "ai-service", "version": "1.0.0"}

@app.get("/ready")
async def ready():
    return {"status": "ready"}

# ── RAG ───────────────────────────────────────────────────────
@app.post("/api/ai/rag/query")
async def rag_query(payload: QueryRequest, db: AsyncSession = Depends(get_db)):
    log.info("rag_query", query=payload.query)

    # Get session history if provided
    history = []
    if payload.session_id:
        history = await get_conversation_history(payload.session_id, max_messages=6)
        history_llm = format_history_for_llm(history)
    else:
        history_llm = []

    result = await rag_answer(payload.query, db, session_history=history_llm)

    # Store in session memory
    if payload.session_id:
        await add_message(payload.session_id, "user",    payload.query)
        await add_message(payload.session_id, "assistant", result["answer"])

    # Auto-evaluate
    context_text = summarise_for_context(result.get("sources", []), max_tokens=500)
    evaluation = await evaluate_rag_response(
        payload.query, result["answer"], context_text, db
    )
    result["evaluation"] = evaluation

    return result

# ── Tool Calling ──────────────────────────────────────────────
@app.post("/api/ai/tools/call")
async def tool_call(payload: QueryRequest, db: AsyncSession = Depends(get_db)):
    """
    LLM decides which tool to call based on user query.
    Tools: lookup_payment_status, analyze_fraud_risk,
           get_failure_reasons, escalate_to_agent
    """
    log.info("tool_call_initiated", query=payload.query)

    # Let LLM decide which tool to use
    raw = await call_llm(
        payload.query,
        system="You are a payment support agent. Use the available tools to help the customer.",
        tools=PAYMENT_TOOLS,
        max_tokens=300,
    )

    # Check if LLM called a tool
    try:
        parsed = json.loads(raw)
        tool_calls = parsed.get("tool_calls", [])
    except Exception:
        tool_calls = []

    if not tool_calls:
        return {"answer": raw, "tool_used": None, "tool_result": None}

    tool_call_data = tool_calls[0]
    tool_name      = tool_call_data.get("name")
    tool_args      = tool_call_data.get("arguments", {})

    log.info("tool_selected", tool=tool_name, args=tool_args)

    # Execute the tool
    tool_result = {}

    if tool_name == "lookup_payment_status":
        tx_id = tool_args.get("transaction_id")
        email = tool_args.get("user_email")

        if tx_id:
            row = await db.execute(
                text("""SELECT id, status, amount, currency, payment_method,
                               failure_reason, fraud_score, created_at, sandbox_ref
                        FROM ledger.transactions WHERE id = :id"""),
                {"id": tx_id},
            )
            tx = row.fetchone()
            tool_result = dict(tx._mapping) if tx else {"error": "Transaction not found"}
        elif email:
            rows = await db.execute(
                text("""SELECT t.id, t.status, t.amount, t.currency, t.created_at
                        FROM ledger.transactions t
                        JOIN core.users u ON u.id = t.sender_id
                        WHERE u.email = :email
                        ORDER BY t.created_at DESC LIMIT 5"""),
                {"email": email},
            )
            tool_result = {"transactions": [dict(r._mapping) for r in rows.fetchall()]}

    elif tool_name == "analyze_fraud_risk":
        tx_id       = tool_args.get("transaction_id")
        fraud_score = tool_args.get("fraud_score", 0)
        rules       = tool_args.get("rules_triggered", [])
        explanation = await call_llm(
            f"Explain fraud risk for transaction {tx_id} with score {fraud_score}. "
            f"Rules: {rules}",
            model="mini", max_tokens=200,
        )
        tool_result = {
            "transaction_id": tx_id,
            "fraud_score":    fraud_score,
            "risk_level":     "HIGH" if fraud_score > 0.7 else "MEDIUM" if fraud_score > 0.4 else "LOW",
            "explanation":    explanation,
        }

    elif tool_name == "get_failure_reasons":
        pattern = tool_args.get("failure_pattern", "network_error")
        fix_data = FAILURE_FIX_MAP.get(pattern, {})
        tool_result = {
            "pattern":    pattern,
            "reason":     fix_data.get("reason", "Unknown failure"),
            "causes":     fix_data.get("causes", []),
            "fixes":      fix_data.get("fixes", []),
            "escalate":   fix_data.get("escalate", False),
        }

    elif tool_name == "escalate_to_agent":
        ticket_id = str(uuid.uuid4())
        tool_result = {
            "ticket_id":  ticket_id,
            "issue_type": tool_args.get("issue_type"),
            "priority":   tool_args.get("priority"),
            "status":     "created",
            "message":    f"Ticket {ticket_id[:8].upper()} created. An agent will contact you within 2-4 hours.",
        }

    # Generate final answer with tool result
    final_answer = await call_llm(
        f"Based on this tool result, answer the user query: '{payload.query}'\n\n"
        f"Tool result: {json.dumps(tool_result, default=str)}",
        model="mini", max_tokens=300,
    )

    return {
        "answer":      final_answer,
        "tool_used":   tool_name,
        "tool_args":   tool_args,
        "tool_result": tool_result,
    }

# ── Fraud Explanation ─────────────────────────────────────────
@app.post("/api/ai/fraud/explain")
async def explain_fraud(payload: FraudExplainRequest):
    rules_summary = "\n".join([
        f"- {r['rule']}: {r.get('detail','')} (weight: {r.get('weight',0):.2f})"
        for r in payload.rules_triggered
    ])
    prompt = f"""You are a fraud analyst. Explain this fraud alert in plain English.

Transaction ID: {payload.transaction_id}
Fraud Score: {payload.fraud_score:.3f} / 1.000
Rules triggered:
{rules_summary}

Provide:
1. Why this was flagged (plain language)
2. What each rule means for this transaction
3. Recommended action: APPROVE / REVIEW / BLOCK
4. Customer-facing message (professional, non-accusatory)

Keep under 150 words."""

    explanation = await call_llm(prompt, model="mini", max_tokens=300)
    severity = (
        "critical" if payload.fraud_score >= 0.85 else
        "high"     if payload.fraud_score >= 0.70 else
        "medium"   if payload.fraud_score >= 0.50 else "low"
    )
    return {
        "transaction_id":     payload.transaction_id,
        "fraud_score":        payload.fraud_score,
        "severity":           severity,
        "explanation":        explanation,
        "recommended_action": "block" if payload.fraud_score >= 0.75 else "review",
    }

# ── NLP Failure Detection ─────────────────────────────────────
@app.post("/api/ai/nlp/failure-reason")
async def nlp_failure(payload: QueryRequest, db: AsyncSession = Depends(get_db)):
    return await detect_failure_reasons(payload.query, db, top_k=payload.top_k)

# ── Multi-Agent Orchestration ─────────────────────────────────
@app.post("/api/ai/agents/analyze-transaction")
async def agent_analyze_transaction(payload: dict, db: AsyncSession = Depends(get_db)):
    tx_id = payload.get("transaction_id")
    if not tx_id:
        raise HTTPException(status_code=400, detail="transaction_id required")
    return await orchestrator.analyze_transaction(tx_id, db)

@app.post("/api/ai/agents/resolve-dispute")
async def agent_resolve_dispute(payload: dict, db: AsyncSession = Depends(get_db)):
    dispute_id = payload.get("dispute_id")
    if not dispute_id:
        raise HTTPException(status_code=400, detail="dispute_id required")
    return await orchestrator.resolve_dispute(dispute_id, db)

@app.post("/api/ai/agents/merchant-settlement")
async def agent_merchant_settlement(payload: dict, db: AsyncSession = Depends(get_db)):
    merchant_id = payload.get("merchant_id")
    if not merchant_id:
        raise HTTPException(status_code=400, detail="merchant_id required")
    return await orchestrator.merchant_settlement(merchant_id, db)

# ── Session Memory ────────────────────────────────────────────
@app.post("/api/ai/session/create")
async def create_chat_session(payload: SessionRequest):
    session_id = await create_session(payload.user_id, payload.session_type)
    return {"session_id": session_id, "ttl_seconds": 3600}

@app.get("/api/ai/session/{session_id}")
async def get_chat_session(session_id: str):
    session = await get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or expired")
    return session

@app.post("/api/ai/session/chat")
async def session_chat(payload: ChatRequest, db: AsyncSession = Depends(get_db)):
    """Multi-turn support chat with memory."""
    session = await get_session(payload.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found. Create one first.")

    history = await get_conversation_history(payload.session_id, max_messages=8)
    history_llm = format_history_for_llm(history)

    result = await rag_answer(payload.message, db, session_history=history_llm)

    await add_message(payload.session_id, "user",      payload.message)
    await add_message(payload.session_id, "assistant", result["answer"],
                      metadata={"confidence": result["confidence"]})

    return {
        "session_id": payload.session_id,
        "answer":     result["answer"],
        "confidence": result["confidence"],
        "sources":    result.get("sources", [])[:3],
        "turn":       len(history) // 2 + 1,
    }

@app.delete("/api/ai/session/{session_id}")
async def end_session(session_id: str):
    await delete_session(session_id)
    return {"message": "Session ended"}

# ── Evaluation ────────────────────────────────────────────────
@app.post("/api/ai/judge/evaluate")
async def llm_judge(payload: JudgeRequest, db: AsyncSession = Depends(get_db)):
    return await evaluate_rag_response(
        payload.query, payload.response, payload.context, db
    )

@app.post("/api/ai/evaluate/fraud/{transaction_id}")
async def eval_fraud(transaction_id: str, payload: dict,
                     db: AsyncSession = Depends(get_db)):
    return await evaluate_fraud_prediction(
        transaction_id, payload.get("predicted_score", 0.5), db
    )

@app.post("/api/ai/evaluate/batch")
async def batch_eval(payload: dict, db: AsyncSession = Depends(get_db)):
    sample = payload.get("sample_size", 20)
    return await run_batch_evaluation(db, sample_size=sample)

# ── Settlement Summary ────────────────────────────────────────
@app.get("/api/ai/settlement/summary/{merchant_id}")
async def settlement_summary(merchant_id: str, db: AsyncSession = Depends(get_db)):
    result = await orchestrator.merchant_settlement(merchant_id, db)
    analysis = result.get("settlement_analysis", {})
    return {
        "summary": analysis.get("summary", "Settlement analysis complete"),
        "stats":   analysis.get("stats", []),
        "details": analysis,
    }

# ── Embed Transaction ─────────────────────────────────────────
@app.post("/api/ai/embed/transaction")
async def embed_transaction(payload: EmbedRequest, db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        text("SELECT * FROM ledger.transactions WHERE id = :id"),
        {"id": payload.transaction_id},
    )
    tx = row.fetchone()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    success = await embed_and_store_transaction(dict(tx._mapping), db)
    return {"embedded": success, "transaction_id": payload.transaction_id}

@app.post("/api/ai/embed/batch")
async def embed_batch(payload: dict, db: AsyncSession = Depends(get_db)):
    """Embed recent transactions that don't have embeddings yet."""
    limit = payload.get("limit", 50)
    rows = await db.execute(
        text("""
            SELECT t.* FROM ledger.transactions t
            LEFT JOIN ai.transaction_embeddings e ON e.transaction_id = t.id
            WHERE e.id IS NULL
            ORDER BY t.created_at DESC
            LIMIT :limit
        """),
        {"limit": limit},
    )
    transactions = [dict(r._mapping) for r in rows.fetchall()]

    embedded = 0
    for tx in transactions:
        success = await embed_and_store_transaction(tx, db)
        if success:
            embedded += 1

    return {"total": len(transactions), "embedded": embedded}
