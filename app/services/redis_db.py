# server/redis_db.py
import redis.asyncio as redis
from app.core.settings import REDIS_URL

_redis = None

def _new_client():
    return redis.from_url(
        REDIS_URL,
        decode_responses=True,
        socket_connect_timeout=3,
        socket_timeout=30,
        health_check_interval=30,
        retry_on_timeout=True,
    )

async def get_redis(force_reconnect: bool = False):
    global _redis

    if force_reconnect and _redis is not None:
        try:
            await _redis.aclose()
        except Exception:
            pass
        _redis = None

    if _redis is None:
        client = _new_client()
        await client.ping()
        _redis = client
        return _redis

    try:
        await _redis.ping()
    except Exception:
        try:
            await _redis.aclose()
        except Exception:
            pass
        _redis = _new_client()
        await _redis.ping()

    return _redis