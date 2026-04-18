"""
Import Ferramentas Router — /api/import

Fluxo:
  1. POST /start       → cria job, dispara scraping em background
  2. GET  /status      → retorna progresso do job mais recente
  3. GET  /products    → lista produtos pendentes de revisão
  4. POST /generate-image/{id} → gera imagem IA para um produto
  5. POST /publish/{id}        → aprova e publica um produto no banco
  6. POST /publish-all         → publica todos os produtos aprovados/pendentes
  7. DELETE /products/{id}     → rejeita/exclui produto da fila
"""
import asyncio, logging, uuid, json
from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from database.db import Database
from routers.auth import get_current_user
from scrapers.vendizap import fetch_all_products, CAT_FERRAMENTAS
from services.image_generator import generate_product_image, is_image_gen_enabled

router = APIRouter()
logger = logging.getLogger(__name__)

MARGIN = 0.75   # 75% de margem → preço_venda = custo * 1.75


def _sell_price(cost: float) -> float:
    return round(cost * (1 + MARGIN), 2)


# ── Background task ──────────────────────────────────────────────────────────

async def _run_import(job_id: str, generate_images: bool):
    db = Database()
    try:
        await db.update_import_job(job_id, status="scraping")

        # 1. Scrape todos os produtos do fornecedor (sem filtro de categoria)
        raw = await fetch_all_products()
        if not raw:
            await db.update_import_job(job_id, status="error", error="Nenhum produto retornado pelo fornecedor")
            return

        # 2. Calcular preço de venda com margem
        products = []
        for p in raw:
            cost = float(p.get("cost_brl") or 0)
            products.append({
                **p,
                "sell_price":      _sell_price(cost),
                "original_images": p.get("images", []),
            })

        await db.update_import_job(job_id, status="saving", total=len(products))
        await db.save_import_products(job_id, products)

        # 3. Geração de imagens IA (opcional)
        if generate_images and is_image_gen_enabled():
            await db.update_import_job(job_id, status="generating_images")
            pending = await db.get_import_products(job_id)
            gen_count = 0
            for pr in pending:
                try:
                    url = await generate_product_image(pr["title"], pr.get("sku", ""))
                    if url:
                        await db.update_import_product(str(pr["id"]), ai_image_url=url)
                        gen_count += 1
                    await db.update_import_job(job_id, generated=gen_count, processed=gen_count)
                    await asyncio.sleep(1)   # rate-limit DALL-E
                except Exception as e:
                    logger.warning(f"Geração de imagem falhou para {pr['id']}: {e}")

        counts = await db.count_import_products(job_id)
        await db.update_import_job(
            job_id,
            status="done",
            total=sum(counts.values()),
            processed=sum(counts.values()),
        )
        logger.info(f"Import job {job_id} concluído — {sum(counts.values())} produtos")

    except Exception as e:
        logger.error(f"Import job {job_id} falhou: {e}", exc_info=True)
        await db.update_import_job(job_id, status="error", error=str(e))


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/start")
async def start_import(
    payload: dict = {},
    background_tasks: BackgroundTasks = None,
    user=Depends(get_current_user),
):
    """Inicia scraping do fornecedor em background."""
    generate_images = payload.get("generate_images", False)
    db = Database()
    job_id = await db.create_import_job()
    background_tasks.add_task(_run_import, job_id, generate_images)
    return {
        "job_id":   job_id,
        "status":   "started",
        "message":  "Importação iniciada — aguarde ~15s para scraping concluir.",
        "images_ai": generate_images and is_image_gen_enabled(),
    }


@router.get("/status")
async def import_status(user=Depends(get_current_user)):
    """Retorna o job de importação mais recente."""
    job = await Database().get_latest_import_job()
    if not job:
        return {"status": "idle", "message": "Nenhuma importação realizada ainda"}
    counts = await Database().count_import_products(str(job["id"]))
    return {**{k: str(v) if hasattr(v, 'isoformat') else v for k, v in job.items()}, "counts": counts}


@router.get("/status/{job_id}")
async def import_status_by_id(job_id: str, user=Depends(get_current_user)):
    job = await Database().get_import_job(job_id)
    if not job:
        raise HTTPException(404, "Job não encontrado")
    counts = await Database().count_import_products(job_id)
    return {**{k: str(v) if hasattr(v, 'isoformat') else v for k, v in job.items()}, "counts": counts}


@router.get("/products")
async def list_import_products(
    status: str = None,
    job_id: str = None,
    user=Depends(get_current_user),
):
    """Lista produtos na fila de revisão."""
    db = Database()
    if not job_id:
        job = await db.get_latest_import_job()
        if not job:
            return {"products": [], "total": 0}
        job_id = str(job["id"])

    products = await db.get_import_products(job_id, status=status)
    result = []
    for p in products:
        orig = p.get("original_images")
        if isinstance(orig, str):
            try:
                orig = json.loads(orig)
            except Exception:
                orig = []
        result.append({
            "id":              str(p["id"]),
            "job_id":          str(p["job_id"]),
            "vendor_id":       p.get("vendor_id", ""),
            "sku":             p.get("sku", ""),
            "title":           p.get("title", ""),
            "description":     p.get("description", ""),
            "cost_brl":        float(p.get("cost_brl") or 0),
            "sell_price":      float(p.get("sell_price") or 0),
            "category":        p.get("category", "Geral"),
            "original_images": orig or [],
            "ai_image_url":    p.get("ai_image_url", ""),
            "status":          p.get("status", "pending"),
        })
    return {"products": result, "total": len(result), "job_id": job_id}


