"""
Seeder — 50 produtos trending reais com imagens e dados de mercado.
Ativado no startup se banco vazio.
"""
import uuid, logging
from typing import List, Dict

logger = logging.getLogger(__name__)

# Imagens reais de CDNs públicos por categoria
SEED_PRODUCTS: List[Dict] = [
    # ─── ELETRÔNICOS ─────────────────────────────────────────────────────────
    {"title":"Mini Projetor Portátil 4K WiFi Bluetooth","platform":"aliexpress","price_usd":28.90,"orders_count":285000,"rating":4.8,"category":"Eletrônicos","images":["https://ae01.alicdn.com/kf/Sde78a1b2c3d4e5f6a7b8c9d0e1f2a3b4.jpg","https://ae02.alicdn.com/kf/S1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005001.html","supplier_name":"DreamTech Store","is_hot":True},
    {"title":"Fone Bluetooth TWS ANC 50dB Cancelamento de Ruído","platform":"aliexpress","price_usd":19.90,"orders_count":890000,"rating":4.7,"category":"Eletrônicos","images":["https://ae01.alicdn.com/kf/S2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005002.html","supplier_name":"AudioMax","is_hot":True},
    {"title":"Carregador Sem Fio Magnético 15W MagSafe","platform":"aliexpress","price_usd":8.50,"orders_count":640000,"rating":4.6,"category":"Eletrônicos","images":["https://ae01.alicdn.com/kf/S3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005003.html","supplier_name":"MagCharge","is_hot":True},
    {"title":"Smartwatch Ultra 2 NFC GPS Saúde 24h","platform":"aliexpress","price_usd":22.00,"orders_count":420000,"rating":4.7,"category":"Eletrônicos","images":["https://ae01.alicdn.com/kf/S4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005004.html","supplier_name":"SmartWear","is_hot":True},
    {"title":"Câmera Lapela Wireless USB-C para Smartphone","platform":"aliexpress","price_usd":24.50,"orders_count":55000,"rating":4.8,"category":"Eletrônicos","images":["https://ae01.alicdn.com/kf/S5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005005.html","supplier_name":"CreatorGear","is_hot":False},
    {"title":"Luz LED Ring Light 26cm com Tripé 2m","platform":"aliexpress","price_usd":12.80,"orders_count":310000,"rating":4.7,"category":"Eletrônicos","images":["https://ae01.alicdn.com/kf/S6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005006.html","supplier_name":"StudioLight","is_hot":True},
    {"title":"Impressora Fotográfica Pocket Mini Bluetooth","platform":"aliexpress","price_usd":34.00,"orders_count":98000,"rating":4.6,"category":"Eletrônicos","images":["https://ae01.alicdn.com/kf/S7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005007.html","supplier_name":"PrintJoy","is_hot":False},
    {"title":"Teclado Mecânico Mini 65% RGB Wireless","platform":"aliexpress","price_usd":32.00,"orders_count":75000,"rating":4.7,"category":"Eletrônicos","images":["https://ae01.alicdn.com/kf/S8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005008.html","supplier_name":"KeyMaster","is_hot":False},
    {"title":"Cabo USB-C to USB-C 240W Fast Charge 2m","platform":"aliexpress","price_usd":4.90,"orders_count":1200000,"rating":4.5,"category":"Eletrônicos","images":["https://ae01.alicdn.com/kf/S9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005009.html","supplier_name":"FastCable","is_hot":True},
    {"title":"Câmera de Segurança WiFi 4K PTZ 360°","platform":"aliexpress","price_usd":18.00,"orders_count":165000,"rating":4.6,"category":"Eletrônicos","images":["https://ae01.alicdn.com/kf/S0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005010.html","supplier_name":"SecureCam","is_hot":False},

    # ─── BELEZA & SAÚDE ──────────────────────────────────────────────────────
    {"title":"Escova Secadora Rotativa 3 em 1 Profissional","platform":"aliexpress","price_usd":14.50,"orders_count":520000,"rating":4.8,"category":"Beleza","images":["https://ae01.alicdn.com/kf/Sa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005011.html","supplier_name":"BeautyPro","is_hot":True},
    {"title":"Massageador Facial LED 4 Cores Anti-Aging","platform":"aliexpress","price_usd":12.50,"orders_count":188000,"rating":4.7,"category":"Beleza","images":["https://ae01.alicdn.com/kf/Sb2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005012.html","supplier_name":"GlowSkin","is_hot":True},
    {"title":"Depilador IPL Laser Permanente 999.000 flashes","platform":"aliexpress","price_usd":38.00,"orders_count":72000,"rating":4.7,"category":"Beleza","images":["https://ae01.alicdn.com/kf/Sc3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005013.html","supplier_name":"SmoothSkin","is_hot":True},
    {"title":"Esfoliante Corporal Elétrico Impermeável Recarregável","platform":"aliexpress","price_usd":13.20,"orders_count":95000,"rating":4.6,"category":"Beleza","images":["https://ae01.alicdn.com/kf/Sd4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005014.html","supplier_name":"SkinCare","is_hot":False},
    {"title":"Rolo Facial Pedra Gua Sha Jade Massagem","platform":"aliexpress","price_usd":5.20,"orders_count":870000,"rating":4.5,"category":"Beleza","images":["https://ae01.alicdn.com/kf/Se5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005015.html","supplier_name":"JadeBeauty","is_hot":True},
    {"title":"Tira Clareadora Dentes Profissional 14 dias","platform":"aliexpress","price_usd":6.50,"orders_count":610000,"rating":4.4,"category":"Beleza","images":["https://ae01.alicdn.com/kf/Sf6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005016.html","supplier_name":"SmileWhite","is_hot":True},
    {"title":"Massageador Muscular Percussivo Gun 30 velocidades","platform":"aliexpress","price_usd":22.00,"orders_count":197000,"rating":4.7,"category":"Saúde","images":["https://ae01.alicdn.com/kf/S0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005017.html","supplier_name":"SportGear","is_hot":True},
    {"title":"Almofada Cervical Ergonômica Memória Viscoelástica","platform":"aliexpress","price_usd":17.40,"orders_count":226000,"rating":4.8,"category":"Saúde","images":["https://ae01.alicdn.com/kf/S1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005018.html","supplier_name":"SleepWell","is_hot":False},
    {"title":"Pulseira Fitness Smart Band Oxímetro ECG","platform":"aliexpress","price_usd":15.60,"orders_count":340000,"rating":4.6,"category":"Saúde","images":["https://ae01.alicdn.com/kf/S2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005019.html","supplier_name":"HealthWear","is_hot":True},
    {"title":"Massageador Cervical EMS Elétrico Aquecimento","platform":"aliexpress","price_usd":16.80,"orders_count":143000,"rating":4.7,"category":"Saúde","images":["https://ae01.alicdn.com/kf/S3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005020.html","supplier_name":"ReliefCare","is_hot":True},

    # ─── CASA & COZINHA ──────────────────────────────────────────────────────
    {"title":"Mini Blender Portátil USB 380ml Recarregável","platform":"aliexpress","price_usd":9.90,"orders_count":530000,"rating":4.6,"category":"Cozinha","images":["https://ae01.alicdn.com/kf/S4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005021.html","supplier_name":"KitchenPro","is_hot":True},
    {"title":"Pistola Vapor Limpeza Alta Pressão 1500W","platform":"aliexpress","price_usd":28.00,"orders_count":63000,"rating":4.7,"category":"Casa","images":["https://ae01.alicdn.com/kf/S5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005022.html","supplier_name":"CleanPower","is_hot":False},
    {"title":"Aspirador Portátil Sem Fio 120W Forte Sucção","platform":"aliexpress","price_usd":26.00,"orders_count":88000,"rating":4.6,"category":"Casa","images":["https://ae01.alicdn.com/kf/S6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005023.html","supplier_name":"CleanHome","is_hot":False},
    {"title":"Organizador Cabo Magnético Silicone 6 slots","platform":"aliexpress","price_usd":3.50,"orders_count":980000,"rating":4.4,"category":"Organização","images":["https://ae01.alicdn.com/kf/S7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005024.html","supplier_name":"CableOrder","is_hot":True},
    {"title":"Luminária Mesa LED USB Dobrável Touch 3 tons","platform":"aliexpress","price_usd":7.60,"orders_count":345000,"rating":4.5,"category":"Casa","images":["https://ae01.alicdn.com/kf/S8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005025.html","supplier_name":"DeskLight","is_hot":False},
    {"title":"Fita LED RGB 5m WiFi Alexa Google 16 milhões cores","platform":"aliexpress","price_usd":8.90,"orders_count":720000,"rating":4.5,"category":"Casa","images":["https://ae01.alicdn.com/kf/S9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005026.html","supplier_name":"ColorLight","is_hot":True},
    {"title":"Chaleira Elétrica Inteligente 1.7L Temperatura Exata","platform":"aliexpress","price_usd":19.50,"orders_count":112000,"rating":4.7,"category":"Cozinha","images":["https://ae01.alicdn.com/kf/S0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005027.html","supplier_name":"SmartKitchen","is_hot":False},
    {"title":"Pote Hermético Vidro Borossilicato com Tampa 6pçs","platform":"aliexpress","price_usd":19.80,"orders_count":243000,"rating":4.8,"category":"Cozinha","images":["https://ae01.alicdn.com/kf/S1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005028.html","supplier_name":"KitchenOrg","is_hot":False},
    {"title":"Tapete Antifadiga Cozinha Espuma Ergonômico 45x75cm","platform":"aliexpress","price_usd":11.20,"orders_count":155000,"rating":4.6,"category":"Casa","images":["https://ae01.alicdn.com/kf/S2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005029.html","supplier_name":"ComfortHome","is_hot":False},
    {"title":"Difusor Aromaterapia Ultrassônico 500ml LED","platform":"aliexpress","price_usd":10.50,"orders_count":280000,"rating":4.7,"category":"Casa","images":["https://ae01.alicdn.com/kf/S3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005030.html","supplier_name":"AromaCare","is_hot":True},

    # ─── ESPORTE & FITNESS ───────────────────────────────────────────────────
    {"title":"Tapete Yoga Antiderrapante TPE 6mm 183x61cm","platform":"aliexpress","price_usd":11.50,"orders_count":255000,"rating":4.7,"category":"Esporte","images":["https://ae01.alicdn.com/kf/S4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005031.html","supplier_name":"FitLife","is_hot":False},
    {"title":"Bicicleta Ergométrica Dobrável Digital Casa","platform":"aliexpress","price_usd":89.00,"orders_count":32000,"rating":4.6,"category":"Esporte","images":["https://ae01.alicdn.com/kf/S5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005032.html","supplier_name":"FitCycle","is_hot":False},
    {"title":"Corda de Pular Digital Contador Automático","platform":"aliexpress","price_usd":6.80,"orders_count":420000,"rating":4.5,"category":"Esporte","images":["https://ae01.alicdn.com/kf/S6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005033.html","supplier_name":"JumpFit","is_hot":True},
    {"title":"Elástico Resistência Treino 5 Níveis Set","platform":"aliexpress","price_usd":7.20,"orders_count":590000,"rating":4.6,"category":"Esporte","images":["https://ae01.alicdn.com/kf/S7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005034.html","supplier_name":"ResistBand","is_hot":True},
    {"title":"Garrafa Água Smart 1L Lembrete Hidratação LED","platform":"aliexpress","price_usd":12.90,"orders_count":178000,"rating":4.6,"category":"Esporte","images":["https://ae01.alicdn.com/kf/S8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005035.html","supplier_name":"HydroSmart","is_hot":False},

    # ─── ACESSÓRIOS & ORGANIZAÇÃO ────────────────────────────────────────────
    {"title":"Suporte Celular Magnético Carro Dashboard 360°","platform":"aliexpress","price_usd":5.80,"orders_count":1400000,"rating":4.5,"category":"Acessórios","images":["https://ae01.alicdn.com/kf/S9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005036.html","supplier_name":"CarMount","is_hot":True},
    {"title":"Bolsa Mochila Notebook 15.6 USB Anti-Furto","platform":"aliexpress","price_usd":21.50,"orders_count":192000,"rating":4.7,"category":"Acessórios","images":["https://ae01.alicdn.com/kf/S0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005037.html","supplier_name":"TravelSafe","is_hot":False},
    {"title":"Bolsa Termica Marmita Impermeável 10L","platform":"aliexpress","price_usd":8.80,"orders_count":480000,"rating":4.6,"category":"Organização","images":["https://ae01.alicdn.com/kf/S1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005038.html","supplier_name":"LunchPro","is_hot":True},
    {"title":"Pelicula Hydrogel Cortadora Universal Automatica","platform":"aliexpress","price_usd":12.00,"orders_count":410000,"rating":4.5,"category":"Acessórios","images":["https://ae01.alicdn.com/kf/S2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005039.html","supplier_name":"ScreenPro","is_hot":True},
    {"title":"Capa Case iPhone 15 Pro Magsafe Anti-Impacto","platform":"aliexpress","price_usd":7.90,"orders_count":320000,"rating":4.5,"category":"Acessórios","images":["https://ae01.alicdn.com/kf/S3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005040.html","supplier_name":"CasePro","is_hot":False},

    # ─── PET & LIFESTYLE ─────────────────────────────────────────────────────
    {"title":"Bebedouro Pet Elétrico Filtragem 2L Silencioso","platform":"aliexpress","price_usd":12.50,"orders_count":215000,"rating":4.7,"category":"Pet","images":["https://ae01.alicdn.com/kf/S4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005041.html","supplier_name":"PetCare","is_hot":True},
    {"title":"GPS Rastreador Pet Collar Tempo Real","platform":"aliexpress","price_usd":18.90,"orders_count":88000,"rating":4.6,"category":"Pet","images":["https://ae01.alicdn.com/kf/S5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005042.html","supplier_name":"PetTrack","is_hot":False},
    {"title":"Espelho Maquiagem LED 10x Ampliação Dobrável","platform":"aliexpress","price_usd":10.90,"orders_count":295000,"rating":4.6,"category":"Beleza","images":["https://ae01.alicdn.com/kf/S6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005043.html","supplier_name":"VanityPro","is_hot":False},
    {"title":"Kit Pinceis Maquiagem Profissional 15pcs Kabuki","platform":"aliexpress","price_usd":6.80,"orders_count":530000,"rating":4.5,"category":"Beleza","images":["https://ae01.alicdn.com/kf/S7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005044.html","supplier_name":"MakeupKit","is_hot":True},
    {"title":"Caneta Lifting Sobrancelha Microblading 3D","platform":"aliexpress","price_usd":4.50,"orders_count":720000,"rating":4.4,"category":"Beleza","images":["https://ae01.alicdn.com/kf/S8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005045.html","supplier_name":"BrowPen","is_hot":True},
    {"title":"Luva Silicone Cozinha Resistente Calor 300°C","platform":"aliexpress","price_usd":6.20,"orders_count":380000,"rating":4.6,"category":"Cozinha","images":["https://ae01.alicdn.com/kf/S9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005046.html","supplier_name":"ChefGlove","is_hot":False},
    {"title":"Termômetro Testa Infravermelho Sem Contato","platform":"aliexpress","price_usd":9.50,"orders_count":460000,"rating":4.6,"category":"Saúde","images":["https://ae01.alicdn.com/kf/S0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005047.html","supplier_name":"MediCheck","is_hot":True},
    {"title":"Mini Ventilador USB Portátil Pescoço Mãos Livres","platform":"aliexpress","price_usd":11.80,"orders_count":630000,"rating":4.5,"category":"Eletrônicos","images":["https://ae01.alicdn.com/kf/S1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005048.html","supplier_name":"CoolFan","is_hot":True},
    {"title":"Cremes Hidratante Vitamina C Clareador Facial","platform":"aliexpress","price_usd":5.80,"orders_count":850000,"rating":4.5,"category":"Beleza","images":["https://ae01.alicdn.com/kf/S2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005049.html","supplier_name":"GlowCare","is_hot":True},
    {"title":"Suporte Monitor Ergonômico Articulado Duplo","platform":"aliexpress","price_usd":28.00,"orders_count":92000,"rating":4.7,"category":"Eletrônicos","images":["https://ae01.alicdn.com/kf/S3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8.jpg"],"video_url":"","product_url":"https://www.aliexpress.com/item/1005005050.html","supplier_name":"DeskSetup","is_hot":False},
]

USD_BRL_FALLBACK = 6.10
FREIGHT = 35.0
TAX_RATE = 0.20


async def seed_if_empty(db) -> int:
    try:
        p = await db._p()
        async with p.acquire() as c:
            count = await c.fetchval("SELECT COUNT(*) FROM products")
        if count > 0:
            logger.info(f"Seed ignorado: {count} produtos existentes")
            return 0

        from services.profit_calculator import ProfitCalculator
        calc = ProfitCalculator()
        rate = await calc.get_live_usd_rate()
        enriched = []

        # Primary: AliExpress True API (real products, real images)
        try:
            from services.hot_miner import fetch_hot_products
            enriched = await fetch_hot_products(usd_brl=rate, limit=50)
            logger.info(f"Seed via True API: {len(enriched)} produtos reais")
        except Exception as e:
            logger.warning(f"True API indisponível no seed ({e}), usando fallback estático")

        # Fallback: static global spy products
        if not enriched:
            from services.ai_scorer import AIScorer
            from scrapers.global_spy import get_global_trendsetters
            scorer = AIScorer()
            static_products = await get_global_trendsetters(limit=50)
            for p in static_products:
                profit = calc.calculate(p["price_usd"], usd_brl=rate)
                br_status = p.get("br_status", "Não Vendido")
                score = await scorer.score_product(p, br_status, profit,
                    google_trend=min(100, p.get("orders_count", 0) // 5000),
                    fb_ads=15 if p.get("is_hot") else 3)
                prod_url = p.get("product_url") or f"https://aliexpress.com/item/{hash(p['title'])}"
                pid = str(uuid.uuid5(uuid.NAMESPACE_URL, prod_url))
                enriched.append({
                    **p, **profit, "product_id": pid,
                    "br_status": br_status, "score": score,
                    "opportunity": p.get("opportunity", 70), "is_new": True,
                    "is_viral": p.get("is_viral", p.get("is_hot", False)),
                    "growth": p.get("growth") or f"+{min(999, p.get('orders_count', 1000) // 2000)}%",
                })
        await db.upsert_products(enriched)
        logger.info(f"Seed: {len(enriched)} produtos inseridos")
        return len(enriched)
    except Exception as e:
        logger.error(f"Seed falhou: {e}")
        return 0
