"""
Facebook Ads Advanced v2.0
Coleta avançada de dados de Ads com análise de engagement e tendências
- Scraping com Apify
- Análise de engagement
- Detecção de produtos trending
- Correlação com produtos
"""
import httpx
import os
import logging
from typing import List, Dict, Optional
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)
APIFY_TOKEN = os.getenv("APIFY_TOKEN", "")
BASE = "https://api.apify.com/v2"


class FacebookAdsAdvanced:
    """Coleta avançada de dados de Facebook Ads."""

    async def search_ads_advanced(
        self,
        keyword: str,
        country: str = "BR",
        max_results: int = 100,
        min_engagement: int = 0
    ) -> List[Dict]:
        """
        Busca Ads com filtros avançados.
        
        Args:
            keyword: Palavra-chave para buscar
            country: País (ex: BR)
            max_results: Número máximo de resultados
            min_engagement: Engagement mínimo para filtrar
        """
        try:
            logger.info(f"🔍 Buscando Ads para '{keyword}' (max: {max_results})...")
            
            url = f"{BASE}/acts/apify~facebook-ads-scraper/run-sync-get-dataset-items"
            params = {
                "token": APIFY_TOKEN,
                "timeout": "240",
                "memory": "1024"
            }
            
            payload = {
                "searchTerms": [keyword],
                "country": country,
                "activeStatus": "ACTIVE",
                "maxAds": max_results,
                "proxyConfiguration": {"useApifyProxy": True}
            }
            
            async with httpx.AsyncClient(timeout=270) as client:
                response = await client.post(
                    url,
                    params=params,
                    json=payload
                )
                response.raise_for_status()
                
                ads = response.json()
                
                # Normalizar e filtrar
                normalized = [
                    self._normalize_ad(ad)
                    for ad in ads
                    if ad and self._normalize_ad(ad).get("total_engagement", 0) >= min_engagement
                ]
                
                logger.info(f"✅ {keyword}: {len(normalized)} ads encontrados (engagement >= {min_engagement})")
                return normalized
                
        except Exception as e:
            logger.error(f"❌ Erro ao buscar Ads para '{keyword}': {e}")
            return []

    async def search_ads_by_advertiser(
        self,
        advertiser_name: str,
        country: str = "BR",
        max_results: int = 50
    ) -> List[Dict]:
        """Busca Ads de um anunciante específico."""
        try:
            logger.info(f"🔍 Buscando Ads do anunciante '{advertiser_name}'...")
            
            url = f"{BASE}/acts/apify~facebook-ads-scraper/run-sync-get-dataset-items"
            params = {
                "token": APIFY_TOKEN,
                "timeout": "240",
                "memory": "1024"
            }
            
            payload = {
                "pageNames": [advertiser_name],
                "country": country,
                "activeStatus": "ACTIVE",
                "maxAds": max_results,
                "proxyConfiguration": {"useApifyProxy": True}
            }
            
            async with httpx.AsyncClient(timeout=270) as client:
                response = await client.post(url, params=params, json=payload)
                response.raise_for_status()
                
                ads = response.json()
                normalized = [self._normalize_ad(ad) for ad in ads if ad]
                
                logger.info(f"✅ Anunciante '{advertiser_name}': {len(normalized)} ads encontrados")
                return normalized
                
        except Exception as e:
            logger.error(f"❌ Erro ao buscar Ads do anunciante: {e}")
            return []

    async def get_trending_ads(
        self,
        keywords: List[str],
        country: str = "BR",
        min_engagement: int = 5000
    ) -> List[Dict]:
        """Retorna Ads em tendência (alto engagement)."""
        try:
            logger.info(f"🔥 Buscando Ads em tendência ({len(keywords)} keywords)...")
            
            all_ads = []
            for keyword in keywords:
                ads = await self.search_ads_advanced(
                    keyword,
                    country=country,
                    max_results=50,
                    min_engagement=min_engagement
                )
                all_ads.extend(ads)
            
            # Ordenar por engagement
            all_ads.sort(key=lambda x: x.get("total_engagement", 0), reverse=True)
            
            logger.info(f"✅ Total de Ads em tendência: {len(all_ads)}")
            return all_ads[:100]  # Top 100
            
        except Exception as e:
            logger.error(f"❌ Erro ao buscar Ads em tendência: {e}")
            return []

    async def analyze_ad_performance(self, ad: Dict) -> Dict:
        """Analisa performance de um Ad."""
        engagement = ad.get("total_engagement", 0)
        days_active = ad.get("days_active", 1)
        
        # Engagement por dia
        engagement_per_day = engagement / max(days_active, 1)
        
        # Performance label
        if engagement_per_day > 1000:
            performance = "Explosivo"
        elif engagement_per_day > 500:
            performance = "Muito Alto"
        elif engagement_per_day > 100:
            performance = "Alto"
        elif engagement_per_day > 20:
            performance = "Médio"
        else:
            performance = "Baixo"
        
        return {
            "engagement_per_day": round(engagement_per_day, 2),
            "performance": performance,
            "total_engagement": engagement,
            "days_active": days_active,
        }

    async def scrape_and_save(
        self,
        keyword: str,
        db,
        min_engagement: int = 0
    ):
        """Busca Ads e salva no banco de dados."""
        try:
            ads = await self.search_ads_advanced(
                keyword,
                max_results=100,
                min_engagement=min_engagement
            )
            
            if ads:
                await db.save_ads(keyword, ads)
                logger.info(f"✅ {len(ads)} ads salvos para '{keyword}'")
            else:
                logger.warning(f"⚠️  Nenhum ad encontrado para '{keyword}'")
                
        except Exception as e:
            logger.error(f"❌ Erro ao scrape e salvar Ads: {e}")

    # ── MÉTODOS PRIVADOS ──────────────────────────────────────────────────────

    def _normalize_ad(self, ad: Dict) -> Dict:
        """Normaliza dados de Ad da API."""
        try:
            # Tipo criativo
            has_video = bool(ad.get("videoHdUrl") or ad.get("videoDUrl"))
            images = ad.get("images", [])
            if isinstance(images, list) and len(images) > 1:
                creative_type = "Carrossel"
            elif has_video:
                creative_type = "Vídeo"
            else:
                creative_type = "Imagem"
            
            # Engagement
            likes = ad.get("likeCount", 0) or 0
            comments = (ad.get("commentCount", 0) or 0) * 3
            shares = (ad.get("shareCount", 0) or 0) * 5
            total_engagement = likes + comments + shares
            
            # Dias ativos
            start_date = ad.get("startDate", "")
            days_active = 0
            if start_date:
                try:
                    delta = datetime.now() - datetime.strptime(start_date[:10], "%Y-%m-%d")
                    days_active = max(0, delta.days)
                except:
                    pass
            
            # Imagem
            image_url = ""
            if images and isinstance(images, list) and images:
                img_item = images[0]
                image_url = img_item.get("url", "") if isinstance(img_item, dict) else str(img_item)
            
            # Engagement label
            if total_engagement > 50000:
                engagement_label = "Explosivo"
            elif total_engagement > 10000:
                engagement_label = "Muito Alto"
            elif total_engagement > 3000:
                engagement_label = "Alto"
            elif total_engagement > 500:
                engagement_label = "Médio"
            else:
                engagement_label = "Baixo"
            
            return {
                "ad_id": ad.get("adId", ad.get("id", "")),
                "title": (ad.get("adBodyText", "") or "")[:200],
                "advertiser": ad.get("pageName", ""),
                "creative_type": creative_type,
                "image_url": image_url,
                "video_url": ad.get("videoHdUrl", "") or ad.get("videoDUrl", ""),
                "days_active": days_active,
                "is_active": True,
                "engagement": engagement_label,
                "total_engagement": total_engagement,
                "likes": likes,
                "comments": ad.get("commentCount", 0) or 0,
                "shares": ad.get("shareCount", 0) or 0,
                "fb_library_url": f"https://www.facebook.com/ads/library/?id={ad.get('adId','')}",
                "platform": "facebook",
                "scraped_at": datetime.now().isoformat(),
            }
        except Exception as e:
            logger.error(f"Erro ao normalizar Ad: {e}")
            return {}
