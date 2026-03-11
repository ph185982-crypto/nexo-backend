"""
Remove produtos garbage (charutos, roupas infantis, bandeiras, etc.)
Mantém apenas produtos curados de fitness/saúde/pets/beleza
"""
import asyncio, asyncpg

DATABASE_URL = "postgresql://nexo_db_wjv3_user:s0yvLJLFSBBd8BbsnFJS5Yq5WnJi2uu9@dpg-d6m1l3fgi27c738atp30-a.oregon-postgres.render.com/nexo_db_wjv3"

# Palavras-chave que indicam produto garbage (não queremos no sistema)
GARBAGE_KEYWORDS = [
    "charuto", "cigarro", "humidor",
    "bandeira", "flag",
    "jaqueta", "casaco", "roupas", "menina", "menino", "criança", "crianças", "kids", "beisebol",
    "afnan", "parfum", "unisex rebel",
    "mangueira farpada", "acoplamento", "adaptador de",
    "porta-chaves", "d-dead", "s-space",
    "waffle", "flower cake", "stencil",
    "adesivo de acne", "hidrocolóide",
    "cortador de charuto", "tesoura de charuto",
    "estojo de charuto", "suporte de charuto",
    "suporte de tubo", "flip-top de metal",
    "2d flat", "personalizar bandeira", "bandeira da france",
]

# Títulos válidos que DEVEM ser mantidos (nossos curados)
KEEP_KEYWORDS = [
    "massageador", "massagem", "pistola de massagem",
    "escova alisadora", "máscara led", "mascara led",
    "brinquedo", "gato",
    "garrafa", "pets",
    "clareamento dental",
    "anticelulite",
    "corretor de postura",
    "aspirador nasal",
    "mini mixer",
    "espumador de café",
    "elásticos de resistência",
    "meias de compressão",
    "luminária led para plantas",
    "rolo de espuma",
    "lâmpada uv para unhas",
    "suporte magnético",
]


async def clean():
    conn = await asyncpg.connect(DATABASE_URL)

    rows = await conn.fetch("SELECT id, title, score FROM products ORDER BY score DESC")
    print(f"Produtos antes da limpeza: {len(rows)}")

    to_delete = []
    to_keep = []

    for row in rows:
        title_lower = row['title'].lower()

        is_garbage = any(kw in title_lower for kw in GARBAGE_KEYWORDS)

        if is_garbage:
            to_delete.append(row['id'])
            print(f"  DELETAR: {row['score']:3} | {row['title'][:70]}")
        else:
            to_keep.append(row['id'])

    print(f"\nManter: {len(to_keep)} | Deletar: {len(to_delete)}")

    if to_delete:
        await conn.execute("DELETE FROM products WHERE id = ANY($1::text[])", to_delete)
        print(f"[OK] {len(to_delete)} produtos garbage removidos")

    # Agora deduplica por título (mantém maior score)
    rows2 = await conn.fetch("SELECT id, title, score FROM products ORDER BY title, score DESC")
    seen = {}
    dup_ids = []
    for row in rows2:
        key = row['title'][:40].lower().strip()
        if key in seen:
            dup_ids.append(row['id'])
            print(f"  DUP: {row['score']:3} | {row['title'][:70]}")
        else:
            seen[key] = row['id']

    if dup_ids:
        await conn.execute("DELETE FROM products WHERE id = ANY($1::text[])", dup_ids)
        print(f"[OK] {len(dup_ids)} duplicados removidos")

    remaining = await conn.fetchval("SELECT COUNT(*) FROM products")
    print(f"\n[OK] {remaining} produtos finais no banco")

    # Lista final
    final = await conn.fetch("SELECT title, score FROM products ORDER BY score DESC")
    for r in final:
        print(f"  {r['score']:3} | {r['title'][:70]}")

    await conn.close()


if __name__ == "__main__":
    asyncio.run(clean())
