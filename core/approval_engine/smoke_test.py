"""
Approval Engine smoke test — no external dependencies, no DB.

Verifies end-to-end computation from ApprovalContext → ApprovalEstimate
using in-memory fixtures covering two scenarios:
  A) Strong student (high mastery, consistent, close to ready)
  B) Weak student (low coverage, inconsistent, far from ready)
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

from core.approval_engine import (
    ApprovalEngine,
    ApprovalContext,
    SubjectSnapshot,
    GapSnapshot,
    MissionRecord,
    ReviewBacklog,
    StudyConsistency,
    ExamConfig,
)


def _make_subjects_strong() -> list[SubjectSnapshot]:
    return [
        SubjectSnapshot(
            subject_id=uuid4(),
            subject_slug="legislacao_transito",
            subject_name="Legislação de Trânsito",
            exam_weight=3.0,
            mastery_score=78.0,
            correct_rate=0.82,
            total_attempts=340,
            coverage_ratio=0.85,
            last_studied=datetime.now(timezone.utc),
        ),
        SubjectSnapshot(
            subject_id=uuid4(),
            subject_slug="direito_constitucional",
            subject_name="Direito Constitucional",
            exam_weight=2.5,
            mastery_score=65.0,
            correct_rate=0.71,
            total_attempts=210,
            coverage_ratio=0.75,
            last_studied=datetime.now(timezone.utc),
        ),
        SubjectSnapshot(
            subject_id=uuid4(),
            subject_slug="direito_penal",
            subject_name="Direito Penal",
            exam_weight=2.0,
            mastery_score=55.0,
            correct_rate=0.63,
            total_attempts=150,
            coverage_ratio=0.70,
            last_studied=datetime.now(timezone.utc),
        ),
    ]


def _make_subjects_weak() -> list[SubjectSnapshot]:
    return [
        SubjectSnapshot(
            subject_id=uuid4(),
            subject_slug="legislacao_transito",
            subject_name="Legislação de Trânsito",
            exam_weight=3.0,
            mastery_score=28.0,
            correct_rate=0.35,
            total_attempts=40,
            coverage_ratio=0.20,
            last_studied=None,
        ),
        SubjectSnapshot(
            subject_id=uuid4(),
            subject_slug="direito_constitucional",
            subject_name="Direito Constitucional",
            exam_weight=2.5,
            mastery_score=15.0,
            correct_rate=0.22,
            total_attempts=15,
            coverage_ratio=0.10,
            last_studied=None,
        ),
    ]


def _prf_exam() -> ExamConfig:
    return ExamConfig(
        exam_id="PRF",
        total_questions=120,
        cutoff_score=50.0,
        scoring_method="cebraspe",
        blocks=3,
        block_cutoff=35.0,
    )


def _make_context_strong() -> ApprovalContext:
    return ApprovalContext(
        user_id=uuid4(),
        target_exam="PRF",
        days_until_exam=45,
        subjects=_make_subjects_strong(),
        gaps=[
            GapSnapshot(
                subject_id=None,
                topic_id=None,
                label="Crimes de Trânsito",
                gap_score=0.35,
                impact_score=0.40,
                importance=0.55,
                explanation="Subtópico com maior taxa de erro.",
            )
        ],
        missions=[
            MissionRecord(
                date=datetime.now(timezone.utc),
                completed=True,
                completion_rate=0.90,
                score=0.82,
            )
            for _ in range(20)
        ],
        review_backlog=ReviewBacklog(
            total_due=12,
            total_overdue=4,
            overdue_by_subject={"legislacao_transito": 3, "direito_penal": 1},
        ),
        consistency=StudyConsistency(
            streak_days=18,
            days_active_last_30=24,
            avg_daily_questions=32.0,
            avg_session_accuracy=0.76,
            total_missions_last_30=22,
            completed_missions_last_30=20,
        ),
        exam_config=_prf_exam(),
        learning_context={
            "learning_speed_category": "fast",
            "learning_velocity": 0.75,
            "retention_category": "strong",
            "review_efficiency_score": 0.78,
            "confidence_overall": 0.72,
            "confidence_by_subject": {},
            "forgetting_velocity": {"legislacao_transito": 0.08, "direito_penal": 0.12},
            "fatigue_threshold_minutes": 55,
            "preferred_format": "questions",
        },
        previous_approval_probability=0.58,
        previous_computed_at=datetime(2025, 7, 1, tzinfo=timezone.utc),
    )


def _make_context_weak() -> ApprovalContext:
    return ApprovalContext(
        user_id=uuid4(),
        target_exam="PRF",
        days_until_exam=30,
        subjects=_make_subjects_weak(),
        gaps=[],
        missions=[
            MissionRecord(
                date=datetime.now(timezone.utc),
                completed=False,
                completion_rate=0.10,
                score=0.25,
            )
            for _ in range(5)
        ],
        review_backlog=ReviewBacklog(
            total_due=45,
            total_overdue=28,
            overdue_by_subject={"legislacao_transito": 20, "direito_constitucional": 8},
        ),
        consistency=StudyConsistency(
            streak_days=1,
            days_active_last_30=5,
            avg_daily_questions=4.0,
            avg_session_accuracy=0.32,
            total_missions_last_30=6,
            completed_missions_last_30=1,
        ),
        exam_config=_prf_exam(),
        learning_context={
            "learning_speed_category": "slow",
            "learning_velocity": 0.20,
            "retention_category": "weak",
            "review_efficiency_score": 0.25,
            "confidence_overall": 0.30,
            "confidence_by_subject": {},
            "forgetting_velocity": {"legislacao_transito": 0.45, "direito_constitucional": 0.38},
            "fatigue_threshold_minutes": 20,
            "preferred_format": "questions",
        },
        previous_approval_probability=None,
        previous_computed_at=None,
    )


def run() -> None:
    engine = ApprovalEngine()

    print("=" * 60)
    print("SCENARIO A — Strong student")
    print("=" * 60)
    ctx_a = _make_context_strong()
    est_a = engine.estimate(ctx_a)

    print(f"  approval_probability : {est_a.approval_probability:.4f}  ({est_a.approval_pct}%)")
    print(f"  confidence_score     : {est_a.confidence_score:.4f}")
    print(f"  estimated_exam_score : {est_a.estimated_exam_score:.1f}")
    print(f"  estimated_cutoff_gap : {est_a.estimated_cutoff_gap:+.1f}")
    print(f"  risk_level           : {est_a.risk_level}")
    print(f"  days_to_ready        : {est_a.days_to_ready}")
    print(f"  trend.direction      : {est_a.trend.direction}")
    print(f"  trend.acceleration   : {est_a.trend.acceleration}")
    print(f"  projected_30d        : {est_a.projected_growth.in_30_days:.4f}")
    print(f"  projected_90d        : {est_a.projected_growth.in_90_days:.4f}")
    print(f"  weakest_domains      : {[d.subject_name for d in est_a.weakest_domains]}")
    print("  estimators:")
    for d in est_a.estimator_detail:
        print(f"    {d.name:<16} score={d.raw_score:.3f}  contribution={d.contribution:.3f}")
    print()
    print("  explanation:")
    for line in est_a.explanation:
        print(f"    • {line}")

    # Assertions for scenario A
    assert 0.55 < est_a.approval_probability < 1.0, (
        f"Strong student should have probability > 0.55, got {est_a.approval_probability}"
    )
    assert est_a.risk_level in ("low", "medium"), (
        f"Strong student should be low/medium risk, got {est_a.risk_level}"
    )
    assert est_a.trend.direction == "improving", (
        f"Strong student with prior of 0.58 should be improving, got {est_a.trend.direction}"
    )
    assert len(est_a.estimator_detail) == 6, (
        f"Expected 6 estimator details, got {len(est_a.estimator_detail)}"
    )
    total_weight = sum(d.weight for d in est_a.estimator_detail)
    assert abs(total_weight - 1.0) < 1e-9, f"Weights must sum to 1.0, got {total_weight}"

    print()
    print("=" * 60)
    print("SCENARIO B — Weak student")
    print("=" * 60)
    ctx_b = _make_context_weak()
    est_b = engine.estimate(ctx_b)

    print(f"  approval_probability : {est_b.approval_probability:.4f}  ({est_b.approval_pct}%)")
    print(f"  risk_level           : {est_b.risk_level}")
    print(f"  trend.direction      : {est_b.trend.direction}  (no prior → stable expected)")
    print(f"  projected_30d        : {est_b.projected_growth.in_30_days:.4f}")
    print("  estimators:")
    for d in est_b.estimator_detail:
        print(f"    {d.name:<16} score={d.raw_score:.3f}  contribution={d.contribution:.3f}")

    assert est_b.approval_probability < 0.50, (
        f"Weak student should have probability < 0.50, got {est_b.approval_probability}"
    )
    assert est_b.risk_level == "high", (
        f"Weak student should be high risk, got {est_b.risk_level}"
    )
    assert est_b.trend.direction == "stable", (
        "No prior → trend should be stable"
    )

    # Verify summary dict
    summary = est_a.as_summary_dict()
    required_keys = {
        "approval_probability", "approval_pct", "confidence_score",
        "estimated_exam_score", "estimated_cutoff_gap", "trend_direction",
        "risk_level", "days_to_ready", "projected_30d", "explanation",
    }
    missing = required_keys - summary.keys()
    assert not missing, f"as_summary_dict() missing keys: {missing}"

    print()
    print("=" * 60)
    print("ALL ASSERTIONS PASSED")
    print("=" * 60)


if __name__ == "__main__":
    run()
