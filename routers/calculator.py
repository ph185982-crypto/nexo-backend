"""Profit Calculator Router"""
from fastapi import APIRouter, Depends
from typing import Optional
from routers.auth import get_current_user
from services.profit_calculator import ProfitCalculator

router = APIRouter()

@router.get("")
async def calculate(
    cost_usd: float, usd_brl: float=0, freight: float=5.0, tax: float=0,
    markup: float=3.0, qty: int=100, marketplace: str="shopee",
    user=Depends(get_current_user)
):
    return await ProfitCalculator().simulate(
        cost_usd=cost_usd, usd_brl=usd_brl or None, freight=freight,
        tax=tax, markup=markup, qty=qty, marketplace=marketplace
    )
