"""
Coverage audit data models.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class CoverageFlag(str, Enum):
    GOOD = "good"         # ≥ 20 questions
    LOW = "low"           # 5–19 questions
    CRITICAL = "critical" # 1–4 questions
    EMPTY = "empty"       # 0 questions


@dataclass
class TopicCoverage:
    topic_slug: str
    question_count: int
    difficulty_distribution: dict[str, int]  # {easy: N, medium: N, hard: N}
    flag: CoverageFlag


@dataclass
class SubjectCoverage:
    subject_slug: str
    subject_name: str
    weight: float
    question_count: int
    topic_count: int
    flag: CoverageFlag
    difficulty_distribution: dict[str, int] = field(default_factory=dict)
    topics: list[TopicCoverage] = field(default_factory=list)

    @property
    def priority_score(self) -> float:
        """Higher score = higher import priority. Empty high-weight = most urgent."""
        weight_factor = self.weight
        scarcity_factor = max(0, 20 - self.question_count) / 20
        return round(weight_factor * scarcity_factor, 3)

    @property
    def missing_topic_count(self) -> int:
        """Topics with zero questions (from known edital topics)."""
        return sum(1 for t in self.topics if t.flag == CoverageFlag.EMPTY)


@dataclass
class CoverageReport:
    """Full coverage analysis for one exam."""
    exam: str                                     # 'PMGO' or 'PRF'
    total_questions: int
    total_subjects: int
    covered_subjects: int                         # subjects with ≥ 1 question
    subject_coverage: list[SubjectCoverage]
    exam_readiness_score: float                   # 0.0–1.0
    missing_subjects: list[str]
    low_coverage_subjects: list[str]
    import_priority: list[str]                    # ordered by priority_score DESC
    recommendations: list[str] = field(default_factory=list)
    difficulty_distribution: dict[str, int] = field(default_factory=dict)

    @property
    def subject_coverage_pct(self) -> float:
        if self.total_subjects == 0:
            return 0.0
        return round(self.covered_subjects / self.total_subjects * 100, 1)

    def as_dict(self) -> dict:
        return {
            "exam": self.exam,
            "total_questions": self.total_questions,
            "total_subjects": self.total_subjects,
            "covered_subjects": self.covered_subjects,
            "subject_coverage_pct": self.subject_coverage_pct,
            "exam_readiness_score": self.exam_readiness_score,
            "missing_subjects": self.missing_subjects,
            "low_coverage_subjects": self.low_coverage_subjects,
            "import_priority": self.import_priority,
            "recommendations": self.recommendations,
            "difficulty_distribution": self.difficulty_distribution,
            "subjects": [
                {
                    "slug": sc.subject_slug,
                    "name": sc.subject_name,
                    "weight": sc.weight,
                    "question_count": sc.question_count,
                    "topic_count": sc.topic_count,
                    "flag": sc.flag.value,
                    "priority_score": sc.priority_score,
                    "difficulty_distribution": sc.difficulty_distribution,
                    "topics": [
                        {
                            "slug": t.topic_slug,
                            "question_count": t.question_count,
                            "flag": t.flag.value,
                            "difficulty_distribution": t.difficulty_distribution,
                        }
                        for t in sorted(sc.topics, key=lambda x: -x.question_count)
                    ],
                }
                for sc in sorted(self.subject_coverage, key=lambda x: -x.weight)
            ],
        }
