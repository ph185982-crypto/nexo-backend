"""
Question Ingestion Pipeline — normalize, validate, deduplicate, and enrich
raw question records from seed files and authorized imports.

Public API::

    from core.question_ingestion import QuestionIngestionPipeline, IngestionReport
    from core.question_ingestion.models import IngestedQuestion, SourceType

    pipeline = QuestionIngestionPipeline()
    questions, report = pipeline.run_from_seed_dirs()
    print(f"Accepted {report.accepted}/{report.total_raw} questions")
"""
from .models import Alternative, IngestedQuestion, QuestionType, SourceType
from .pipeline import PMGO_IMPORT_DIR, PMGO_SEED_DIR, IngestionReport, QuestionIngestionPipeline

__all__ = [
    "QuestionIngestionPipeline",
    "IngestionReport",
    "IngestedQuestion",
    "Alternative",
    "QuestionType",
    "SourceType",
    "PMGO_SEED_DIR",
    "PMGO_IMPORT_DIR",
]
