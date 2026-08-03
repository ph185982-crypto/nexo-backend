"""
JSON data loader for PRF and PMGO seed files.
Discovers and loads .json files from:
  - prf/seeds/questions/   (PRF question seeds)
  - prf/seeds/articles/    (legal article seeds)
  - data/pmgo/seed/        (PMGO question seeds)
  - data/pmgo/imports/     (authorized PMGO imports)
"""
from __future__ import annotations
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

SEEDS_DIR = Path(__file__).parent
REPO_ROOT = SEEDS_DIR.parent.parent
PMGO_SEED_DIR = REPO_ROOT / "data" / "pmgo" / "seed"
PMGO_IMPORT_DIR = REPO_ROOT / "data" / "pmgo" / "imports"


def load_questions() -> list[dict]:
    """Load all questions: PRF seeds + PMGO seeds + PMGO authorized imports."""
    items = _load_json_dir(SEEDS_DIR / "questions")
    items.extend(_load_json_dir(PMGO_SEED_DIR, source_tag="PMGO/seed"))
    items.extend(_load_json_dir(PMGO_IMPORT_DIR, source_tag="PMGO/import"))
    return items


def load_articles() -> list[dict]:
    return _load_json_dir(SEEDS_DIR / "articles")


def _load_json_dir(directory: Path, source_tag: str | None = None) -> list[dict]:
    if not directory.exists():
        logger.info(f"[loader] Directory not found, skipping: {directory}")
        return []

    all_items = []
    for fp in sorted(directory.glob("*.json")):
        try:
            with open(fp, encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list):
                if source_tag:
                    for item in data:
                        item.setdefault("_seed_source", source_tag)
                all_items.extend(data)
                logger.info(f"[loader] Loaded {len(data)} items from {fp.name}")
            else:
                logger.warning(f"[loader] Expected list in {fp.name}, got {type(data).__name__}")
        except Exception as e:
            logger.warning(f"[loader] Failed to load {fp.name}: {e}")

    return all_items
