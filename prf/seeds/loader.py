"""
JSON data loader for PRF seed files.
Discovers and loads .json files from prf/seeds/ subdirectories.
"""
from __future__ import annotations
import json
import os
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

SEEDS_DIR = Path(__file__).parent


def load_questions() -> list[dict]:
    return _load_json_dir(SEEDS_DIR / "questions")


def load_articles() -> list[dict]:
    return _load_json_dir(SEEDS_DIR / "articles")


def _load_json_dir(directory: Path) -> list[dict]:
    if not directory.exists():
        logger.warning(f"[PRF] Seed directory not found: {directory}")
        return []

    all_items = []
    for fp in sorted(directory.glob("*.json")):
        try:
            with open(fp, encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list):
                all_items.extend(data)
                logger.info(f"[PRF] Loaded {len(data)} items from {fp.name}")
            else:
                logger.warning(f"[PRF] Expected list in {fp.name}, got {type(data).__name__}")
        except Exception as e:
            logger.warning(f"[PRF] Failed to load {fp.name}: {e}")

    return all_items
