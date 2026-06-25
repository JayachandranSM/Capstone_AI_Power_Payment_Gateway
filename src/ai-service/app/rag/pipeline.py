"""
Hybrid RAG Pipeline:
- Real Azure OpenAI embeddings (text-embedding-3-small)
- pgvector HNSW semantic search
- Keyword fallback with ILIKE
- Reranking by recency + resolution effectiveness + similarity score
- Token-optimised context window
"""
import json
from datetime import datetime, timezone
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.llm_client import get_embedding, call_llm, summarise_for_context, count_tokens
import structlog

log = structlog.get_logger(__name__)


async def embed_and_store_transaction(tx: dict, db: AsyncSession) -> bool:
    """Generate embedding for a transaction and store in pgvector."""
    content = (
        f"Transaction {tx.get('id')} | "
        f"Status: {tx.get('status')} | "
        f"Amount: {tx.get('currency')} {tx.get('amount')} | "
        f"Method: {tx.get('payment_method')} | "
        f"Failure: {tx.get('failure_reason', 'none')} | "
        f"Fraud score: {tx.get('fraud_score', 0)} | "
        f"Type: {tx.get('type')}"
    )
    try:
        embedding = await get_embedding(content, model="small")
        embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

        await db.execute(
            text("""
                INSERT INTO ai.transaction_embeddings
                    (transaction_id, content_text, embedding)
                VALUES (:tid, :content, :embedding::vector)
                ON CONFLICT DO NOTHING
            """),
            {"tid": tx["id"], "content": content, "embedding": embedding_str},
        )
        await db.commit()
        return True
    except Exception as exc:
        log.error("embed_store_failed", error=str(exc))
        return False


async def embed_and_store_kb(article: dict, db: AsyncSession) -> bool:
    """Embed and store a knowledge base article."""
    content = f"{article['title']}\n\n{article['content']}"
    try:
        embedding = await get_embedding(content, model="small")
        embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

        await db.execute(
            text("""
                INSERT INTO ai.knowledge_base
                    (title, content, category, tags, embedding)
                VALUES (:title, :content, :category, :tags, :embedding::vector)
                ON CONFLICT DO NOTHING
            """),
            {
                "title":     article["title"],
                "content":   article["content"],
                "category":  article.get("category", "general"),
                "tags":      article.get("tags", []),
                "embedding": embedding_str,
            },
        )
        await db.commit()
        return True
    except Exception as exc:
        log.error("kb_embed_failed", error=str(exc))
        return False


async def semantic_search(query: str, db: AsyncSession,
                           top_k: int = 5) -> list[dict]:
    """Search pgvector with real query embedding."""
    try:
        embedding = await get_embedding(query, model="small")
        embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

        rows = await db.execute(
            text("""
                SELECT
                    te.transaction_id,
                    te.content_text,
                    1 - (te.embedding <=> :emb::vector) AS similarity,
                    t.status,
                    t.amount,
                    t.currency,
                    t.payment_method,
                    t.failure_reason,
                    t.fraud_score,
                    t.created_at,
                    t.chargeback_flag
                FROM ai.transaction_embeddings te
                JOIN ledger.transactions t ON t.id = te.transaction_id
                ORDER BY te.embedding <=> :emb::vector
                LIMIT :k
            """),
            {"emb": embedding_str, "k": top_k},
        )
        results = [dict(r._mapping) for r in rows.fetchall()]
        log.info("semantic_search_done", hits=len(results))
        return results
    except Exception as exc:
        log.warning("semantic_search_failed", error=str(exc))
        return []


async def keyword_search(query: str, db: AsyncSession,
                          top_k: int = 5) -> list[dict]:
    """ILIKE keyword fallback search."""
    terms = [t for t in query.lower().split() if len(t) > 3][:5]
    if not terms:
        rows = await db.execute(
            text("""
                SELECT id as transaction_id, failure_reason as content_text,
                       status, amount, currency, payment_method,
                       failure_reason, fraud_score, created_at, chargeback_flag,
                       0.5 as similarity
                FROM ledger.transactions
                WHERE status IN ('failed','flagged')
                ORDER BY created_at DESC LIMIT :k
            """),
            {"k": top_k},
        )
        return [dict(r._mapping) for r in rows.fetchall()]

    conditions = " OR ".join(
        [f"failure_reason ILIKE :t{i}" for i in range(len(terms))]
        + [f"payment_method ILIKE :t{i}" for i in range(len(terms))]
    )
    params = {f"t{i}": f"%{t}%" for i, t in enumerate(terms)}

    rows = await db.execute(
        text(f"""
            SELECT id as transaction_id,
                   COALESCE(failure_reason, type) as content_text,
                   status, amount, currency, payment_method,
                   failure_reason, fraud_score, created_at, chargeback_flag,
                   0.5 as similarity
            FROM ledger.transactions
            WHERE {conditions}
            ORDER BY created_at DESC LIMIT :k
        """),
        {**params, "k": top_k},
    )
    return [dict(r._mapping) for r in rows.fetchall()]


