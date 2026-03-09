"""
Export Router — CSV and Excel export of products
"""
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from typing import Optional
from database.db import Database
from routers.auth import get_current_user
import csv, io, json
from datetime import datetime

router = APIRouter()
db = Database()


@router.get("/csv")
async def export_csv(
    category: Optional[str] = None,
    min_markup: float = 3.0,
    limit: int = 200,
    user=Depends(get_current_user)
):
    products = await db.get_products(category=category, min_markup=min_markup, limit=limit)

    output = io.StringIO()
    writer = csv.writer(output)

    # Header
    writer.writerow([
        "Nome", "Categoria", "Plataforma",
        "Preço USD", "Custo BRL", "Frete BRL", "Impostos BRL", "Custo Total BRL",
        "Preço Sugerido", "Markup", "Margem %",
        "Status BR", "Score", "Oportunidade %",
        "Pedidos Globais", "Rating", "Link do Produto"
    ])

    for p in products:
        margin = round((p.get("suggested_sell_price",0) - p.get("total_cost_brl",0)) / max(p.get("suggested_sell_price",1),1) * 100, 1)
        writer.writerow([
            p.get("title",""),
            p.get("category",""),
            p.get("platform",""),
            p.get("price_usd",""),
            p.get("cost_brl",""),
            p.get("freight_brl",""),
            p.get("tax_brl",""),
            p.get("total_cost_brl",""),
            p.get("suggested_sell_price",""),
            p.get("markup",""),
            f"{margin}%",
            p.get("br_status",""),
            p.get("score",""),
            f"{p.get('opportunity',0)}%",
            p.get("orders_count",""),
            p.get("rating",""),
            p.get("product_url",""),
        ])

    output.seek(0)
    filename = f"nexo_products_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([output.getvalue().encode("utf-8-sig")]),  # utf-8-sig for Excel compatibility
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.get("/json")
async def export_json(
    category: Optional[str] = None,
    min_markup: float = 3.0,
    limit: int = 200,
    user=Depends(get_current_user)
):
    products = await db.get_products(category=category, min_markup=min_markup, limit=limit)
    output = json.dumps({"exported_at": datetime.now().isoformat(), "total": len(products), "products": products}, ensure_ascii=False, indent=2, default=str)
    filename = f"nexo_products_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    return StreamingResponse(
        iter([output.encode("utf-8")]),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
