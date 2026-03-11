"""
Meta Ads Router — tenta API real, cai para DEMO se falhar.
"""
import httpx, os, logging
from fastapi import APIRouter, Depends
from database.db import get_db
from routers.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()

META_TOKEN = os.getenv("META_ADS_TOKEN", "")
META_VERSION = "v19.0"
BASE_URL = f"https://graph.facebook.com/{META_VERSION}"

# ── DEMO DATA ──────────────────────────────────────────────────────────────
DEMO_ACCOUNTS = [
    {"id": "act_123456789", "name": "NEXO Demo Account", "currency": "BRL",
     "account_status": 1, "amount_spent": "1500.00"}
]

DEMO_CAMPAIGNS = [
    {"id": "23843001", "name": "Pistola Massagem — Conversão", "status": "ACTIVE",
     "objective": "OUTCOME_SALES", "daily_budget": "5000", "lifetime_budget": None},
    {"id": "23843002", "name": "Escova Alisadora — Tráfego", "status": "ACTIVE",
     "objective": "OUTCOME_TRAFFIC", "daily_budget": "3000", "lifetime_budget": None},
    {"id": "23843003", "name": "Máscara LED — Engajamento", "status": "PAUSED",
     "objective": "OUTCOME_ENGAGEMENT", "daily_budget": "2000", "lifetime_budget": None},
    {"id": "23843004", "name": "Pet Store — Remarketing", "status": "ACTIVE",
     "objective": "OUTCOME_SALES", "daily_budget": "4000", "lifetime_budget": None},
]

DEMO_ADS = [
    {"id": "ad_001", "name": "Pistola — Vídeo UGC", "status": "ACTIVE",
     "campaign_id": "23843001", "effective_status": "ACTIVE",
     "insights": {"impressions": "45200", "clicks": "1356", "spend": "320.50",
                  "reach": "38000", "frequency": "1.19", "cpm": "7.09", "ctr": "3.00",
                  "actions": [{"action_type": "purchase", "value": "23"}]}},
    {"id": "ad_002", "name": "Escova — Carrossel", "status": "ACTIVE",
     "campaign_id": "23843002", "effective_status": "ACTIVE",
     "insights": {"impressions": "32100", "clicks": "642", "spend": "198.00",
                  "reach": "29000", "frequency": "1.11", "cpm": "6.17", "ctr": "2.00",
                  "actions": [{"action_type": "purchase", "value": "12"}]}},
    {"id": "ad_003", "name": "LED — Estático", "status": "PAUSED",
     "campaign_id": "23843003", "effective_status": "CAMPAIGN_PAUSED",
     "insights": {"impressions": "18500", "clicks": "148", "spend": "95.00",
                  "reach": "17200", "frequency": "1.08", "cpm": "5.14", "ctr": "0.80",
                  "actions": [{"action_type": "purchase", "value": "5"}]}},
    {"id": "ad_004", "name": "Pet — Remarketing Dinâmico", "status": "ACTIVE",
     "campaign_id": "23843004", "effective_status": "ACTIVE",
     "insights": {"impressions": "22700", "clicks": "908", "spend": "275.00",
                  "reach": "21000", "frequency": "1.08", "cpm": "12.12", "ctr": "4.00",
                  "actions": [{"action_type": "purchase", "value": "31"}]}},
]

DEMO_INSIGHTS = {
    "impressions": "118500", "clicks": "3054", "spend": "888.50",
    "reach": "95000", "cpm": "7.50", "ctr": "2.58",
    "actions": [{"action_type": "purchase", "value": "71"}],
    "date_start": "2024-01-01", "date_stop": "2024-01-31"
}


# ── helpers ────────────────────────────────────────────────────────────────
async def _graph_get(path: str, params: dict) -> dict:
    params["access_token"] = META_TOKEN
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{BASE_URL}/{path}", params=params)
        r.raise_for_status()
        return r.json()


# ── ROUTES ─────────────────────────────────────────────────────────────────
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
            data = await _graph_get(f"{account_id}/ads",
                                    {"fields": "id,name,status,campaign_id,effective_status",
                                     "limit": 100})
            ads = data.get("data", [])
            if ads:
                return {"ads": ads, "demo": False}
        except Exception as e:
            logger.warning(f"Meta ads falhou: {e} — usando DEMO")
    return {"ads": DEMO_ADS, "demo": True}


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


@router.get("/ad/{ad_id}/insights")
async def get_ad_insights(ad_id: str, current_user=Depends(get_current_user)):
    demo_ad = next((a for a in DEMO_ADS if a["id"] == ad_id), None)
    if META_TOKEN and not ad_id.startswith("ad_0"):
        try:
            data = await _graph_get(f"{ad_id}/insights",
                                    {"fields": "impressions,clicks,spend,reach,frequency,cpm,ctr,actions"})
            insights_list = data.get("data", [])
            if insights_list:
                return {"insights": insights_list[0], "demo": False}
        except Exception as e:
            logger.warning(f"Meta ad insights falhou: {e} — usando DEMO")
    if demo_ad:
        return {"insights": demo_ad.get("insights", {}), "demo": True}
    return {"insights": {}, "demo": True}


@router.post("/analyze")
async def analyze_ads(current_user=Depends(get_current_user)):
    """Analisa todos os anúncios e retorna diagnóstico."""
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
        logger.warning(f"Meta analyze falhou: {e} — usando DEMO")

    diagnostics = []
    for ad in ads:
        insights = ad.get("insights", {})
        if isinstance(insights, dict) and "data" in insights:
            insights = insights["data"][0] if insights["data"] else {}

        ctr = float(insights.get("ctr", 0) or 0)
        cpm = float(insights.get("cpm", 0) or 0)
        frequency = float(insights.get("frequency", 0) or 0)
        spend = float(insights.get("spend", 0) or 0)

        actions = insights.get("actions", []) or []
        purchases = sum(int(a.get("value", 0)) for a in actions if a.get("action_type") == "purchase")
        roas = (purchases * 150) / spend if spend > 0 else 0

        issues = []
        if ctr < 1.0:
            issues.append({"type": "low_ctr", "severity": "high",
                           "message": f"CTR baixo ({ctr:.2f}%) — criativo fraco, testar novos formatos"})
        if cpm > 50:
            issues.append({"type": "high_cpm", "severity": "medium",
                           "message": f"CPM alto (R${cpm:.2f}) — público saturado, expandir audiência"})
        if frequency > 3:
            issues.append({"type": "high_frequency", "severity": "medium",
                           "message": f"Frequência alta ({frequency:.1f}) — audiência cansada, trocar criativo"})
        if roas < 2 and spend > 50:
            issues.append({"type": "low_roas", "severity": "high",
                           "message": f"ROAS baixo ({roas:.1f}x) — revisar oferta e página de destino"})

        diagnostics.append({
            "ad_id": ad.get("id"),
            "ad_name": ad.get("name"),
            "status": ad.get("status"),
            "metrics": {"ctr": ctr, "cpm": cpm, "frequency": frequency,
                        "spend": spend, "purchases": purchases, "roas": round(roas, 2)},
            "issues": issues,
            "health": "critical" if any(i["severity"] == "high" for i in issues)
                       else "warning" if issues else "good"
        })

    return {
        "diagnostics": diagnostics,
        "summary": {
            "total_ads": len(diagnostics),
            "critical": sum(1 for d in diagnostics if d["health"] == "critical"),
            "warning": sum(1 for d in diagnostics if d["health"] == "warning"),
            "good": sum(1 for d in diagnostics if d["health"] == "good"),
        },
        "demo": using_demo
    }
