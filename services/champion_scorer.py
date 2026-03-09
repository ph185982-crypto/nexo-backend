"""
Champion Scorer v3.0
Sistema avançado de scoring para identificar produtos campeões
- Scoring multidimensional
- Análise de viabilidade
- Detecção de tendências
- Cálculo de ROI estimado
"""
import logging
from typing import Dict, List
from datetime import datetime

logger = logging.getLogger(__name__)


class ChampionScorer:
    """Sistema avançado de scoring para produtos."""

    async def calculate_champion_score(
        self,
        product: Dict,
        ads_data: Optional[Dict] = None,
        market_data: Optional[Dict] = None
    ) -> Dict:
        """
        Calcula score de campeão multidimensional.
        
        Dimensões:
        - Profitabilidade (0-25)
        - Demanda (0-25)
        - Viabilidade (0-20)
        - Tendência (0-15)
        - Presença em Ads (0-15)
        
        Total: 0-100
        """
        try:
            score = 0
            breakdown = {}
            
            # 1. PROFITABILIDADE (0-25)
            profit_score = self._score_profitability(product)
            score += profit_score
            breakdown["profitability"] = profit_score
            
            # 2. DEMANDA (0-25)
            demand_score = self._score_demand(product)
            score += demand_score
            breakdown["demand"] = demand_score
            
            # 3. VIABILIDADE (0-20)
            viability_score = self._score_viability(product)
            score += viability_score
            breakdown["viability"] = viability_score
            
            # 4. TENDÊNCIA (0-15)
            trend_score = self._score_trend(product)
            score += trend_score
            breakdown["trend"] = trend_score
            
            # 5. PRESENÇA EM ADS (0-15)
            ads_score = self._score_ads_presence(product, ads_data)
            score += ads_score
            breakdown["ads"] = ads_score
            
            # Normalizar para 0-100
            final_score = min(100, max(0, score))
            
            return {
                "champion_score": final_score,
                "breakdown": breakdown,
                "is_champion": final_score >= 85,
                "tier": self._get_tier(final_score),
                "recommendation": self._get_recommendation(final_score, breakdown),
            }
            
        except Exception as e:
            logger.error(f"Erro ao calcular champion score: {e}")
            return {
                "champion_score": 0,
                "breakdown": {},
                "is_champion": False,
                "tier": "Unknown",
                "recommendation": "Erro no cálculo",
            }

    async def estimate_roi(self, product: Dict) -> Dict:
        """Estima ROI do produto."""
        try:
            # Dados do produto
            cost_brl = product.get("total_cost_brl", 0)
            sell_price = product.get("suggested_sell_price", 0)
            markup = product.get("markup", 0)
            
            if cost_brl <= 0 or sell_price <= 0:
                return {
                    "estimated_roi": 0,
                    "breakeven_units": 0,
                    "profit_per_unit": 0,
                }
            
            # Lucro por unidade
            profit_per_unit = sell_price - cost_brl
            
            # ROI percentual
            roi_percentage = ((sell_price - cost_brl) / cost_brl) * 100
            
            # Unidades para break-even (assumindo custo fixo de R$500)
            fixed_costs = 500
            breakeven_units = int(fixed_costs / profit_per_unit) if profit_per_unit > 0 else 0
            
            # Estimativa de vendas (baseado em orders_count global)
            orders_count = product.get("orders_count", 0)
            estimated_monthly_sales = min(100, max(5, int(orders_count / 1000)))
            
            # Lucro mensal estimado
            estimated_monthly_profit = (estimated_monthly_sales * profit_per_unit) - fixed_costs
            
            # Payback period (meses)
            payback_months = 1 if estimated_monthly_profit > 0 else 999
            
            return {
                "estimated_roi": round(roi_percentage, 2),
                "profit_per_unit": round(profit_per_unit, 2),
                "breakeven_units": breakeven_units,
                "estimated_monthly_sales": estimated_monthly_sales,
                "estimated_monthly_profit": round(estimated_monthly_profit, 2),
                "payback_months": payback_months,
            }
            
        except Exception as e:
            logger.error(f"Erro ao estimar ROI: {e}")
            return {
                "estimated_roi": 0,
                "breakeven_units": 0,
                "profit_per_unit": 0,
            }

    # ── MÉTODOS DE SCORING ────────────────────────────────────────────────────

    def _score_profitability(self, product: Dict) -> float:
        """Score de profitabilidade (0-25)."""
        markup = product.get("markup", 0)
        
        if markup >= 5:
            return 25
        elif markup >= 4:
            return 20
        elif markup >= 3.5:
            return 15
        elif markup >= 3:
            return 10
        elif markup >= 2.5:
            return 5
        else:
            return 0

    def _score_demand(self, product: Dict) -> float:
        """Score de demanda (0-25)."""
        orders = product.get("orders_count", 0)
        rating = product.get("rating", 0)
        
        # Baseado em orders_count
        if orders >= 100000:
            orders_score = 15
        elif orders >= 50000:
            orders_score = 12
        elif orders >= 10000:
            orders_score = 9
        elif orders >= 1000:
            orders_score = 6
        elif orders >= 100:
            orders_score = 3
        else:
            orders_score = 0
        
        # Baseado em rating
        if rating >= 4.8:
            rating_score = 10
        elif rating >= 4.5:
            rating_score = 8
        elif rating >= 4.0:
            rating_score = 5
        else:
            rating_score = 0
        
        return min(25, orders_score + rating_score)

    def _score_viability(self, product: Dict) -> float:
        """Score de viabilidade (0-20)."""
        br_status = product.get("br_status", "Já Vendido")
        price = product.get("price_usd", 0)
        
        # Status no Brasil
        if br_status == "Não Vendido":
            status_score = 15
        elif br_status == "Pouco Vendido":
            status_score = 10
        else:
            status_score = 5
        
        # Preço (produtos baratos são mais viáveis)
        if price <= 10:
            price_score = 5
        elif price <= 20:
            price_score = 4
        elif price <= 50:
            price_score = 3
        else:
            price_score = 0
        
        return min(20, status_score + price_score)

    def _score_trend(self, product: Dict) -> float:
        """Score de tendência (0-15)."""
        # Baseado em score do produto (que já incorpora trends)
        product_score = product.get("score", 0)
        
        if product_score >= 90:
            return 15
        elif product_score >= 80:
            return 12
        elif product_score >= 70:
            return 9
        elif product_score >= 60:
            return 6
        elif product_score >= 50:
            return 3
        else:
            return 0

    def _score_ads_presence(self, product: Dict, ads_data: Optional[Dict] = None) -> float:
        """Score de presença em Ads (0-15)."""
        if not ads_data:
            return 0
        
        engagement = ads_data.get("ads_engagement", 0)
        ads_count = ads_data.get("ads_count", 0)
        
        # Baseado em engagement
        if engagement > 50000:
            engagement_score = 10
        elif engagement > 10000:
            engagement_score = 8
        elif engagement > 1000:
            engagement_score = 5
        else:
            engagement_score = 0
        
        # Baseado em quantidade de Ads
        if ads_count >= 10:
            count_score = 5
        elif ads_count >= 5:
            count_score = 3
        elif ads_count >= 1:
            count_score = 1
        else:
            count_score = 0
        
        return min(15, engagement_score + count_score)

    # ── MÉTODOS AUXILIARES ────────────────────────────────────────────────────

    def _get_tier(self, score: float) -> str:
        """Retorna tier baseado no score."""
        if score >= 95:
            return "🏆 Lendário"
        elif score >= 85:
            return "🥇 Campeão"
        elif score >= 75:
            return "🥈 Muito Bom"
        elif score >= 65:
            return "🥉 Bom"
        elif score >= 50:
            return "👍 Aceitável"
        else:
            return "❌ Não Recomendado"

    def _get_recommendation(self, score: float, breakdown: Dict) -> str:
        """Retorna recomendação baseada no score."""
        if score >= 95:
            return "Produto excepcional! Recomendado para importação imediata."
        elif score >= 85:
            return "Produto campeão! Excelente oportunidade de negócio."
        elif score >= 75:
            return "Produto muito bom. Considere importar com atenção ao mercado."
        elif score >= 65:
            return "Produto bom. Pesquise mais antes de importar."
        elif score >= 50:
            return "Produto aceitável. Requer análise detalhada."
        else:
            return "Produto não recomendado. Procure outras oportunidades."


# Instância global
champion_scorer = ChampionScorer()
