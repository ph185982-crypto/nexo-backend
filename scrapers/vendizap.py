"""
Vendizap Scraper — raspa produtos do catálogo yanne.vendizap.com via API oficial.

API: POST https://app.vendizap.com/webservice/Vitrine/carregarVitrine
Retorna todos os produtos em uma única chamada (sem paginação real).
"""
import httpx, logging
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

VENDIZAP_API = "https://app.vendizap.com/webservice/Vitrine/carregarVitrine"
CDN_ORIGINAL = "https://cdn.vendizap.com/vendizap-produtos/"
CDN_THUMB    = "https://cdn.vendizap.com/vendizap-produtos-thumbs/"

# Store ID + category IDs para yanne.vendizap.com
STORE_ID          = "6521bf11c1b2bf583974ff18"
CAT_FERRAMENTAS   = "6558f10aa733c239671b80b5"   # "FERRAMENTAS EM GERAL"


def _build_image_urls(img_obj: dict) -> dict:
    """Retorna thumb e original de um objeto de imagem Vendizap."""
    h = img_obj.get("hash", "")
    return {
        "thumb":    img_obj.get("link") or (CDN_THUMB + h if h else ""),
        "original": img_obj.get("linkOriginal") or (CDN_ORIGINAL + h if h else ""),
    }


async def fetch_all_products(
    store_id: str = STORE_ID,
    category_ids: Optional[List[str]] = None,
    timeout: int = 30,
) -> List[Dict]:
    """
    Busca todos os produtos do catálogo.
    Se category_ids for None, busca tudo; senão filtra pelas categorias informadas.
    """
    payload = {
        "idUsuario":      store_id,
        "textoPesquisa":  "",
        "categoria":      category_ids or [],
        "filtrosVitrine": {"texto": "", "precoMin": 0, "precoMax": 0, "variacoes": []},
        "isTabela":       False,
        "permiteCache":   False,
        "tipoCache":      "normal" if not category_ids else "filtrando",
        "produtoURL":     None,
        "isMobile":       False,
        "paginaGerais":   0,
        "paginaPromocoes": 0,
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(VENDIZAP_API, json=payload)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.error(f"Vendizap API error: {e}")
        return []

    raw = data.get("produtos") or data.get("listas", {}).get("listaGaleria") or []
    logger.info(f"Vendizap retornou {len(raw)} produtos (store={store_id})")

    results = []
    for p in raw:
        if not p.get("exibir", True):
            continue

        images = [_build_image_urls(img) for img in (p.get("imagens") or []) if img.get("hash")]
        descricao = (p.get("descricao") or "").strip()
        if not descricao:
            continue

        results.append({
            "vendor_id":   p.get("_id", ""),
            "sku":         p.get("codigo", ""),
            "title":       descricao,
            "description": (p.get("detalhes") or p.get("detalhesFormatado") or "").strip(),
            "cost_brl":    float(p.get("preco") or 0),
            "images":      images,
            "category":    _guess_category(descricao),
            "source_url":  f"https://yanne.vendizap.com",
        })

    return results


def _guess_category(title: str) -> str:
    t = title.upper()
    if any(k in t for k in ["FERRAMENTA", "ALICATE", "CHAVE", "BROCA", "FORMÃO", "TALHADEIRA",
                              "SOQUETE", "ESPÁTULA", "COLHER DE PEDREIRO", "NÍVEL", "PARAFUS",
                              "MOTOSERRA", "PISTOLA", "INVERSORA", "FURADEIRA"]):
        return "Ferramentas"
    if any(k in t for k in ["CAIXA DE SOM", "FONE", "MICROFONE", "ÁUDIO", "BLUETOOTH"]):
        return "Áudio"
    if any(k in t for k in ["CABO", "CARREGADOR", "FONTE", "USB", "HDMI"]):
        return "Cabos e Carregadores"
    if any(k in t for k in ["CÂMERA", "PROJETOR", "TV BOX", "CONSOLE"]):
        return "Eletrônicos"
    if any(k in t for k in ["LUMINÁRIA", "LED", "LANTERNA", "SOLAR"]):
        return "Iluminação"
    return "Geral"
