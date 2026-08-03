"""
Coverage router — PMGO and PRF question bank coverage reporting.

GET /api/prf/coverage/pmgo   → CoverageReport for PMGO exam
GET /api/prf/coverage/prf    → CoverageReport for PRF exam
GET /api/prf/coverage/ingest → Run ingestion pipeline and return report
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from prf.routers.deps import get_repo
from prf.database.repository import PRFRepository

router = APIRouter()


@router.get("/pmgo")
async def coverage_pmgo(repo: PRFRepository = Depends(get_repo)):
    """Coverage analysis for the PMGO exam question pool."""
    return await _coverage(repo, exam="PMGO")


@router.get("/prf")
async def coverage_prf(repo: PRFRepository = Depends(get_repo)):
    """Coverage analysis for the PRF exam question pool."""
    return await _coverage(repo, exam="PRF")


@router.get("/ingest")
async def ingest_preview():
    """
    Run the ingestion pipeline on seed/import directories and return a
    dry-run report (no DB writes). Use for auditing before seeding.
    """
    from core.question_ingestion import QuestionIngestionPipeline

    pipeline = QuestionIngestionPipeline()
    questions, report = pipeline.run_from_seed_dirs()
    return {
        "total_raw": report.total_raw,
        "accepted": report.accepted,
        "validation_errors": report.validation_errors,
        "duplicates_skipped": report.duplicates_skipped,
        "acceptance_rate": report.acceptance_rate,
        "error_sample": report.error_details[:10],
    }


async def _coverage(repo: PRFRepository, exam: str) -> dict:
    from core.coverage_audit import CoverageAuditor
    from prf.seeds.seed_data import SUBJECTS

    # Fetch questions from DB (subject_slug + topic_slug only)
    all_questions = await repo.get_questions_for_coverage()
    auditor = CoverageAuditor(exam=exam)
    report = auditor.audit(questions=all_questions, subjects=SUBJECTS)
    return report.as_dict()
