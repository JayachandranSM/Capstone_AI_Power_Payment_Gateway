"""
Azure OpenAI client with:
- Tool calling / function calling
- Token optimisation (chunking + summarisation)
- Retry with exponential backoff
- Graceful fallback
"""
import asyncio
import json
import tiktoken
from openai import AzureOpenAI
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from app.config import get_ai_settings
import structlog

log      = get_ai_settings.__class__  # placeholder
settings = get_ai_settings()
log      = structlog.get_logger(__name__)

_client: AzureOpenAI | None = None

def strip_markdown(text: str) -> str:
    """Remove markdown formatting for human-readable output."""
    if not text:
        return text
    text = text.replace("**", "").replace("***", "")
    text = text.replace("###", "").replace("##", "").replace("# ", "")
    text = text.replace("```", "").replace("`", "")
    import re
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def get_client() -> AzureOpenAI:
    global _client
    if _client is None:
        _client = AzureOpenAI(
            api_key=settings.azure_openai_api_key,
            azure_endpoint=settings.azure_openai_endpoint,
            api_version=settings.azure_openai_api_version,
        )
    return _client

# ── Token management ──────────────────────────────────────────
def count_tokens(text: str, model: str = "gpt-4o") -> int:
    try:
        enc = tiktoken.encoding_for_model(model)
        return len(enc.encode(text))
    except Exception:
        return len(text) // 4

def chunk_text(text: str, max_tokens: int = 1500) -> list[str]:
    """Split text into token-safe chunks."""
    words  = text.split()
    chunks = []
    current_chunk: list[str] = []
    current_tokens = 0

    for word in words:
        word_tokens = count_tokens(word)
        if current_tokens + word_tokens > max_tokens and current_chunk:
            chunks.append(" ".join(current_chunk))
            current_chunk = [word]
            current_tokens = word_tokens
        else:
            current_chunk.append(word)
            current_tokens += word_tokens

    if current_chunk:
        chunks.append(" ".join(current_chunk))
    return chunks

def summarise_for_context(items: list[dict], max_tokens: int = 2000) -> str:
    """Summarise transaction list to fit token budget."""
    lines = []
    for item in items:
        line = (
            f"TX {str(item.get('id',''))[:8]}: "
            f"{item.get('status','?')} | "
            f"{item.get('currency','?')} {item.get('amount','?')} | "
            f"{item.get('payment_method','?')} | "
            f"fraud={item.get('fraud_score','?')} | "
            f"reason={item.get('failure_reason','none')}"
        )
        lines.append(line)
        if count_tokens("\n".join(lines)) > max_tokens:
            lines.append(f"... and {len(items) - len(lines) + 1} more")
            break
    return "\n".join(lines)

# ── Prompt injection guardrail ──────────────────────────────
PROMPT_INJECTION_PATTERNS = [
    "ignore previous instructions",
    "ignore all previous instructions",
    "ignore the above",
    "disregard previous",
    "disregard all previous",
    "forget your instructions",
    "forget everything above",
    "you are now",
    "act as if",
    "system prompt",
    "reveal your prompt",
    "reveal your system prompt",
    "what are your instructions",
    "print your instructions",
    "developer mode",
    "jailbreak",
    "do anything now",
    "bypass your",
    "override your",
    "new instructions:",
    "</system>",
    "<|im_start|>",
]

def detect_prompt_injection(text: str) -> bool:
    """Detect common prompt injection patterns in user input."""
    if not text:
        return False
    lower = text.lower()
    return any(pattern in lower for pattern in PROMPT_INJECTION_PATTERNS)

# ── Core LLM call ─────────────────────────────────────────────
async def call_llm(
    prompt: str,
    system: str = "You are an expert payment analyst.",
    model: str = "mini",
    max_tokens: int = 512,
    tools: list | None = None,
) -> str:
    # Guardrail: block prompt injection attempts before reaching the LLM
    if detect_prompt_injection(prompt):
        return (
            "I can only help with payment-related questions such as "
            "transaction status, fraud explanations, refunds, and settlements. "
            "I'm not able to follow instructions that try to change my role or behavior."
        )

    deployment = (
        settings.azure_openai_chat_deployment
        if model == "mini"
        else settings.azure_openai_heavy_deployment
    )
    client = get_client()

    try:
        kwargs: dict = dict(
            model=deployment,
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": prompt},
            ],
            temperature=0.3,
        )
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"

        response = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(
                None, lambda: client.chat.completions.create(**kwargs)
            ),
            timeout=settings.llm_timeout_seconds,
        )

        choice = response.choices[0]

        # Handle tool calls
        if tools and choice.finish_reason == "tool_calls" and choice.message.tool_calls:
            return json.dumps({
                "tool_calls": [
                    {
                        "name": tc.function.name,
                        "arguments": json.loads(tc.function.arguments),
                    }
                    for tc in choice.message.tool_calls
                ]
            })

        return choice.message.content.strip() if choice.message.content else ""

    except asyncio.TimeoutError:
        log.warning("llm_timeout", deployment=deployment)
        return "[LLM timeout — please retry]"
    except Exception as exc:
        log.error("llm_error", error=str(exc))
        return f"[LLM error: {str(exc)[:100]}]"

