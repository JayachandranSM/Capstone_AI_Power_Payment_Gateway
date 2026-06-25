"""
Server-side session memory for merchant support interactions.
Stores conversation history in Redis with TTL.
"""
import json
import uuid
from datetime import datetime, timezone
import redis.asyncio as aioredis
from app.config import get_ai_settings

settings = get_ai_settings()
_redis: aioredis.Redis | None = None

SESSION_TTL = 3600  # 1 hour

async def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis

async def create_session(user_id: str, session_type: str = "support") -> str:
    session_id = str(uuid.uuid4())
    r = await get_redis()
    session_data = {
        "session_id": session_id,
        "user_id": user_id,
        "session_type": session_type,
        "messages": [],
        "context": {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await r.setex(f"session:{session_id}", SESSION_TTL, json.dumps(session_data))
    return session_id

async def get_session(session_id: str) -> dict | None:
    r = await get_redis()
    data = await r.get(f"session:{session_id}")
    if not data:
        return None
    await r.expire(f"session:{session_id}", SESSION_TTL)
    return json.loads(data)

async def add_message(session_id: str, role: str, content: str,
                      metadata: dict | None = None) -> bool:
    session = await get_session(session_id)
    if not session:
        return False
    r = await get_redis()
    session["messages"].append({
        "role": role,
        "content": content,
        "metadata": metadata or {},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    # Keep last 20 messages to manage token budget
    if len(session["messages"]) > 20:
        session["messages"] = session["messages"][-20:]
    await r.setex(f"session:{session_id}", SESSION_TTL, json.dumps(session))
    return True

async def update_context(session_id: str, context_update: dict) -> bool:
    session = await get_session(session_id)
    if not session:
        return False
    r = await get_redis()
    session["context"].update(context_update)
    await r.setex(f"session:{session_id}", SESSION_TTL, json.dumps(session))
    return True

async def get_conversation_history(session_id: str,
                                    max_messages: int = 10) -> list[dict]:
    session = await get_session(session_id)
    if not session:
        return []
    messages = session.get("messages", [])
    return messages[-max_messages:]

async def delete_session(session_id: str) -> bool:
    r = await get_redis()
    result = await r.delete(f"session:{session_id}")
    return bool(result)

def format_history_for_llm(messages: list[dict]) -> list[dict]:
    """Convert session messages to OpenAI format."""
    return [
        {"role": m["role"], "content": m["content"]}
        for m in messages
        if m["role"] in ("user", "assistant", "system")
    ]
