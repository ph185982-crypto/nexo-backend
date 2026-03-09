"""Ads Spy Router"""
from fastapi import APIRouter, Depends, BackgroundTasks
from typing import Optional
from database.db import Database
from routers.auth import get_current_user
from scrapers.facebook_ads import FacebookAdsSpy

router = APIRouter()

@router.get("")
async def get_ads(keyword: Optional[str]=None, active_only: bool=True, limit: int=50, user=Depends(get_current_user)):
    return {"ads": await Database().get_ads(keyword=keyword, active_only=active_only, limit=limit)}

@router.post("/spy")
async def spy(keyword: str, background_tasks: BackgroundTasks, user=Depends(get_current_user)):
    background_tasks.add_task(FacebookAdsSpy().scrape_and_save, keyword)
    return {"status": "scraping", "keyword": keyword}