@router.post("/generate-image/{product_id}")
async def generate_image(product_id: str, user=Depends(get_current_user)):
    """Gera imagem IA para um produto específico."""
    if not is_image_gen_enabled():
        raise HTTPException(400, "OPENAI_API_KEY não configurado")
    db = Database()
    pool = await db._p()
    async with pool.acquire() as c:
        row = await c.fetchrow("SELECT * FROM import_products WHERE id=$1", product_id)
    if not row:
        raise HTTPException(404, "Produto não encontrado")

    pr = dict(row)
    url = await generate_product_image(pr["title"], pr.get("sku", ""))
    if not url:
        raise HTTPException(502, "Geração de imagem falhou — verifique OPENAI_API_KEY")
    await db.update_import_product(product_id, ai_image_url=url)
    return {"url": url, "product_id": product_id}


@router.post("/publish/{product_id}")
async def publish_product(product_id: str, user=Depends(get_current_user)):
    """Aprova e publica um produto no banco principal de produtos."""
    db = Database()
    pool = await db._p()
    async with pool.acquire() as c:
        row = await c.fetchrow("SELECT * FROM import_products WHERE id=$1", product_id)
    if not row:
        raise HTTPException(404, "Produto não encontrado")

    pr = dict(row)
    orig = pr.get("original_images")
    if isinstance(orig, str):
        try:
            orig = json.loads(orig)
        except Exception:
            orig = []

    # Monta imagens: prefere AI, fallback para originais do fornecedor
    ai_img = pr.get("ai_image_url", "")
    images = [ai_img] if ai_img else [img.get("original") or img.get("thumb", "") for img in (orig or []) if img]
    images = [i for i in images if i]

    product = {
        "id":                    str(uuid.uuid4()),
        "title":                 pr["title"],
        "category":              pr.get("category", "Geral"),
        "platform":              "vendizap",
        "price_usd":             0,
        "cost_brl":              float(pr.get("cost_brl") or 0),
        "freight_brl":           0,
        "tax_brl":               0,
        "total_cost_brl":        float(pr.get("cost_brl") or 0),
        "suggested_sell_price":  float(pr.get("sell_price") or 0),
        "markup":                MARGIN,
        "orders_count":          0,
        "rating":                0,
        "br_status":             "Não Vendido",
        "score":                 50,
        "opportunity":           70,
        "saturation_pct":        10,
        "google_trend_score":    0,
        "fb_ads_count":          0,
        "images":                json.dumps(images),
        "sources":               json.dumps([]),
        "br_links":              json.dumps([]),
        "tags":                  json.dumps([]),
        "product_url":           "https://yanne.vendizap.com",
        "supplier_name":         "Luciy Variedades",
        "ai_analysis":           None,
        "image_url":             images[0] if images else "",
        "targeting_suggestion":  json.dumps([]),
        "copy_suggestion":       pr.get("description", ""),
        "is_new":                True,
        "is_viral":              False,
        "highlight":             False,
        "growth":                "+0%",
        "delivery_days":         "1-5",
    }

    await db.upsert_products([product])
    await db.update_import_product(product_id, status="published")
    return {"status": "published", "product_id": product["id"], "title": pr["title"]}


@router.post("/publish-all")
async def publish_all(user=Depends(get_current_user)):
    """Publica todos os produtos pendentes do job mais recente."""
    db = Database()
    job = await db.get_latest_import_job()
    if not job:
        raise HTTPException(404, "Nenhum job de importação encontrado")

    job_id = str(job["id"])
    pending = await db.get_import_products(job_id, status="pending")
    published = 0
    errors = []

    for pr in pending:
        try:
            orig = pr.get("original_images")
            if isinstance(orig, str):
                try:
                    orig = json.loads(orig)
                except Exception:
                    orig = []

            ai_img = pr.get("ai_image_url", "")
            images = [ai_img] if ai_img else [img.get("original") or img.get("thumb", "") for img in (orig or []) if img]
            images = [i for i in images if i]

            product = {
                "id":                    str(uuid.uuid4()),
                "title":                 pr["title"],
                "category":              pr.get("category", "Geral"),
                "platform":              "vendizap",
                "price_usd":             0,
                "cost_brl":              float(pr.get("cost_brl") or 0),
                "freight_brl":           0,
                "tax_brl":               0,
                "total_cost_brl":        float(pr.get("cost_brl") or 0),
                "suggested_sell_price":  float(pr.get("sell_price") or 0),
                "markup":                MARGIN,
                "orders_count":          0,
                "rating":                0,
                "br_status":             "Não Vendido",
                "score":                 50,
                "opportunity":           70,
                "saturation_pct":        10,
                "google_trend_score":    0,
                "fb_ads_count":          0,
                "images":                json.dumps(images),
                "sources":               json.dumps([]),
                "br_links":              json.dumps([]),
                "tags":                  json.dumps([]),
                "product_url":           "https://yanne.vendizap.com",
                "supplier_name":         "Luciy Variedades",
                "ai_analysis":           None,
                "image_url":             images[0] if images else "",
                "targeting_suggestion":  json.dumps([]),
                "copy_suggestion":       pr.get("description", ""),
                "is_new":                True,
                "is_viral":              False,
                "highlight":             False,
                "growth":                "+0%",
                "delivery_days":         "1-5",
            }

            await db.upsert_products([product])
            await db.update_import_product(str(pr["id"]), status="published")
            published += 1
        except Exception as e:
            errors.append(str(e))

    return {
        "published": published,
        "errors":    len(errors),
        "job_id":    job_id,
    }


@router.delete("/products/{product_id}")
async def reject_product(product_id: str, user=Depends(get_current_user)):
    """Rejeita e remove produto da fila."""
    db = Database()
    await db.update_import_product(product_id, status="rejected")
    return {"status": "rejected", "product_id": product_id}
