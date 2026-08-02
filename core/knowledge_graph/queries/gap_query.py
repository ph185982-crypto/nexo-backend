from __future__ import annotations
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

from ..graph.graph import KnowledgeGraph
from ..graph.node import NodeType
from ..scoring.scorer import NodeScorer, ScoredNode


@dataclass
class GapResult:
    scored_node: ScoredNode
    recommended_step: str           # "questions" | "review" | "flashcards" | "law"
    explanation: str

    @property
    def node_id(self) -> str:
        return self.scored_node.node.node_id

    @property
    def label(self) -> str:
        return self.scored_node.node.label

    @property
    def impact_score(self) -> float:
        return self.scored_node.impact_score

    @property
    def subject_id(self) -> Optional[UUID]:
        return self.scored_node.subject_id

    @property
    def topic_id(self) -> Optional[UUID]:
        return self.scored_node.topic_id


@dataclass
class GapAnalysis:
    all_gaps: list[GapResult]           # every scored node, sorted by impact
    top_gaps: list[GapResult]           # top N
    critical: list[GapResult]           # impact_score > 0.7
    quick_wins: list[GapResult]         # high importance, mastery 40-70% — nearly there
    coverage_gaps: list[GapResult]      # low attempts (< 5) — never studied


class GapQuery:
    """Answers: 'What are the biggest knowledge gaps?'"""

    _CRITICAL_THRESHOLD = 0.60
    _QUICK_WIN_MIN_MASTERY = 40.0
    _QUICK_WIN_MAX_MASTERY = 72.0
    _QUICK_WIN_MIN_IMPORTANCE = 0.4
    _LOW_ATTEMPTS = 5

    def __init__(self) -> None:
        self._scorer = NodeScorer()

    def execute(
        self,
        graph: KnowledgeGraph,
        limit: int = 10,
        node_types: Optional[list[NodeType]] = None,
    ) -> GapAnalysis:
        if node_types is None:
            node_types = [NodeType.SUBJECT, NodeType.TOPIC]

        scored = self._scorer.score_all(graph, node_types)

        all_gaps = [self._to_result(s) for s in scored]

        top_gaps = all_gaps[:limit]

        critical = [g for g in all_gaps if g.impact_score >= self._CRITICAL_THRESHOLD]

        quick_wins = [
            g for g in all_gaps
            if (
                self._QUICK_WIN_MIN_MASTERY <= g.scored_node.mastery_score <= self._QUICK_WIN_MAX_MASTERY
                and g.scored_node.importance >= self._QUICK_WIN_MIN_IMPORTANCE
            )
        ][:limit]

        coverage_gaps = [
            g for g in all_gaps
            if g.scored_node.node.metrics and g.scored_node.node.metrics.attempts < self._LOW_ATTEMPTS
        ][:limit]

        return GapAnalysis(
            all_gaps=all_gaps,
            top_gaps=top_gaps,
            critical=critical,
            quick_wins=quick_wins,
            coverage_gaps=coverage_gaps,
        )

    def _to_result(self, s: ScoredNode) -> GapResult:
        step = s.recommended_step
        explanation = self._explain(s)
        return GapResult(scored_node=s, recommended_step=step, explanation=explanation)

    @staticmethod
    def _explain(s: ScoredNode) -> str:
        parts: list[str] = []
        if s.mastery_score < 30:
            parts.append(f"domínio crítico {s.mastery_score:.0f}/100")
        elif s.mastery_score < 60:
            parts.append(f"domínio fraco {s.mastery_score:.0f}/100")
        if s.error_pressure > 0:
            parts.append(f"{s.node.metrics.error_count} erro(s) sem resolução")
        if s.review_pressure > 0:
            parts.append(f"{s.node.metrics.overdue_reviews} revisão(ões) atrasada(s)")
        if s.importance >= 0.6:
            parts.append(f"peso alto no edital ({s.importance:.0%})")
        return " — ".join(parts) if parts else "gap de cobertura"
