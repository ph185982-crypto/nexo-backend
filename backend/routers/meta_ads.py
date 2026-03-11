"""Meta Ads Intelligence Router — Graph API v19.0 + Modo Demo"""
import os, logging, asyncio
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

# ── DADOS DEMO (realistas) ────────────────────────────────────────────────────

_DEMO_ACCOUNTS = [{"id": "act_123456789", "name": "NEXO Demo Store", "currency": "BRL", "account_status": 1, "amount_spent": "3240.50"}]

_DEMO_CAMPAIGNS = [
    {"id": "23850001", "name": "Pistola Massagem - Conversão", "status": "ACTIVE", "objective": "OUTCOME_SALES", "daily_budget": 5000, "spend": 1240.50, "impressions": 85000, "clicks": 1870, "ctr": 2.20, "cpm": 14.59, "cpc": 0.66, "reach": 72000, "frequency": 1.18, "purchases": 43, "revenue": 4085.00, "purchase_roas": 3.29, "cost_per_purchase": 28.85},
    {"id": "23850002", "name": "Escova Alisadora - TOF", "status": "ACTIVE", "objective": "OUTCOME_AWARENESS", "daily_budget": 3000, "spend": 890.00, "impressions": 120000, "clicks": 960, "ctr": 0.80, "cpm": 7.42, "cpc": 0.93, "reach": 98000, "frequency": 1.22, "purchases": 18, "revenue": 1530.00, "purchase_roas": 1.72, "cost_per_purchase": 49.44},
    {"id": "23850003", "name": "Máscara LED - Retargeting", "status": "PAUSED", "objective": "OUTCOME_SALES", "daily_budget": 2000, "spend": 450.00, "impressions": 22000, "clicks": 440, "ctr": 2.00, "cpm": 20.45, "cpc": 1.02, "reach": 15000, "frequency": 1.47, "purchases": 12, "revenue": 1140.00, "purchase_roas": 2.53, "cost_per_purchase": 37.50},
    {"id": "23850004", "name": "Brinquedo Gato - Prospecting", "status": "ACTIVE", "objective": "OUTCOME_SALES", "daily_budget": 4000, "spend": 660.00, "impressions": 95000, "clicks": 2375, "ctr": 2.50, "cpm": 6.95, "cpc": 0.28, "reach": 80000, "frequency": 1.19, "purchases": 31, "revenue": 3100.00, "purchase_roas": 4.70, "cost_per_purchase": 21.29},
]

_DEMO_ADS = [
    {"id": "ad_001", "name": "Pistola - Vídeo 15s", "status": "ACTIVE", "effective_status": "ACTIVE", "badge": "ESCALÁVEL", "creative_title": "Pistola de Massagem Profissional", "creative_body": "Alívio em segundos. Frete grátis!", "thumbnail_url": "https://ae01.alicdn.com/kf/S8b5e0c5a63684e0ead7c0e0e1b7b3e3cJ.jpg", "spend": 620.25, "impressions": 42000, "clicks": 924, "ctr": 2.20, "cpm": 14.77, "cpc": 0.67, "reach": 36000, "frequency": 1.17, "purchases": 22, "revenue": 2090.00, "purchase_roas": 3.37, "cost_per_purchase": 28.19, "video_plays": 35280, "play_rate_pct": 84.0, "completion_rate_pct": 38.5},
    {"id": "ad_002", "name": "Escova - Carrossel", "status": "ACTIVE", "effective_status": "ACTIVE", "badge": "ATENÇÃO", "creative_title": "Escova Alisadora Rotativa", "creative_body": "Cabelos lisos e brilhosos em minutos.", "thumbnail_url": "https://ae01.alicdn.com/kf/HTB1example2.jpg", "spend": 445.00, "impressions": 60000, "clicks": 480, "ctr": 0.80, "cpm": 7.42, "cpc": 0.93, "reach": 49000, "frequency": 1.22, "purchases": 9, "revenue": 765.00, "purchase_roas": 1.72, "cost_per_purchase": 49.44, "video_plays": 0, "play_rate_pct": 0, "completion_rate_pct": 0},
    {"id": "ad_003", "name": "Brinquedo Gato - Imagem", "status": "ACTIVE", "effective_status": "ACTIVE", "badge": "ESCALÁVEL", "creative_title": "Seu Gato Vai Enlouquecer!", "creative_body": "Brinquedo automático com pena recarregável.", "thumbnail_url": "https://ae01.alicdn.com/kf/S4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9.jpg", "spend": 330.00, "impressions": 47500, "clicks": 1187, "ctr": 2.50, "cpm": 6.95, "cpc": 0.28, "reach": 40000, "frequency": 1.19, "purchases": 16, "revenue": 1600.00, "purchase_roas": 4.85, "cost_per_purchase": 20.63, "video_plays": 0, "play_rate_pct": 0, "completion_rate_pct": 0},
    {"id": "ad_004", "name": "Máscara LED - Vídeo Demo", "status": "PAUSED", "effective_status": "PAUSED", "badge": "PAUSAR", "creative_title": "Rejuvenescimento Facial em Casa", "creative_body": "Tecnologia LED usada por dermatologistas.", "thumbnail_url": "https://ae01.alicdn.com/kf/Sc3d4example.jpg", "spend": 225.00, "impressions": 11000, "clicks": 220, "ctr": 2.00, "cpm": 20.45, "cpc": 1.02, "reach": 7500, "frequency": 1.47, "purchases": 6, "revenue": 570.00, "purchase_roas": 2.53, "cost_per_purchase": 37.50, "video_plays": 8250, "play_rate_pct": 75.0, "completion_rate_pct": 31.2},
]


