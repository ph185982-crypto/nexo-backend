"""
Meta Ads Router — API real com fallback DEMO automático.
Badge automático por anúncio + diagnóstico IA sem API externa.
"""
import httpx, os, logging
from fastapi import APIRouter, Depends
from routers.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()

META_TOKEN   = os.getenv("META_ADS_TOKEN", "")
META_VERSION = "v19.0"
BASE_URL     = f"https://graph.facebook.com/{META_VERSION}"

# ── DEMO DATA ──────────────────────────────────────────────────────────────────
DEMO_ACCOUNTS = [
    {"id": "act_123456789", "name": "[DEMO] NEXO Account", "currency": "BRL",
     "account_status": 1, "amount_spent": "1500.00"}
]

DEMO_CAMPAIGNS = [
    {"id": "23843001", "name": "[DEMO] Pistola Massagem — Conversão", "status": "ACTIVE",
     "objective": "OUTCOME_SALES", "daily_budget": "5000"},
    {"id": "23843002", "name": "[DEMO] Escova Alisadora — Tráfego", "status": "ACTIVE",
     "objective": "OUTCOME_TRAFFIC", "daily_budget": "3000"},
    {"id": "23843003", "name": "[DEMO] Máscara LED — Engajamento", "status": "PAUSED",
     "objective": "OUTCOME_ENGAGEMENT", "daily_budget": "2000"},
    {"id": "23843004", "name": "[DEMO] Pet Store — Remarketing", "status": "ACTIVE",
     "objective": "OUTCOME_SALES", "daily_budget": "4000"},
]

DEMO_ADS = [
    {"id": "ad_001", "name": "[DEMO] Pistola — Vídeo UGC", "status": "ACTIVE",
     "campaign_id": "23843001",
     "insights": {"impressions": "45200", "clicks": "1356", "spend": "320.50",
                  "reach": "38000", "frequency": "1.19", "cpm": "7.09", "ctr": "3.00",
                  "actions": [{"action_type": "purchase", "value": "23"}]}},
    {"id": "ad_002", "name": "[DEMO] Escova — Carrossel", "status": "ACTIVE",
     "campaign_id": "23843002",
     "insights": {"impressions": "32100", "clicks": "642", "spend": "198.00",
                  "reach": "29000", "frequency": "1.11", "cpm": "6.17", "ctr": "2.00",
                  "actions": [{"action_type": "purchase", "value": "12"}]}},
    {"id": "ad_003", "name": "[DEMO] LED — Estático", "status": "PAUSED",
     "campaign_id": "23843003",
     "insights": {"impressions": "18500", "clicks": "148", "spend": "95.00",
                  "reach": "17200", "frequency": "1.08", "cpm": "5.14", "ctr": "0.80",
                  "actions": [{"action_type": "purchase", "value": "5"}]}},
    {"id": "ad_004", "name": "[DEMO] Pet — Remarketing Dinâmico", "status": "ACTIVE",
     "campaign_id": "23843004",
     "insights": {"impressions": "22700", "clicks": "908", "spend": "275.00",
                  "reach": "21000", "frequency": "3.80", "cpm": "12.12", "ctr": "4.00",
                  "actions": [{"action_type": "purchase", "value": "31"}]}},
    {"id": "ad_005", "name": "[DEMO] Máscara Celulite — Ruim", "status": "ACTIVE",
     "campaign_id": "23843001",
     "insights": {"impressions": "9800", "clicks": "29", "spend": "120.00",
                  "reach": "9500", "frequency": "1.03", "cpm": "12.24", "ctr": "0.30",
                  "actions": [{"action_type": "purchase", "value": "0"}]}},
    {"id": "ad_006", "name": "[DEMO] Olho Massageador — Estável", "status": "ACTIVE",
     "campaign_id": "23843002",
     "insights": {"impressions": "14200", "clicks": "213", "spend": "88.00",
                  "reach": "13100", "frequency": "1.08", "cpm": "6.20", "ctr": "1.50",
                  "actions": [{"action_type": "purchase", "value": "8"}]}},
    {"id": "ad_007", "name": "[DEMO] Garrafa Pet — Escalável", "status": "ACTIVE",
     "campaign_id": "23843004",
     "insights": {"impressions": "28000", "clicks": "840", "spend": "165.00",
                  "reach": "26000", "frequency": "1.08", "cpm": "5.89", "ctr": "3.00",
                  "actions": [{"action_type": "purchase", "value": "18"}]}},
    {"id": "ad_008", "name": "[DEMO] Resistência Treino — Atenção", "status": "ACTIVE",
     "campaign_id": "23843003",
     "insights": {"impressions": "11500", "clicks": "138", "spend": "75.00",
                  "reach": "11000", "frequency": "1.05", "cpm": "6.52", "ctr": "1.20",
                  "actions": [{"action_type": "purchase", "value": "3"}]}},
]

