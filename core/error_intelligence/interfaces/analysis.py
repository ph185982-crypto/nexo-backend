"""
ErrorAnalysis and all output types for the Error Intelligence Engine.
These are the sole outputs — read by other engines, never written by them.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional
from uuid import UUID


@dataclass
class TreatmentAction:
    """
    A single recommended remediation action.
    Other engines (Decision Engine, Mission Builder) consume this list
    to decide what to include in the next mission.
    """
    action_type: str            # TreatmentActionType value
    target_id: Optional[UUID]   # article_id, topic_id, etc. — None when not applicable
    target_label: str           # human-readable name of the target
    reason: str                 # why this action was recommended
    priority: int               # 1-10 (10 = most urgent)
    estimated_time_mins: int    # expected time to complete this action
    expected_learning_gain: float  # 0-1 expected improvement from completing this action


@dataclass
class PatternMatch:
    """A recurring behavioural pattern detected across error history."""
    pattern_type: str           # PatternType value
    description: str            # human-readable description
    occurrences: int            # number of examples that match this pattern
    confidence: float           # 0-1 how certain this pattern is
    examples: list[str]         # short labels describing matching instances


@dataclass(frozen=True)
class EvolutionStatus:
    """
    Whether this error type is disappearing, improving, stable, or worsening.
    Computed by comparing current context against previous error_notebook state.
    """
    direction: str              # EvolutionDirection value
    description: str
    delta: float                # change in times_repeated or error rate (negative = improving)


@dataclass
class RelatedKnowledge:
    """
    Related content surfaced from the Knowledge Graph for this error.
    Other engines use this to build study paths and missions.
    """
    articles: list[Any]         # KnowledgeNode instances (duck-typed, NodeType.ARTICLE)
    topics: list[Any]           # KnowledgeNode instances (NodeType.TOPIC)
    questions: list[Any]        # KnowledgeNode instances (NodeType.QUESTION)
    flashcards: list[Any]       # KnowledgeNode instances (NodeType.FLASHCARD)
    study_path: list[Any]       # Ordered study path from KGE OriginResult
    mission_step_hints: list[str]  # suggested step types for Decision Engine: "LAW", "REVIEW", etc.


@dataclass
class ErrorAnalysis:
    """
    Complete diagnosis of one wrong answer.

    The Error Intelligence Engine's sole output type.
    No other engine writes to this — it is read-only from external consumers.
    """
    user_id: UUID
    question_id: UUID
    analyzed_at: datetime

    # ── Core diagnosis ────────────────────────────────────────────────
    classification: str         # ErrorClassification value
    severity: str               # ErrorSeverity value
    root_cause: str             # single sentence explaining WHY the user failed
    knowledge_gap: str          # specific gap label (article, concept, topic)

    # ── Related knowledge (from KGE) ──────────────────────────────────
    related_knowledge: RelatedKnowledge

    # ── Treatment recommendations ──────────────────────────────────────
    recommended_actions: list[TreatmentAction]

    # ── Priority signals for other engines ───────────────────────────
    review_priority: int        # 1-10 overall urgency for the review queue
    estimated_gain: float       # 0-1 expected approval probability improvement

    # ── Pattern and evolution ─────────────────────────────────────────
    pattern_match: Optional[PatternMatch] = None
    evolution: Optional[EvolutionStatus] = None

    # ── Transparency ─────────────────────────────────────────────────
    classifier_scores: dict[str, float] = field(default_factory=dict)

    # ── Helpers ───────────────────────────────────────────────────────

    def as_dict(self) -> dict:
        """Lightweight dict for API responses and inter-engine communication."""
        return {
            "user_id": str(self.user_id),
            "question_id": str(self.question_id),
            "analyzed_at": self.analyzed_at.isoformat(),
            "classification": self.classification,
            "severity": self.severity,
            "root_cause": self.root_cause,
            "knowledge_gap": self.knowledge_gap,
            "review_priority": self.review_priority,
            "estimated_gain": round(self.estimated_gain, 4),
            "evolution": self.evolution.direction if self.evolution else None,
            "pattern": self.pattern_match.pattern_type if self.pattern_match else None,
            "actions": [
                {
                    "type": a.action_type,
                    "target": a.target_label,
                    "reason": a.reason,
                    "priority": a.priority,
                    "time_mins": a.estimated_time_mins,
                    "gain": round(a.expected_learning_gain, 3),
                }
                for a in self.recommended_actions
            ],
            "related_articles": len(self.related_knowledge.articles),
            "related_topics": len(self.related_knowledge.topics),
            "related_questions": len(self.related_knowledge.questions),
            "study_path_length": len(self.related_knowledge.study_path),
        }
