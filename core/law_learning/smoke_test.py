"""
Law Learning Engine smoke test — no external dependencies, no DB.

Covers:
  A) Article not yet studied (NOT_STARTED) → READ_ARTICLE recommended
  B) Article with mistakes and overdue review (NEEDS_REVIEW) → REVISIT_MISTAKES
  C) Mastered article with related content → ADVANCE_TO_RELATED
  D) Difficult article in progress → COMPARE_ARTICLES or SOLVE_QUESTIONS
  E) Difficulty estimator signals — exception-heavy article → HARD+
  F) Importance estimator — high-frequency critical-weight article → CRITICAL+
  G) Relationship finder — sibling + cross-referenced articles
  H) as_dict() — output structure validation
  I) Custom provider injection — provider_name reflected in output
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from uuid import UUID, uuid4

from core.law_learning import (
    LawLearningEngine,
    ArticleContext,
    ArticleSnapshot,
    PersonalProgressSnapshot,
    RelatedContentSnapshot,
    LearningContextSnapshot,
    ApprovalContextSnapshot,
    ArticleLearningObject,
    DifficultyLevel,
    ImportanceLevel,
    StudyStatus,
    NextActionType,
    ExplanationProvider,
    StaticExplanationProvider,
)
from core.law_learning.interfaces.output import ArticleExplanation

_ENGINE = LawLearningEngine()
_USER_ID = uuid4()
_DOC_ID  = uuid4()
_SUBJ_ID = uuid4()
_TOPIC_ID = uuid4()


def _base_article(**kwargs) -> ArticleSnapshot:
    defaults = dict(
        article_id=uuid4(),
        document_id=_DOC_ID,
        subject_id=_SUBJ_ID,
        topic_id=_TOPIC_ID,
        article_number="29",
        title="Requisitos para habilitação",
        official_text=(
            "Para a habilitação, o candidato deverá satisfazer as seguintes exigências: "
            "I - ser penalmente imputável; II - saber ler e escrever; "
            "III - possuir carteira de identidade ou equivalente. "
            "Parágrafo único. Estão dispensados dos requisitos do inciso III, "
            "exceto o previsto no inciso I, os condutores de veículo rural."
        ),
        simple_text="Para tirar habilitação, o candidato precisa: ser maior de 18 anos, saber ler e escrever, ter identidade. Exceção: motoristas rurais dispensam parte dos requisitos, exceto imputabilidade penal.",
        highlights=["habilitação", "imputável", "exceto"],
        tags=["habilitacao", "ctb", "requisitos", "exceto"],
        frequency_score=0.75,
        chapter="Capítulo III",
        section="Seção I",
        document_abbreviation="CTB",
    )
    defaults.update(kwargs)
    return ArticleSnapshot(**defaults)


def _base_progress(**kwargs) -> PersonalProgressSnapshot:
    defaults = dict(
        mastery_level=0.55,
        total_attempts=20,
        accuracy=0.65,
        mistake_count=3,
        review_count=2,
        last_studied=datetime.now(timezone.utc) - timedelta(days=5),
        is_overdue=False,
    )
    defaults.update(kwargs)
    return PersonalProgressSnapshot(**defaults)


def _base_learning(**kwargs) -> LearningContextSnapshot:
    defaults = dict(
        forgetting_velocity_article=0.20,
        confidence_for_subject=0.65,
        retention_category="medium",
        review_efficiency=0.60,
        topic_mastery_confidence=0.70,
    )
    defaults.update(kwargs)
    return LearningContextSnapshot(**defaults)


def _base_approval(**kwargs) -> ApprovalContextSnapshot:
    defaults = dict(
        approval_probability=0.55,
        subject_weight=3.0,
        risk_level="medium",
    )
    defaults.update(kwargs)
    return ApprovalContextSnapshot(**defaults)


def _base_related(**kwargs) -> RelatedContentSnapshot:
    defaults = dict(
        related_article_ids=[uuid4(), uuid4()],
        related_article_labels=["Art. 30 CTB", "Art. 31 CTB"],
        related_question_ids=[uuid4(), uuid4(), uuid4()],
        related_topic_ids=[_TOPIC_ID],
        related_topic_labels=["Habilitação"],
        sibling_article_ids=[uuid4()],
    )
    defaults.update(kwargs)
    return RelatedContentSnapshot(**defaults)


def _ctx(**kwargs) -> ArticleContext:
    return ArticleContext(
        user_id=_USER_ID,
        article=kwargs.pop("article", _base_article()),
        progress=kwargs.pop("progress", _base_progress()),
        related_content=kwargs.pop("related_content", _base_related()),
        learning=kwargs.pop("learning", _base_learning()),
        approval=kwargs.pop("approval", _base_approval()),
        **kwargs,
    )


# ════════════════════════════════════════════════════════════════════════════
# A — NOT_STARTED → READ_ARTICLE
# ════════════════════════════════════════════════════════════════════════════

def test_not_started():
    ctx = _ctx(progress=None)
    obj = _ENGINE.analyze(ctx)
    assert obj.study_status == StudyStatus.NOT_STARTED, f"Expected NOT_STARTED, got {obj.study_status}"
    assert obj.recommended_next_action.action == NextActionType.READ_ARTICLE
    assert obj.personal_mastery == 0.0
    assert obj.mistake_count == 0
    assert obj.estimated_learning_gain > 0
    print(f"  [A] NOT_STARTED — action={obj.recommended_next_action.action}  gain={obj.estimated_learning_gain:.4f}")


# ════════════════════════════════════════════════════════════════════════════
# B — NEEDS_REVIEW (overdue + many mistakes) → REVISIT_MISTAKES
# ════════════════════════════════════════════════════════════════════════════

def test_needs_review():
    ctx = _ctx(progress=_base_progress(
        is_overdue=True,
        mistake_count=5,
        total_attempts=30,
        accuracy=0.50,
        mastery_level=0.40,
    ))
    obj = _ENGINE.analyze(ctx)
    assert obj.study_status == StudyStatus.NEEDS_REVIEW, f"Expected NEEDS_REVIEW, got {obj.study_status}"
    assert obj.recommended_next_action.action == NextActionType.REVISIT_MISTAKES
    print(f"  [B] NEEDS_REVIEW — action={obj.recommended_next_action.action}  priority={obj.recommended_next_action.priority}")


# ════════════════════════════════════════════════════════════════════════════
# C — MASTERED + related content → ADVANCE_TO_RELATED
# ════════════════════════════════════════════════════════════════════════════

def test_mastered():
    ctx = _ctx(progress=_base_progress(
        mastery_level=0.92,
        accuracy=0.90,
        is_overdue=False,
    ))
    obj = _ENGINE.analyze(ctx)
    assert obj.study_status == StudyStatus.MASTERED, f"Expected MASTERED, got {obj.study_status}"
    assert obj.recommended_next_action.action == NextActionType.ADVANCE_TO_RELATED
    assert len(obj.related_articles) > 0
    print(f"  [C] MASTERED — action={obj.recommended_next_action.action}  related={len(obj.related_articles)}")


# ════════════════════════════════════════════════════════════════════════════
# D — IN_PROGRESS with few mistakes → SOLVE_QUESTIONS
# ════════════════════════════════════════════════════════════════════════════

def test_in_progress():
    ctx = _ctx(progress=_base_progress(mistake_count=1))
    obj = _ENGINE.analyze(ctx)
    assert obj.study_status == StudyStatus.IN_PROGRESS, f"Expected IN_PROGRESS, got {obj.study_status}"
    assert obj.recommended_next_action.action in (
        NextActionType.SOLVE_QUESTIONS,
        NextActionType.COMPARE_ARTICLES,
        NextActionType.REVISIT_MISTAKES,
    )
    print(f"  [D] IN_PROGRESS — action={obj.recommended_next_action.action}")


# ════════════════════════════════════════════════════════════════════════════
# E — Difficulty estimator: exception-heavy article
# ════════════════════════════════════════════════════════════════════════════

def test_difficulty_estimation():
    hard_article = _base_article(
        official_text=(
            "Art. 99. É proibida a circulação de veículos automotores em vias públicas urbanas "
            "e rurais, exceto os de emergência devidamente identificados, salvo mediante autorização "
            "especial concedida pelo órgão de trânsito competente, exceto nas vias dotadas de "
            "sinalização específica e homologada, ressalvado o disposto no art. 102, § 3º, "
            "inciso IV, alínea b, do presente Código. "
            "§ 1º. Excepcionalmente, o órgão executivo de trânsito estadual poderá autorizar, "
            "somente em casos de extrema urgência e necessidade pública devidamente comprovada, "
            "a circulação restrita de determinados veículos em horários e locais previamente definidos. "
            "§ 2º. Salvo disposição em contrário prevista nesta seção ou em regulamento específico, "
            "as normas do caput aplicam-se a todos os condutores, exceto os contemplados no art. 145, "
            "inciso II e inciso III, alínea c, ressalvadas as condições do § 1º do art. 31."
        ),
        frequency_score=0.80,
        tags=["exceto", "salvo", "excecao"],
    )
    ctx = _ctx(
        article=hard_article,
        progress=_base_progress(accuracy=0.40, mistake_count=6),
    )
    obj = _ENGINE.analyze(ctx)
    assert obj.difficulty.level in (DifficultyLevel.HARD, DifficultyLevel.VERY_HARD), (
        f"Expected HARD or VERY_HARD, got {obj.difficulty.level}"
    )
    assert "exception_density" in obj.difficulty.factors
    print(f"  [E] Difficulty: {obj.difficulty.level} (score={obj.difficulty.score:.4f})")
    print(f"      factors: {obj.difficulty.factors}")


# ════════════════════════════════════════════════════════════════════════════
# F — Importance estimator: high-frequency + heavy subject
# ════════════════════════════════════════════════════════════════════════════

def test_importance_estimation():
    ctx = _ctx(
        article=_base_article(frequency_score=0.95),
        approval=_base_approval(subject_weight=4.5),
        progress=_base_progress(mistake_count=8),
    )
    obj = _ENGINE.analyze(ctx)
    assert obj.importance.level in (ImportanceLevel.HIGH, ImportanceLevel.CRITICAL), (
        f"Expected HIGH or CRITICAL, got {obj.importance.level}"
    )
    print(f"  [F] Importance: {obj.importance.level} (score={obj.importance.score:.4f})")


# ════════════════════════════════════════════════════════════════════════════
# G — Relationship finder
# ════════════════════════════════════════════════════════════════════════════

def test_relationship_finder():
    related = _base_related(
        sibling_article_ids=[uuid4(), uuid4()],
        related_article_ids=[uuid4(), uuid4(), uuid4()],
        related_article_labels=["Art. 30 CTB", "Art. 31 CTB", "Art. 32 CTB"],
    )
    ctx = _ctx(related_content=related)
    obj = _ENGINE.analyze(ctx)
    assert len(obj.related_articles) >= 2
    types = {r.relationship_type for r in obj.related_articles}
    assert "same_chapter" in types or "cross_referenced" in types
    print(f"  [G] Related articles: {len(obj.related_articles)}")
    for r in obj.related_articles[:3]:
        print(f"      {r.relationship_type} → {r.label} (strength={r.strength:.3f})")


# ════════════════════════════════════════════════════════════════════════════
# H — as_dict() structure validation
# ════════════════════════════════════════════════════════════════════════════

def test_as_dict():
    obj = _ENGINE.analyze(_ctx())
    d = obj.as_dict()
    required_keys = {
        "user_id", "article_id", "analyzed_at", "article_number", "document",
        "study_status", "personal_mastery", "difficulty", "importance",
        "explanation", "related_articles", "exam_importance",
        "estimated_learning_gain", "recommended_next_action",
    }
    missing = required_keys - set(d.keys())
    assert not missing, f"as_dict() missing keys: {missing}"
    assert "level" in d["difficulty"]
    assert "level" in d["importance"]
    assert "summary" in d["explanation"]
    assert "keywords" in d["explanation"]
    assert "action" in d["recommended_next_action"]
    print(f"  [H] as_dict() — {len(d)} top-level keys")
    print(f"      explanation summary: {d['explanation']['summary'][:80]}…")


# ════════════════════════════════════════════════════════════════════════════
# I — Custom provider injection
# ════════════════════════════════════════════════════════════════════════════

class _MockProvider:
    @property
    def provider_name(self) -> str:
        return "mock-ai-v1"

    def explain(self, context: ArticleContext) -> ArticleExplanation:
        return ArticleExplanation(
            summary="Mock summary generated by test provider.",
            keywords=["mock", "test"],
            mnemonic="MOCK",
            common_mistakes=["Mistake A"],
            provider_name=self.provider_name,
        )


def test_custom_provider():
    engine = LawLearningEngine(provider=_MockProvider())
    obj = engine.analyze(_ctx())
    assert obj.explanation.provider_name == "mock-ai-v1"
    assert obj.explanation.summary == "Mock summary generated by test provider."
    print(f"  [I] Custom provider — provider={obj.explanation.provider_name}")


# ════════════════════════════════════════════════════════════════════════════
# Runner
# ════════════════════════════════════════════════════════════════════════════

def run():
    tests = [
        ("A", "NOT_STARTED → READ_ARTICLE",         test_not_started),
        ("B", "NEEDS_REVIEW → REVISIT_MISTAKES",     test_needs_review),
        ("C", "MASTERED → ADVANCE_TO_RELATED",       test_mastered),
        ("D", "IN_PROGRESS → SOLVE_QUESTIONS",       test_in_progress),
        ("E", "Difficulty estimator",                test_difficulty_estimation),
        ("F", "Importance estimator",                test_importance_estimation),
        ("G", "Relationship finder",                 test_relationship_finder),
        ("H", "as_dict() structure",                 test_as_dict),
        ("I", "Custom provider injection",           test_custom_provider),
    ]

    print("=" * 64)
    print("LAW LEARNING ENGINE — Smoke Test")
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