def _build_demo_insights():
    return {
        "spend": 3240.50, "impressions": 322000, "clicks": 5629,
        "ctr": 1.75, "cpm": 10.06, "cpc": 0.58,
        "reach": 265000, "frequency": 1.21,
        "purchases": 104, "revenue": 9885.00,
        "purchase_roas": 3.05, "cost_per_purchase": 31.16,
        "video_plays": 43530, "play_rate_pct": 58.2,
        "video_p25": 38200, "video_p50": 28900,
        "video_p75": 19600, "video_p100": 16760,
    }


def _analyze_demo(campaigns, ads):
    """Análise IA dos dados demo."""
    issues = []
    for c in campaigns:
        ctr = c.get("ctr", 0)
        cpm = c.get("cpm", 0)
        freq = c.get("frequency", 0)
        if ctr < 1.0 and c.get("spend", 0) > 0:
            issues.append({"level": "warning", "campaign": c["name"], "msg": f"CTR baixo ({ctr}%) — criativo fraco, teste novas artes"})
        if cpm > 50 and c.get("spend", 0) > 0:
            issues.append({"level": "danger", "campaign": c["name"], "msg": f"CPM alto (R${cpm}) — público saturado, expanda segmentação"})
        if freq > 3 and c.get("spend", 0) > 0:
            issues.append({"level": "warning", "campaign": c["name"], "msg": f"Frequência alta ({freq}x) — público cansado, exclua quem já comprou"})
    return issues


# ── HELPERS ───────────────────────────────────────────────────────────────────

def _token() -> str:
    t = _TOKEN or os.getenv("META_ADS_TOKEN", "")
    return t


async def _graph_get(path: str, params: dict) -> dict:
    token = _token()
    if not token:
        raise Exception("META_ADS_TOKEN não configurado")
    params["access_token"] = token
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{GRAPH_URL}/{path}", params=params)
    if r.status_code != 200:
        body = r.json()
        err = body.get("error", {})
        raise Exception(f"Meta API: {err.get('message', f'HTTP {r.status_code}')}")
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

    def _video(field: str) -> float:
        return float((ins.get(field) or [{}])[0].get("value", 0)) if isinstance(ins.get(field), list) else 0.0

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
    data = await _graph_get("me/adaccounts", {"fields": "name,account_id,currency,account_status,amount_spent"})
    return data.get("data", [])


# ── ENDPOINTS ─────────────────────────────────────────────────────────────────

