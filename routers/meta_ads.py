"""Meta Ads Intelligence Router — Graph API v19.0"""
import os, logging
import httpx
from fastapi import APIRouter, Depends, HTTPException
from routers.auth import get_current_user
from services.meta_analyzer import MetaAnalyzer

router = APIRouter()
logger = logging.getLogger(__name__)

GRAPH_URL = "https://graph.facebook.com/v19.0"
_TOKEN = os.getenv("META_ADS_TOKEN", "")

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


def _token() -> str:
    t = _TOKEN or os.getenv("META_ADS_TOKEN", "")
    if not t:
        raise HTTPException(503, "META_ADS_TOKEN não configurado no servidor")
    return t


def _safe_log(msg: str):
    """Log sem expor token."""
    logger.info(msg)


async def _graph_get(path: str, params: dict) -> dict:
    params["access_token"] = _token()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{GRAPH_URL}/{path}", params=params)
    # Nunca loga o token
    if r.status_code != 200:
        body = r.json()
        err = body.get("error", {})
        raise HTTPException(r.status_code, err.get("message", f"Meta API error {r.status_code}"))
    return r.json()


def _parse_insights(insights_edge: dict | None) -> dict:
    if not insights_edge:
        return {}
    data = insights_edge.get("data", [])
    if not data:
        return {}
    ins = data[0]

    def _action(actions: list, action_type: str) -> float:
        if not actions:
            return 0.0
        for a in actions:
            if a.get("action_type") == action_type:
                return float(a.get("value", 0))
        return 0.0

    actions       = ins.get("actions") or []
    action_values = ins.get("action_values") or []
    purchases     = _action(actions, "purchase")
    revenue       = _action(action_values, "purchase")
    spend         = float(ins.get("spend", 0))
    roas          = round(revenue / spend, 2) if spend > 0 else 0.0
    cost_per_pur  = round(spend / purchases, 2) if purchases > 0 else 0.0

    def _video(field: str) -> float:
        return float((ins.get(field) or [{}])[0].get("value", 0)) if isinstance(ins.get(field), list) else 0.0

    return {
        "spend":              spend,
        "impressions":        int(ins.get("impressions", 0)),
        "clicks":             int(ins.get("clicks", 0)),
        "ctr":                round(float(ins.get("ctr", 0)), 2),
        "cpm":                round(float(ins.get("cpm", 0)), 2),
        "cpc":                round(float(ins.get("cpc", 0)), 2),
        "reach":              int(ins.get("reach", 0)),
        "frequency":          round(float(ins.get("frequency", 0)), 2),
        "purchases":          int(purchases),
        "revenue":            round(revenue, 2),
        "purchase_roas":      roas,
        "cost_per_purchase":  cost_per_pur,
        "video_plays":        _video("video_play_actions"),
        "video_p25":          _video("video_p25_watched_actions"),
        "video_p50":          _video("video_p50_watched_actions"),
        "video_p75":          _video("video_p75_watched_actions"),
        "video_p100":         _video("video_p100_watched_actions"),
    }


async def _get_ad_accounts() -> list[dict]:
    data = await _graph_get("me/adaccounts", {
        "fields": "name,account_id,currency,account_status,amount_spent"
    })
    return data.get("data", [])


# ── ENDPOINTS ─────────────────────────────────────────────────────────────────

@router.get("/accounts")
async def list_accounts(user=Depends(get_current_user)):
    """Lista todas as contas de anúncio vinculadas ao token."""
    accounts = await _get_ad_accounts()
    _safe_log(f"[Meta] {len(accounts)} conta(s) encontrada(s)")
    return {"accounts": accounts}


@router.get("/campaigns")
async def list_campaigns(account_id: str = "", user=Depends(get_current_user)):
    accounts = await _get_ad_accounts()
    if not accounts:
        raise HTTPException(404, "Nenhuma conta de anúncio encontrada")

    acc_id = account_id or accounts[0]["id"]
    data = await _graph_get(f"{acc_id}/campaigns", {
        "fields": _CAMPAIGN_FIELDS,
        "limit":  50,
    })
    campaigns = []
    for c in data.get("data", []):
        ins = _parse_insights(c.get("insights"))
        campaigns.append({
            "id":             c["id"],
            "name":           c["name"],
            "status":         c.get("status"),
            "objective":      c.get("objective"),
            "daily_budget":   int(c.get("daily_budget", 0)) / 100,
            "lifetime_budget":int(c.get("lifetime_budget", 0)) / 100,
            "budget_remaining":int(c.get("budget_remaining", 0)) / 100,
            **ins,
        })
    campaigns.sort(key=lambda x: x.get("spend", 0), reverse=True)
    _safe_log(f"[Meta] {len(campaigns)} campanha(s)")
    return {"campaigns": campaigns, "account_id": acc_id}


