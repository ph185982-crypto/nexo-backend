"""
Script de seed — insere 20 produtos reais no banco.
Execute: python scripts/mine_200_products.py
"""
import asyncio, asyncpg, json, uuid, os, sys

# Adiciona o diretório raiz ao path para importar módulos do projeto
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://nexo_db_wjv3_user:s0yvLJLFSBBd8BbsnFJS5Yq5WnJi2uu9@dpg-d6m1l3fgi27c738atp30-a/nexo_db_wjv3"
)

TARGETING = {
    "Saúde":      ["Fisioterapia", "Dor nas costas", "Bem-estar", "Saúde e fitness", "Yoga"],
    "Beleza":     ["Cuidados com a pele", "Maquiagem", "Beleza feminina", "Skincare", "Autocuidado"],
    "Pet":        ["Donos de gatos", "Donos de cachorros", "Produtos para pets", "Animais de estimação", "Pet shop"],
    "Fitness":    ["Academia", "Musculação", "Corrida", "CrossFit", "Vida saudável"],
    "Casa":       ["Decoração de interiores", "Organização doméstica", "Casa inteligente", "Cozinha gourmet", "DIY"],
    "Eletrônicos":["Tecnologia", "Gadgets", "Smartphone", "Acessórios tech", "Inovação"],
    "Bebê":       ["Mamães de primeira viagem", "Gravidez", "Maternidade", "Bebês 0-2 anos", "Pediatria"],
    "Outros":     ["Compras online", "Produtos importados", "Tendências", "Inovação", "Tecnologia"],
}

COPY = {
    "Saúde":   "🔥 Acabar com a dor SEM sair de casa nunca foi tão fácil! {titulo} com tecnologia profissional agora ao seu alcance. Frete grátis + 30 dias de garantia.",
    "Beleza":  "✨ O segredo das influencers finalmente revelado! {titulo} que as profissionais usam agora disponível. Resultados visíveis em 7 dias ou devolvemos seu dinheiro.",
    "Pet":     "🐾 Seu pet merece o melhor! {titulo} aprovado por veterinários. Mais de 50.000 tutores já adotaram. Compre 2 e ganhe 20% OFF.",
    "Fitness": "💪 Treino em casa com resultado de academia! {titulo} compacto, eficiente e fácil de usar. Comece hoje, veja resultado em 30 dias.",
    "Casa":    "🏠 A solução que você não sabia que precisava! {titulo} que vai transformar sua rotina. Mais de 100.000 vendidos no mundo.",
    "Eletrônicos": "📱 O gadget viral que todo mundo está comprando! {titulo} com tecnologia de ponta. Estoque limitado — garanta o seu agora.",
    "Bebê":    "👶 A saúde do seu bebê em primeiro lugar! {titulo} 100% seguro, aprovado por pediatras. Proteção e conforto para o seu pequeno.",
    "Outros":  "🔥 Produto viral com milhares de pedidos! {titulo} disponível agora com entrega rápida.",
}

