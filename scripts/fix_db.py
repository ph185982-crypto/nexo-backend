"""
Script de correção do banco:
1. Remove produtos duplicados (mantém o de maior score por título)
2. Insere ads demo para o Ads Spy
Execute: python scripts/fix_db.py
"""
import asyncio, asyncpg, json, uuid, os, sys

DATABASE_URL = "postgresql://nexo_db_wjv3_user:s0yvLJLFSBBd8BbsnFJS5Yq5WnJi2uu9@dpg-d6m1l3fgi27c738atp30-a.oregon-postgres.render.com/nexo_db_wjv3"

DEMO_ADS = [
    # Pistola massagem
    {"keyword": "pistola massagem muscular", "title": "Pistola Massagem - Video UGC antes/depois", "advertiser": "FitStore BR", "creative_type": "Video", "days_active": 28, "is_active": True, "engagement": "Explosivo", "total_engagement": 45200, "image_url": "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400", "platform": "facebook"},
    {"keyword": "pistola massagem muscular", "title": "Pistola Massagem - Carrossel Beneficios", "advertiser": "FitStore BR", "creative_type": "Carrossel", "days_active": 14, "is_active": True, "engagement": "Muito Alto", "total_engagement": 22100, "image_url": "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=400", "platform": "instagram"},
    # Escova alisadora
    {"keyword": "escova alisadora rotativa", "title": "Escova Rotativa - Transformacao em 60s", "advertiser": "BeautyImport", "creative_type": "Video", "days_active": 21, "is_active": True, "engagement": "Explosivo", "total_engagement": 38700, "image_url": "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400", "platform": "facebook"},
    {"keyword": "escova alisadora rotativa", "title": "Escova Ceramica - Resultado Profissional", "advertiser": "BeautyImport", "creative_type": "Imagem", "days_active": 10, "is_active": True, "engagement": "Alto", "total_engagement": 15300, "image_url": "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400", "platform": "facebook"},
    # Mascara LED
    {"keyword": "mascara led facial", "title": "Mascara LED 7 Cores - Skincare Revolution", "advertiser": "GlowBR", "creative_type": "Video", "days_active": 35, "is_active": True, "engagement": "Muito Alto", "total_engagement": 67400, "image_url": "https://images.unsplash.com/photo-1596755389378-c31d21fd1273?w=400", "platform": "facebook"},
    # Gato brinquedo
    {"keyword": "brinquedo automatico gato", "title": "Brinquedo Gato Automatico - Seu pet vai amar", "advertiser": "PetShopTop", "creative_type": "Video", "days_active": 18, "is_active": True, "engagement": "Explosivo", "total_engagement": 98200, "image_url": "https://images.unsplash.com/photo-1548247416-ec66f4900b2e?w=400", "platform": "instagram"},
    {"keyword": "brinquedo automatico gato", "title": "Brinquedo Pet Pena Recarregavel", "advertiser": "PetShopTop", "creative_type": "Imagem", "days_active": 7, "is_active": True, "engagement": "Alto", "total_engagement": 12400, "image_url": "https://images.unsplash.com/photo-1592194996308-7b43878e84a6?w=400", "platform": "facebook"},
    # Garrafa pet
    {"keyword": "garrafa agua pet portatil", "title": "Garrafa Pet Portatil - Passeio Perfeito", "advertiser": "PetShopTop", "creative_type": "Imagem", "days_active": 22, "is_active": True, "engagement": "Muito Alto", "total_engagement": 31500, "image_url": "https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=400", "platform": "facebook"},
    # Massageador joelho
    {"keyword": "massageador joelho eletrico", "title": "Massageador Joelho - Fim da dor em 15min", "advertiser": "SaudeTotal", "creative_type": "Video", "days_active": 41, "is_active": True, "engagement": "Alto", "total_engagement": 48000, "image_url": "https://images.unsplash.com/photo-1559757175-5700dde675bc?w=400", "platform": "facebook"},
    # Massageador ocular
    {"keyword": "massageador ocular vibração", "title": "Massageador Olhos - Relaxamento Instantaneo", "advertiser": "SaudeTotal", "creative_type": "Video", "days_active": 15, "is_active": True, "engagement": "Alto", "total_engagement": 27800, "image_url": "https://images.unsplash.com/photo-1515377905703-c4788e51af15?w=400", "platform": "instagram"},
    # Kit clareamento
    {"keyword": "kit clareamento dental led", "title": "Clareamento LED - Resultado em 7 dias", "advertiser": "SmileStore", "creative_type": "Video", "days_active": 30, "is_active": True, "engagement": "Muito Alto", "total_engagement": 61000, "image_url": "https://images.unsplash.com/photo-1606811841689-23dfddce3e95?w=400", "platform": "facebook"},
    # Celulite
    {"keyword": "massageador anticelulite eletrico", "title": "Anti-Celulite Eletrico - Resultado real", "advertiser": "BelezaTotal", "creative_type": "Video", "days_active": 19, "is_active": True, "engagement": "Explosivo", "total_engagement": 55300, "image_url": "https://images.unsplash.com/photo-1556228453-efd6c1ff04f6?w=400", "platform": "instagram"},
    # Corretor postura
    {"keyword": "corretor postura ajustavel", "title": "Corretor Postura Invisivel - Sem mais dor", "advertiser": "SaudeTotal", "creative_type": "Imagem", "days_active": 25, "is_active": True, "engagement": "Medio", "total_engagement": 18500, "image_url": "https://images.unsplash.com/photo-1587645483890-21a12a8fc1fc?w=400", "platform": "facebook"},
    # Aspirador bebe
    {"keyword": "aspirador nasal eletrico bebe", "title": "Aspirador Nasal Bebe - Pediatras recomendam", "advertiser": "MamaeTop", "creative_type": "Video", "days_active": 33, "is_active": True, "engagement": "Alto", "total_engagement": 78000, "image_url": "https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=400", "platform": "facebook"},
]

