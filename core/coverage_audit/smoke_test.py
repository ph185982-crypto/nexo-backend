"""
Smoke tests for the coverage audit module.
No DB, no external dependencies.

Run:
    python -m core.coverage_audit.smoke_test
"""
from __future__ import annotations

import sys


def _ok(label: str) -> None:
    print(f"  PASS  {label}")


def _fail(label: str, detail: str) -> None:
    print(f"  FAIL  {label}: {detail}")
    sys.exit(1)


SUBJECTS = [
    {"slug": "direito-penal", "name": "Direito Penal", "weight_pm": 3.0, "weight_prf": 2.5},
    {"slug": "direito-constitucional", "name": "Direito Constitucional", "weight_pm": 2.5, "weight_prf": 2.5},
    {"slug": "criminologia", "name": "Criminologia", "weight_pm": 1.5, "weight_prf": 0.0},
    {"slug": "medicina-legal", "name": "Medicina Legal", "weight_pm": 1.0, "weight_prf": 0.0},
    {"slug": "legislacao-transito", "name": "Legislação de Trânsito", "weight_pm": 0.0, "weight_prf": 3.0},
]


def _questions(counts: dict[str, int]) -> list[dict]:
    qs = []
    for slug, n in counts.items():
        for i in range(n):
            qs.append({"subject_slug": slug, "topic_slug": f"topic-{i}"})
    return qs


def test_empty_pool() -> None:
    from core.coverage_audit import CoverageAuditor, CoverageFlag
    auditor = CoverageAuditor("PMGO")
    report = auditor.audit(questions=[], subjects=SUBJECTS)
    assert report.total_questions == 0
    assert report.exam_readiness_score < 0.5, "readiness should be low for empty pool"
    assert len(report.missing_subjects) > 0
    _ok("empty pool → low readiness and missing subjects")


def test_full_coverage() -> None:
    from core.coverage_audit import CoverageAuditor, CoverageFlag
    auditor = CoverageAuditor("PMGO")
    # Give every PMGO subject 25 questions
    pmgo_slugs = {s["slug"] for s in SUBJECTS if s["weight_pm"] > 0}
    qs = _questions({s: 25 for s in pmgo_slugs})
    report = auditor.audit(questions=qs, subjects=SUBJECTS)
    assert report.missing_subjects == [], f"no missing subjects expected: {report.missing_subjects}"
    assert report.exam_readiness_score > 0.8, f"readiness should be high: {report.exam_readiness_score}"
    _ok("full coverage → high readiness, no missing subjects")


def test_prf_subjects_excluded_from_pmgo_audit() -> None:
    from core.coverage_audit import CoverageAuditor
    auditor = CoverageAuditor("PMGO")
    # Only PRF subjects have questions — PMGO subjects empty
    qs = _questions({"legislacao-transito": 50})
    report = auditor.audit(questions=qs, subjects=SUBJECTS)
    # PMGO subjects (weight_pm > 0) should show as empty/missing
    assert "legislacao-transito" not in report.import_priority, \
        "PRF-only subjects should not appear in PMGO priority list"
    _ok("PRF-only subjects are excluded from PMGO audit")


def test_partial_coverage_low_flag() -> None:
    from core.coverage_audit import CoverageAuditor, CoverageFlag
    auditor = CoverageAuditor("PMGO")
    qs = _questions({"direito-penal": 3, "criminologia": 1})  # 3 = LOW, 1 = CRITICAL
    report = auditor.audit(questions=qs, subjects=SUBJECTS)
    penal = next(sc for sc in report.subject_coverage if sc.subject_slug == "direito-penal")
    assert penal.flag == CoverageFlag.LOW, f"expected LOW (3q), got {penal.flag}"
    crim = next(sc for sc in report.subject_coverage if sc.subject_slug == "criminologia")
    assert crim.flag == CoverageFlag.CRITICAL, f"expected CRITICAL (1q), got {crim.flag}"
    # also check EMPTY
    med = next(sc for sc in report.subject_coverage if sc.subject_slug == "medicina-legal")
    assert med.flag == CoverageFlag.EMPTY
    _ok("partial coverage: 3q → LOW flag, 1q → CRITICAL flag, 0q → EMPTY flag")


def test_import_priority_ordering() -> None:
    from core.coverage_audit import CoverageAuditor
    auditor = CoverageAuditor("PMGO")
    # direito-penal (weight 3.0, empty) should rank higher than criminologia (1.5, empty)
    qs = []
    report = auditor.audit(questions=qs, subjects=SUBJECTS)
    priority = report.import_priority
    penal_idx = priority.index("direito-penal") if "direito-penal" in priority else -1
    crim_idx = priority.index("criminologia") if "criminologia" in priority else -1
    assert penal_idx != -1 and crim_idx != -1
    assert penal_idx < crim_idx, "higher-weight empty subject should have higher import priority"
    _ok("import priority: high-weight empty subjects ranked first")


def test_recommendations_generated() -> None:
    from core.coverage_audit import CoverageAuditor
    auditor = CoverageAuditor("PMGO")
    qs = _questions({"direito-penal": 3})
    report = auditor.audit(questions=qs, subjects=SUBJECTS)
    assert len(report.recommendations) > 0, "should generate recommendations for incomplete coverage"
    _ok("recommendations generated for incomplete pool")


def test_as_dict_structure() -> None:
    from core.coverage_audit import CoverageAuditor
    auditor = CoverageAuditor("PMGO")
    qs = _questions({"direito-penal": 10})
    report = auditor.audit(questions=qs, subjects=SUBJECTS)
    d = report.as_dict()
    for key in ("exam", "total_questions", "total_subjects", "covered_subjects",
                 "subject_coverage_pct", "exam_readiness_score", "missing_subjects",
                 "low_coverage_subjects", "import_priority", "recommendations", "subjects"):
        assert key in d, f"missing key in as_dict(): {key}"
    _ok("as_dict() contains all required keys")


def test_prf_exam_mode() -> None:
    from core.coverage_audit import CoverageAuditor
    auditor = CoverageAuditor("PRF")
    qs = _questions({"legislacao-transito": 30, "direito-penal": 20})
    report = auditor.audit(questions=qs, subjects=SUBJECTS)
    assert report.exam == "PRF"
    # PRF subjects include legislacao-transito (weight_prf=3.0)
    slugs = {sc.subject_slug for sc in report.subject_coverage}
    assert "legislacao-transito" in slugs
    assert "criminologia" not in slugs, "PMGO-only subject should not appear in PRF audit"
    _ok("PRF exam mode: correct subject filtering")


TESTS = [
    test_empty_pool,
    test_full_coverage,
    test_prf_subjects_excluded_from_pmgo_audit,
    test_partial_coverage_low_flag,
    test_import_priority_ordering,
    test_recommendations_generated,
    test_as_dict_structure,
    test_prf_exam_mode,
]


if __name__ == "__main__":
    print("=" * 60)
    print("Coverage Audit — Smoke Tests")
    print("=" * 60)
    for test in TESTS:
        test()
    print("=" * 60)
    print(f"All {len(TESTS)} tests passed.")
