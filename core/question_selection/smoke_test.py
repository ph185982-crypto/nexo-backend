"""
Question Selection smoke tests — no DB, no external dependencies.

Nine scenarios:
  1  new_student        — zero history, balanced pool
  2  advanced_student   — high mastery prefers hard unseen questions
  3  high_fatigue       — EASY target when fatigued
  4  reinforcement_mode — error context drives concept consolidation
  5  review_mode        — spaced-repetition backlog takes priority
  6  objective_mode     — session objective constrains selection
  7  low_remaining_time — questions that don't fit time are excluded
  8  high_mastery       — recently answered questions are filtered out
  9  exam_simulation    — exam-frequency signal dominates
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from uuid import uuid4

from core.question_selection import (
    QuestionSelectionEngine,
    QuestionSnapshot,
    QuestionSelectionContext,
    DifficultyLevel,
    SelectionMode,
)

engine = QuestionSelectionEngine()

# ── Shared UUIDs ──────────────────────────────────────────────────────────────

_USER = uuid4()
_SUBJ_A = uuid4()
_SUBJ_B = uuid4()
_TOPIC_A = uuid4()
_ART_A = uuid4()
_ART_B = uuid4()


def _snap(
    difficulty=DifficultyLevel.MEDIUM,
    exam_frequency=0.50,
    tags=(),
    times_answered=0,
    times_wrong=0,
    last_answered_at=None,
    estimated_time_secs=90,
    subject_id=None,
    topic_id=None,
    article_id=None,
    is_exception_type=False,
) -> QuestionSnapshot:
    return QuestionSnapshot(
        question_id=uuid4(),
        subject_id=subject_id or _SUBJ_A,
        topic_id=topic_id,
        article_id=article_id,
        difficulty=difficulty,
        exam_frequency=exam_frequency,
        is_true_false=True,
        is_exception_type=is_exception_type,
        tags=tuple(tags),
        estimated_time_secs=estimated_time_secs,
        times_answered=times_answered,
        times_wrong=times_wrong,
        last_answered_at=last_answered_at,
    )


def _ago(days: float = 0.0) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days)


# ════════════════════════════════════════════════════════════════════════════
# 1 — New student
# ════════════════════════════════════════════════════════════════════════════

def test_new_student():
    pool = tuple(_snap() for _ in range(5))
    ctx = QuestionSelectionContext(user_id=_USER, available_questions=pool)

    result = engine.select(ctx)

    assert result is not None, "Should return a result for a non-empty pool"
    assert result.selection_score > 0, "Score must be positive"
    assert result.question_id in {s.question_id for s in pool}
    assert result.selection_mode == SelectionMode.NORMAL

    # Verify as_dict() structure
    d = result.as_dict()
    for key in ("question_id", "selection_reason", "selection_score", "difficulty",
                "score_breakdown", "alternatives", "selection_mode"):
        assert key in d, f"Missing key: {key}"

    print(f"  [1] new_student — selected {result.question_id}, score={result.selection_score:.4f}")


# ════════════════════════════════════════════════════════════════════════════
# 2 — Advanced student (high mastery, prefers hard unseen questions)
# ════════════════════════════════════════════════════════════════════════════

def test_advanced_student():
    # Questions seen many times with low exam frequency (easy)
    seen_easy = [
        _snap(
            difficulty=DifficultyLevel.EASY,
            exam_frequency=0.10,
            times_answered=20,
            times_wrong=2,
            last_answered_at=_ago(12),  # 12 days ago → somewhat retained
        )
        for _ in range(3)
    ]
    # Hard unseen questions with high exam frequency — clearly better for advanced student
    unseen_hard = _snap(
        difficulty=DifficultyLevel.HARD,
        exam_frequency=0.90,
        times_answered=0,
    )

    pool = tuple(seen_easy + [unseen_hard])
    ctx = QuestionSelectionContext(
        user_id=_USER,
        available_questions=pool,
        difficulty_target=DifficultyLevel.HARD,
        subject_mastery={str(_SUBJ_A): 0.90},
    )

    result = engine.select(ctx)

    assert result is not None
    assert result.difficulty in (DifficultyLevel.HARD, DifficultyLevel.VERY_HARD), (
        f"Advanced student should get hard question, got {result.difficulty}"
    )
    assert result.question_id == unseen_hard.question_id, (
        "Should select the hard unseen question over reviewed easy ones"
    )

    print(f"  [2] advanced_student — {result.difficulty.value}, score={result.selection_score:.4f}")


# ════════════════════════════════════════════════════════════════════════════
# 3 — High fatigue (Study Runtime already lowered difficulty_target to EASY)
# ════════════════════════════════════════════════════════════════════════════

def test_high_fatigue():
    hard_q  = _snap(difficulty=DifficultyLevel.HARD,  exam_frequency=0.60, estimated_time_secs=180)
    easy_q  = _snap(difficulty=DifficultyLevel.EASY,  exam_frequency=0.60, estimated_time_secs=60)
    medium_q = _snap(difficulty=DifficultyLevel.MEDIUM, exam_frequency=0.60, estimated_time_secs=90)

    pool = (hard_q, easy_q, medium_q)
    ctx = QuestionSelectionContext(
        user_id=_USER,
        available_questions=pool,
        fatigue_level="EXHAUSTED",
        difficulty_target=DifficultyLevel.EASY,   # Study Runtime lowered this
    )

    result = engine.select(ctx)

    assert result is not None
    assert result.difficulty in (DifficultyLevel.VERY_EASY, DifficultyLevel.EASY), (
        f"Fatigued student should get easy question, got {result.difficulty}"
    )
    assert result.question_id == easy_q.question_id

    print(f"  [3] high_fatigue — {result.difficulty.value}, score={result.selection_score:.4f}")


# ════════════════════════════════════════════════════════════════════════════
# 4 — Reinforcement mode (error intelligence context)
# ════════════════════════════════════════════════════════════════════════════

def test_reinforcement_mode():
    reinf_tags = ("art-302-CTB", "velocidade-excessiva")

    # The "right" question: same concept as recent error, different question
    target = _snap(
        tags=reinf_tags,
        exam_frequency=0.50,
        difficulty=DifficultyLevel.MEDIUM,
    )
    # Decoys: unrelated topics
    decoys = tuple(
        _snap(tags=("CF-art-5",), exam_frequency=0.50)
        for _ in range(4)
    )

    pool = (target,) + decoys
    ctx = QuestionSelectionContext(
        user_id=_USER,
        available_questions=pool,
        mode=SelectionMode.REINFORCEMENT,
        reinforcement_concept_tags=reinf_tags,
    )

    result = engine.select(ctx)

    assert result is not None
    assert result.question_id == target.question_id, (
        "Reinforcement mode must select the concept-matching question"
    )
    assert result.selection_mode == SelectionMode.REINFORCEMENT

    print(f"  [4] reinforcement_mode — selected={result.question_id}, score={result.selection_score:.4f}")


# ════════════════════════════════════════════════════════════════════════════
# 5 — Review mode (spaced-repetition backlog)
# ════════════════════════════════════════════════════════════════════════════

def test_review_mode():
    backlog_q = _snap(
        tags=("revisao",),
        times_answered=5,
        times_wrong=2,
        last_answered_at=_ago(10),
        exam_frequency=0.40,
    )
    fresh_qs = tuple(
        _snap(exam_frequency=0.60, times_answered=0)
        for _ in range(4)
    )

    pool = (backlog_q,) + fresh_qs
    ctx = QuestionSelectionContext(
        user_id=_USER,
        available_questions=pool,
        mode=SelectionMode.REVIEW,
        review_backlog=(backlog_q.question_id,),
    )

    result = engine.select(ctx)

    assert result is not None
    assert result.question_id == backlog_q.question_id, (
        "REVIEW mode must select the question in the backlog"
    )

    print(f"  [5] review_mode — backlog question selected, score={result.selection_score:.4f}")


# ════════════════════════════════════════════════════════════════════════════
# 6 — Objective mode (session objective drives selection)
# ════════════════════════════════════════════════════════════════════════════

def test_objective_mode():
    # Question that matches subject + topic + article of the active objective
    target = _snap(
        subject_id=_SUBJ_A,
        topic_id=_TOPIC_A,
        article_id=_ART_A,
        tags=("CF-art-144", "segurança-pública"),
        exam_frequency=0.50,
    )
    # Decoys: different subjects/articles
    decoys = tuple(
        _snap(subject_id=_SUBJ_B, exam_frequency=0.50)
        for _ in range(4)
    )

    pool = (target,) + decoys
    ctx = QuestionSelectionContext(
        user_id=_USER,
        available_questions=pool,
        mode=SelectionMode.OBJECTIVE,
        current_objective="MASTER_ARTICLE",
        objective_subject_id=_SUBJ_A,
        objective_topic_id=_TOPIC_A,
        objective_article_id=_ART_A,
        knowledge_gaps=("CF-art-144", "segurança-pública"),   # matches target
    )

    result = engine.select(ctx)

    assert result is not None
    assert result.question_id == target.question_id, (
        "OBJECTIVE mode must select the question matching the objective"
    )

    print(f"  [6] objective_mode — objective question selected, score={result.selection_score:.4f}")


# ════════════════════════════════════════════════════════════════════════════
# 7 — Low remaining time (long questions eliminated)
# ════════════════════════════════════════════════════════════════════════════

def test_low_remaining_time():
    slow_q  = _snap(estimated_time_secs=300, exam_frequency=0.90)  # 5 min
    medium_q = _snap(estimated_time_secs=120, exam_frequency=0.80) # 2 min
    fast_q  = _snap(estimated_time_secs=45,  exam_frequency=0.70)  # 45 s

    pool = (slow_q, medium_q, fast_q)
    ctx = QuestionSelectionContext(
        user_id=_USER,
        available_questions=pool,
        remaining_time_secs=60,   # only 60 seconds left
    )

    result = engine.select(ctx)

    assert result is not None
    assert result.estimated_time_secs <= 60, (
        f"Selected question must fit remaining time, got {result.estimated_time_secs}s"
    )
    assert result.question_id == fast_q.question_id

    print(f"  [7] low_remaining_time — {result.estimated_time_secs}s question selected")


# ════════════════════════════════════════════════════════════════════════════
# 8 — High mastery (recently answered questions filtered out)
# ════════════════════════════════════════════════════════════════════════════

def test_high_mastery():
    # Recent questions (in 24h window) — should be filtered when mastery ≥ 0.70
    recent_qs = [_snap(exam_frequency=0.90) for _ in range(4)]
    recent_ids = tuple(q.question_id for q in recent_qs)

    # Unseen question — should survive the filter
    unseen_q = _snap(exam_frequency=0.50, times_answered=0)

    pool = tuple(recent_qs) + (unseen_q,)
    ctx = QuestionSelectionContext(
        user_id=_USER,
        available_questions=pool,
        subject_mastery={str(_SUBJ_A): 0.85},  # high mastery → filter kicks in
        recent_questions=recent_ids,
    )

    result = engine.select(ctx)

    assert result is not None
    assert result.question_id == unseen_q.question_id, (
        "High mastery: recently answered questions must be filtered out"
    )

    print(f"  [8] high_mastery — unseen question selected, score={result.selection_score:.4f}")


# ════════════════════════════════════════════════════════════════════════════
# 9 — Exam simulation (exam-frequency signal dominates)
# ════════════════════════════════════════════════════════════════════════════

def test_exam_simulation():
    # High-frequency question (appears in many real exams)
    high_freq = _snap(exam_frequency=0.95, tags=("PRF-classic",))
    # Low-frequency questions (rarely in exams)
    low_freqs = tuple(_snap(exam_frequency=0.10) for _ in range(4))

    pool = (high_freq,) + low_freqs
    ctx = QuestionSelectionContext(
        user_id=_USER,
        available_questions=pool,
        mode=SelectionMode.EXAM_SIMULATION,
    )

    result = engine.select(ctx)

    assert result is not None
    assert result.question_id == high_freq.question_id, (
        "EXAM_SIMULATION must prefer the highest exam-frequency question"
    )
    assert result.score_breakdown.get("exam_weight", 0) >= 0.90, (
        f"Exam weight score should reflect high frequency, got {result.score_breakdown}"
    )

    print(f"  [9] exam_simulation — exam_weight={result.score_breakdown['exam_weight']:.4f}")


# ════════════════════════════════════════════════════════════════════════════
# Runner
# ════════════════════════════════════════════════════════════════════════════

def run():
    tests = [
        ("1", "new_student",        test_new_student),
        ("2", "advanced_student",   test_advanced_student),
        ("3", "high_fatigue",       test_high_fatigue),
        ("4", "reinforcement_mode", test_reinforcement_mode),
        ("5", "review_mode",        test_review_mode),
        ("6", "objective_mode",     test_objective_mode),
        ("7", "low_remaining_time", test_low_remaining_time),
        ("8", "high_mastery",       test_high_mastery),
        ("9", "exam_simulation",    test_exam_simulation),
    ]

    print("=" * 64)
    print("QUESTION SELECTION — Smoke Test")
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
