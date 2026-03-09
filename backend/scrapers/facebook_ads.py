"""Facebook Ads Library Spy via Apify"""
import httpx, os, logging
from typing import List, Dict
from datetime import datetime

logger = logging.getLogger(__name__)
APIFY_TOKEN = os.getenv("APIFY_TOKEN", "")
BASE = "https://api.apify.com/v2"


class FacebookAdsSpy:
    async def search_ads(self, keyword: str, country="BR", max_results=50) -> List[Dict]:
        try:
            url = f"{BASE}/acts/apify~facebook-ads-scraper/run-sync-get-dataset-items?token={APIFY_TOKEN}&timeout=240&memory=1024"
            async with httpx.AsyncClient(timeout=270) as c:
                r = await c.post(url, json={"searchTerms": [keyword], "country": country, "activeStatus": "ACTIVE", "maxAds": max_results, "proxyConfiguration": {"useApifyProxy": True}})
                r.raise_for_status()
                return [self._norm(ad) for ad in r.json() if ad]
        except Exception as e:
            logger.error(f"FB Ads '{keyword}': {e}")
            return []

    async def scrape_and_save(self, keyword: str):
        from database.db import Database
        db = Database()
        ads = await self.search_ads(keyword)
        if ads:
            await db.save_ads(keyword, ads)

    def _norm(self, ad) -> Dict:
        has_video = bool(ad.get("videoHdUrl") or ad.get("videoDUrl"))
        creative_type = "Vídeo" if has_video else ("Carrossel" if len(ad.get("images", [])) > 1 else "Imagem")
        eng = ad.get("likeCount", 0) or 0 + (ad.get("commentCount", 0) or 0) * 3 + (ad.get("shareCount", 0) or 0) * 5
        eng_label = "Explosivo" if eng > 50000 else "Muito Alto" if eng > 10000 else "Alto" if eng > 3000 else "Médio" if eng > 500 else "Baixo"
        start = ad.get("startDate", "")
        days = 0
        if start:
            try:
                delta = datetime.now() - datetime.strptime(start[:10], "%Y-%m-%d")
                days = max(0, delta.days)
            except: pass
        img = ""
        if ad.get("images") and isinstance(ad["images"], list) and ad["images"]:
            img_item = ad["images"][0]
            img = img_item.get("url", "") if isinstance(img_item, dict) else str(img_item)
        return {
            "ad_id": ad.get("adId", ad.get("id", "")),
            "title": (ad.get("adBodyText", "") or "")[:200],
            "advertiser": ad.get("pageName", ""),
            "creative_type": creative_type,
            "image_url": img,
            "video_url": ad.get("videoHdUrl", ""),
            "days_active": days,
            "is_active": True,
            "engagement": eng_label,
            "total_engagement": eng,
            "fb_library_url": f"https://www.facebook.com/ads/library/?id={ad.get('adId','')}",
            "platform": "facebook",
        }
