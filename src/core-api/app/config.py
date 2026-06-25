from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60
    refresh_token_expire_days: int = 7

    database_url: str = "postgresql+asyncpg://pguser:pgpassword@postgres:5432/payment_gateway"
    database_pool_size: int = 20
    database_max_overflow: int = 10

    redis_url: str = "redis://redis:6379/0"
    redis_pool_size: int = 20
    idempotency_ttl_seconds: int = 86400

    allowed_origins: str = "http://localhost:3000,http://localhost:80"
    log_level: str = "INFO"
    log_format: str = "json"

    totp_issuer: str = "PayGateway"
    mfa_enabled: bool = True

    azure_openai_api_key: str = ""
    azure_openai_endpoint: str = ""
    azure_openai_api_version: str = "2025-04-01-preview"
    azure_openai_chat_deployment: str = "gpt-5.4-mini"
    azure_openai_heavy_deployment: str = "gpt-5.4"
    azure_openai_embedding_small: str = "text-embedding-3-small"
    azure_openai_embedding_large: str = "text-embedding-3-large"
    llm_timeout_seconds: int = 30
    llm_max_retries: int = 2

    fx_cache_ttl_seconds: int = 3600

    stripe_secret_key: str = "sk_test_demo"
    stripe_webhook_secret: str = "whsec_demo"

@lru_cache
def get_settings() -> Settings:
    return Settings()
