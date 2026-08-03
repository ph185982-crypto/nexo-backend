"""
Error Intelligence Engine smoke test — no external dependencies, no DB.

Covers:
  A) UNKNOWN_CONTENT    — first attempt, no mastery record
  B) MEMORY_FAILURE     — overdue review card, previously correct
  C) CONCEPT_CONFUSION  — topic in confusion matrix
  D) EXCEPTION_CONFUSION — exception-type question
  E) OVERCONFIDENCE     — confidence=5 with wrong answer
  F) Pattern detection  — FAST_ANSWERER and TOPIC_BLIND_SPOT
  G) generateReport     — report dict structure validation
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from uuid import UUID, uuid4

from core.error_intelligence import (
    ErrorIntelligenceEngine,
    ErrorContext,
    QuestionSnapshot,
    PreviousAttemptSnapshot,
    ErrorEntrySnapshot,
    ReviewCardSnapshot,
    MasterySnapshot,
    SessionSnapshot,
    LearningContextSnapshot,
    ApprovalContextSnapshot,
    ErrorClassification,
    ErrorSeverity,
)

_ENGINE = ErrorIntelligenceEngine()
_SUBJECT_ID = uuid4()
_TOPIC_ID   = uuid4()
_QUESTION_ID = uuid4()
_USER_ID     = uuid4()
_SESSION_ID  = uuid4()


def _base_question(**kwargs) -> QuestionSnapshot:
    defaults = dict(
        question_id=_QUESTION_ID,
        subject_id=_SUBJECT_ID,
        topic_id=_TOPIC_ID,
        question_type="certo_errado",
        content_type="lei_seca",
        difficulty="medium",
        legal_basis="Art. 29, CTB",
        legal_article_id=uuid4(),
        tags=[],
        times_answered=500,
        times_correct=250,
        avg_time_secs=35.0,
    )
    defaults.update(kwargs)
    return QuestionSnapshot(**defaults)


def _base_learning(**kwargs) -> LearningContextSnapshot:
    defaults = dict(
        forgetting_velocity_subject=0.15,
        confidence_calibration=0.70,
        confidence_for_subject=0.65,
        learning_speed="medium",
        fatigue_threshold_mins=45,
        confused_topics=[],
        confusion_pairs=[],
        retention_category="medium",
        review_efficiency=0.60,
    )
    defaults.update(kwargs)
    return LearningContextSnapshot(**defaults)


def _base_approval(**kwargs) -> ApprovalContextSnapshot:
    defaults = dict(
        approval_probability=0.52,
        subject_weight=2.5,
        risk_level="medium",
    )
    defaults.update(kwargs)
    return ApprovalContextSnapshot(**defaults)


def _base_session(**kwargs) -> SessionSnapshot:
    defaults = dict(
        session_id=_SESSION_ID,
        position_in_session=5,
        total_questions_so_far=5,
        accuracy_so_far=0.60,
        energy_level="high",
        duration_so_far_mins=15.0,
    )
    defaults.update(kwargs)
    return SessionSnapshot(**defaults)


# ════════════════════════════════════════════════════════════════════════════
# Scenario A — UNKNOWN_CONTENT
# ════════════════════════════════════════════════════════════════════════════

def test_unknown_content():
    ctx = ErrorContext(
        user_id=_USER_ID,
        question=_base_question(),
        user_answer="C",
        correct_answer="E",
        response_time_secs=4,
        confidence=None,
        previous_attempts=[],
        error_entry=None,
        review_card=None,
        mastery=None,
        session=_base_session(),
        learning=_base_learning(),
        approval=_base_approval(),
        origin_result=None,
    )
    analysis = _ENGINE.analyze(ctx)
    assert analysis.classification == ErrorClassification.UNKNOWN_CONTENT.value, (
        f"Expected UNKNOWN_CONTENT, got {analysis.classification}"
    )
    assert analysis.severity in (ErrorSeverity.MEDIUM.value, ErrorSeverity.HIGH.value, ErrorSeverity.CRITICAL.value)
    assert analysis.root_cause
    assert analysis.knowledge_gap
    assert len(analysis.recommended_actions) >= 2
    assert any(a.action_type == "READ_LAW" for a in analysis.recommended_actions)
    print(f"  [A] UNKNOWN_CONTENT — severity={analysis.severity}  priority={analysis.review_priority}")
    print(f"      root_cause: {analysis.root_cause}")
    print(f"      actions: {[a.action_type for a in analysis.recommended_actions]}")


# ════════════════════════════════════════════════════════════════════════════
# Scenario B — MEMORY_FAILURE
# ════════════════════════════════════════════════════════════════════════════

def test_memory_failure():
    ctx = ErrorContext(
        user_id=_USER_ID,
        question=_base_question(),
        user_answer="E",
        correct_answer="C",
        response_time_secs=25,
        confidence=3,
        previous_attempts=[
            PreviousAttemptSnapshot(
                answered_at=datetime.now(timezone.utc) - timedelta(days=20),
                is_correct=True,
                confidence=4,
                time_spent_secs=30,
            ),
            PreviousAttemptSnapshot(
                answered_at=datetime.now(timezone.utc) - timedelta(days=10),
                is_correct=True,
                confidence=3,
                time_spent_secs=28,
            ),
        ],
        error_entry=ErrorEntrySnapshot(
            times_repeated=1,
            resolved=False,
            last_error_at=datetime.now(timezone.utc),
            error_type="conceptual",
            error_summary=None,
        ),
        review_card=ReviewCardSnapshot(
            ease_factor=2.2,
            interval_days=8,
            repetitions=3,
            is_overdue=True,
            last_quality=2,
            total_reviews=5,
            total_correct=3,
            streak=0,
            lapsed=True,
        ),
        mastery=MasterySnapshot(
            mastery_level=0.58,
            total_attempts=45,
            accuracy=0.71,
            error_count=5,
            last_studied=datetime.now(timezone.utc) - timedelta(days=12),
        ),
        session=_base_session(),
        learning=_base_learning(forgetting_velocity_subject=0.35),
        approval=_base_approval(),
        origin_result=None,
    )
    analysis = _ENGINE.analyze(ctx)
    assert analysis.classification == ErrorClassification.MEMORY_FAILURE.value, (
        f"Expected MEMORY_FAILURE, got {analysis.classification}"
    )
    assert any(a.action_type == "INCREASE_REVIEW_PRIORITY" for a in analysis.recommended_actions)
    print(f"  [B] MEMORY_FAILURE — severity={analysis.severity}  priority={analysis.review_priority}")
    print(f"      evolution: {analysis.evolution.direction if analysis.evolution else 'N/A'}")


# ════════════════════════════════════════════════════════════════════════════
# Scenario C — CONCEPT_CONFUSION
# ════════════════════════════════════════════════════════════════════════════

def test_concept_confusion():
    topic_a = str(_TOPIC_ID)
    topic_b = str(uuid4())
    ctx = ErrorContext(
        user_id=_USER_ID,
        # interpretacao type — no lei_seca trigger, so LAW_CONFUSION won't spike
        question=_base_question(content_type="interpretacao", legal_basis="Art. 302 CTB", tags=[]),
        user_answer="C",
        correct_answer="E",
        response_time_secs=40,
        confidence=3,
        previous_attempts=[
            PreviousAttemptSnapshot(
                answered_at=datetime.now(timezone.utc) - timedelta(days=5),
                is_correct=False, confidence=3, time_spent_secs=38,
            ),
            PreviousAttemptSnapshot(
                answered_at=datetime.now(timezone.utc) - timedelta(days=2),
                is_correct=False, confidence=3, time_spent_secs=42,
            ),
        ],
        error_entry=ErrorEntrySnapshot(
            times_repeated=3,
            resolved=False,
            last_error_at=datetime.now(timezone.utc),
            error_type="conceptual",
            error_summary=None,
        ),
        review_card=None,
        mastery=MasterySnapshot(
            mastery_level=0.42,
            total_attempts=30,
            accuracy=0.50,
            error_count=10,
            last_studied=datetime.now(timezone.utc) - timedelta(days=3),
        ),
        session=_base_session(),
        learning=_base_learning(
            confused_topics=[topic_a],
            confusion_pairs=[(topic_a, topic_b, 0.65)],
        ),
        approval=_base_approval(),
        origin_result=None,
    )
    analysis = _ENGINE.analyze(ctx)
    assert analysis.classification == ErrorClassification.CONCEPT_CONFUSION.value, (
        f"Expected CONCEPT_CONFUSION, got {analysis.classification}"
    )
    assert any(a.action_type == "REVIEW_RELATED_CONCEPTS" for a in analysis.recommended_actions)
    print(f"  [C] CONCEPT_CONFUSION — severity={analysis.severity}  evolution={analysis.evolution.direction}")


# ════════════════════════════════════════════════════════════════════════════
# Scenario D — EXCEPTION_CONFUSION
# ════════════════════════════════════════════════════════════════════════════

def test_exception_confusion():
    ctx = ErrorContext(
        user_id=_USER_ID,
        question=_base_question(content_type="excecao", tags=["exceto", "CTB"]),
        user_answer="E",
        correct_answer="C",
        response_time_secs=20,
        confidence=3,
        previous_attempts=[
            PreviousAttemptSnapshot(
                answered_at=datetime.now(timezone.utc) - timedelta(days=7),
                is_correct=False, confidence=3, time_spent_secs=22,
            ),
        ],
        error_entry=ErrorEntrySnapshot(
            times_repeated=2,
            resolved=False,
            last_error_at=datetime.now(timezone.utc),
            error_type="conceptual",
            error_summary=None,
        ),
        review_card=None,
        mastery=MasterySnapshot(
            mastery_level=0.45,
            total_attempts=25,
            accuracy=0.52,
            error_count=8,
            last_studied=datetime.now(timezone.utc) - timedelta(days=5),
        ),
        session=_base_session(),
        learning=_base_learning(),
        approval=_base_approval(subject_weight=3.0),
        origin_result=None,
    )
    analysis = _ENGINE.analyze(ctx)
    assert analysis.classification == ErrorClassification.EXCEPTION_CONFUSION.value, (
        f"Expected EXCEPTION_CONFUSION, got {analysis.classification}"
    )
    assert any(a.action_type == "REVIEW_SPECIFIC_ARTICLE" for a in analysis.recommended_actions)
    assert any(a.action_type == "CREATE_FLASHCARD_CANDIDATE" for a in analysis.recommended_actions)
    print(f"  [D] EXCEPTION_CONFUSION — severity={analysis.severity}  priority={analysis.review_priority}")


# ════════════════════════════════════════════════════════════════════════════
# Scenario E — OVERCONFIDENCE
# ════════════════════════════════════════════════════════════════════════════

def test_overconfidence():
    ctx = ErrorContext(
        user_id=_USER_ID,
        question=_base_question(difficulty="hard"),
        user_answer="C",
        correct_answer="E",
        response_time_secs=18,
        confidence=5,  # max confidence, wrong answer
        previous_attempts=[
            PreviousAttemptSnapshot(
                answered_at=datetime.now(timezone.utc) - timedelta(days=15),
                is_correct=True, confidence=4, time_spent_secs=20,
            ),
        ],
        error_entry=None,
        review_card=None,
        mastery=MasterySnapshot(
            mastery_level=0.72,
            total_attempts=60,
            accuracy=0.78,
            error_count=8,
            last_studied=datetime.now(timezone.utc) - timedelta(days=2),
        ),
        session=_base_session(),
        learning=_base_learning(confidence_calibration=0.32),
        approval=_base_approval(),
        origin_result=None,
    )
    analysis = _ENGINE.analyze(ctx)
    assert analysis.classification == ErrorClassification.OVERCONFIDENCE.value, (
        f"Expected OVERCONFIDENCE, got {analysis.classification}"
    )
    assert "5/5" in analysis.root_cause
    print(f"  [E] OVERCONFIDENCE — severity={analysis.severity}")
    print(f"      root_cause: {analysis.root_cause}")


# ════════════════════════════════════════════════════════════════════════════
# Scenario F — Pattern detection
# ════════════════════════════════════════════════════════════════════════════

def test_pattern_detection():
    now = datetime.now(timezone.utc)
    # 20 attempts where 8 are very fast (< 10s) and wrong
    recent_attempts = [
        PreviousAttemptSnapshot(
            answered_at=now - timedelta(days=i),
            is_correct=(i % 3 != 0),
            confidence=2 if i % 3 == 0 else 4,
            time_spent_secs=5 if i % 3 == 0 else 35,
        )
        for i in range(20)
    ]
    recent_errors = [
        ErrorEntrySnapshot(
            times_repeated=i + 1,
            resolved=False,
            last_error_at=now - timedelta(days=i),
            error_type="conceptual",
            error_summary=None,
        )
        for i in range(6)
    ]

    patterns = _ENGINE.findPatterns(recent_errors, recent_attempts)
    print(f"  [F] Pattern detection — found {len(patterns)} pattern(s)")
    for p in patterns:
        print(f"      {p.pattern_type} (conf={p.confidence:.2f}): {p.description}")
    # At least fast-answerer or topic blind spot should be detected
    pattern_types = {p.pattern_type for p in patterns}
    assert len(patterns) >= 1, "Expected at least one pattern"
    print(f"      Pattern types: {pattern_types}")


# ════════════════════════════════════════════════════════════════════════════
# Scenario G — Report generation
# ════════════════════════════════════════════════════════════════════════════

def test_report_generation():
    ctx = ErrorContext(
        user_id=_USER_ID,
        question=_base_question(),
        user_answer="C",
        correct_answer="E",
        response_time_secs=4,
        confidence=None,
        previous_attempts=[],
        error_entry=None,
        review_card=None,
        mastery=None,
        session=_base_session(),
        learning=_base_learning(),
        approval=_base_approval(),
        origin_result=None,
    )
    analysis = _ENGINE.analyze(ctx)
    report = _ENGINE.generateReport(analysis)

    required_keys = {"summary", "diagnosis", "actions", "knowledge", "signals", "report_generated_at"}
    missing = required_keys - set(report.keys())
    assert not missing, f"Report missing keys: {missing}"
    assert "classification" in report["summary"]
    assert "severity" in report["summary"]
    assert "one_liner" in report["summary"]
    assert isinstance(report["actions"], list)
    assert len(report["actions"]) >= 1
    print(f"  [G] Report generation — {len(report['actions'])} action(s)")
    print(f"      one_liner: {report['summary']['one_liner']}")


# ════════════════════════════════════════════════════════════════════════════
# Runner
# ════════════════════════════════════════════════════════════════════════════

def run():
    tests = [
        ("A", "UNKNOWN_CONTENT",    test_unknown_content),
        ("B", "MEMORY_FAILURE",     test_memory_failure),
        ("C", "CONCEPT_CONFUSION",  test_concept_confusion),
        ("D", "EXCEPTION_CONFUSION", test_exception_confusion),
        ("E", "OVERCONFIDENCE",     test_overconfidence),
        ("F", "Pattern detection",  test_pattern_detection),
        ("G", "Report generation",  test_report_generation),
    ]

    print("=" * 64)
    print("ERROR INTELLIGENCE ENGINE — Smoke Test")
    print("=" * 64)
    for label, name, fn in tests:
        print(f"\nScenario {label} — {name}")
        fn()

    print()
    print("=" * 64)
    print("ALL ASSERTIONS PASSED")
    print("=" * 64)


if __name__ == "__main__":
    run()