DEMO_INSIGHTS = {
    "impressions": "182000", "clicks": "4074", "spend": "1336.50",
    "reach": "152600", "cpm": "7.34", "ctr": "2.24",
    "actions": [{"action_type": "purchase", "value": "100"}],
    "date_start": "2026-02-09", "date_stop": "2026-03-11"
}


# ── Helpers ────────────────────────────────────────────────────────────────────
async def _graph_get(path: str, params: dict) -> dict:
    params["access_token"] = META_TOKEN
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{BASE_URL}/{path}", params=params)
        r.raise_for_status()
        return r.json()


def _compute_badge(insights: dict) -> dict:
    """Calcula ROAS e atribui badge automático ao anúncio."""
    ctr       = float(insights.get("ctr", 0) or 0)
    spend     = float(insights.get("spend", 0) or 0)
    frequency = float(insights.get("frequency", 0) or 0)
    actions   = insights.get("actions", []) or []
    purchases = sum(int(a.get("value", 0)) for a in actions if a.get("action_type") == "purchase")
    roas      = (purchases * 150) / spend if spend > 0 else 0

    if roas >= 3.0 and ctr >= 1.5:
        badge = {"label": "ESCALÁVEL", "color": "green"}
    elif roas >= 2.0 and ctr >= 1.0:
        badge = {"label": "ESTÁVEL", "color": "blue"}
    elif roas >= 1.0:
        badge = {"label": "ATENÇÃO", "color": "yellow"}
    else:
        badge = {"label": "PAUSAR", "color": "red"}

    if frequency > 4 and badge["color"] != "red":
        badge = {"label": "PAUSAR", "color": "red"}

    return {**badge, "roas": round(roas, 2), "purchases": purchases,
            "ctr": round(ctr, 2), "spend": round(spend, 2), "frequency": round(frequency, 2)}


def _diagnose_ad(insights: dict) -> list:
    """Diagnóstico IA sem API externa."""
    ctr       = float(insights.get("ctr", 0) or 0)
    cpm       = float(insights.get("cpm", 0) or 0)
    frequency = float(insights.get("frequency", 0) or 0)
    actions   = insights.get("actions", []) or []
    spend     = float(insights.get("spend", 0) or 0)
    purchases = sum(int(a.get("value", 0)) for a in actions if a.get("action_type") == "purchase")
    roas      = (purchases * 150) / spend if spend > 0 else 0

    issues = []
    if ctr < 0.5:
        issues.append("Criativo muito fraco — teste novo ângulo de dor")
    elif ctr < 1.0:
        issues.append("Criativo abaixo do ideal — melhore o hook dos primeiros 3 segundos")
    if cpm > 60:
        issues.append("Público muito concorrido — expanda ou use lookalike 3-5%")
    if frequency > 3.5:
        issues.append("Público saturado — crie novo conjunto com interesse diferente")
    if roas < 1.5 and spend > 50:
        issues.append("Oferta fraca — teste preço menor ou adicione bônus")
    return issues


# ── ROUTES ─────────────────────────────────────────────────────────────────────
@router.get("/accounts")
async def list_accounts(current_user=Depends(get_current_user)):
    if META_TOKEN:
        try:
            data = await _graph_get("me/adaccounts",
                                    {"fields": "id,name,currency,account_status,amount_spent", "limit": 50})
            accounts = data.get("data", [])
            if accounts:
                return {"accounts": accounts, "demo": False}
        except Exception as e:
            logger.warning(f"Meta accounts falhou: {e} — usando DEMO")
    return {"accounts": DEMO_ACCOUNTS, "demo": True}


@router.get("/campaigns")
async def list_campaigns(account_id: str = "act_123456789",
                          current_user=Depends(get_current_user)):
    if META_TOKEN and not account_id.startswith("act_demo"):
        try:
            data = await _graph_get(f"{account_id}/campaigns",
                                    {"fields": "id,name,status,objective,daily_budget,lifetime_budget",
                                     "limit": 100})
            campaigns = data.get("data", [])
            if campaigns:
                return {"campaigns": campaigns, "demo": False}
        except Exception as e:
            logger.warning(f"Meta campaigns falhou: {e} — usando DEMO")
    return {"campaigns": DEMO_CAMPAIGNS, "demo": True}