@router.get("/adsets")
async def list_adsets(account_id: str = "", user=Depends(get_current_user)):
    accounts = await _get_ad_accounts()
    if not accounts:
        raise HTTPException(404, "Nenhuma conta de anúncio encontrada")

    acc_id = account_id or accounts[0]["id"]
    data = await _graph_get(f"{acc_id}/adsets", {
        "fields": _ADSET_FIELDS,
        "limit":  100,
    })
    adsets = []
    for s in data.get("data", []):
        ins = _parse_insights(s.get("insights"))
        targeting = s.get("targeting", {})
        adsets.append({
            "id":             s["id"],
            "name":           s["name"],
            "status":         s.get("status"),
            "daily_budget":   int(s.get("daily_budget", 0)) / 100,
            "bid_strategy":   s.get("bid_strategy"),
            "optimization_goal": s.get("optimization_goal"),
            "age_min":        targeting.get("age_min"),
            "age_max":        targeting.get("age_max"),
            "genders":        targeting.get("genders"),
            **ins,
        })
    adsets.sort(key=lambda x: x.get("spend", 0), reverse=True)
    _safe_log(f"[Meta] {len(adsets)} conjunto(s) de anúncio")
    return {"adsets": adsets, "account_id": acc_id}


@router.get("/ads")
async def list_ads(account_id: str = "", user=Depends(get_current_user)):
    accounts = await _get_ad_accounts()
    if not accounts:
        raise HTTPException(404, "Nenhuma conta de anúncio encontrada")

    acc_id = account_id or accounts[0]["id"]
    data = await _graph_get(f"{acc_id}/ads", {
        "fields": _AD_FIELDS,
        "limit":  100,
    })
    ads = []
    for a in data.get("data", []):
        ins = _parse_insights(a.get("insights"))
        creative = a.get("creative") or {}
        spend = ins.get("spend", 0)
        impressions = ins.get("impressions", 0)
        play_rate = round((ins.get("video_plays", 0) / impressions * 100), 1) if impressions > 0 else 0
        completion_rate = round((ins.get("video_p100", 0) / max(ins.get("video_plays", 1), 1) * 100), 1)

        # Badge de status
        roas = ins.get("purchase_roas", 0)
        ctr  = ins.get("ctr", 0)
        freq = ins.get("frequency", 0)
        if roas >= 3 and ctr >= 1.5 and spend > 0:
            badge = "ESCALÁVEL"
        elif roas >= 2 and ctr >= 1.0 and spend > 0:
            badge = "ESTÁVEL"
        elif a.get("effective_status") == "DISAPPROVED":
            badge = "REPROVADO"
        elif roas < 1 or ctr < 0.5 or freq > 4:
            badge = "PAUSAR"
        else:
            badge = "ATENÇÃO"

        ads.append({
            "id":              a["id"],
            "name":            a["name"],
            "status":          a.get("status"),
            "effective_status":a.get("effective_status"),
            "badge":           badge,
            "creative_title":  creative.get("title", ""),
            "creative_body":   creative.get("body", ""),
            "thumbnail_url":   creative.get("thumbnail_url", ""),
            "image_url":       creative.get("image_url", "") or creative.get("thumbnail_url", ""),
            "video_id":        creative.get("video_id", ""),
            "play_rate_pct":   play_rate,
            "completion_rate_pct": completion_rate,
            **ins,
        })
    ads.sort(key=lambda x: x.get("spend", 0), reverse=True)
    _safe_log(f"[Meta] {len(ads)} anúncio(s)")
    return {"ads": ads, "account_id": acc_id}


@router.get("/insights")
async def consolidated_insights(account_id: str = "", user=Depends(get_current_user)):
    """Métricas consolidadas dos últimos 30 dias."""
    accounts = await _get_ad_accounts()
    if not accounts:
        raise HTTPException(404, "Nenhuma conta de anúncio encontrada")

    acc_id = account_id or accounts[0]["id"]
    data = await _graph_get(f"{acc_id}/insights", {
        "fields":      _INSIGHTS_FIELDS,
        "date_preset": "last_30d",
        "level":       "account",
    })
    ins = _parse_insights({"data": data.get("data", [])})
    impressions = ins.get("impressions", 0)
    plays = ins.get("video_plays", 0)
    _safe_log(f"[Meta] Insights consolidados: gasto R${ins.get('spend',0)}")
    return {
        **ins,
        "play_rate_pct":      round(plays / impressions * 100, 1) if impressions else 0,
        "account_id":         acc_id,
        "account_name":       accounts[0].get("name", ""),
        "currency":           accounts[0].get("currency", "BRL"),
    }


@router.get("/analysis")
async def ai_analysis(account_id: str = "", user=Depends(get_current_user)):
    """IA analisa toda a conta e retorna diagnóstico priorizado."""
    accounts = await _get_ad_accounts()
    if not accounts:
        raise HTTPException(404, "Nenhuma conta de anúncio encontrada")

    acc_id = account_id or accounts[0]["id"]

    # Busca campanhas e anúncios em paralelo
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
        ins = _parse_insights(a.get("insights"))
        creative = a.get("creative") or {}
        ads.append({
            "id": a["id"], "name": a["name"],
            "status": a.get("status"), "effective_status": a.get("effective_status"),
            "thumbnail_url": creative.get("thumbnail_url", ""),
            **ins,
        })

    account_ins = _parse_insights({"data": insights_data.get("data", [])})

    analyzer = MetaAnalyzer()
    result = analyzer.analyze(campaigns, ads, account_ins)
    _safe_log(f"[Meta] Análise IA: score {result.get('health_score')}/100, {len(result.get('issues',[]))} problema(s)")
    return result
