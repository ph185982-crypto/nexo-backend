"""
NEXO Mining Scheduler v5.0
Máquina de mineração de produtos com scraping agressivo e inteligente
- Scan contínuo a cada 3h (8x por dia)
- Ads scan a cada 2h (12x por dia)
- Trends a cada 4h
- Digest de campeões a cada 6h
"""
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

# ── KEYWORDS EXPANDIDAS PARA MINERAÇÃO ────────────────────────────────────────
# Categorias de alto potencial
MINING_KEYWORDS_EN = [
    # ── ELETRÔNICOS TRENDING ──────────────────────────────────────────────────
    "mini projector portable 4k", "hair dryer brush rotating", "massage gun compact",
    "led magnetic light rechargeable", "cable organizer magnetic", "smart home gadget",
    "wireless charging pad fast", "portable blender usb", "fitness recovery tool",
    "ring light selfie professional", "neck massager electric", "smart watch fitness",
    "camera lapel wireless", "keyboard mechanical mini", "security camera wifi 4k",
    
    # ── BELEZA & SAÚDE ────────────────────────────────────────────────────────
    "facial massage device led", "hair removal ipl laser", "teeth whitening strips",
    "jade roller gua sha", "electric scrubber body", "massage gun percussion",
    "cervical pillow memory foam", "fitness tracker smart band", "electric neck massager",
    
    # ── CASA & ORGANIZAÇÃO ────────────────────────────────────────────────────
    "mini blender portable usb", "steam cleaner high pressure", "vacuum cleaner cordless",
    "cable organizer magnetic", "desk lamp led usb", "rgb led strip wifi",
    "smart kettle temperature", "glass storage containers", "aroma diffuser ultrasonic",
    
    # ── ESPORTE & LIFESTYLE ───────────────────────────────────────────────────
    "yoga mat non slip", "jump rope digital counter", "resistance bands set",
    "smart water bottle hydration", "ergonomic pillow cervical",
    
    # ── ACESSÓRIOS POPULARES ──────────────────────────────────────────────────
    "phone holder magnetic car", "backpack notebook 15.6", "thermal lunch bag",
    "screen protector hydrogel", "phone case iphone magsafe",
]

MINING_KEYWORDS_PT = [
    # ── ELETRÔNICOS ───────────────────────────────────────────────────────────
    "projetor portatil 4k", "escova secadora rotativa", "massageador muscular",
    "luz led magnetica", "organizador cabo", "gadget casa inteligente",
    "carregador sem fio rapido", "blender portatil usb", "ferramenta recuperacao",
    "ring light profissional", "massageador cervical", "relogio inteligente",
    "camera lapela wireless", "teclado mecanico mini", "camera seguranca wifi 4k",
    
    # ── BELEZA ────────────────────────────────────────────────────────────────
    "massageador facial led", "depilador ipl laser", "clareador dentes",
    "rolo jade gua sha", "esfoliante eletrico", "massageador percussivo",
    "almofada cervical espuma", "pulseira fitness inteligente", "massageador eletrico",
    
    # ── CASA ──────────────────────────────────────────────────────────────────
    "mini blender portatil", "pistola vapor limpeza", "aspirador portatil",
    "organizador cabo magnetico", "luminaria led usb", "fita led rgb wifi",
    "chaleira eletrica inteligente", "pote vidro hermetico", "difusor aromaterapia",
    
    # ── ESPORTE ───────────────────────────────────────────────────────────────
    "tapete yoga antiderrapante", "corda pular digital", "elastico resistencia",
    "garrafa agua inteligente", "almofada ergonomica",
    
    # ── ACESSÓRIOS ────────────────────────────────────────────────────────────
    "suporte celular magnetico", "mochila notebook 15.6", "bolsa termica",
    "pelicula hydrogel", "capa case iphone magsafe",
]