@router.get("/accounts")
async def list_accounts(user=Depends(get_current_user)):
    """Lista contas de anúncio. Retorna modo DEMO se token inválido."""
    try:
        accounts = await _get_ad_accounts()
        if accounts:
            logger.info(f"[Meta] {len(accounts)} conta(s) real(is)")
            return {"accounts": accounts, "demo": False}
    except Exception as e:
        logger.warning(f"[Meta] API real falhou ({e}) — modo DEMO")
    return {"accounts": _DEMO_ACCOUNTS, "demo": True}


@router.get("/campaigns")
async def list_campaigns(account_id: str = "", user=Depends(get_current_user)):
    try:
        accounts = await _get_ad_accounts()
        acc_id = account_id or (accounts[0]["id"] if accounts else "")
        data = await _graph_get(f"{acc_id}/campaigns", {"fields": _CAMPAIGN_FIELDS, "limit": 50})
        campaigns = []
        for c in data.get("data", []):
            ins = _parse_insights(c.get("insights"))
            campaigns.append({"id": c["id"], "name": c["name"], "status": c.get("status"), "objective": c.get("objective"), "daily_budget": int(c.get("daily_budget", 0)) / 100, **ins})
        campaigns.sort(key=lambda x: x.get("spend", 0), reverse=True)
        return {"campaigns": campaigns, "account_id": acc_id, "demo": False}
    except Exception as e:
        logger.warning(f"[Meta] campaigns falhou ({e}) — modo DEMO")
        return {"campaigns": _DEMO_CAMPAIGNS, "account_id": "act_123456789", "demo": True}


@router.get("/adsets")
async def list_adsets(account_id: str = "", user=Depends(get_current_user)):
    try:
        accounts = await _get_ad_accounts()
        acc_id = account_id or (accounts[0]["id"] if accounts else "")
        data = await _graph_get(f"{acc_id}/adsets", {"fields": _ADSET_FIELDS, "limit": 100})
        adsets = []
        for s in data.get("data", []):
            ins = _parse_insights(s.get("insights"))
            targeting = s.get("targeting", {})
            adsets.append({"id": s["id"], "name": s["name"], "status": s.get("status"), "daily_budget": int(s.get("daily_budget", 0)) / 100, "bid_strategy": s.get("bid_strategy"), "optimization_goal": s.get("optimization_goal"), "age_min": targeting.get("age_min"), "age_max": targeting.get("age_max"), "genders": targeting.get("genders"), **ins})
        adsets.sort(key=lambda x: x.get("spend", 0), reverse=True)
        return {"adsets": adsets, "account_id": acc_id, "demo": False}
    except Exception as e:
        logger.warning(f"[Meta] adsets falhou ({e}) — modo DEMO")
        return {"adsets": [], "account_id": "act_123456789", "demo": True, "message": "Conecte uma conta Meta Ads real para ver conjuntos de anúncios."}


@router.get("/ads")
async def list_ads(account_id: str = "", user=Depends(get_current_user)):
    try:
        accounts = await _get_ad_accounts()
        acc_id = account_id or (accounts[0]["id"] if accounts else "")
        data = await _graph_get(f"{acc_id}/ads", {"fields": _AD_FIELDS, "limit": 100})
        ads = []
        for a in data.get("data", []):
            ins = _parse_insights(a.get("insights"))
            creative = a.get("creative") or {}
            spend = ins.get("spend", 0); impressions = ins.get("impressions", 0)
            play_rate = round((ins.get("video_plays", 0) / impressions * 100), 1) if impressions > 0 else 0
            completion_rate = round((ins.get("video_p100", 0) / max(ins.get("video_plays", 1), 1) * 100), 1)
            roas = ins.get("purchase_roas", 0); ctr = ins.get("ctr", 0); freq = ins.get("frequency", 0)
            if roas >= 3 and ctr >= 1.5 and spend > 0: badge = "ESCALÁVEL"
            elif roas >= 2 and ctr >= 1.0 and spend > 0: badge = "ESTÁVEL"
            elif a.get("effective_status") == "DISAPPROVED": badge = "REPROVADO"
            elif roas < 1 or ctr < 0.5 or freq > 4: badge = "PAUSAR"
            else: badge = "ATENÇÃO"
            ads.append({"id": a["id"], "name": a["name"], "status": a.get("status"), "effective_status": a.get("effective_status"), "badge": badge, "creative_title": creative.get("title", ""), "creative_body": creative.get("body", ""), "thumbnail_url": creative.get("thumbnail_url", ""), "image_url": creative.get("image_url", "") or creative.get("thumbnail_url", ""), "video_id": creative.get("video_id", ""), "play_rate_pct": play_rate, "completion_rate_pct": completion_rate, **ins})
        ads.sort(key=lambda x: x.get("spend", 0), reverse=True)
        return {"ads": ads, "account_id": acc_id, "demo": False}
    except Exception as e:
        logger.warning(f"[Meta] ads falhou ({e}) — modo DEMO")
        return {"ads": _DEMO_ADS, "account_id": "act_123456789", "demo": True}


