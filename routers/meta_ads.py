"""Meta Ads Intelligence Router — Graph API v19.0"""
import os, logging
import httpx
from fastapi import APIRouter, Depends, HTTPException
from routers.auth import get_current_user
from services.meta_analyzer import MetaAnalyzer

router = APIRouter()
logger = logging.getLogger(__name__)

GRAPH_URL = "https://graph.facebook.com/v19.0"

# Permissões necessárias documentadas
REQUIRED_PERMISSIONS = ["ads_read", "read_insights", "ads_management", "business_management"]

_INSIGHTS_FIELDS = ",".join([
    "spend", "impressions", "clicks", "ctr", "cpm", "cpc",
    "reach", "frequency", "actions", "action_values",
    "video_play_actions", "video_p25_watched_actions",
    "video_p50_watched_actions", "video_p75_watched_actions",
    "video_p100_watched_actions",
])

_AD_FIELDS = ",".join([
    "id", "name", "status", "effective_status",
    "creative{id,title,body,image_url,thumbnail_url,video_id}",
    f"insights{{date_preset=last_30d,fields={_INSIGHTS_FIELDS}}}",
])

_CAMPAIGN_FIELDS = ",".join([
    "id", "name", "status", "objective",
    "daily_budget", "lifetime_budget", "budget_remaining",
    f"insights{{date_preset=last_30d,fields={_INSIGHTS_FIELDS}}}",
])

_ADSET_FIELDS = ",".join([
    "id", "name", "status", "daily_budget", "bid_amount", "bid_strategy",
    "targeting", "optimization_goal", "destination_type",
    f"insights{{date_preset=last_30d,fields={_INSIGHTS_FIELDS}}}",
])

# ── Meta API error codes ───────────────────────────────────────────────────────
_META_ERROR_HINTS = {
    190: "Token de acesso inválido ou expirado. Gere um novo token em business.facebook.com.",
    200: "Permissão negada. O token precisa das permissões: ads_read e read_insights.",
    10:  "Permissão de API bloqueada. Adicione ads_read, read_insights ao token.",
    100: "Parâmetro inválido na requisição à API do Meta.",
    4:   "Limite de rate da API atingido. Aguarde alguns minutos.",
    17:  "Limite de chamadas por usuário atingido. Tente em 1 hora.",
    341: "Limite diário de chamadas atingido.",
    368: "Conta de anúncios temporariamente bloqueada pelo Meta.",
}


def _get_token() -> str:
    t = os.getenv("META_ADS_TOKEN", "")
    if not t:
        raise HTTPException(503, detail={
            "error_type":    "TOKEN_NOT_CONFIGURED",
            "message":       "META_ADS_TOKEN não configurado no servidor.",
            "hint":          "Adicione META_ADS_TOKEN nas variáveis de ambiente do Render.",
            "permissions":   REQUIRED_PERMISSIONS,
            "setup_url":     "https://business.facebook.com/settings/system-users",
        })
    return t


async def _graph_get(path: str, params: dict) -> dict:
    token = _get_token()
    params = {**params, "access_token": token}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(f"{GRAPH_URL}/{path}", params=params)
    except httpx.TimeoutException:
        raise HTTPException(504, detail={"error_type": "TIMEOUT", "message": "Meta API não respondeu em 30s."})
    except httpx.RequestError as e:
        raise HTTPException(502, detail={"error_type": "NETWORK_ERROR", "message": str(e)})

    body = r.json()

    if r.status_code != 200 or "error" in body:
        err   = body.get("error", {})
        code  = err.get("code", 0)
        etype = err.get("type", "")
        msg   = err.get("message", f"Meta API HTTP {r.status_code}")
        fbtid = err.get("fbtrace_id", "")

        # Log completo sem expor token
        logger.error(
            f"[Meta API] Erro {code} ({etype}): {msg} | "
            f"subcode={err.get('error_subcode')} | fbtrace={fbtid} | path=/{path}"
        )

        hint = _META_ERROR_HINTS.get(code, "Verifique as permissões do token e se a conta de anúncios está ativa.")
        raise HTTPException(r.status_code or 400, detail={
            "error_type":     etype or "META_API_ERROR",
            "error_code":     code,
            "message":        msg,
            "hint":           hint,
            "permissions":    REQUIRED_PERMISSIONS,
            "fbtrace_id":     fbtid,
            "setup_url":      "https://business.facebook.com/settings/system-users",
        })

    return body


