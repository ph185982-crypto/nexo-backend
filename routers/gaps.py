"""Market Gap Router"""
from fastapi import APIRouter, Depends
from database.db import Database
from routers.auth import get_current_user

router = APIRouter()

@router.get("")
async def gaps(min_opportunity: float=70.0, user=Depends(get_current_user)):
    return {"gaps": await Database().get_market_gaps(min_opportunity)}