def rerank_results(results: list[dict],
                   query: str,
                   alpha_sim: float = 0.5,
                   alpha_rec: float = 0.3,
                   alpha_res: float = 0.2) -> list[dict]:
    """
    Rerank by composite score:
    - alpha_sim: semantic similarity weight
    - alpha_rec: recency weight
    - alpha_res: resolution effectiveness weight
    """
    now = datetime.now(timezone.utc)

    for item in results:
        # Similarity score (0-1)
        sim_score = float(item.get("similarity", 0.5))

        # Recency score (newer = higher, decay over 30 days)
        created_at = item.get("created_at")
        if created_at:
            if hasattr(created_at, "replace"):
                age_days = (now - created_at.replace(tzinfo=timezone.utc)).days
            else:
                age_days = 30
            rec_score = max(0.0, 1.0 - (age_days / 30.0))
        else:
            rec_score = 0.5

        # Resolution effectiveness score
        status = item.get("status", "")
        fraud  = float(item.get("fraud_score") or 0)
        if status == "success":
            res_score = 1.0
        elif status == "failed":
            res_score = 0.6
        elif status == "flagged":
            res_score = 0.3 if fraud > 0.7 else 0.5
        else:
            res_score = 0.4

        # Composite score
        item["rerank_score"] = (
            alpha_sim * sim_score
            + alpha_rec * rec_score
            + alpha_res * res_score
        )

    return sorted(results, key=lambda x: x["rerank_score"], reverse=True)


async def hybrid_search(query: str, db: AsyncSession,
                         top_k: int = 5) -> tuple[list[dict], bool]:
    """
    Hybrid: semantic + keyword, deduplicated, reranked.
    Returns (results, used_fallback).
    """
    semantic = await semantic_search(query, db, top_k=top_k)
    keyword  = await keyword_search(query, db, top_k=top_k)
    used_fallback = len(semantic) == 0

    # Deduplicate
    seen = set()
    combined = []
    for item in semantic + keyword:
        tx_id = str(item.get("transaction_id", ""))
        if tx_id and tx_id not in seen:
            seen.add(tx_id)
            combined.append(item)

    reranked = rerank_results(combined, query)
    return reranked[:top_k], used_fallback


async def rag_answer(query: str, db: AsyncSession,
                      session_history: list[dict] | None = None) -> dict:
    """
    Full RAG pipeline:
    1. Hybrid search
    2. Rerank
    3. Token-optimised context
    4. LLM answer with session history
    """
    results, used_fallback = await hybrid_search(query, db, top_k=8)

    # Build token-optimised context
    context_text = summarise_for_context(results, max_tokens=1500)

    # Build prompt with history
    history_text = ""
    if session_history:
        history_text = "\n".join([
            f"{m['role'].upper()}: {m['content']}"
            for m in session_history[-4:]
        ])
        history_text = f"\nPrevious conversation:\n{history_text}\n"

    prompt = f"""You are a payment support specialist with access to transaction data.
{history_text}
Query: {query}

Relevant transaction data:
{context_text}

Provide a structured answer:
1. **Root Cause**: What caused this issue
2. **Affected Transactions**: How many and what pattern
3. **Recommended Fix**: Specific actionable steps
4. **Prevention**: How to avoid this in future

Be concise and technical. Use numbers where available."""

    answer = await call_llm(prompt, model="mini", max_tokens=600)

    return {
        "answer":       answer,
        "sources":      results[:5],
        "confidence":   0.85 if not used_fallback else 0.60,
        "used_fallback": used_fallback,
        "result_count": len(results),
    }
