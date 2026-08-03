"""
QuestionIngestionPipeline — orchestrates normalize → validate → deduplicate → enrich.

Supports multiple source paths:
  1. Seed files bundled in the repo (data/pmgo/seed/)
  2. Authorized CSV/JSON imports (data/pmgo/imports/)
  3. Any caller-supplied list of raw dicts

The pipeline is pure: no DB I/O. Callers decide what to do with the output.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

from .deduplicator import Deduplicator
from .detector import enrich
from .models import IngestedQuestion, SourceType
from .normalizer import normalize
from .validator import validate

logger = logging.getLogger(__name__)

# Default seed and import directories relative to the repo root
_REPO_ROOT = Path(__file__).parent.parent.parent
PMGO_SEED_DIR = _REPO_ROOT / "data" / "pmgo" / "seed"
PMGO_IMPORT_DIR = _REPO_ROOT / "data" / "pmgo" / "imports"


@dataclass
class IngestionReport:
    total_raw: int = 0
    normalized: int = 0
    validation_errors: int = 0
    duplicates_skipped: int = 0
    enriched: int = 0
    accepted: int = 0
    error_details: list[dict] = field(default_factory=list)

    @property
    def acceptance_rate(self) -> float:
        return round(self.accepted / self.total_raw, 4) if self.total_raw else 0.0


class QuestionIngestionPipeline:
    """
    Stateless pipeline: call run() as many times as needed.

    Parameters
    ----------
    existing_hashes:
        Set of content hashes already in the database, used by the
        deduplicator to skip re-imports. Pass an empty set (default)
        to accept all non-duplicate records within the run.
    """

    def __init__(self, existing_hashes: set[str] | None = None) -> None:
        self._existing_hashes = existing_hashes or set()

    # ── Public ────────────────────────────────────────────────────────

    def run_from_seed_dirs(
        self,
        seed_dir: Path = PMGO_SEED_DIR,
        import_dir: Path = PMGO_IMPORT_DIR,
    ) -> tuple[list[IngestedQuestion], IngestionReport]:
        """Load all JSON files from the seed and import directories and run the pipeline."""
        raw_records: list[dict] = []

        for directory, source_type in [
            (seed_dir, SourceType.SEED),
            (import_dir, SourceType.AUTHORIZED_IMPORT),
        ]:
            if not directory.exists():
                logger.info(f"[ingestion] Directory not found, skipping: {directory}")
                continue
            for fp in sorted(directory.glob("*.json")):
                loaded = self._load_json_file(fp)
                for item in loaded:
                    item["_source_type"] = source_type
                raw_records.extend(loaded)
                logger.info(f"[ingestion] Loaded {len(loaded)} records from {fp.name}")

        return self.run(raw_records)

    def run(
        self,
        raw_records: list[dict],
        source_type: SourceType = SourceType.UNKNOWN,
    ) -> tuple[list[IngestedQuestion], IngestionReport]:
        """Process a list of raw question dicts through the full pipeline."""
        report = IngestionReport(total_raw=len(raw_records))
        dedup = Deduplicator(self._existing_hashes)
        accepted: list[IngestedQuestion] = []

        for i, raw in enumerate(raw_records):
            effective_source = raw.get("_source_type", source_type)

            # 1. Normalize
            q = normalize(raw, effective_source)
            if q is None:
                report.validation_errors += 1
                report.error_details.append(
                    {"index": i, "error": "normalization failed", "raw": raw.get("text", "")[:80]}
                )
                continue
            report.normalized += 1

            # 2. Validate
            errors = validate(q)
            if errors:
                report.validation_errors += 1
                report.error_details.append(
                    {"index": i, "error": "; ".join(errors), "text": q.text[:80]}
                )
                logger.debug(f"[ingestion] Validation errors in record {i}: {errors}")
                continue

            # 3. Deduplicate
            if dedup.is_duplicate(q):
                continue

            # 4. Enrich
            enrich(q)
            report.enriched += 1
            accepted.append(q)

        report.duplicates_skipped = dedup.duplicates_skipped
        report.accepted = len(accepted)
        return accepted, report

    # ── Private ───────────────────────────────────────────────────────

    @staticmethod
    def _load_json_file(fp: Path) -> list[dict]:
        try:
            with open(fp, encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list):
                return data
            logger.warning(f"[ingestion] Expected list in {fp.name}, got {type(data).__name__}")
            return []
        except Exception as e:
            logger.warning(f"[ingestion] Failed to load {fp.name}: {e}")
            return []