DEMO_TRENDS = [
    {"keyword": "massageador muscular portatil", "trend_score": 92, "geo": "BR", "timeframe": "today 3-m"},
    {"keyword": "escova alisadora rotativa", "trend_score": 87, "geo": "BR", "timeframe": "today 3-m"},
    {"keyword": "mascara led facial skincare", "trend_score": 85, "geo": "BR", "timeframe": "today 3-m"},
    {"keyword": "brinquedo automatico gatos", "trend_score": 83, "geo": "BR", "timeframe": "today 3-m"},
    {"keyword": "garrafa termica portatil pet", "trend_score": 81, "geo": "BR", "timeframe": "today 3-m"},
    {"keyword": "massageador ocular aquecimento", "trend_score": 78, "geo": "BR", "timeframe": "today 3-m"},
    {"keyword": "kit clareamento dental led", "trend_score": 76, "geo": "BR", "timeframe": "today 3-m"},
    {"keyword": "aspirador nasal bebe silencioso", "trend_score": 74, "geo": "BR", "timeframe": "today 3-m"},
    {"keyword": "corretor postura invisivel", "trend_score": 71, "geo": "BR", "timeframe": "today 3-m"},
    {"keyword": "massageador anticelulite eletrico", "trend_score": 69, "geo": "BR", "timeframe": "today 3-m"},
    {"keyword": "luminaria led plantas indoor", "trend_score": 66, "geo": "BR", "timeframe": "today 3-m"},
    {"keyword": "espumador cafe eletrico mini", "trend_score": 63, "geo": "BR", "timeframe": "today 3-m"},
    {"keyword": "elasticos resistencia musculacao", "trend_score": 60, "geo": "BR", "timeframe": "today 3-m"},
    {"keyword": "meias compressao corrida", "trend_score": 57, "geo": "BR", "timeframe": "today 3-m"},
    {"keyword": "massageador couro cabeludo eletrico", "trend_score": 54, "geo": "BR", "timeframe": "today 3-m"},
]


async def fix():
    conn = await asyncpg.connect(DATABASE_URL)

    # ── 1. Limpar duplicados ─────────────────────────────────────────────────
    print("Limpando duplicados...")
    # Busca todos os produtos ordenados por título + score
    rows = await conn.fetch("SELECT id, title, score FROM products ORDER BY title, score DESC")
    seen_titles = {}
    to_delete = []
    for row in rows:
        title_key = row['title'][:50].lower().strip()
        if title_key in seen_titles:
            to_delete.append(row['id'])
        else:
            seen_titles[title_key] = row['id']

    if to_delete:
        await conn.execute(f"DELETE FROM products WHERE id = ANY($1::text[])", to_delete)
        print(f"[OK] {len(to_delete)} duplicados removidos")

    remaining = await conn.fetchval("SELECT COUNT(*) FROM products")
    print(f"[OK] {remaining} produtos unicos no banco")

    # ── 2. Inserir trends demo ────────────────────────────────────────────────
    print("Inserindo trends demo...")
    for t in DEMO_TRENDS:
        await conn.execute("""
            INSERT INTO trends (keyword, trend_score, geo, timeframe, timeline, updated_at)
            VALUES ($1, $2, $3, $4, '[]', NOW())
            ON CONFLICT (keyword, geo) DO UPDATE SET
                trend_score=EXCLUDED.trend_score, updated_at=NOW()
        """, t["keyword"], t["trend_score"], t["geo"], t["timeframe"])
    print(f"[OK] {len(DEMO_TRENDS)} trends inseridas")

    # ── 3. Inserir ads demo ────────────────────────────────────────────────────
    print("Inserindo ads demo...")
    # Limpa ads velhos primeiro
    await conn.execute("DELETE FROM ads")

    for ad in DEMO_ADS:
        ad_id = str(uuid.uuid4())
        await conn.execute("""
            INSERT INTO ads (id, keyword, title, advertiser, creative_type, image_url,
                days_active, is_active, engagement, total_engagement, platform, raw_data)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            ON CONFLICT (id) DO NOTHING
        """,
            ad_id, ad["keyword"], ad["title"], ad["advertiser"],
            ad["creative_type"], ad["image_url"], ad["days_active"],
            ad["is_active"], ad["engagement"], ad["total_engagement"],
            ad["platform"], json.dumps(ad)
        )
    print(f"[OK] {len(DEMO_ADS)} ads inseridos")

    await conn.close()
    print("\nBanco corrigido com sucesso!")


if __name__ == "__main__":
    asyncio.run(fix())
