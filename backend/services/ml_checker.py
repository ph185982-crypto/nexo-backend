"""
Mercado Livre BR Saturation Checker
Verifica saturação de produto no mercado brasileiro via RapidAPI.
Retorna: "Não Vendido" / "Pouco Vendido" / "Já Vendido"
"""
import logging, os
import httpx

logger = logging.getLogger(__name__)

ML_RAPIDAPI_KEY  = os.getenv("RAPIDAPI_KEY", "")
ML_RAPIDAPI_HOST = "mercadolivresearchapi.p.rapidapi.com"

# Cache simples em memória para evitar chamadas repetidas
_cache: dict = {}


async def check_ml_saturation(keywords: str) -> tuple[str, int]:
    """
    Busca palavras-chave no Mercado Livre e retorna (status, count).
    status: "Não Vendido" | "Pouco Vendido" | "Já Vendido"
    count: número de resultados encontrados
    """
    key = keywords.lower().strip()
    if key in _cache:
        return _cache[key]

    if not ML_RAPIDAPI_KEY:
        return ("Não Vendido", 0)

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"https://{ML_RAPIDAPI_HOST}/",
                headers={
                    "x-rapidapi-host": ML_RAPIDAPI_HOST,
                    "x-rapidapi-key":  ML_RAPIDAPI_KEY,
                    "Content-Type": "application/json",
                },
                json={"query": keywords, "limit": 10, "offset": 0, "site": "MLB"},
            )
            if r.status_code != 200:
                logger.warning(f"ML API status {r.status_code} para '{keywords}'")
                return ("Não Vendido", 0)

            data  = r.json()
            count = int(data.get("total", data.get("paging", {}).get("total", 0)) or 0)

    except Exception as e:
        logger.warning(f"ML checker falhou para '{keywords}': {e}")
        return ("Não Vendido", 0)

    if count < 5:
        status = "Não Vendido"
    elif count <= 50:
        status = "Pouco Vendido"
    else:
        status = "Já Vendido"

    _cache[key] = (status, count)
    logger.info(f"ML '{keywords}': {count} resultados → {status}")
    return (status, count)


def ml_score_bonus(br_status: str) -> int:
    """Retorna pontos de bônus de score baseado na saturação BR."""
    return {"Não Vendido": 25, "Pouco Vendido": 15, "Já Vendido": 5}.get(br_status, 5)
