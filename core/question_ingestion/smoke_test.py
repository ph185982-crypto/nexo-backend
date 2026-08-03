"""
Smoke tests for the question ingestion pipeline.
No DB, no external dependencies.

Run:
    python -m core.question_ingestion.smoke_test
"""
from __future__ import annotations

import sys


def _make_raw(overrides: dict | None = None) -> dict:
    base = {
        "subject_slug": "direito-penal",
        "topic_slug": "crimes-contra-vida",
        "question_type": "multipla_escolha",
        "text": "Qual é a pena mínima para homicídio simples, segundo o art. 121 do Código Penal?",
        "difficulty": "medium",
        "source": "AOCP/PMGO",
        "year": 2022,
        "examiner": "Instituto AOCP",
        "explanation": "O art. 121, caput, do CP prevê pena de reclusão de 6 a 20 anos para homicídio simples.",
        "legal_basis": "Art. 121, CP",
        "context_text": "",
        "alternatives": [
            {"letter": "A", "text": "2 a 8 anos de reclusão.", "is_correct": False, "explanation": "Esse é o patamar do homicídio culposo (§3°)."},
            {"letter": "B", "text": "4 a 12 anos de reclusão.", "is_correct": False, "explanation": "Não corresponde ao previsto no caput."},
            {"letter": "C", "text": "6 a 20 anos de reclusão.", "is_correct": True, "explanation": "Correto. Art. 121, caput."},
            {"letter": "D", "text": "12 a 30 anos de reclusão.", "is_correct": False, "explanation": "É o patamar do homicídio qualificado (§2°)."},
            {"letter": "E", "text": "20 a 40 anos de reclusão.", "is_correct": False, "explanation": "Não existe esse intervalo para homicídio simples."},
        ],
    }
    if overrides:
        base.update(overrides)
    return base


def _ok(label: str) -> None:
    print(f"  PASS  {label}")


def _fail(label: str, detail: str) -> None:
    print(f"  FAIL  {label}: {detail}")
    sys.exit(1)


def test_normalizer_valid() -> None:
    from core.question_ingestion.normalizer import normalize
    from core.question_ingestion.models import SourceType
    q = normalize(_make_raw(), SourceType.SEED)
    assert q is not None, "should normalize valid record"
    assert q.text.startswith("Qual"), "text should be preserved"
    assert q.subject_slug == "direito-penal"
    assert q.difficulty == "medium"
    _ok("normalizer handles valid record")


def test_normalizer_missing_text() -> None:
    from core.question_ingestion.normalizer import normalize
    q = normalize(_make_raw({"text": ""}))
    assert q is None, "should return None for empty text"
    _ok("normalizer returns None for missing text")


def test_normalizer_difficulty_alias() -> None:
    from core.question_ingestion.normalizer import normalize
    q = normalize(_make_raw({"difficulty": "fácil"}))
    assert q is not None
    assert q.difficulty == "easy", f"expected easy, got {q.difficulty}"
    _ok("normalizer maps difficulty alias 'fácil' → 'easy'")


def test_normalizer_auto_question_type() -> None:
    from core.question_ingestion.normalizer import normalize
    from core.question_ingestion.models import QuestionType
    raw = _make_raw({
        "question_type": "invalid",
        "alternatives": [
            {"letter": "C", "text": "Certo", "is_correct": True},
            {"letter": "E", "text": "Errado", "is_correct": False},
        ]
    })
    q = normalize(raw)
    assert q is not None
    assert q.question_type == QuestionType.CERTO_ERRADO, "should detect certo_errado for 2 alternatives"
    _ok("normalizer infers certo_errado for 2-alternative record")


def test_validator_valid() -> None:
    from core.question_ingestion.normalizer import normalize
    from core.question_ingestion.validator import validate
    q = normalize(_make_raw())
    assert q is not None
    errors = validate(q)
    assert errors == [], f"expected no errors, got: {errors}"
    _ok("validator passes a valid question")


def test_validator_no_correct_alternative() -> None:
    from core.question_ingestion.normalizer import normalize
    from core.question_ingestion.validator import validate
    raw = _make_raw()
    for alt in raw["alternatives"]:
        alt["is_correct"] = False
    q = normalize(raw)
    errors = validate(q)
    assert any("no correct" in e for e in errors), f"expected no-correct error, got: {errors}"
    _ok("validator flags missing correct alternative")


