from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class AISettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://pguser:pgpassword@postgres:5432/payment_gateway"
    redis_url: str = "redis://redis:6379/0"

    azure_openai_api_key: str = ""
    azure_openai_endpoint: str = ""
    azure_openai_api_version: str = "2025-04-01-preview"
    azure_openai_chat_deployment: str = "gpt-5.4-mini"
    azure_openai_heavy_deployment: str = "gpt-5.4"
    azure_openai_embedding_small: str = "text-embedding-3-small"
    azure_openai_embedding_large: str = "text-embedding-3-large"
    llm_timeout_seconds: int = 30
    llm_max_retries: int = 2

    log_level: str = "INFO"

@lru_cache
def get_ai_settings() -> AISettings:
    return AISettings()