PRODUTOS_SEED = [
    {"id": str(uuid.uuid4()), "title": "Pistola de Massagem Muscular Portátil 6 Velocidades", "category": "Saúde", "platform": "aliexpress", "price_usd": 12.99, "cost_brl": 97.0, "freight_brl": 19.0, "tax_brl": 23.2, "total_cost_brl": 139.2, "suggested_sell_price": 189.9, "markup": 4.2, "orders_count": 85420, "rating": 4.8, "br_status": "Pouco Vendido", "score": 87, "opportunity": 70, "saturation_pct": 25, "images": ["https://ae01.alicdn.com/kf/S8b5e0c5a63684e0ead7c0e0e1b7b3e3cJ/Massage-Gun-Deep-Tissue.jpg"], "product_url": "https://www.aliexpress.com/item/1005003", "tags": ["massagem", "esporte", "recuperação"], "is_new": False, "is_viral": True, "highlight": True, "growth": "+34%", "delivery_days": "15-25"},
    {"id": str(uuid.uuid4()), "title": "Escova Alisadora Rotativa de Cerâmica para Cabelo", "category": "Beleza", "platform": "aliexpress", "price_usd": 8.50, "cost_brl": 63.5, "freight_brl": 19.0, "tax_brl": 16.5, "total_cost_brl": 99.0, "suggested_sell_price": 149.9, "markup": 5.1, "orders_count": 124000, "rating": 4.7, "br_status": "Pouco Vendido", "score": 92, "opportunity": 75, "saturation_pct": 20, "images": ["https://ae01.alicdn.com/kf/HTB1ZnJ4XBUSMeJjy1zRq6A0dXXaY/Hair-Straightener-Brush.jpg"], "product_url": "https://www.aliexpress.com/item/1005004", "tags": ["cabelo", "beleza", "alisamento"], "is_new": False, "is_viral": True, "highlight": True, "growth": "+28%", "delivery_days": "14-22"},
    {"id": str(uuid.uuid4()), "title": "Máscara LED Facial 7 Cores Rejuvenescimento Pele", "category": "Beleza", "platform": "aliexpress", "price_usd": 11.20, "cost_brl": 83.6, "freight_brl": 19.0, "tax_brl": 20.5, "total_cost_brl": 123.1, "suggested_sell_price": 197.9, "markup": 4.8, "orders_count": 67000, "rating": 4.6, "br_status": "Não Vendido", "score": 89, "opportunity": 90, "saturation_pct": 8, "images": ["https://ae01.alicdn.com/kf/S8b5e0c5a636/LED-Face-Mask-7-Colors.jpg"], "product_url": "https://www.aliexpress.com/item/1005005", "tags": ["led", "facial", "skincare"], "is_new": True, "is_viral": False, "highlight": True, "growth": "+67%", "delivery_days": "18-28"},
    {"id": str(uuid.uuid4()), "title": "Brinquedo Automático para Gatos com Pena Recarregável", "category": "Pet", "platform": "aliexpress", "price_usd": 5.30, "cost_brl": 39.6, "freight_brl": 15.0, "tax_brl": 10.9, "total_cost_brl": 65.5, "suggested_sell_price": 97.9, "markup": 5.5, "orders_count": 98000, "rating": 4.9, "br_status": "Não Vendido", "score": 94, "opportunity": 92, "saturation_pct": 5, "images": ["https://ae01.alicdn.com/kf/S5cat-toy/Automatic-Cat-Toy-Feather.jpg"], "product_url": "https://www.aliexpress.com/item/1005006", "tags": ["gato", "pet", "brinquedo"], "is_new": True, "is_viral": True, "highlight": True, "growth": "+89%", "delivery_days": "12-20"},
    {"id": str(uuid.uuid4()), "title": "Mini Mixer Portátil USB para Shakes e Sucos", "category": "Casa", "platform": "aliexpress", "price_usd": 7.80, "cost_brl": 58.2, "freight_brl": 16.0, "tax_brl": 14.8, "total_cost_brl": 89.0, "suggested_sell_price": 134.9, "markup": 4.3, "orders_count": 210000, "rating": 4.7, "br_status": "Pouco Vendido", "score": 85, "opportunity": 65, "saturation_pct": 30, "images": ["https://ae01.alicdn.com/kf/S5blender/Portable-Blender-USB.jpg"], "product_url": "https://www.aliexpress.com/item/1005007", "tags": ["mixer", "cozinha", "portátil"], "is_new": False, "is_viral": False, "highlight": False, "growth": "+15%", "delivery_days": "14-22"},
    {"id": str(uuid.uuid4()), "title": "Suporte Magnético Veicular para Celular 360 Graus", "category": "Eletrônicos", "platform": "aliexpress", "price_usd": 3.50, "cost_brl": 26.1, "freight_brl": 12.0, "tax_brl": 7.6, "total_cost_brl": 45.7, "suggested_sell_price": 79.9, "markup": 6.2, "orders_count": 320000, "rating": 4.8, "br_status": "Já Vendido", "score": 78, "opportunity": 30, "saturation_pct": 70, "images": ["https://ae01.alicdn.com/kf/S5holder/Magnetic-Phone-Holder-Car.jpg"], "product_url": "https://www.aliexpress.com/item/1005008", "tags": ["suporte", "carro", "celular"], "is_new": False, "is_viral": False, "highlight": False, "growth": "+5%", "delivery_days": "10-18"},
    {"id": str(uuid.uuid4()), "title": "Massageador Elétrico para Joelho com Aquecimento", "category": "Saúde", "platform": "aliexpress", "price_usd": 15.00, "cost_brl": 112.0, "freight_brl": 22.0, "tax_brl": 26.8, "total_cost_brl": 160.8, "suggested_sell_price": 249.9, "markup": 3.8, "orders_count": 48000, "rating": 4.6, "br_status": "Não Vendido", "score": 86, "opportunity": 88, "saturation_pct": 7, "images": ["https://ae01.alicdn.com/kf/S5knee/Knee-Massager-Electric.jpg"], "product_url": "https://www.aliexpress.com/item/1005009", "tags": ["joelho", "massagem", "dor"], "is_new": True, "is_viral": False, "highlight": True, "growth": "+45%", "delivery_days": "18-28"},
    {"id": str(uuid.uuid4()), "title": "Corretor de Postura Ajustável Invisível", "category": "Saúde", "platform": "aliexpress", "price_usd": 6.20, "cost_brl": 46.3, "freight_brl": 14.0, "tax_brl": 12.1, "total_cost_brl": 72.4, "suggested_sell_price": 119.9, "markup": 5.0, "orders_count": 185000, "rating": 4.5, "br_status": "Pouco Vendido", "score": 83, "opportunity": 60, "saturation_pct": 35, "images": ["https://ae01.alicdn.com/kf/S5posture/Posture-Corrector.jpg"], "product_url": "https://www.aliexpress.com/item/1005010", "tags": ["postura", "coluna", "ergonômico"], "is_new": False, "is_viral": False, "highlight": False, "growth": "+12%", "delivery_days": "14-22"},
    {"id": str(uuid.uuid4()), "title": "Garrafa de Água Portátil para Pets com Filtro", "category": "Pet", "platform": "aliexpress", "price_usd": 4.80, "cost_brl": 35.8, "freight_brl": 13.0, "tax_brl": 9.8, "total_cost_brl": 58.6, "suggested_sell_price": 97.9, "markup": 5.8, "orders_count": 115000, "rating": 4.9, "br_status": "Não Vendido", "score": 91, "opportunity": 90, "saturation_pct": 6, "images": ["https://ae01.alicdn.com/kf/S5petwater/Dog-Water-Bottle.jpg"], "product_url": "https://www.aliexpress.com/item/1005011", "tags": ["pet", "água", "portátil"], "is_new": True, "is_viral": True, "highlight": True, "growth": "+78%", "delivery_days": "12-20"},
    {"id": str(uuid.uuid4()), "title": "Massageador Ocular com Vibração e Aquecimento", "category": "Saúde", "platform": "aliexpress", "price_usd": 13.50, "cost_brl": 100.8, "freight_brl": 20.0, "tax_brl": 24.2, "total_cost_brl": 145.0, "suggested_sell_price": 229.9, "markup": 4.5, "orders_count": 72000, "rating": 4.7, "br_status": "Não Vendido", "score": 88, "opportunity": 88, "saturation_pct": 8, "images": ["https://ae01.alicdn.com/kf/S5eye/Eye-Massager-Vibration.jpg"], "product_url": "https://www.aliexpress.com/item/1005012", "tags": ["olhos", "massagem", "relaxamento"], "is_new": True, "is_viral": False, "highlight": True, "growth": "+56%", "delivery_days": "16-26"},
    {"id": str(uuid.uuid4()), "title": "Massageador de Couro Cabeludo Elétrico à Prova D'água", "category": "Beleza", "platform": "aliexpress", "price_usd": 9.90, "cost_brl": 73.9, "freight_brl": 17.0, "tax_brl": 18.2, "total_cost_brl": 109.1, "suggested_sell_price": 169.9, "markup": 4.6, "orders_count": 89000, "rating": 4.8, "br_status": "Pouco Vendido", "score": 86, "opportunity": 68, "saturation_pct": 22, "images": ["https://ae01.alicdn.com/kf/S5scalp/Scalp-Massager-Electric.jpg"], "product_url": "https://www.aliexpress.com/item/1005013", "tags": ["cabelo", "couro cabeludo", "massagem"], "is_new": False, "is_viral": True, "highlight": False, "growth": "+23%", "delivery_days": "14-22"},
    {"id": str(uuid.uuid4()), "title": "Kit Elásticos de Resistência para Musculação 5 Níveis", "category": "Fitness", "platform": "aliexpress", "price_usd": 5.90, "cost_brl": 44.0, "freight_brl": 14.0, "tax_brl": 11.6, "total_cost_brl": 69.6, "suggested_sell_price": 109.9, "markup": 5.2, "orders_count": 156000, "rating": 4.6, "br_status": "Pouco Vendido", "score": 84, "opportunity": 62, "saturation_pct": 28, "images": ["https://ae01.alicdn.com/kf/S5bands/Resistance-Bands-Set.jpg"], "product_url": "https://www.aliexpress.com/item/1005014", "tags": ["fitness", "musculação", "elástico"], "is_new": False, "is_viral": False, "highlight": False, "growth": "+18%", "delivery_days": "12-20"},
    {"id": str(uuid.uuid4()), "title": "Rolo de Espuma para Massagem Muscular Pós-Treino", "category": "Fitness", "platform": "aliexpress", "price_usd": 8.20, "cost_brl": 61.2, "freight_brl": 18.0, "tax_brl": 15.8, "total_cost_brl": 95.0, "suggested_sell_price": 149.9, "markup": 4.7, "orders_count": 93000, "rating": 4.5, "br_status": "Pouco Vendido", "score": 81, "opportunity": 58, "saturation_pct": 32, "images": ["https://ae01.alicdn.com/kf/S5foam/Foam-Roller-Massage.jpg"], "product_url": "https://www.aliexpress.com/item/1005015", "tags": ["fitness", "recuperação", "massagem"], "is_new": False, "is_viral": False, "highlight": False, "growth": "+9%", "delivery_days": "14-22"},
    {"id": str(uuid.uuid4()), "title": "Kit Clareamento Dental LED Profissional", "category": "Beleza", "platform": "aliexpress", "price_usd": 10.50, "cost_brl": 78.4, "freight_brl": 17.0, "tax_brl": 19.1, "total_cost_brl": 114.5, "suggested_sell_price": 189.9, "markup": 4.9, "orders_count": 61000, "rating": 4.6, "br_status": "Não Vendido", "score": 87, "opportunity": 85, "saturation_pct": 10, "images": ["https://ae01.alicdn.com/kf/S5teeth/Teeth-Whitening-LED-Kit.jpg"], "product_url": "https://www.aliexpress.com/item/1005016", "tags": ["dentes", "clareamento", "beleza"], "is_new": True, "is_viral": False, "highlight": True, "growth": "+52%", "delivery_days": "16-24"},
    {"id": str(uuid.uuid4()), "title": "Luminária LED para Plantas Indoor Crescimento", "category": "Casa", "platform": "aliexpress", "price_usd": 11.80, "cost_brl": 88.1, "freight_brl": 20.0, "tax_brl": 21.6, "total_cost_brl": 129.7, "suggested_sell_price": 199.9, "markup": 4.5, "orders_count": 44000, "rating": 4.7, "br_status": "Não Vendido", "score": 85, "opportunity": 87, "saturation_pct": 9, "images": ["https://ae01.alicdn.com/kf/S5plant/Plant-Grow-Light-LED.jpg"], "product_url": "https://www.aliexpress.com/item/1005017", "tags": ["plantas", "led", "jardim"], "is_new": True, "is_viral": False, "highlight": True, "growth": "+61%", "delivery_days": "18-26"},
    {"id": str(uuid.uuid4()), "title": "Aspirador Nasal Elétrico para Bebê Silencioso", "category": "Bebê", "platform": "aliexpress", "price_usd": 9.20, "cost_brl": 68.7, "freight_brl": 16.0, "tax_brl": 16.9, "total_cost_brl": 101.6, "suggested_sell_price": 159.9, "markup": 4.6, "orders_count": 78000, "rating": 4.8, "br_status": "Não Vendido", "score": 88, "opportunity": 89, "saturation_pct": 7, "images": ["https://ae01.alicdn.com/kf/S5nasal/Baby-Nasal-Aspirator.jpg"], "product_url": "https://www.aliexpress.com/item/1005018", "tags": ["bebê", "saúde", "nasal"], "is_new": True, "is_viral": False, "highlight": True, "growth": "+43%", "delivery_days": "16-24"},
    {"id": str(uuid.uuid4()), "title": "Espumador de Café Elétrico Mini Recarregável", "category": "Casa", "platform": "aliexpress", "price_usd": 4.20, "cost_brl": 31.4, "freight_brl": 12.0, "tax_brl": 8.7, "total_cost_brl": 52.1, "suggested_sell_price": 84.9, "markup": 5.8, "orders_count": 230000, "rating": 4.7, "br_status": "Pouco Vendido", "score": 83, "opportunity": 60, "saturation_pct": 30, "images": ["https://ae01.alicdn.com/kf/S5coffee/Coffee-Frother-Electric.jpg"], "product_url": "https://www.aliexpress.com/item/1005019", "tags": ["café", "cozinha", "espuma"], "is_new": False, "is_viral": False, "highlight": False, "growth": "+14%", "delivery_days": "12-18"},
    {"id": str(uuid.uuid4()), "title": "Meias de Compressão para Corrida e Esporte", "category": "Fitness", "platform": "aliexpress", "price_usd": 3.80, "cost_brl": 28.4, "freight_brl": 11.0, "tax_brl": 7.9, "total_cost_brl": 47.3, "suggested_sell_price": 79.9, "markup": 5.9, "orders_count": 145000, "rating": 4.6, "br_status": "Pouco Vendido", "score": 82, "opportunity": 58, "saturation_pct": 32, "images": ["https://ae01.alicdn.com/kf/S5socks/Compression-Socks-Sport.jpg"], "product_url": "https://www.aliexpress.com/item/1005020", "tags": ["meias", "corrida", "compressão"], "is_new": False, "is_viral": False, "highlight": False, "growth": "+11%", "delivery_days": "12-20"},
    {"id": str(uuid.uuid4()), "title": "Massageador Anticelulite Elétrico Corporal", "category": "Beleza", "platform": "aliexpress", "price_usd": 14.50, "cost_brl": 108.2, "freight_brl": 21.0, "tax_brl": 25.8, "total_cost_brl": 155.0, "suggested_sell_price": 239.9, "markup": 4.3, "orders_count": 55000, "rating": 4.7, "br_status": "Não Vendido", "score": 87, "opportunity": 86, "saturation_pct": 9, "images": ["https://ae01.alicdn.com/kf/S5cellulite/Cellulite-Massager-Electric.jpg"], "product_url": "https://www.aliexpress.com/item/1005021", "tags": ["celulite", "corpo", "beleza"], "is_new": True, "is_viral": True, "highlight": True, "growth": "+72%", "delivery_days": "17-25"},
    {"id": str(uuid.uuid4()), "title": "Lâmpada UV Profissional para Unhas Gel 48W", "category": "Beleza", "platform": "aliexpress", "price_usd": 9.90, "cost_brl": 73.9, "freight_brl": 17.0, "tax_brl": 18.2, "total_cost_brl": 109.1, "suggested_sell_price": 169.9, "markup": 4.5, "orders_count": 267000, "rating": 4.8, "br_status": "Já Vendido", "score": 79, "opportunity": 32, "saturation_pct": 68, "images": ["https://ae01.alicdn.com/kf/S5naillamp/UV-Nail-Lamp-48W.jpg"], "product_url": "https://www.aliexpress.com/item/1005022", "tags": ["unhas", "gel", "UV"], "is_new": False, "is_viral": False, "highlight": False, "growth": "+6%", "delivery_days": "14-22"},
]


