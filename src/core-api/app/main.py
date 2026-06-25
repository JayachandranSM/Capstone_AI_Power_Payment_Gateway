from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.auth.router import router as auth_router
from app.config import get_settings
from app.health.router import admin_router, health_router, merchant_router
from app.payments.router import router as payment_router
from app.transactions.router import (
    dispute_router, notif_router, refund_router, tx_router, wallet_router,
)
from app.utils.logging import configure_logging, get_logger
from db.redis_client import close_redis, get_redis
from db.session import engine
from middleware.idempotency import IdempotencyMiddleware

configure_logging()
log      = get_logger(__name__)
settings = get_settings()

@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("startup_begin", env=settings.app_env)
    await get_redis()
    async with engine.begin():
        pass
    log.info("startup_complete")
    yield
    await close_redis()
    await engine.dispose()
    log.info("shutdown_complete")

app = FastAPI(
    title="AI-Powered Payment Gateway",
    description="Production-grade multi-role payment platform with AI fraud detection, RAG support, and multi-agent orchestration",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(IdempotencyMiddleware)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    log.error("unhandled_exception", path=request.url.path, error=str(exc), exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error", "code": "INTERNAL_ERROR"},
    )

API = "/api/v1"
app.include_router(health_router)
app.include_router(auth_router,     prefix=API)
app.include_router(payment_router,  prefix=API)
app.include_router(tx_router,       prefix=API)
app.include_router(refund_router,   prefix=API)
app.include_router(dispute_router,  prefix=API)
app.include_router(wallet_router,   prefix=API)
app.include_router(notif_router,    prefix=API)
app.include_router(merchant_router, prefix=API)
app.include_router(admin_router,    prefix=API)

@app.get("/")
async def root():
    return {
        "service": "AI-Powered Payment Gateway",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health",
    }
