"""Download Router — proxy para baixar mídias (fotos e vídeos) dos produtos"""
import httpx, re
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from routers.auth import get_current_user

router = APIRouter()

ALLOWED_HOSTS = [
    "ae01.alicdn.com", "ae02.alicdn.com", "ae03.alicdn.com", "ae04.alicdn.com",
    "img.alicdn.com", "cbu01.alicdn.com",
    "down-br.img.susercontent.com", "cf.shopee.com.br",
    "z-p3-scontent.fbcdn.net", "scontent.cdninstagram.com",
    "video.aliexpress-media.com", "aliexpress-media.com",
    "img.youtube.com",
]

_EXT_CONTENT = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".gif": "image/gif", ".webp": "image/webp",
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
}


def _allowed(url: str) -> bool:
    try:
        from urllib.parse import urlparse
        host = urlparse(url).hostname or ""
        return any(host == h or host.endswith("." + h) for h in ALLOWED_HOSTS)
    except Exception:
        return False


def _content_type(url: str, fallback="application/octet-stream") -> str:
    low = url.lower().split("?")[0]
    for ext, ct in _EXT_CONTENT.items():
        if low.endswith(ext):
            return ct
    return fallback


def _safe_filename(url: str, default="arquivo") -> str:
    name = url.split("/")[-1].split("?")[0]
    name = re.sub(r"[^\w.\-]", "_", name)
    return name or default


@router.get("/media")
async def download_media(
    url: str = Query(..., description="URL pública da imagem ou vídeo"),
    filename: str = Query(None, description="Nome do arquivo (opcional)"),
    user=Depends(get_current_user)
):
    """
    Faz proxy do arquivo de mídia e envia para download no navegador.
    Aceita imagens e vídeos de plataformas conhecidas (AliExpress, Shopee, etc.).
    """
    if not _allowed(url):
        raise HTTPException(400, "URL de origem não permitida por segurança.")

    safe_name = filename or _safe_filename(url)
    content_type = _content_type(url)

    async def stream():
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            async with client.stream("GET", url, headers={"User-Agent": "Mozilla/5.0"}) as resp:
                if resp.status_code >= 400:
                    raise HTTPException(resp.status_code, "Falha ao buscar mídia na origem")
                async for chunk in resp.aiter_bytes(chunk_size=65536):
                    yield chunk

    return StreamingResponse(
        stream(),
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'}
    )
