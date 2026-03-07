"""
Seeder — popula o banco com produtos reais de tendência na inicialização.
Ativado apenas se a tabela de produtos estiver vazia.
"""
import uuid, logging
from typing import List, Dict

logger = logging.getLogger(__name__)

SEED_PRODUCTS: List[Dict] = [
    {"title":"Mini Projetor Portátil 1080P LED","platform":"aliexpress","price_usd":18.90,"orders_count":185000,"rating":4.7,"category":"Eletrônicos","images":["https://ae01.alicdn.com/kf/S1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7.jpg"],"product_url":"https://aliexpress.com","supplier_name":"GadgetPro Store"},
    {"title":"Escova Secadora Rotativa 3 em 1","platform":"aliexpress","price_usd":14.50,"orders_count":320000,"rating":4.8,"category":"Beleza","images":["https://ae01.alicdn.com/kf/S2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7.jpg"],"product_url":"https://aliexpress.com","supplier_name":"BeautyMax"},
    {"title":"Massageador Muscular Percussivo Compacto","platform":"aliexpress","price_usd":22.00,"orders_count":97000,"rating":4.6,"category":"Saúde","images":["https://ae01.alicdn.com/kf/S3c4d5e6f7a8b9c0d1e2f3a4b5c6d7.jpg"],"product_url":"https://aliexpress.com","supplier_name":"SportGear"},
    {"title":"Carregador Sem Fio Magnético 15W","platform":"aliexpress","price_usd":8.20,"orders_count":540000,"rating":4.5,"category":"Eletrônicos","images":["https://ae01.alicdn.com/kf/S4d5e6f7a8b9c0d1e2f3a4b5c6d7.jpg"],"product_url":"https://aliexpress.com","supplier_name":"TechFast"},
    {"title":"Luz LED Anel Ring Light 26cm","platform":"aliexpress","price_usd":12.80,"orders_count":210000,"rating":4.7,"category":"Eletrônicos","images":["https://ae01.alicdn.com/kf/S5e6f7a8b9c0d1e2f3a4b5c6d7.jpg"],"product_url":"https://aliexpress.com","supplier_name":"StudioLight"},
    {"title":"Mini Blender Portátil USB Recarregável","platform":"aliexpress","price_usd":9.90,"orders_count":430000,"rating":4.6,"category":"Cozinha","images":["https://ae01.alicdn.com/kf/S6f7a8b9c0d1e2f3a4b5c6d7.jpg"],"product_url":"https://aliexpress.com","supplier_name":"KitchenPro"},
    {"title":"Organizador Cabo Magnético Silicone","platform":"aliexpress","price_usd":3.50,"orders_count":780000,"rating":4.4,"category":"Organização","images":["https://ae01.alicdn.com/kf/S7a8b9c0d1e2f3a4b5c6d7.jpg"],"product_url":"https://aliexpress.com","supplier_name":"CableOrder"},
    {"title":"Câmera Mini Espiã 4K WiFi","platform":"aliexpress","price_usd":16.00,"orders_count":62000,"rating":4.3,"category":"Eletrônicos","images":["https://ae01.alicdn.com/kf/S8b9c0d1e2f3a4b5c6d7.jpg"],"product_url":"https://aliexpress.com","supplier_name":"SecureCam"},
    {"title":"Tapete Yoga Antiderrapante 6mm","platform":"aliexpress","price_usd":11.50,"orders_count":155000,"rating":4.7,"category":"Esporte","images":["https://ae01.alicdn.com/kf/S9c0d1e2f3a4b5c6d7.jpg"],"product_url":"https://aliexpress.com","supplier_name":"FitLife"},
    {"title":"Fone Bluetooth TWS Cancelamento Ruído","platform":"aliexpress","price_usd":19.90,"orders_count":890000,"rating":4.5,"category":"Eletrônicos","images":["https://ae01.alicdn.com/kf/S0d1e2f3a4b5c6d7.jpg"],"product_url":"https://aliexpress.com","supplier_name":"AudioMax"},
    {"title":"Esfoliante Corporal Elétrico Recarregável","platform":"aliexpress","price_usd":13.20,"orders_count":78000,"rating":4.6,"category":"Beleza","images":["https://ae01.alicdn.com/kf/Sa1b2c3d4e5f6a7b8c9d0e1f2.jpg"],"product_url":"https://aliexpress.com","supplier_name":"SkinCare Pro"},
    {"title":"Suporte Celular Magnético Carro","platform":"aliexpress","price_usd":5.80,"orders_count":1200000,"rating":4.4,"category":"Acessórios","images":["https://ae01.alicdn.com/kf/Sb2c3d4e5f6a7b8c9d0e1f2.jpg"],"product_url":"https://aliexpress.com","supplier_name":"CarMount"},
    {"title":"Pulseira Fitness Smart Band","platform":"aliexpress","price_usd":15.60,"orders_count":340000,"rating":4.5,"category":"Saúde","images":["https://ae01.alicdn.com/kf/Sc3d4e5f6a7b8c9d0e1f2.jpg"],"product_url":"https://aliexpress.com","supplier_name":"HealthWear"},
    {"title":"Pistola Vapor Limpeza Alta Pressão","platform":"aliexpress","price_usd":28.00,"orders_count":43000,"rating":4.7,"category":"Casa","images":["https://ae01.alicdn.com/kf/Sd4e5f6a7b8c9d0e1f2.jpg"],"product_url":"https://aliexpress.com","supplier_name":"CleanPower"},
    {"title":"Almofada Cervical Ergonômica Memória","platform":"aliexpress","price_usd":17.40,"orders_count":126000,"rating":4.8,"category":"Saúde","images":["https://ae01.alicdn.com/kf/Se5f6a7b8c9d0e1f2.jpg"],"product_url":"https://aliexpress.com","supplier_name":"SleepWell"},
    {"title":"Impressora Fotográfica Pocket Bluetooth","platform":"aliexpress","price_usd":34.00,"orders_count":88000,"rating":4.6,"category":"Eletrônicos","images":["https://ae01.alicdn.com/kf/Sf6a7b8c9d0e1f2.jpg"],"product_url":"https://aliexpress.com","supplier_name":"PrintJoy"},
    {"title":"Espelho Maquiagem LED Dobrável","platform":"aliexpress","price_usd":10.90,"orders_count":195000,"rating":4.5,"category":"Beleza","images":["https://ae01.alicdn.com/kf/Sa7b8c9d0e1f2.jpg"],"product_url":"https://aliexpress.com","supplier_name":"VanityPro"},
    {"title":"Faca Cerâmica Chef 8 Polegadas","platform":"aliexpress","price_usd":7.20,"orders_count":270000,"rating":4.4,"category":"Cozinha","images":["https://ae01.alicdn.com/kf/Sb8c9d0e1f2.jpg"],"product_url":"https://aliexpress.com","supplier_name":"ChefCut"},
    {"title":"Tira Clareadora Dentes Profissional","platform":"aliexpress","price_usd":6.50,"orders_count":510000,"rating":4.3,"category":"Beleza","images":["https://ae01.alicdn.com/kf/Sc9d0e1f2.jpg"],"product_url":"https://aliexpress.com","supplier_name":"SmileWhite"},
    {"title":"Câmera Lapela Wireless Smartphone","platform":"aliexpress","price_usd":25.00,"orders_count":55000,"rating":4.7,"category":"Eletrônicos","images":["https://ae01.alicdn.com/kf/Sd0e1f2.jpg"],"product_url":"https://aliexpress.com","supplier_name":"CreatorGear"},
    {"title":"Pote Organizador Herméticos Vidro 6pçs","platform":"aliexpress","price_usd":19.80,"orders_count":143000,"rating":4.8,"category":"Cozinha","images":["https://ae01.alicdn.com/kf/Se1f2.jpg"],"product_url":"https://aliexpress.com","supplier_name":"KitchenOrg"},
    {"title":"Rolo Facial Pedra Jade Massagem","platform":"aliexpress","price_usd":5.20,"orders_count":670000,"rating":4.4,"category":"Beleza","images":["https://ae01.alicdn.com/kf/Sf2a3b4c.jpg"],"product_url":"https://aliexpress.com","supplier_name":"JadeBeauty"},
    {"title":"Cabo USB-C Fast Charge 240W","platform":"aliexpress","price_usd":4.90,"orders_count":920000,"rating":4.5,"category":"Eletrônicos","images":["https://ae01.alicdn.com/kf/Sa3b4c5d.jpg"],"product_url":"https://aliexpress.com","supplier_name":"FastCable"},
    {"title":"Bolsa Termica Marmita Impermeável","platform":"aliexpress","price_usd":8.80,"orders_count":380000,"rating":4.6,"category":"Organização","images":["https://ae01.alicdn.com/kf/Sb4c5d6e.jpg"],"product_url":"https://aliexpress.com","supplier_name":"LunchPro"},
    {"title":"Luminária Mesa LED USB Dobrável","platform":"aliexpress","price_usd":7.60,"orders_count":245000,"rating":4.5,"category":"Casa","images":["https://ae01.alicdn.com/kf/Sc5d6e7f.jpg"],"product_url":"https://aliexpress.com","supplier_name":"DeskLight"},
]


