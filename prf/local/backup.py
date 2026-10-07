"""
Backup automático do progresso.

O progresso mora no navegador do candidato (localStorage). Limpar os dados do
site, trocar de celular ou perder o aparelho apagava meses de estudo, e o
backup por arquivo exigia lembrar de exportar. Aqui o app envia uma cópia ao
servidor sozinho, e um código de recuperação de 12 caracteres, que só o
candidato conhece, traz tudo de volta em qualquer aparelho.

Sem conta, sem e-mail: o código é a chave. O servidor guarda só o hash dele,
então quem lê a tabela não consegue restaurar o progresso de ninguém. 12
caracteres de um alfabeto de 32 dão 60 bits — fora do alcance de tentativa e
erro, e a restauração ainda tem limite de tentativas.

Fica dormente sem armazenamento: sem URL de Postgres no ambiente (ou com o
banco fora do ar) tudo aqui responde "indisponível" em poucos milissegundos, e
o app continua funcionando só com o navegador. Com a variável de banco no
projeto, passa a funcionar no deploy seguinte (a Vercel só entrega variável
nova a deploys novos).

A cada envio o estado anterior vira `prev_state`: um envio ruim (por exemplo,
de um aparelho recém-instalado, vazio) ainda deixa a versão boa recuperável.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import time
import urllib.parse
from collections import defaultdict, deque
from typing import Optional

logger = logging.getLogger(__name__)

DB_ENV_CANDIDATES = (
    "POSTGRES_URL",
    "POSTGRES_PRISMA_URL",
    "POSTGRES_URL_NON_POOLING",
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
)
# O driver recusa parâmetro que não conhece, e os provedores acrescentam vários
# na URL (pgbouncer, channel_binding, connect_timeout...). Só passa o que o
# asyncpg entende.
DSN_PARAMS = {"sslmode", "host", "port", "user", "password", "dbname", "database", "ssl"}

CODE_RE = re.compile(r"^[A-HJ-NP-Z2-9]{12}$")
MAX_BACKUP_BYTES = 4_000_000
CONNECT_TIMEOUT = 6.0
COOLDOWN_SECS = 60.0
RESTORE_LIMIT_PER_HOUR = 10
SAVE_LIMIT_PER_HOUR = 120

SCHEMA = """
CREATE TABLE IF NOT EXISTS progress_backup (
    code_hash   TEXT PRIMARY KEY,
    state       JSONB NOT NULL,
    prev_state  JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""

_pool = None
_pool_loop = None
_pool_lock: Optional[asyncio.Lock] = None
_down_until = 0.0
_hits: dict[str, deque] = defaultdict(deque)


class BackupUnavailable(RuntimeError):
    pass


class BackupRejected(ValueError):
    pass


def database_url() -> Optional[str]:
    for name in DB_ENV_CANDIDATES:
        value = os.getenv(name)
        if value:
            return value
    return None


def clean_dsn(url: str) -> str:
    parts = urllib.parse.urlsplit(url)
    kept = [(k, v) for k, v in urllib.parse.parse_qsl(parts.query) if k in DSN_PARAMS]
    return urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(kept)))


def normalize_code(raw: str) -> str:
    code = re.sub(r"[^A-Za-z0-9]", "", raw or "").upper()
    if not CODE_RE.match(code):
        raise BackupRejected("Código inválido. Ele tem 12 letras e números.")
    return code


def hash_code(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def _limited(key: str, limit: int) -> bool:
    now = time.monotonic()
    bucket = _hits[key]
    while bucket and bucket[0] <= now - 3600:
        bucket.popleft()
    if len(bucket) >= limit:
        return True
    bucket.append(now)
    if len(_hits) > 5000:
        for k in [k for k, b in _hits.items() if not b or b[-1] <= now - 3600]:
            del _hits[k]
    return False


async def _get_pool():
    """Pool de 2 conexões, criado sob demanda. Falhou, lembra por um minuto:
    com o banco fora do ar, cada envio do app pagaria o tempo de conexão."""
    global _pool, _pool_loop, _pool_lock, _down_until
    loop = asyncio.get_running_loop()
    # As conexões pertencem ao laço de eventos que as abriu. Se o servidor
    # trocar de laço (reinício do worker, teste), o pool velho fica inútil:
    # descarta e recria, em vez de falhar com "connection closed".
    if _pool is not None and _pool_loop is not loop:
        _pool, _pool_lock = None, None
    if _pool is not None:
        return _pool
    url = database_url()
    if not url:
        raise BackupUnavailable("sem armazenamento configurado")
    if time.monotonic() < _down_until:
        raise BackupUnavailable("armazenamento fora do ar")
    if _pool_lock is None:
        _pool_lock = asyncio.Lock()
    async with _pool_lock:
        if _pool is not None:
            return _pool
        import asyncpg

        try:
            pool = await asyncio.wait_for(
                asyncpg.create_pool(clean_dsn(url), min_size=0, max_size=2,
                                    statement_cache_size=0, command_timeout=10.0,
                                    max_inactive_connection_lifetime=30.0),
                timeout=CONNECT_TIMEOUT,
            )
            async with pool.acquire() as conn:
                await conn.execute(SCHEMA)
        except Exception as e:
            _down_until = time.monotonic() + COOLDOWN_SECS
            logger.warning(f"[BACKUP] armazenamento indisponível: {type(e).__name__}: {e}")
            raise BackupUnavailable("armazenamento fora do ar") from e
        _pool, _pool_loop = pool, loop
        return _pool


async def available() -> bool:
    try:
        await _get_pool()
        return True
    except BackupUnavailable:
        return False


def _validate(backup: dict) -> str:
    if not isinstance(backup, dict) or backup.get("app") != "estudo-pmgo" or backup.get("version") != 2:
        raise BackupRejected("Formato de backup incompatível.")
    if not isinstance(backup.get("progress"), dict):
        raise BackupRejected("Backup sem progresso.")
    text = json.dumps(backup, ensure_ascii=False, separators=(",", ":"))
    if len(text.encode()) > MAX_BACKUP_BYTES:
        raise BackupRejected("Backup maior que o limite de 4 MB.")
    return text


async def save(device_id: str, code: str, backup: dict) -> str:
    code = normalize_code(code)
    text = _validate(backup)
    if _limited(f"save:{device_id}", SAVE_LIMIT_PER_HOUR):
        raise BackupRejected("Muitos envios seguidos. Tente de novo mais tarde.")
    pool = await _get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO progress_backup (code_hash, state)
            VALUES ($1, $2::jsonb)
            ON CONFLICT (code_hash) DO UPDATE
               SET prev_state = progress_backup.state,
                   state      = EXCLUDED.state,
                   updated_at = now()
            RETURNING updated_at
            """,
            hash_code(code), text,
        )
    return row["updated_at"].isoformat()


async def restore(device_id: str, code: str, previous: bool = False) -> Optional[dict]:
    code = normalize_code(code)
    if _limited(f"restore:{device_id}", RESTORE_LIMIT_PER_HOUR):
        raise BackupRejected("Muitas tentativas. Aguarde uma hora para tentar de novo.")
    pool = await _get_pool()
    column = "prev_state" if previous else "state"
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT {column} AS state, updated_at FROM progress_backup WHERE code_hash = $1",
            hash_code(code),
        )
    if not row or row["state"] is None:
        return None
    state = row["state"]
    return {"backup": json.loads(state) if isinstance(state, str) else state,
            "updated_at": row["updated_at"].isoformat()}


async def close() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
