"""Download Router — proxy de imagens e download de mídias dos produtos"""
import httpx, re
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse, Response
from routers.auth import get_current_user

router = APIRouter()

ALLOWED_HOSTS = [
    "ae01.alicdn.com", "ae02.alicdn.com", "ae03.alicdn.com", "ae04.alicdn.com",
    "ae05.alicdn.com", "ae06.alicdn.com",
    "img.alicdn.com", "cbu01.alicdn.com",
    # AliExpress True API CDN
    "ae-pic-a1.aliexpress-media.com", "ae-pic-a2.aliexpress-media.com",
    "ae-pic-b1.aliexpress-media.com", "ae-pic-b2.aliexpress-media.com",
    "aliexpress-media.com",
    "video.aliexpress-media.com",
    "down-br.img.susercontent.com", "cf.shopee.com.br",
    "z-p3-scontent.fbcdn.net", "scontent.cdninstagram.com",
    "img.youtube.com", "images.unsplash.com",
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


@router.get("/image")
async def proxy_image(
    url: str = Query(..., description="URL da imagem AliExpress ou outra plataforma"),
):
    """
    Proxy público de imagens — sem autenticação, resolve CORS do AliExpress.
    Usado pelo frontend para exibir fotos dos produtos.
    """
    # Permite qualquer domínio AliExpress CDN + Unsplash
    try:
        from urllib.parse import urlparse
        host = urlparse(url).hostname or ""
        ali_ok = (
            "alicdn.com" in host or
            "aliexpress" in host or
            "aliexpress-media.com" in host or
            "ae-pic-a1" in host or
            "unsplash.com" in host or
            "susercontent.com" in host
        )
        if not ali_ok:
            raise HTTPException(400, "Domínio não permitido no proxy")
    except Exception:
        raise HTTPException(400, "URL inválida")

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            r = await client.get(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://www.aliexpress.com/",
            })
            if r.status_code >= 400:
                raise HTTPException(502, "Imagem não encontrada na origem")
            content_type = r.headers.get("content-type", "image/jpeg")
            return Response(
                content=r.content,
                media_type=content_type,
                headers={
                    "Cache-Control": "public, max-age=86400",
                    "Access-Control-Allow-Origin": "*",
                }
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Erro ao buscar imagem: {e}")


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