def _parse_insights(insights_edge: dict | None) -> dict:
    if not insights_edge:
        return {}
    data = insights_edge.get("data", [])
    if not data:
        return {}
    ins = data[0]

    def _action(actions: list, action_type: str) -> float:
        for a in (actions or []):
            if a.get("action_type") == action_type:
                return float(a.get("value", 0))
        return 0.0

    def _video(field: str) -> float:
        v = ins.get(field)
        if isinstance(v, list) and v:
            return float(v[0].get("value", 0))
        return 0.0

    actions       = ins.get("actions") or []
    action_values = ins.get("action_values") or []
    purchases     = _action(actions, "purchase")
    revenue       = _action(action_values, "purchase")
    spend         = float(ins.get("spend", 0))
    roas          = round(revenue / spend, 2) if spend > 0 else 0.0
    cost_per_pur  = round(spend / purchases, 2) if purchases > 0 else 0.0

    return {
        "spend":             spend,
        "impressions":       int(ins.get("impressions", 0)),
        "clicks":            int(ins.get("clicks", 0)),
        "ctr":               round(float(ins.get("ctr", 0)), 2),
        "cpm":               round(float(ins.get("cpm", 0)), 2),
        "cpc":               round(float(ins.get("cpc", 0)), 2),
        "reach":             int(ins.get("reach", 0)),
        "frequency":         round(float(ins.get("frequency", 0)), 2),
        "purchases":         int(purchases),
        "revenue":           round(revenue, 2),
        "purchase_roas":     roas,
        "cost_per_purchase": cost_per_pur,
        "video_plays":       _video("video_play_actions"),
        "video_p25":         _video("video_p25_watched_actions"),
        "video_p50":         _video("video_p50_watched_actions"),
        "video_p75":         _video("video_p75_watched_actions"),
        "video_p100":        _video("video_p100_watched_actions"),
    }


async def _get_ad_accounts() -> list[dict]:
    data = await _graph_get("me/adaccounts", {
        "fields": "name,account_id,currency,account_status,amount_spent"
    })
    accounts = data.get("data", [])
    logger.info(f"[Meta] {len(accounts)} conta(s) de anuncio encontrada(s)")
    return accounts


# ── ENDPOINT: /config ──────────────────────────────────────────────────────────

@router.get("/config")
async def meta_config(user=Depends(get_current_user)):
    """Retorna status de configuração do token sem expô-lo."""
    token = os.getenv("META_ADS_TOKEN", "")
    configured = bool(token)
    return {
        "configured":          configured,
        "required_permissions": REQUIRED_PERMISSIONS,
        "setup_url":           "https://business.facebook.com/settings/system-users",
        "graph_api_version":   "v19.0",
        "token_preview":       (token[:8] + "…") if configured else None,
    }


# ── ENDPOINTS ─────────────────────────────────────────────────────────────────

@router.get("/accounts")
async def list_accounts(user=Depends(get_current_user)):
    accounts = await _get_ad_accounts()
    return {"accounts": accounts}


@router.get("/campaigns")
async def list_campaigns(account_id: str = "", user=Depends(get_current_user)):
    accounts = await _get_ad_accounts()
    if not accounts:
        raise HTTPException(404, detail={"error_type": "NO_ACCOUNTS", "message": "Nenhuma conta de anuncio encontrada para este token."})

    acc_id = account_id or accounts[0]["id"]
    data = await _graph_get(f"{acc_id}/campaigns", {"fields": _CAMPAIGN_FIELDS, "limit": 50})
    campaigns = []
    for c in data.get("data", []):
        ins = _parse_insights(c.get("insights"))
        campaigns.append({
            "id":              c["id"],
            "name":            c["name"],
            "status":          c.get("status"),
            "objective":       c.get("objective"),
            "daily_budget":    int(c.get("daily_budget") or 0) / 100,
            "lifetime_budget": int(c.get("lifetime_budget") or 0) / 100,
            **ins,
        })
    campaigns.sort(key=lambda x: x.get("spend", 0), reverse=True)
    logger.info(f"[Meta] {len(campaigns)} campanha(s) retornada(s)")
    return {"campaigns": campaigns, "account_id": acc_id}


@router.get("/adsets")
async def list_adsets(account_id: str = "", user=Depends(get_current_user)):
    accounts = await _get_ad_accounts()
    if not accounts:
        raise HTTPException(404, detail={"error_type": "NO_ACCOUNTS", "message": "Nenhuma conta de anuncio encontrada."})

    acc_id = account_id or accounts[0]["id"]
    data = await _graph_get(f"{acc_id}/adsets", {"fields": _ADSET_FIELDS, "limit": 100})
    adsets = []
    for s in data.get("data", []):
        ins = _parse_insights(s.get("insights"))
        targeting = s.get("targeting", {})
        adsets.append({
            "id":               s["id"],
            "name":             s["name"],
            "status":           s.get("status"),
            "daily_budget":     int(s.get("daily_budget") or 0) / 100,
            "bid_strategy":     s.get("bid_strategy"),
            "optimization_goal":s.get("optimization_goal"),
            "age_min":          targeting.get("age_min"),
            "age_max":          targeting.get("age_max"),
            **ins,
        })
    adsets.sort(key=lambda x: x.get("spend", 0), reverse=True)
    return {"adsets": adsets, "account_id": acc_id}


