"""
Hybrid RAG Pipeline - Fixed version
"""
import json
from datetime import datetime, timezone
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.llm_client import get_embedding, call_llm, summarise_for_context
import structlog

log = structlog.get_logger(__name__)


async def embed_and_store_transaction(tx: dict, db: AsyncSession) -> bool:
    content = (
        f"Transaction {tx.get('id')} | "
        f"Status: {tx.get('status')} | "
        f"Amount: {tx.get('currency')} {tx.get('amount')} | "
        f"Method: {tx.get('payment_method')} | "
        f"Failure: {tx.get('failure_reason', 'none')} | "
        f"Fraud score: {tx.get('fraud_score', 0)}"
    )
    try:
        embedding = await get_embedding(content, model="small")
        embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"
        await db.execute(
            text("""
                INSERT INTO ai.transaction_embeddings
                    (transaction_id, content_text, embedding)
                VALUES (:tid, :content, CAST(:embedding AS vector))
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
    content = f"{article['title']}\n\n{article['content']}"
    try:
        embedding = await get_embedding(content, model="small")
        embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"
        await db.execute(
            text("""
                INSERT INTO ai.knowledge_base
                    (title, content, category, tags, embedding)
                VALUES (:title, :content, :category, :tags, CAST(:embedding AS vector))
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


async def semantic_search(query: str, db: AsyncSession, top_k: int = 5) -> list[dict]:
    """Semantic search using real Azure OpenAI embeddings."""
    try:
        embedding = await get_embedding(query, model="small")
        embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"
        rows = await db.execute(
            text("""
                SELECT
                    te.transaction_id,
                    te.content_text,
                    1 - (te.embedding <=> CAST(:emb AS vector)) AS similarity,
                    t.status, t.amount, t.currency,
                    t.payment_method, t.failure_reason,
                    t.fraud_score, t.created_at
                FROM ai.transaction_embeddings te
                JOIN ledger.transactions t ON t.id = te.transaction_id
                ORDER BY te.embedding <=> CAST(:emb AS vector)
                LIMIT :k
            """),
            {"emb": embedding_str, "k": top_k},
        )
        results = [dict(r._mapping) for r in rows.fetchall()]
        log.info("semantic_search_done", hits=len(results))
        return results
    except Exception as exc:
        log.warning("semantic_search_failed_using_keyword", error=str(exc))
        return []


async def keyword_search(query: str, db: AsyncSession, top_k: int = 5) -> list[dict]:
    """ILIKE keyword fallback — always works."""
    terms = [t for t in query.lower().split() if len(t) > 3][:5]

    # Search knowledge base first
    kb_results = []
    try:
        if terms:
            kb_conditions = " OR ".join([f"content ILIKE :t{i}" for i in range(len(terms))])
            kb_params = {f"t{i}": f"%{t}%" for i, t in enumerate(terms)}
            kb_rows = await db.execute(
                text(f"""
                    SELECT title, content, category,
                           0.7 as similarity, NULL as transaction_id,
                           NULL as status, NULL as amount, NULL as currency,
                           NULL as payment_method, NULL as failure_reason,
                           NULL as fraud_score, created_at
                    FROM ai.knowledge_base
                    WHERE {kb_conditions}
                    ORDER BY helpful_count DESC
                    LIMIT :k
                """),
                {**kb_params, "k": min(3, top_k)},
            )
            kb_results = [dict(r._mapping) for r in kb_rows.fetchall()]
    except Exception as exc:
        log.warning("kb_search_failed", error=str(exc))

    # Search transactions
    tx_results = []
    try:
        if terms:
            conditions = " OR ".join(
                [f"failure_reason ILIKE :t{i}" for i in range(len(terms))] +
                [f"payment_method::text ILIKE :t{i}" for i in range(len(terms))]
            )
            params = {f"t{i}": f"%{t}%" for i, t in enumerate(terms)}
            rows = await db.execute(
                text(f"""
                    SELECT id as transaction_id,
                           COALESCE(failure_reason, type::text) as content_text,
                           status, amount, currency, payment_method,
                           failure_reason, fraud_score, created_at,
                           0.5 as similarity
                    FROM ledger.transactions
                    WHERE {conditions}
                    ORDER BY created_at DESC LIMIT :k
                """),
                {**params, "k": top_k},
            )
            tx_results = [dict(r._mapping) for r in rows.fetchall()]
        else:
            rows = await db.execute(
                text("""
                    SELECT id as transaction_id,
                           COALESCE(failure_reason, type::text) as content_text,
                           status, amount, currency, payment_method,
                           failure_reason, fraud_score, created_at,
                           0.4 as similarity
                    FROM ledger.transactions
                    ORDER BY created_at DESC LIMIT :k
                """),
                {"k": top_k},
            )
            tx_results = [dict(r._mapping) for r in rows.fetchall()]
    except Exception as exc:
        log.warning("tx_search_failed", error=str(exc))

    return kb_results + tx_results


def rerank_results(results: list[dict], query: str) -> list[dict]:
    """Rerank by composite score: similarity + recency + resolution effectiveness."""
    now = datetime.now(timezone.utc)
    for item in results:
        sim_score = float(item.get("similarity") or 0.5)
        created_at = item.get("created_at")
        if created_at:
            try:
                if hasattr(created_at, "replace"):
                    age_days = (now - created_at.replace(tzinfo=timezone.utc)).days
                else:
                    age_days = 30
            except Exception:
                age_days = 30
            rec_score = max(0.0, 1.0 - (age_days / 30.0))
        else:
            rec_score = 0.8  # KB articles rank higher

        status = item.get("status", "")
        res_score = 1.0 if not status else (1.0 if status == "success" else 0.6 if status == "failed" else 0.4)

        item["rerank_score"] = 0.5 * sim_score + 0.3 * rec_score + 0.2 * res_score

    return sorted(results, key=lambda x: x.get("rerank_score", 0), reverse=True)


async def hybrid_search(query: str, db: AsyncSession, top_k: int = 5) -> tuple[list[dict], bool]:
    """Hybrid: semantic + keyword, deduplicated, reranked."""
    semantic = await semantic_search(query, db, top_k=top_k)
    keyword  = await keyword_search(query, db, top_k=top_k)
    used_fallback = len(semantic) == 0

    seen = set()
    combined = []
    for item in semantic + keyword:
        key = str(item.get("transaction_id") or item.get("title") or id(item))
        if key not in seen:
            seen.add(key)
            combined.append(item)

    reranked = rerank_results(combined, query)
    return reranked[:top_k], used_fallback


async def rag_answer(query: str, db: AsyncSession, session_history: list[dict] | None = None) -> dict:
    """Full RAG pipeline with hybrid search + LLM answer."""
    results, used_fallback = await hybrid_search(query, db, top_k=8)

    # Build context from results
    context_parts = []
    for item in results[:5]:
        if item.get("title"):  # KB article
            context_parts.append(f"[Knowledge Base] {item['title']}: {item['content'][:300]}")
        else:
            context_parts.append(
                f"[Transaction] Status:{item.get('status','?')} "
                f"Amount:{item.get('currency','?')} {item.get('amount','?')} "
                f"Method:{item.get('payment_method','?')} "
                f"Failure:{item.get('failure_reason','none')}"
            )
    context_text = "\n".join(context_parts) if context_parts else "No specific transaction data found."

    # Build history
    history_text = ""
    if session_history:
        history_text = "\nPrevious conversation:\n" + "\n".join([
            f"{m['role'].upper()}: {m['content']}"
            for m in session_history[-4:]
        ]) + "\n"

    prompt = f"""You are a payment support specialist.
{history_text}
Query: {query}

Relevant information:
{context_text}

Provide a helpful, structured answer with:
1. Root cause or explanation
2. Recommended action or fix
3. Prevention tip

Be concise and specific."""

    answer = await call_llm(prompt, model="mini", max_tokens=500)

    if not answer or answer.startswith("[LLM"):
        # Fallback answer from context
        if context_parts:
            answer = f"Based on your payment data: {context_parts[0][:200]}. Please check your payment method settings and retry."
        else:
            answer = "I found no specific matching records. Please check your transaction ID or refine your query."

    return {
        "answer":        answer,
        "sources":       results[:5],
        "confidence":    0.85 if not used_fallback else 0.65,
        "used_fallback": used_fallback,
        "result_count":  len(results),
    }
