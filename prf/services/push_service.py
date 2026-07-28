"""Entrega de Web Push — o que faz o lembrete chegar no celular.

A plataforma já sabia decidir quando cutucar o candidato, mas a notificação
morria numa fila que ninguém entregava. Isto fecha esse caminho.

A criptografia do Web Push (RFC 8188 e RFC 8291) é implementada aqui em vez de
vir da pywebpush porque a dependência dela, a http-ece, não publica wheel e
teria de compilar no build da Vercel — uma falha ali derruba o deploy inteiro,
e não vale correr esse risco por sessenta linhas de código bem especificado.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import time
from urllib.parse import urlparse

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF, HKDFExpand

logger = logging.getLogger(__name__)

VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:contato@prfestudo.app")

# Tamanho de registro do aes128gcm. Um payload de notificação cabe folgado.
RECORD_SIZE = 4096


class PushNotConfigured(RuntimeError):
    """VAPID não está configurado no ambiente."""


def is_configured() -> bool:
    return bool(VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY)


def _b64d(data: str) -> bytes:
    """Base64url sem padding, como o navegador entrega."""
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def _b64e(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _vapid_header(endpoint: str) -> dict[str, str]:
    """Assina o JWT que prova ao push service quem está enviando."""
    origin = urlparse(endpoint)
    claims = {
        "aud": f"{origin.scheme}://{origin.netloc}",
        "exp": int(time.time()) + 12 * 3600,
        "sub": VAPID_SUBJECT,
    }
    header = {"typ": "JWT", "alg": "ES256"}
    signing_input = b".".join([
        _b64e(json.dumps(header, separators=(",", ":")).encode()).encode(),
        _b64e(json.dumps(claims, separators=(",", ":")).encode()).encode(),
    ])

    private_value = int.from_bytes(_b64d(VAPID_PRIVATE_KEY), "big")
    key = ec.derive_private_key(private_value, ec.SECP256R1())
    der = key.sign(signing_input, ec.ECDSA(hashes.SHA256()))

    # O JWS exige a assinatura crua (r||s); o cryptography devolve em DER.
    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
    r, s = decode_dss_signature(der)
    raw = r.to_bytes(32, "big") + s.to_bytes(32, "big")

    token = signing_input.decode() + "." + _b64e(raw)
    return {"Authorization": f"vapid t={token}, k={VAPID_PUBLIC_KEY}"}


def _encrypt(payload: bytes, p256dh: str, auth: str) -> bytes:
    """Cifra o payload no esquema aes128gcm (RFC 8291)."""
    ua_public_bytes = _b64d(p256dh)
    auth_secret = _b64d(auth)

    ua_public = ec.EllipticCurvePublicKey.from_encoded_point(
        ec.SECP256R1(), ua_public_bytes,
    )
    as_private = ec.generate_private_key(ec.SECP256R1())
    as_public_bytes = as_private.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint,
    )

    shared = as_private.exchange(ec.ECDH(), ua_public)

    # O segredo combina o ECDH com o auth do navegador, amarrando a mensagem
    # às duas chaves públicas envolvidas.
    ikm = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=auth_secret,
        info=b"WebPush: info\x00" + ua_public_bytes + as_public_bytes,
    ).derive(shared)

    salt = os.urandom(16)
    prk = HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=b"").derive(ikm)
    cek = HKDFExpand(
        algorithm=hashes.SHA256(), length=16,
        info=b"Content-Encoding: aes128gcm\x00",
    ).derive(prk)
    nonce = HKDFExpand(
        algorithm=hashes.SHA256(), length=12,
        info=b"Content-Encoding: nonce\x00",
    ).derive(prk)

    # 0x02 marca o último registro do fluxo.
    ciphertext = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)

    return (
        salt
        + RECORD_SIZE.to_bytes(4, "big")
        + len(as_public_bytes).to_bytes(1, "big")
        + as_public_bytes
        + ciphertext
    )


async def send_push(subscription: dict, title: str, body: str,
                    url: str = "/", tag: str | None = None, ttl: int = 3600) -> int:
    """Entrega uma notificação. Devolve o status HTTP do push service.

    404 e 410 significam inscrição morta (app desinstalado, permissão revogada);
    quem chama deve apagá-la em vez de insistir.
    """
    if not is_configured():
        raise PushNotConfigured("VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configurados")

    endpoint = subscription["endpoint"]
    payload = json.dumps(
        {"title": title, "body": body, "url": url, "tag": tag or "prf"},
        ensure_ascii=False,
    ).encode()

    encrypted = _encrypt(payload, subscription["p256dh"], subscription["auth"])
    headers = {
        **_vapid_header(endpoint),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": str(ttl),
    }

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(endpoint, content=encrypted, headers=headers)
    if resp.status_code >= 400 and resp.status_code not in (404, 410):
        logger.warning(f"[PRF] push falhou {resp.status_code}: {resp.text[:200]}")
    return resp.status_code