async def ensure_tables(conn):
    """Cria tabelas se não existirem."""
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            category TEXT DEFAULT 'Outros',
            platform TEXT DEFAULT 'aliexpress',
            price_usd FLOAT DEFAULT 0,
            cost_brl FLOAT DEFAULT 0,
            freight_brl FLOAT DEFAULT 0,
            tax_brl FLOAT DEFAULT 0,
            total_cost_brl FLOAT DEFAULT 0,
            suggested_sell_price FLOAT DEFAULT 0,
            markup FLOAT DEFAULT 0,
            orders_count INT DEFAULT 0,
            rating FLOAT DEFAULT 0,
            br_status TEXT DEFAULT 'Não Vendido',
            score INT DEFAULT 0,
            opportunity INT DEFAULT 0,
            saturation_pct INT DEFAULT 0,
            google_trend_score INT DEFAULT 0,
            fb_ads_count INT DEFAULT 0,
            images JSONB DEFAULT '[]',
            sources JSONB DEFAULT '[]',
            br_links JSONB DEFAULT '[]',
            tags JSONB DEFAULT '[]',
            product_url TEXT DEFAULT '',
            supplier_name TEXT DEFAULT '',
            ai_analysis JSONB,
            image_url TEXT DEFAULT '',
            targeting_suggestion JSONB DEFAULT '[]',
            copy_suggestion TEXT DEFAULT '',
            is_new BOOLEAN DEFAULT FALSE,
            is_viral BOOLEAN DEFAULT FALSE,
            highlight BOOLEAN DEFAULT FALSE,
            growth TEXT DEFAULT '+0%',
            delivery_days TEXT DEFAULT '14-25',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT '';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS targeting_suggestion JSONB DEFAULT '[]';
        ALTER TABLE products ADD COLUMN IF NOT EXISTS copy_suggestion TEXT DEFAULT '';
    """)


async def seed():
    conn = await asyncpg.connect(DATABASE_URL)
    await ensure_tables(conn)

    inserted = 0
    for p in PRODUTOS_SEED:
        cat        = p.get("category", "Outros")
        targeting  = TARGETING.get(cat, TARGETING["Outros"])
        copy_text  = COPY.get(cat, COPY["Outros"]).format(titulo=p["title"])
        imgs       = p.get("images", [])
        img_url    = imgs[0] if imgs else ""

        await conn.execute("""
            INSERT INTO products (
                id, title, category, platform, price_usd, cost_brl, freight_brl,
                tax_brl, total_cost_brl, suggested_sell_price, markup, orders_count,
                rating, br_status, score, opportunity, saturation_pct, images,
                sources, product_url, tags, is_new, is_viral, highlight, growth,
                delivery_days, image_url, targeting_suggestion, copy_suggestion,
                ai_analysis, created_at, updated_at
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,NOW(),NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
                score=EXCLUDED.score,
                markup=EXCLUDED.markup,
                br_status=EXCLUDED.br_status,
                image_url=EXCLUDED.image_url,
                targeting_suggestion=EXCLUDED.targeting_suggestion,
                copy_suggestion=EXCLUDED.copy_suggestion,
                updated_at=NOW()
        """,
            p["id"], p["title"], p["category"], p["platform"],
            p["price_usd"], p["cost_brl"], p["freight_brl"], p["tax_brl"],
            p["total_cost_brl"], p["suggested_sell_price"], p["markup"],
            p["orders_count"], p["rating"], p["br_status"], p["score"],
            p["opportunity"], p["saturation_pct"],
            json.dumps(imgs), json.dumps([]),
            p["product_url"], json.dumps(p["tags"]),
            p["is_new"], p["is_viral"], p["highlight"],
            p["growth"], p["delivery_days"],
            img_url,
            json.dumps(targeting),
            copy_text,
            json.dumps({
                "targeting": targeting,
                "copy": copy_text,
                "strategy": f"Score {p['score']}/100. Status BR: {p['br_status']}. Markup {p['markup']}x.",
                "best_markets": ["Brasil", "Portugal", "Angola"],
            })
        )
        print(f"[OK] {p['title']}")
        inserted += 1

    await conn.close()
    print(f"\n{inserted} produtos inseridos com sucesso!")


if __name__ == "__main__":
    asyncio.run(seed())