# ── Embeddings ────────────────────────────────────────────────
async def get_embedding(text: str, model: str = "small") -> list[float]:
    deployment = (
        settings.azure_openai_embedding_small
        if model == "small"
        else settings.azure_openai_embedding_large
    )
    client = get_client()

    # Truncate to safe token limit
    if count_tokens(text) > 8000:
        text = " ".join(text.split()[:6000])

    response = await asyncio.wait_for(
        asyncio.get_event_loop().run_in_executor(
            None,
            lambda: client.embeddings.create(model=deployment, input=text),
        ),
        timeout=settings.llm_timeout_seconds,
    )
    return response.data[0].embedding

# ── Tool definitions ──────────────────────────────────────────
PAYMENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "lookup_payment_status",
            "description": "Look up the status and details of a payment transaction by ID or reference",
            "parameters": {
                "type": "object",
                "properties": {
                    "transaction_id": {
                        "type": "string",
                        "description": "Transaction UUID or sandbox reference"
                    },
                    "user_email": {
                        "type": "string",
                        "description": "Customer email to look up their recent transactions"
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_fraud_risk",
            "description": "Analyze fraud risk for a transaction and return risk score with explanation",
            "parameters": {
                "type": "object",
                "properties": {
                    "transaction_id": {
                        "type": "string",
                        "description": "Transaction ID to analyze"
                    },
                    "fraud_score": {
                        "type": "number",
                        "description": "Current fraud score (0-1)"
                    },
                    "rules_triggered": {
                        "type": "array",
                        "description": "List of fraud rules that were triggered"
                    }
                },
                "required": ["transaction_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_failure_reasons",
            "description": "Get structured failure reasons and fix suggestions for failed transactions",
            "parameters": {
                "type": "object",
                "properties": {
                    "failure_pattern": {
                        "type": "string",
                        "description": "Type of failure: card_declined, upi_timeout, insufficient_balance, kyc_failed, network_error"
                    },
                    "payment_method": {
                        "type": "string",
                        "description": "Payment method: upi, card, bank_transfer, wallet"
                    }
                },
                "required": ["failure_pattern"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "escalate_to_agent",
            "description": "Escalate a payment issue to a human support agent and create a ticket",
            "parameters": {
                "type": "object",
                "properties": {
                    "issue_type": {
                        "type": "string",
                        "description": "Type: fraud, refund, dispute, technical, kyc"
                    },
                    "priority": {
                        "type": "string",
                        "enum": ["low", "medium", "high", "urgent"]
                    },
                    "description": {
                        "type": "string",
                        "description": "Issue description for the ticket"
                    }
                },
                "required": ["issue_type", "priority", "description"]
            }
        }
    }
]

FAILURE_FIX_MAP = {
    "card_declined": {
        "reason": "Card declined by issuing bank",
        "causes": ["Insufficient funds", "Card blocked", "International transactions disabled"],
        "fixes": ["Check card balance", "Enable international payments in bank app", "Try a different card"],
        "escalate": False
    },
    "upi_timeout": {
        "reason": "UPI payment timed out",
        "causes": ["Bank server overload", "Network instability", "Invalid UPI PIN entered"],
        "fixes": ["Retry after 5 minutes", "Check UPI handle is correct", "Reset UPI PIN via bank app"],
        "escalate": False
    },
    "insufficient_balance": {
        "reason": "Wallet or bank account balance too low",
        "causes": ["Insufficient funds", "Locked balance due to pending transaction"],
        "fixes": ["Top up wallet", "Wait for pending transactions to clear", "Use a different payment method"],
        "escalate": False
    },
    "kyc_failed": {
        "reason": "KYC verification incomplete or failed",
        "causes": ["Documents not submitted", "Documents expired", "Mismatch in details"],
        "fixes": ["Complete KYC in profile settings", "Re-upload valid documents", "Contact support"],
        "escalate": True
    },
    "network_error": {
        "reason": "Network or gateway timeout",
        "causes": ["Payment gateway overload", "Bank API downtime", "Network connectivity issue"],
        "fixes": ["Retry after 2-3 minutes", "Check system status", "Use a different network"],
        "escalate": False
    },
}
