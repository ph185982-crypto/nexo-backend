"""Bound anonymous device usage per running instance; no database dependency.

These limits are a local safety net, not a distributed billing quota. Provider
budget alerts and an edge rate limit are still required for a public launch.
"""
import time
from collections import defaultdict, deque

from fastapi import Depends, HTTPException, Request
from prf.routers.deps import get_current_user_id

_hits = defaultdict(deque)
_active = 0


async def guard_ai(request: Request, user_id=Depends(get_current_user_id)):
    global _active
    kind = 'audio' if request.url.path.endswith('/audio') else 'text'
    now = time.monotonic()
    # Instance-wide bucket also bounds repeated anonymous registration.
    for key, limit in [(kind, 300 if kind == 'audio' else 60), (f'{kind}:{user_id}', 150 if kind == 'audio' else 30)]:
        bucket = _hits[key]
        while bucket and bucket[0] <= now - 3600:
            bucket.popleft()
        if len(bucket) >= limit:
            raise HTTPException(429, 'Limite temporário de geração atingido. Tente mais tarde.', headers={'Retry-After': '3600'})
    if _active >= 4:
        raise HTTPException(429, 'Há gerações em andamento. Aguarde e tente novamente.', headers={'Retry-After': '30'})
    if len(_hits) > 2000:
        for key in list(_hits):
            if not _hits[key] or _hits[key][-1] <= now - 3600:
                del _hits[key]
    _hits[kind].append(now)
    _hits[f'{kind}:{user_id}'].append(now)
    _active += 1
    try:
        yield user_id
    finally:
        _active -= 1
