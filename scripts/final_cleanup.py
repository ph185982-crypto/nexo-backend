"""
Mantém apenas produtos curados (20 produtos finais).
Deleta duplicados e produtos não curados (Sony/HTC headphones etc).
"""
import asyncio, asyncpg

DATABASE_URL = "postgresql://nexo_db_wjv3_user:s0yvLJLFSBBd8BbsnFJS5Yq5WnJi2uu9@dpg-d6m1l3fgi27c738atp30-a.oregon-postgres.render.com/nexo_db_wjv3"

# Prefixos dos produtos curados (primeiros 30 caracteres do título, lowercase)
CURATED_PREFIXES = [
    "pistola de massagem muscular p",
    "escova alisadora rotativa de c",
    "mascara led facial 7 cores rej",
    "máscara led facial 7 cores rej",
    "brinquedo automático para gato",
    "mini mixer portátil usb para s",
    "suporte magnético veicular para",
    "massageador elétrico para joelh",
    "corretor de postura ajustável i",
    "garrafa de água portátil para p",
    "massageador ocular com vibração",
    "massageador de couro cabeludo e",
    "kit elásticos de resistência pa",
    "rolo de espuma para massagem mu",
    "kit clareamento dental led prof",
    "luminária led para plantas indo",
    "aspirador nasal elétrico para b",
    "espumador de café elétrico mini",
    "meias de compressão para corrid",
    "massageador anticelulite elétri",
]


def matches_curated(title: str) -> bool:
    t = title.lower().strip()
    for prefix in CURATED_PREFIXES:
        if t.startswith(prefix[:25]):  # check first 25 chars
            return True
    return False


async def final_cleanup():
    conn = await asyncpg.connect(DATABASE_URL)

    rows = await conn.fetch("SELECT id, title, score FROM products ORDER BY title, score DESC")
    print(f"Total antes: {len(rows)}")

    # Group by curated prefix, keep only the best (highest score) per curated product
    curated_keep = {}  # prefix -> best row
    non_curated = []

    for row in rows:
        if matches_curated(row['title']):
            key = row['title'].lower()[:25]
            if key not in curated_keep:
                curated_keep[key] = row  # first is highest score (ordered DESC)
            else:
                non_curated.append(row['id'])  # dup curated
        else:
            non_curated.append(row['id'])

    keep_ids = [r['id'] for r in curated_keep.values()]
    delete_ids = non_curated

    print(f"\nMANTER ({len(keep_ids)}):")
    for r in sorted(curated_keep.values(), key=lambda x: x['score'], reverse=True):
        print(f"  {r['score']:3} | {r['title'][:70]}")

    print(f"\nDELETAR ({len(delete_ids)}):")
    for rid in delete_ids:
        row = next((r for r in rows if r['id'] == rid), None)
        if row:
            print(f"  {row['score']:3} | {row['title'][:70]}")

    if delete_ids:
        await conn.execute("DELETE FROM products WHERE id = ANY($1::text[])", delete_ids)
        print(f"\n[OK] {len(delete_ids)} produtos removidos")

    final = await conn.fetchval("SELECT COUNT(*) FROM products")
    print(f"[OK] {final} produtos finais no banco")

    await conn.close()


if __name__ == "__main__":
    asyncio.run(final_cleanup())
