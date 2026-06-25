import json
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from app.config import get_settings
from app.utils.logging import get_logger
from db.redis_client import get_redis

log = get_logger(__name__)
settings = get_settings()

IDEMPOTENT_PATHS = ["/payments/process", "/wallets/topup", "/refunds", "/disputes"]

class IdempotencyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method != "POST" or not any(
            request.url.path.endswith(p) for p in IDEMPOTENT_PATHS
        ):
            return await call_next(request)

        idem_key = request.headers.get("X-Idempotency-Key")
        if not idem_key:
            return await call_next(request)

        redis = await get_redis()
        lock_key   = f"idem:lock:{idem_key}"
        result_key = f"idem:result:{idem_key}"

        cached = await redis.get(result_key)
        if cached:
            log.info("idempotency_cache_hit", key=idem_key)
            data = json.loads(cached)
            return Response(
                content=json.dumps(data["body"]),
                status_code=data["status_code"],
                headers={"Content-Type": "application/json", "X-Idempotency-Replayed": "true"},
            )

        acquired = await redis.set(lock_key, "1", nx=True, ex=30)
        if not acquired:
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=409,
                                content={"detail": "Duplicate request in flight"})

        try:
            response = await call_next(request)
            body = b""
            async for chunk in response.body_iterator:
                body += chunk

            if response.status_code < 400:
                await redis.setex(
                    result_key, settings.idempotency_ttl_seconds,
                    json.dumps({"status_code": response.status_code,
                                "body": json.loads(body)}),
                )

            return Response(content=body, status_code=response.status_code,
                            headers=dict(response.headers), media_type=response.media_type)
        finally:
            await redis.delete(lock_key)