@router.get("/insights")
async def consolidated_insights(account_id: str = "", user=Depends(get_current_user)):
    try:
        accounts = await _get_ad_accounts()
        acc_id = account_id or (accounts[0]["id"] if accounts else "")
        data = await _graph_get(f"{acc_id}/insights", {"fields": _INSIGHTS_FIELDS, "date_preset": "last_30d", "level": "account"})
        ins = _parse_insights({"data": data.get("data", [])})
        impressions = ins.get("impressions", 0); plays = ins.get("video_plays", 0)
        return {**ins, "play_rate_pct": round(plays / impressions * 100, 1) if impressions else 0, "account_id": acc_id, "account_name": accounts[0].get("name", ""), "currency": accounts[0].get("currency", "BRL"), "demo": False}
    except Exception as e:
        logger.warning(f"[Meta] insights falhou ({e}) — modo DEMO")
        demo = _build_demo_insights()
        return {**demo, "account_id": "act_123456789", "account_name": "NEXO Demo Store", "currency": "BRL", "demo": True}


@router.get("/analysis")
async def ai_analysis(account_id: str = "", user=Depends(get_current_user)):
    try:
        accounts = await _get_ad_accounts()
        acc_id = account_id or (accounts[0]["id"] if accounts else "")
        campaigns_data, ads_data, insights_data = await asyncio.gather(
            _graph_get(f"{acc_id}/campaigns", {"fields": _CAMPAIGN_FIELDS, "limit": 50}),
            _graph_get(f"{acc_id}/ads", {"fields": _AD_FIELDS, "limit": 100}),
            _graph_get(f"{acc_id}/insights", {"fields": _INSIGHTS_FIELDS, "date_preset": "last_30d", "level": "account"}),
        )
        campaigns = []
        for c in campaigns_data.get("data", []):
            ins = _parse_insights(c.get("insights"))
            campaigns.append({"id": c["id"], "name": c["name"], "status": c.get("status"), **ins})
        ads_list = []
        for a in ads_data.get("data", []):
            ins = _parse_insights(a.get("insights"))
            creative = a.get("creative") or {}
            ads_list.append({"id": a["id"], "name": a["name"], "status": a.get("status"), "effective_status": a.get("effective_status"), "thumbnail_url": creative.get("thumbnail_url", ""), **ins})
        account_ins = _parse_insights({"data": insights_data.get("data", [])})
        analyzer = MetaAnalyzer()
        result = analyzer.analyze(campaigns, ads_list, account_ins)
        return {**result, "demo": False}
    except Exception as e:
        logger.warning(f"[Meta] analysis falhou ({e}) — modo DEMO")
        issues = _analyze_demo(_DEMO_CAMPAIGNS, _DEMO_ADS)
        return {
            "demo": True,
            "health_score": 72,
            "issues": issues,
            "recommendations": [
                "Escale a campanha 'Brinquedo Gato' — ROAS de 4.7x com CPM baixo",
                "Pause 'Escova Alisadora TOF' — CTR 0.8% indica criativo fraco",
                "Reative 'Máscara LED' com novo criativo de vídeo (UGC)",
            ],
            "best_campaign": "Brinquedo Gato - Prospecting",
            "total_spend": 3240.50,
            "total_roas": 3.05,
        }