def test_deduplicator_filters_duplicates() -> None:
    from core.question_ingestion.normalizer import normalize
    from core.question_ingestion.deduplicator import Deduplicator
    q1 = normalize(_make_raw())
    q2 = normalize(_make_raw())  # identical → same hash
    dedup = Deduplicator()
    result = dedup.filter([q1, q2])
    assert len(result) == 1, f"expected 1 unique, got {len(result)}"
    assert dedup.duplicates_skipped == 1
    _ok("deduplicator removes duplicate questions")


def test_deduplicator_existing_hashes() -> None:
    from core.question_ingestion.normalizer import normalize
    from core.question_ingestion.deduplicator import Deduplicator
    q = normalize(_make_raw())
    dedup = Deduplicator(existing_hashes={q.content_hash})
    result = dedup.filter([q])
    assert result == [], f"expected empty, already in DB"
    _ok("deduplicator respects existing_hashes from DB")


def test_detector_exam_routing() -> None:
    from core.question_ingestion.normalizer import normalize
    from core.question_ingestion.detector import detect_exam, enrich
    q_pmgo = normalize(_make_raw({"subject_slug": "criminologia"}))
    q_prf  = normalize(_make_raw({"subject_slug": "legislacao-transito"}))
    q_both = normalize(_make_raw({"subject_slug": "direito-penal"}))
    assert detect_exam(q_pmgo) == "PMGO"
    assert detect_exam(q_prf) == "PRF"
    assert detect_exam(q_both) == "BOTH"
    _ok("detector routes subjects to correct exam")


def test_pipeline_end_to_end() -> None:
    from core.question_ingestion.pipeline import QuestionIngestionPipeline
    raw = [_make_raw(), _make_raw({"text": "Segunda questão diferente para evitar duplicata."})]
    pipeline = QuestionIngestionPipeline()
    questions, report = pipeline.run(raw)
    assert report.total_raw == 2
    assert report.accepted == 2
    assert report.duplicates_skipped == 0
    _ok("pipeline end-to-end: 2 valid records → 2 accepted")


def test_pipeline_deduplication_in_batch() -> None:
    from core.question_ingestion.pipeline import QuestionIngestionPipeline
    # 3 raw records but 2 are identical
    raw = [_make_raw(), _make_raw(), _make_raw({"text": "Texto completamente diferente para testar deduplicação."})]
    pipeline = QuestionIngestionPipeline()
    questions, report = pipeline.run(raw)
    assert report.duplicates_skipped == 1, f"expected 1 dup, got {report.duplicates_skipped}"
    assert report.accepted == 2
    _ok("pipeline deduplication: 3 raw (2 identical) → 2 accepted, 1 skipped")


def test_pipeline_from_seed_dirs() -> None:
    from core.question_ingestion.pipeline import QuestionIngestionPipeline, PMGO_SEED_DIR
    pipeline = QuestionIngestionPipeline()
    questions, report = pipeline.run_from_seed_dirs()
    assert report.total_raw > 0, "should find seed files"
    assert report.accepted > 0, f"should accept records; errors: {report.error_details[:3]}"
    assert report.acceptance_rate > 0.80, f"acceptance rate too low: {report.acceptance_rate}"
    _ok(
        f"pipeline loads seed dirs: {report.total_raw} raw, "
        f"{report.accepted} accepted ({report.acceptance_rate:.0%}), "
        f"{report.duplicates_skipped} dupes"
    )


TESTS = [
    test_normalizer_valid,
    test_normalizer_missing_text,
    test_normalizer_difficulty_alias,
    test_normalizer_auto_question_type,
    test_validator_valid,
    test_validator_no_correct_alternative,
    test_deduplicator_filters_duplicates,
    test_deduplicator_existing_hashes,
    test_detector_exam_routing,
    test_pipeline_end_to_end,
    test_pipeline_deduplication_in_batch,
    test_pipeline_from_seed_dirs,
]


if __name__ == "__main__":
    print("=" * 60)
    print("Question Ingestion Pipeline — Smoke Tests")
    print("=" * 60)
    for test in TESTS:
        test()
    print("=" * 60)
    print(f"All {len(TESTS)} tests passed.")