@router.get("/ads")
async def list_ads(account_id: str = "act_123456789",
                   current_user=Depends(get_current_user)):
    if META_TOKEN and not account_id.startswith("act_demo"):
        try:
            data = await _graph_get(
                f"{account_id}/ads",
                {"fields": "id,name,status,campaign_id,effective_status,insights{impressions,clicks,spend,reach,frequency,cpm,ctr,actions}",
                 "limit": 100})
            ads = data.get("data", [])
            if ads:
                enriched = []
                for ad in ads:
                    ins = ad.get("insights", {})
                    if isinstance(ins, dict) and "data" in ins:
                        ins = ins["data"][0] if ins["data"] else {}
                    badge_data = _compute_badge(ins)
                    enriched.append({**ad, "badge": badge_data, "diagnostics": _diagnose_ad(ins)})
                return {"ads": enriched, "demo": False}
        except Exception as e:
            logger.warning(f"Meta ads falhou: {e} — usando DEMO")

    enriched_demo = []
    for ad in DEMO_ADS:
        ins = ad.get("insights", {})
        badge_data = _compute_badge(ins)
        enriched_demo.append({**ad, "badge": badge_data, "diagnostics": _diagnose_ad(ins)})
    return {"ads": enriched_demo, "demo": True}


@router.get("/insights")
async def get_insights(account_id: str = "act_123456789",
                        date_preset: str = "last_30d",
                        current_user=Depends(get_current_user)):
    if META_TOKEN and not account_id.startswith("act_demo"):
        try:
            data = await _graph_get(f"{account_id}/insights",
                                    {"fields": "impressions,clicks,spend,reach,cpm,ctr,actions",
                                     "date_preset": date_preset})
            insights_list = data.get("data", [])
            if insights_list:
                return {"insights": insights_list[0], "demo": False}
        except Exception as e:
            logger.warning(f"Meta insights falhou: {e} — usando DEMO")
    return {"insights": DEMO_INSIGHTS, "demo": True}


@router.get("/analysis")
async def get_analysis(current_user=Depends(get_current_user)):
    """Diagnóstico completo de todos os anúncios com IA própria."""
    using_demo = True
    ads = DEMO_ADS
    try:
        if META_TOKEN:
            data = await _graph_get("me/adaccounts", {"fields": "id", "limit": 1})
            accounts = data.get("data", [])
            if accounts:
                account_id = accounts[0]["id"]
                ads_data = await _graph_get(
                    f"{account_id}/ads",
                    {"fields": "id,name,status,insights{impressions,clicks,spend,cpm,ctr,frequency,actions}",
                     "limit": 100})
                real_ads = ads_data.get("data", [])
                if real_ads:
                    ads = real_ads
                    using_demo = False
    except Exception as e:
        logger.warning(f"Meta analysis falhou: {e} — usando DEMO")

    diagnostics = []
    for ad in ads:
        insights = ad.get("insights", {})
        if isinstance(insights, dict) and "data" in insights:
            insights = insights["data"][0] if insights["data"] else {}

        badge_data = _compute_badge(insights)
        issues     = _diagnose_ad(insights)
        ctr        = badge_data["ctr"]
        cpm        = float(insights.get("cpm", 0) or 0)

        health = "critical" if badge_data["color"] == "red" else \
                 "warning"  if badge_data["color"] == "yellow" or issues else "good"

        diagnostics.append({
            "ad_id":   ad.get("id"),
            "ad_name": ad.get("name"),
            "status":  ad.get("status"),
            "badge":   badge_data,
            "metrics": {
                "ctr": ctr, "cpm": cpm,
                "frequency": badge_data["frequency"],
                "spend": badge_data["spend"],
                "purchases": badge_data["purchases"],
                "roas": badge_data["roas"],
            },
            "issues": issues,
            "health": health,
        })

    return {
        "diagnostics": diagnostics,
        "summary": {
            "total_ads": len(diagnostics),
            "escalavel": sum(1 for d in diagnostics if d["badge"]["label"] == "ESCALÁVEL"),
            "estavel":   sum(1 for d in diagnostics if d["badge"]["label"] == "ESTÁVEL"),
            "atencao":   sum(1 for d in diagnostics if d["badge"]["label"] == "ATENÇÃO"),
            "pausar":    sum(1 for d in diagnostics if d["badge"]["label"] == "PAUSAR"),
            "critical":  sum(1 for d in diagnostics if d["health"] == "critical"),
            "warning":   sum(1 for d in diagnostics if d["health"] == "warning"),
            "good":      sum(1 for d in diagnostics if d["health"] == "good"),
        },
        "demo": using_demo
    }


# Mantém rota /analyze para compatibilidade
@router.post("/analyze")
@router.get("/analyze")
async def analyze_ads_compat(current_user=Depends(get_current_user)):
    return await get_analysis(current_user)