@router.get("/ads")
async def list_ads(account_id: str = "", user=Depends(get_current_user)):
    accounts = await _get_ad_accounts()
    if not accounts:
        raise HTTPException(404, detail={"error_type": "NO_ACCOUNTS", "message": "Nenhuma conta de anuncio encontrada."})

    acc_id = account_id or accounts[0]["id"]
    data = await _graph_get(f"{acc_id}/ads", {"fields": _AD_FIELDS, "limit": 100})
    ads = []
    for a in data.get("data", []):
        ins   = _parse_insights(a.get("insights"))
        crtv  = a.get("creative") or {}
        spend = ins.get("spend", 0)
        imps  = ins.get("impressions", 1)
        plays = ins.get("video_plays", 0)
        p100  = ins.get("video_p100", 0)
        play_rate   = round(plays / imps * 100, 1) if imps > 0 else 0
        completion  = round(p100 / max(plays, 1) * 100, 1) if plays > 0 else 0
        roas = ins.get("purchase_roas", 0)
        ctr  = ins.get("ctr", 0)
        freq = ins.get("frequency", 0)

        if roas >= 3 and ctr >= 1.5 and spend > 0:   badge = "ESCALAVEL"
        elif roas >= 2 and ctr >= 1.0 and spend > 0: badge = "ESTAVEL"
        elif a.get("effective_status") == "DISAPPROVED": badge = "REPROVADO"
        elif roas < 1 or ctr < 0.5 or freq > 4:      badge = "PAUSAR"
        else:                                          badge = "ATENCAO"

        ads.append({
            "id":               a["id"],
            "name":             a["name"],
            "status":           a.get("status"),
            "effective_status": a.get("effective_status"),
            "badge":            badge,
            "creative_title":   crtv.get("title", ""),
            "thumbnail_url":    crtv.get("thumbnail_url", ""),
            "image_url":        crtv.get("image_url", "") or crtv.get("thumbnail_url", ""),
            "video_id":         crtv.get("video_id", ""),
            "play_rate_pct":    play_rate,
            "completion_rate_pct": completion,
            **ins,
        })
    ads.sort(key=lambda x: x.get("spend", 0), reverse=True)
    logger.info(f"[Meta] {len(ads)} anuncio(s) retornado(s)")
    return {"ads": ads, "account_id": acc_id}


@router.get("/insights")
async def consolidated_insights(account_id: str = "", user=Depends(get_current_user)):
    accounts = await _get_ad_accounts()
    if not accounts:
        raise HTTPException(404, detail={"error_type": "NO_ACCOUNTS", "message": "Nenhuma conta de anuncio encontrada."})

    acc_id = account_id or accounts[0]["id"]
    data = await _graph_get(f"{acc_id}/insights", {
        "fields":      _INSIGHTS_FIELDS,
        "date_preset": "last_30d",
        "level":       "account",
    })
    ins = _parse_insights({"data": data.get("data", [])})
    imps  = ins.get("impressions", 0)
    plays = ins.get("video_plays", 0)
    logger.info(f"[Meta] Insights conta: gasto {ins.get('spend', 0)}")
    return {
        **ins,
        "play_rate_pct": round(plays / imps * 100, 1) if imps else 0,
        "account_id":    acc_id,
        "account_name":  accounts[0].get("name", ""),
        "currency":      accounts[0].get("currency", "BRL"),
    }


@router.get("/analysis")
async def ai_analysis(account_id: str = "", user=Depends(get_current_user)):
    accounts = await _get_ad_accounts()
    if not accounts:
        raise HTTPException(404, detail={"error_type": "NO_ACCOUNTS", "message": "Nenhuma conta de anuncio encontrada."})

    acc_id = account_id or accounts[0]["id"]
    import asyncio
    campaigns_data, ads_data, insights_data = await asyncio.gather(
        _graph_get(f"{acc_id}/campaigns", {"fields": _CAMPAIGN_FIELDS, "limit": 50}),
        _graph_get(f"{acc_id}/ads",       {"fields": _AD_FIELDS,       "limit": 100}),
        _graph_get(f"{acc_id}/insights",  {"fields": _INSIGHTS_FIELDS, "date_preset": "last_30d", "level": "account"}),
    )

    campaigns = []
    for c in campaigns_data.get("data", []):
        ins = _parse_insights(c.get("insights"))
        campaigns.append({"id": c["id"], "name": c["name"], "status": c.get("status"), **ins})

    ads = []
    for a in ads_data.get("data", []):
        ins  = _parse_insights(a.get("insights"))
        crtv = a.get("creative") or {}
        ads.append({
            "id": a["id"], "name": a["name"],
            "status": a.get("status"), "effective_status": a.get("effective_status"),
            "thumbnail_url": crtv.get("thumbnail_url", ""),
            **ins,
        })

    account_ins = _parse_insights({"data": insights_data.get("data", [])})
    analyzer = MetaAnalyzer()
    result = analyzer.analyze(campaigns, ads, account_ins)
    logger.info(f"[Meta] Analise IA: score {result.get('health_score')}/100")
    return result
