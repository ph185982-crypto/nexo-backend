"""Trends Router"""
from fastapi import APIRouter, Depends
from database.db import Database
from routers.auth import get_current_user
from scrapers.google_trends import GoogleTrendsScraper

router = APIRouter()

@router.get("")
async def get_trends(geo: str = "BR", user=Depends(get_current_user)):
    db = Database()
    stored = await db.get_trends(geo=geo)
    if stored:
        return {"trends": stored}
    # fallback: fetch live
    scraper = GoogleTrendsScraper()
    trends = await scraper.get_trending_products(geo=geo)
    if trends:
        await db.upsert_trends(trends)
    return {"trends": trends}

@router.get("/rising")
async def rising(user=Depends(get_current_user)):
    scraper = GoogleTrendsScraper()
    return {"rising": await scraper.get_rising_queries()}
