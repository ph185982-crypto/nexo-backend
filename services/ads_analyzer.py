"""
NEXO Ads Analyzer v2.0
Análise avançada de Ads para identificar produtos campeões
- Correlação entre Ads e produtos
- Análise de engagement
- Identificação de tendências de Ads
"""
import logging
from typing import List, Dict, Optional
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


class AdsAnalyzer:
    """Analisa dados de Ads para identificar produtos campeões."""

    async def correlate_ads_with_products(self, db) -> List[Dict]:
        """
        Correlaciona Ads com produtos para identificar campeões.
        Retorna produtos que têm Ads ativos com alto engagement.
        """
        try:
            logger.info("🔗 Correlacionando Ads com produtos...")
            
            # Buscar todos os Ads ativos
            ads = await db.get_active_ads()
            
            if not ads:
                logger.warning("⚠️  Nenhum Ad ativo encontrado")
                return []
            
            # Agrupar Ads por título/produto
            ads_by_product = {}
            for ad in ads:
                title = ad.get("title", "")
                if title not in ads_by_product:
                    ads_by_product[title] = []
                ads_by_product[title].append(ad)
            
            # Buscar produtos correspondentes
            correlated = []
            for title, ads_list in ads_by_product.items():
                # Buscar produto por título similar
                products = await db.get_products_by_title_similarity(title)
                
                if products:
                    product = products[0]  # Melhor match
                    
                    # Calcular métricas de Ads
                    ads_metrics = self._calculate_ads_metrics(ads_list)
                    
                    # Enriquecer produto com dados de Ads
                    enriched = {
                        **product,
                        "ads_count": len(ads_list),
                        "ads_engagement": ads_metrics["avg_engagement"],
                        "ads_days_active": ads_metrics["avg_days_active"],
                        "ads_creative_types": ads_metrics["creative_types"],
                        "ads_quality_score": ads_metrics["quality_score"],
                        "is_ads_champion": ads_metrics["quality_score"] >= 8.0,
                    }
                    
                    correlated.append(enriched)
            
            logger.info(f"✅ Correlação concluída: {len(correlated)} produtos com Ads")
            return correlated
            
        except Exception as e:
            logger.error(f"❌ Erro ao correlacionar Ads: {e}")
            return []

    async def analyze_ads_trends(self, db) -> Dict:
        """
        Analisa tendências de Ads para identificar oportunidades.
        """
        try:
            logger.info("📊 Analisando tendências de Ads...")
            
            # Buscar Ads dos últimos 7 dias
            ads = await db.get_ads_by_date_range(
                start_date=datetime.now() - timedelta(days=7)
            )
            
            if not ads:
                logger.warning("⚠️  Nenhum Ad encontrado nos últimos 7 dias")
                return {}
            
            # Análises
            analysis = {
                "total_ads": len(ads),
                "active_ads": len([a for a in ads if a.get("is_active")]),
                "avg_engagement": sum(a.get("total_engagement", 0) for a in ads) / len(ads),
                "top_creative_types": self._get_top_creative_types(ads),
                "top_advertisers": self._get_top_advertisers(ads),
                "engagement_distribution": self._get_engagement_distribution(ads),
                "trending_keywords": self._get_trending_keywords(ads),
            }
            
            logger.info(f"✅ Análise concluída: {analysis['total_ads']} Ads analisados")
            return analysis
            
        except Exception as e:
            logger.error(f"❌ Erro ao analisar tendências: {e}")
            return {}

    async def identify_winning_products(self, db, min_score: int = 85) -> List[Dict]:
        """
        Identifica produtos vencedores baseado em:
        - Score de produto
        - Presença em Ads
        - Engagement em Ads
        - Markup e lucro
        """
        try:
            logger.info(f"🏆 Identificando produtos vencedores (score >= {min_score})...")
            
            # Buscar produtos com score alto
            products = await db.get_products(sort_by="score", limit=500)
            products = [p for p in products if p.get("score", 0) >= min_score]
            
            # Correlacionar com Ads
            correlated = await self.correlate_ads_with_products(db)
            correlated_titles = {p.get("title") for p in correlated}
            
            # Marcar produtos com Ads
            winners = []
            for p in products:
                title = p.get("title", "")
                has_ads = any(t in title or title in t for t in correlated_titles)
                
                winner_score = self._calculate_winner_score(p, has_ads)
                
                if winner_score >= 8.0:
                    winners.append({
                        **p,
                        "winner_score": winner_score,
                        "has_ads": has_ads,
                        "is_champion": True,
                    })
            
            # Ordenar por winner_score
            winners.sort(key=lambda x: x["winner_score"], reverse=True)
            
            logger.info(f"✅ Identificação concluída: {len(winners)} produtos vencedores")
            return winners[:50]  # Top 50
            
        except Exception as e:
            logger.error(f"❌ Erro ao identificar vencedores: {e}")
            return []

    # ── MÉTODOS AUXILIARES ────────────────────────────────────────────────────

    def _calculate_ads_metrics(self, ads_list: List[Dict]) -> Dict:
        """Calcula métricas agregadas de Ads."""
        if not ads_list:
            return {
                "avg_engagement": 0,
                "avg_days_active": 0,
                "creative_types": [],
                "quality_score": 0,
            }
        
        # Engagement médio
        total_engagement = sum(a.get("total_engagement", 0) for a in ads_list)
        avg_engagement = total_engagement / len(ads_list)
        
        # Dias ativos médio
        avg_days = sum(a.get("days_active", 0) for a in ads_list) / len(ads_list)
        
        # Tipos criativos
        creative_types = list(set(a.get("creative_type", "") for a in ads_list))
        
        # Score de qualidade (0-10)
        quality_score = min(10, (avg_engagement / 10000) + (avg_days / 30) + len(creative_types))
        
        return {
            "avg_engagement": avg_engagement,
            "avg_days_active": avg_days,
            "creative_types": creative_types,
            "quality_score": quality_score,
        }

    def _calculate_winner_score(self, product: Dict, has_ads: bool) -> float:
        """Calcula score de vencedor para um produto."""
        score = 0.0
        
        # Score do produto (0-5)
        product_score = product.get("score", 0) / 20
        score += min(5, product_score)
        
        # Markup (0-2)
        markup = product.get("markup", 0)
        if markup >= 5:
            score += 2.0
        elif markup >= 4:
            score += 1.5
        elif markup >= 3:
            score += 1.0
        
        # Status no Brasil (0-1.5)
        br_status = product.get("br_status", "Não Vendido")
        if br_status == "Não Vendido":
            score += 1.5
        elif br_status == "Pouco Vendido":
            score += 1.0
        
        # Presença em Ads (0-1.5)
        if has_ads:
            score += 1.5
        
        # Ads engagement (0-1)
        ads_engagement = product.get("ads_engagement", 0)
        if ads_engagement > 5000:
            score += 1.0
        elif ads_engagement > 1000:
            score += 0.5
        
        return min(10, score)

    def _get_top_creative_types(self, ads: List[Dict]) -> List[str]:
        """Retorna tipos criativos mais usados."""
        from collections import Counter
        types = [a.get("creative_type", "Unknown") for a in ads]
        counter = Counter(types)
        return [t for t, _ in counter.most_common(5)]

    def _get_top_advertisers(self, ads: List[Dict]) -> List[str]:
        """Retorna top anunciantes."""
        from collections import Counter
        advertisers = [a.get("advertiser", "Unknown") for a in ads]
        counter = Counter(advertisers)
        return [a for a, _ in counter.most_common(10)]

    def _get_engagement_distribution(self, ads: List[Dict]) -> Dict:
        """Retorna distribuição de engagement."""
        engagements = [a.get("total_engagement", 0) for a in ads]
        
        return {
            "min": min(engagements) if engagements else 0,
            "max": max(engagements) if engagements else 0,
            "avg": sum(engagements) / len(engagements) if engagements else 0,
            "median": sorted(engagements)[len(engagements)//2] if engagements else 0,
        }

    def _get_trending_keywords(self, ads: List[Dict]) -> List[str]:
        """Extrai keywords trending dos Ads."""
        from collections import Counter
        import re
        
        keywords = []
        for ad in ads:
            title = ad.get("title", "")
            # Extrair palavras-chave (palavras com 4+ caracteres)
            words = re.findall(r'\b\w{4,}\b', title.lower())
            keywords.extend(words)
        
        counter = Counter(keywords)
        return [kw for kw, _ in counter.most_common(20)]