class MiningScheduler:
    """Scheduler otimizado para mineração contínua de produtos."""
    
    def __init__(self):
        self.scheduler = AsyncIOScheduler()
        self.mining_stats = {
            "total_products_mined": 0,
            "champion_products": 0,
            "last_scan": None,
            "last_ads_scan": None,
        }

    async def start(self):
        """Inicia o scheduler de mineração."""
        logger.info("🔥 Iniciando NEXO Mining Scheduler v5.0...")
        
        # ── SCAN AGRESSIVO A CADA 3H (8x por dia) ────────────────────────────
        # 0h, 3h, 6h, 9h, 12h, 15h, 18h, 21h
        self.scheduler.add_job(
            self._product_scan_aggressive,
            CronTrigger(hour="*/3", minute=0, timezone="America/Sao_Paulo"),
            id="scan_3h_aggressive",
            replace_existing=True
        )
        logger.info("✅ Scan agressivo: a cada 3h (8x por dia)")
        
        # ── ADS SCAN A CADA 2H (12x por dia) ──────────────────────────────────
        # 0h, 2h, 4h, 6h, 8h, 10h, 12h, 14h, 16h, 18h, 20h, 22h
        self.scheduler.add_job(
            self._ads_scan_aggressive,
            CronTrigger(hour="*/2", minute=0, timezone="America/Sao_Paulo"),
            id="ads_2h_aggressive",
            replace_existing=True
        )
        logger.info("✅ Ads scan: a cada 2h (12x por dia)")
        
        # ── TRENDS A CADA 4H ──────────────────────────────────────────────────
        self.scheduler.add_job(
            self._refresh_trends,
            CronTrigger(hour="*/4", minute=0, timezone="America/Sao_Paulo"),
            id="trends_4h",
            replace_existing=True
        )
        logger.info("✅ Trends: a cada 4h")
        
        # ── DIGEST DE CAMPEÕES A CADA 6H ──────────────────────────────────────
        self.scheduler.add_job(
            self._champion_digest,
            CronTrigger(hour="*/6", minute=0, timezone="America/Sao_Paulo"),
            id="champion_digest_6h",
            replace_existing=True
        )
        logger.info("✅ Champion digest: a cada 6h")
        
        # ── LIMPEZA DE CACHE A CADA 12H ───────────────────────────────────────
        self.scheduler.add_job(
            self._cache_cleanup,
            CronTrigger(hour="0,12", minute=0, timezone="America/Sao_Paulo"),
            id="cache_cleanup_12h",
            replace_existing=True
        )
        logger.info("✅ Cache cleanup: a cada 12h")
        
        self.scheduler.start()
        logger.info("🔥 NEXO Mining Scheduler iniciado com sucesso!")

    async def stop(self):
        """Para o scheduler."""
        self.scheduler.shutdown()
        logger.info("⏹️  Mining Scheduler parado")

    # ── MINERAÇÃO AGRESSIVA ───────────────────────────────────────────────────
    async def _product_scan_aggressive(self):
        """Scan agressivo a cada 3h com mais keywords e resultados."""
        from scrapers.aliexpress import AliExpressScraper
        from scrapers.shopee import ShopeeScraper
        from scrapers.mercadolivre import MercadoLivreScraper
        from services.ai_scorer import AIScorer
        from services.profit_calculator import ProfitCalculator
        from database.db import Database
        from routers.notifications import notify_new_product

        start_time = datetime.now()
        logger.info(f"🔥 SCAN AGRESSIVO iniciado às {start_time.strftime('%H:%M:%S')}")
        
        db = Database()
        ali = AliExpressScraper()
        shopee = ShopeeScraper()
        ml = MercadoLivreScraper()
        scorer = AIScorer()
        calc = ProfitCalculator()
        
        try:
            # ── ALIEXPRESS: 100 resultados por keyword ────────────────────────
            logger.info(f"🔍 Scraping AliExpress ({len(MINING_KEYWORDS_EN)} keywords)...")
            products = await ali.search_products(MINING_KEYWORDS_EN, max_results=100)
            logger.info(f"✅ AliExpress: {len(products)} produtos encontrados")
            
            # ── MERCADOS BRASILEIROS ──────────────────────────────────────────
            logger.info(f"🔍 Scraping Shopee e Mercado Livre...")
            br = await shopee.search_products(MINING_KEYWORDS_PT, max_results=50)
            br += await ml.search_products(MINING_KEYWORDS_PT, max_results=50)
            logger.info(f"✅ Mercados BR: {len(br)} produtos encontrados")
            
            # ── SCORING E FILTRAGEM ───────────────────────────────────────────
            rate = await calc.get_live_usd_rate()
            results = []
            champions = []
            
            for p in products:
                profit = calc.calculate(p["price_usd"], usd_brl=rate)
                
                # Filtro: markup mínimo 3.0
                if profit["markup"] < 3.0:
                    continue
                
                # Status no Brasil
                br_status = _check_br_status(p["title"], br)
                
                # Score com IA
                score = await scorer.score_product(p, br_status, profit)
                
                # Montar item completo
                item = {**p, **profit, "br_status": br_status, "score": score}
                results.append(item)
                
                # ── IDENTIFICAR CAMPEÕES (score >= 85) ────────────────────────
                if score >= 85:
                    champions.append(item)
                    logger.info(f"🏆 CAMPEÃO ENCONTRADO: {p['title'][:50]} (Score: {score})")
                    await notify_new_product(item)
            
            # ── SALVAR RESULTADOS ─────────────────────────────────────────────
            results.sort(key=lambda x: x["score"], reverse=True)
            await db.upsert_products(results[:200])  # Top 200
            
            # ── ATUALIZAR ESTATÍSTICAS ────────────────────────────────────────
            self.mining_stats["total_products_mined"] += len(results)
            self.mining_stats["champion_products"] += len(champions)
            self.mining_stats["last_scan"] = datetime.now()
            
            elapsed = (datetime.now() - start_time).total_seconds()
            logger.info(f"✅ SCAN CONCLUÍDO: {len(results)} produtos, {len(champions)} campeões em {elapsed:.1f}s")
            
        except Exception as e:
            logger.error(f"❌ SCAN FALHOU: {e}", exc_info=True)

    # ── ADS SCAN AGRESSIVO ────────────────────────────────────────────────────
    async def _ads_scan_aggressive(self):
        """Scan agressivo de Ads a cada 2h."""
        from scrapers.facebook_ads import FacebookAdsSpy
        from database.db import Database

        start_time = datetime.now()
        logger.info(f"📊 ADS SCAN AGRESSIVO iniciado às {start_time.strftime('%H:%M:%S')}")
        
        try:
            spy = FacebookAdsSpy()
            db = Database()
            
            # Usar todas as keywords (não apenas 8)
            keywords_to_scan = MINING_KEYWORDS_PT[:16]  # Top 16 keywords
            logger.info(f"🔍 Scraping Ads ({len(keywords_to_scan)} keywords)...")
            
            total_ads = 0
            for kw in keywords_to_scan:
                try:
                    ads = await spy.search_ads(kw, max_results=100)
                    if ads:
                        await db.save_ads(kw, ads)
                        total_ads += len(ads)
                        logger.info(f"  ✅ {kw}: {len(ads)} ads encontrados")
                except Exception as e:
                    logger.warning(f"  ⚠️  {kw}: {e}")
            
            self.mining_stats["last_ads_scan"] = datetime.now()
            elapsed = (datetime.now() - start_time).total_seconds()
            logger.info(f"✅ ADS SCAN CONCLUÍDO: {total_ads} ads em {elapsed:.1f}s")
            
        except Exception as e:
            logger.error(f"❌ ADS SCAN FALHOU: {e}", exc_info=True)

    # ── TRENDS ────────────────────────────────────────────────────────────────
    async def _refresh_trends(self):
        """Atualiza trends a cada 4h."""
        from scrapers.google_trends import GoogleTrendsScraper
        from database.db import Database
        
        try:
            logger.info("📈 Atualizando trends...")
            trends = await GoogleTrendsScraper().get_trending_products(geo="BR")
            await Database().upsert_trends(trends)
            logger.info(f"✅ Trends: {len(trends)} atualizados")
        except Exception as e:
            logger.warning(f"⚠️  Trends refresh: {e}")

    # ── DIGEST DE CAMPEÕES ────────────────────────────────────────────────────
    async def _champion_digest(self):
        """Digest de campeões a cada 6h."""
        from database.db import Database
        from routers.notifications import send_notification
        
        try:
            logger.info("🏆 Gerando digest de campeões...")
            db = Database()
            
            # Produtos com score >= 85
            champions = await db.get_products(sort_by="score", limit=10)
            champions = [p for p in champions if p.get("score", 0) >= 85]
            
            if not champions:
                logger.info("ℹ️  Nenhum campeão encontrado neste período")
                return
            
            users = await db.get_users_with_notifications()
            
            for user in users:
                settings = await db.get_notif_settings(user["id"])
                if not settings or not settings.get("daily_digest"):
                    continue
                
                # Montar digest
                lines = "\n".join([
                    f"🏆 #{i+1} {p.get('title','')[:50]}\n"
                    f"   Score: {p.get('score',0)}/100 | Markup: ×{p.get('markup',0):.1f} | "
                    f"Status: {p.get('br_status','N/A')}"
                    for i, p in enumerate(champions[:5])
                ])
                
                await send_notification(
                    user=user,
                    settings=settings,
                    subject="🏆 NEXO — Produtos Campeões Detectados!",
                    body=f"Seus produtos campeões de hoje:\n\n{lines}\n\nAcesse a plataforma para análise completa."
                )
            
            logger.info(f"✅ Digest enviado: {len(champions)} campeões")
            
        except Exception as e:
            logger.error(f"❌ Champion digest: {e}")

    # ── LIMPEZA DE CACHE ──────────────────────────────────────────────────────
    async def _cache_cleanup(self):
        """Limpeza de cache a cada 12h."""
        from database.db import Database
        
        try:
            logger.info("🧹 Limpando cache...")
            db = Database()
            await db._cache_clear("products:*")
            await db._cache_clear("trends:*")
            logger.info("✅ Cache limpo")
        except Exception as e:
            logger.warning(f"⚠️  Cache cleanup: {e}")

    # ── UTILITÁRIOS ───────────────────────────────────────────────────────────
    def get_mining_stats(self) -> dict:
        """Retorna estatísticas de mineração."""
        return {
            "total_products_mined": self.mining_stats["total_products_mined"],
            "champion_products": self.mining_stats["champion_products"],
            "last_scan": self.mining_stats["last_scan"],
            "last_ads_scan": self.mining_stats["last_ads_scan"],
            "mining_rate": f"{self.mining_stats['total_products_mined']} produtos/período",
        }


def _check_br_status(title: str, br_products: list) -> str:
    """Verifica status do produto no Brasil."""
    words = set(title.lower().split())
    matches = sum(
        1 for p in br_products
        if len(words & set(p.get("title", "").lower().split())) / max(len(words), 1) > 0.5
    )
    return "Não Vendido" if matches == 0 else "Pouco Vendido" if matches <= 5 else "Já Vendido"
