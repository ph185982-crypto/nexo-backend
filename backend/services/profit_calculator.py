"""Profit Calculator — live USD/BRL rate + full import cost simulation"""
import httpx, os, logging
from typing import Optional, Dict
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)
_rate_cache = {"rate": None, "at": None}


class ProfitCalculator:
    async def get_live_usd_rate(self) -> float:
        global _rate_cache
        now = datetime.now()
        if _rate_cache["rate"] and _rate_cache["at"] and (now - _rate_cache["at"]) < timedelta(hours=1):
            return _rate_cache["rate"]
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                r = await c.get("https://economia.awesomeapi.com.br/json/last/USD-BRL")
                rate = float(r.json()["USDBRL"]["bid"])
                _rate_cache = {"rate": rate, "at": now}
                return rate
        except Exception as e:
            logger.warning(f"Live rate failed: {e}")
            return float(os.getenv("USD_TO_BRL_FALLBACK", "6.0"))

    def calculate(self, cost_usd: float, usd_brl: Optional[float] = None, freight_usd=5.0, target_markup=3.0, marketplace="shopee") -> Dict:
        rate = usd_brl or float(os.getenv("USD_TO_BRL", "6.0"))
        return self._compute(cost_usd, rate, freight_usd, target_markup, marketplace)

    async def simulate(self, cost_usd: float, usd_brl: Optional[float] = None, freight=5.0, tax=0.0, markup=3.0, qty=100, marketplace="shopee") -> Dict:
        rate = usd_brl or await self.get_live_usd_rate()
        result = self._compute(cost_usd, rate, freight, markup, marketplace)
        if tax > 0:
            result["tax_brl"] = tax
            result["total_cost_brl"] = result["cost_brl"] + result["freight_brl"] + tax
            result["suggested_sell_price"] = round(result["total_cost_brl"] * markup, 2)
            result["profit_per_unit"] = round(result["suggested_sell_price"] - result["total_cost_brl"], 2)
            result["markup"] = round(result["suggested_sell_price"] / result["total_cost_brl"], 2)
        invest = result["total_cost_brl"] * qty
        revenue = result["suggested_sell_price"] * qty
        gross = revenue - invest
        result["simulation"] = {"qty": qty, "total_investment": round(invest, 2), "total_revenue": round(revenue, 2), "gross_profit": round(gross, 2), "roi_pct": round((gross / invest) * 100, 1) if invest > 0 else 0, "break_even_units": max(1, round(invest / result["suggested_sell_price"]))}
        result["usd_brl_rate"] = rate
        result["viable"] = result["markup"] >= 3.0
        result["rating"] = "Excelente" if result["markup"] >= 4.5 else "Ótimo" if result["markup"] >= 3.5 else "Bom" if result["markup"] >= 3.0 else "Marginal"
        return result

    def _compute(self, cost_usd, usd_brl, freight_usd, markup, marketplace) -> Dict:
        cost_brl = round(cost_usd * usd_brl, 2)
        freight_brl = round(freight_usd * usd_brl, 2)
        tax_rate = 0.20 if (cost_usd + freight_usd) <= 50 else 0.24
        tax_brl = round(cost_brl * tax_rate, 2)
        total = round(cost_brl + freight_brl + tax_brl, 2)
        fee = {"shopee": 0.14, "mercadolivre_classico": 0.13, "mercadolivre_premium": 0.18, "amazon": 0.15, "magalu": 0.16, "proprio": 0.0}.get(marketplace, 0.14)
        sell = round(total * markup, 2)
        profit = round(sell - total, 2)
        margin = round((profit / sell) * 100, 1) if sell > 0 else 0
        return {"cost_usd": cost_usd, "cost_brl": cost_brl, "freight_usd": freight_usd, "freight_brl": freight_brl, "tax_brl": tax_brl, "tax_rate_pct": round(tax_rate * 100, 1), "total_cost_brl": total, "marketplace": marketplace, "marketplace_fee_pct": round(fee * 100, 1), "suggested_sell_price": sell, "profit_per_unit": profit, "margin_pct": margin, "markup": round(sell / total, 2) if total > 0 else 0}
