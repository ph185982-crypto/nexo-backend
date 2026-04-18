"""
Image Generator — gera fotos padronizadas de produtos usando DALL-E 3 (OpenAI).

Se OPENAI_API_KEY não estiver configurado, retorna None e o sistema
usa as fotos originais do fornecedor.

Estilo padrão: fundo branco, produto centralizado, iluminação profissional, e-commerce.
"""
import os, logging, httpx
from typing import Optional

logger = logging.getLogger(__name__)

OPENAI_KEY = os.getenv("OPENAI_API_KEY", "")
DALLE_URL  = "https://api.openai.com/v1/images/generations"

STYLE_PROMPT = (
    "Professional product photography for e-commerce: "
    "pure white background, product perfectly centered, "
    "soft studio lighting from above-left, sharp focus, "
    "no shadows, no props, no text, 4K quality, "
    "minimalist style."
)


async def generate_product_image(product_title: str, sku: str = "") -> Optional[str]:
    """
    Gera uma imagem profissional do produto usando DALL-E 3.
    Retorna URL da imagem gerada ou None se não configurado / falhar.
    """
    if not OPENAI_KEY:
        logger.debug("OPENAI_API_KEY não configurado — pulando geração de imagem")
        return None

    # Limpa o título: remove código SKU duplicado ao final
    title = product_title
    if sku and title.upper().endswith(sku.upper()):
        title = title[: -len(sku)].rstrip(" -()").strip()

    prompt = f"{STYLE_PROMPT} Product: {title[:200]}"

    headers = {
        "Authorization": f"Bearer {OPENAI_KEY}",
        "Content-Type":  "application/json",
    }
    body = {
        "model":   "dall-e-3",
        "prompt":  prompt,
        "n":       1,
        "size":    "1024x1024",
        "quality": "standard",
    }

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(DALLE_URL, json=body, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            url = data["data"][0]["url"]
            logger.info(f"Imagem gerada para '{title[:50]}': {url[:60]}…")
            return url
    except Exception as e:
        logger.warning(f"DALL-E falhou para '{title[:50]}': {e}")
        return None


def is_image_gen_enabled() -> bool:
    return bool(OPENAI_KEY)