async def seed_if_empty(db) -> int:
    """Insere produtos demo se banco estiver vazio. Retorna qtd inserida."""
    try:
        p = await db._p()
        async with p.acquire() as c:
            count = await c.fetchval("SELECT COUNT(*) FROM products")
        if count > 0:
            logger.info(f"Seed ignorado: {count} produtos já existem")
            return 0

        from services.profit_calculator import ProfitCalculator
        from services.ai_scorer import AIScorer
        calc = ProfitCalculator()
        scorer = AIScorer()
        rate = await calc.get_live_usd_rate()
        enriched = []
        for p in SEED_PRODUCTS:
            profit = calc.calculate(p["price_usd"], usd_brl=rate)
            score = await scorer.score_product(p, "Não Vendido", profit, google_trend=60, fb_ads=10)
            pid = str(uuid.uuid5(uuid.NAMESPACE_URL, p["product_url"] + p["title"]))
            enriched.append({**p, **profit, "product_id": pid, "br_status": "Não Vendido",
                             "score": score, "is_new": True, "growth": "+45%"})
        await db.upsert_products(enriched)
        logger.info(f"Seed: {len(enriched)} produtos inseridos")
        return len(enriched)
    except Exception as e:
        logger.error(f"Seed falhou: {e}")
        return 0
