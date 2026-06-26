"""
Live FX Rate fetcher with Redis cache.
Falls back to hardcoded rates if API unavailable.
"""
import httpx
import json
from decimal import Decimal
from datetime import datetime, timezone
from app.utils.logging import get_logger

log = get_logger(__name__)

# Hardcoded fallback rates (USD base)
FALLBACK_RATES = {
    ("INR","USD"): Decimal("0.012"),  ("USD","INR"): Decimal("83.5"),
    ("EUR","USD"): Decimal("1.09"),   ("USD","EUR"): Decimal("0.917"),
    ("GBP","USD"): Decimal("1.27"),   ("USD","GBP"): Decimal("0.787"),
    ("SGD","USD"): Decimal("0.74"),   ("USD","SGD"): Decimal("1.35"),
    ("AED","USD"): Decimal("0.272"),  ("USD","AED"): Decimal("3.674"),
    ("JPY","USD"): Decimal("0.0067"), ("USD","JPY"): Decimal("149.5"),
    ("CAD","USD"): Decimal("0.738"),  ("USD","CAD"): Decimal("1.355"),
    ("AUD","USD"): Decimal("0.653"),  ("USD","AUD"): Decimal("1.531"),
    ("CNY","USD"): Decimal("0.138"),  ("USD","CNY"): Decimal("7.24"),
    ("EUR","INR"): Decimal("90.8"),   ("INR","EUR"): Decimal("0.011"),
    ("GBP","INR"): Decimal("106.0"),  ("INR","GBP"): Decimal("0.0094"),
}

async def fetch_live_rates(redis_client) -> dict:
    """Fetch live FX rates from exchangerate-api (free tier)."""
    cache_key = "fx:rates:usd"
    try:
        cached = await redis_client.get(cache_key)
        if cached:
            rates = json.loads(cached)
            log.info("fx_rates_from_cache")
            return rates
    except Exception:
        pass

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            # Free API - no key required for basic rates
            r = await client.get("https://open.er-api.com/v6/latest/USD")
            if r.status_code == 200:
                data = r.json()
                rates = data.get("rates", {})
                try:
                    await redis_client.setex(cache_key, 3600, json.dumps(rates))
                except Exception:
                    pass
                log.info("fx_rates_fetched_live", currencies=len(rates))
                return rates
    except Exception as exc:
        log.warning("fx_live_fetch_failed", error=str(exc))

    return {}


async def get_fx_rate_live(from_cur: str, to_cur: str, redis_client=None) -> Decimal:
    """Get FX rate with live data + fallback."""
    if from_cur == to_cur:
        return Decimal("1.0")

    # Try live rates
    if redis_client:
        rates = await fetch_live_rates(redis_client)
        if rates:
            try:
                if from_cur == "USD":
                    rate = Decimal(str(rates.get(to_cur, 1)))
                    return rate
                elif to_cur == "USD":
                    from_rate = Decimal(str(rates.get(from_cur, 1)))
                    return Decimal("1") / from_rate
                else:
                    # Cross rate via USD
                    from_rate = Decimal(str(rates.get(from_cur, 1)))
                    to_rate   = Decimal(str(rates.get(to_cur, 1)))
                    return to_rate / from_rate
            except Exception as exc:
                log.warning("fx_rate_calc_failed", error=str(exc))

    # Fallback
    fallback = FALLBACK_RATES.get((from_cur, to_cur))
    if fallback:
        return fallback

    # Try reverse
    reverse = FALLBACK_RATES.get((to_cur, from_cur))
    if reverse:
        return Decimal("1") / reverse

    return Decimal("1.0")
