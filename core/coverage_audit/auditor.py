"""
CoverageAuditor — analyses a question corpus against a subject catalogue
and produces a CoverageReport.

Pure domain logic: no DB I/O. The caller provides:
  - questions: list of dicts with at least {subject_slug, topic_slug}
  - subjects:  list of dicts with {slug, name, weight_pm, weight_prf, ...}
"""
from __future__ import annotations

import math
from collections import defaultdict

from .models import CoverageFlag, CoverageReport, SubjectCoverage

# Thresholds for coverage flags
_GOOD_THRESHOLD = 20
_LOW_THRESHOLD = 5
_CRITICAL_THRESHOLD = 1

# Weights for readiness calculation: we penalise uncovered high-weight subjects
_READINESS_EMPTY_PENALTY = 0.15
_READINESS_LOW_PENALTY = 0.05


def _flag(count: int) -> CoverageFlag:
    if count == 0:
        return CoverageFlag.EMPTY
    if count < _CRITICAL_THRESHOLD + 1:
        return CoverageFlag.CRITICAL
    if count < _LOW_THRESHOLD + 1:
        return CoverageFlag.LOW
    return CoverageFlag.GOOD


class CoverageAuditor:
    """
    Compute a CoverageReport for any exam given a question corpus and subject list.

    Parameters
    ----------
    exam : str
        'PMGO' or 'PRF' — selects which weight column to use.
    """

    def __init__(self, exam: str = "PMGO") -> None:
        self.exam = exam.upper()
        self._weight_key = "weight_pm" if self.exam == "PMGO" else "weight_prf"

    def audit(
        self,
        questions: list[dict],
        subjects: list[dict],
    ) -> CoverageReport:
        """
        Run coverage analysis and return a CoverageReport.

        questions: list of dicts with at least {subject_slug, topic_slug}
        subjects:  list of dicts with {slug, name, weight_pm|weight_prf, ...}
        """
        # Only subjects with positive weight for this exam
        relevant_subjects = [
            s for s in subjects
            if float(s.get(self._weight_key, 0)) > 0 and s.get("is_active", True)
        ]

        # Count questions per subject
        q_by_subject: dict[str, int] = defaultdict(int)
        topics_by_subject: dict[str, set] = defaultdict(set)
        for q in questions:
            slug = q.get("subject_slug", "")
            q_by_subject[slug] += 1
            topics_by_subject[slug].add(q.get("topic_slug", ""))

        subject_coverages: list[SubjectCoverage] = []
        missing: list[str] = []
        low: list[str] = []

        for subj in relevant_subjects:
            slug = subj["slug"]
            count = q_by_subject.get(slug, 0)
            weight = float(subj.get(self._weight_key, 0))
            flag = _flag(count)

            sc = SubjectCoverage(
                subject_slug=slug,
                subject_name=subj.get("name", slug),
                weight=weight,
                question_count=count,
                topic_count=len(topics_by_subject.get(slug, set())),
                flag=flag,
            )
            subject_coverages.append(sc)

            if flag == CoverageFlag.EMPTY:
                missing.append(slug)
            elif flag in (CoverageFlag.CRITICAL, CoverageFlag.LOW):
                low.append(slug)

        # Import priority: sort by priority_score descending
        priority = [
            sc.subject_slug
            for sc in sorted(subject_coverages, key=lambda x: -x.priority_score)
            if sc.priority_score > 0
        ]

        readiness = self._readiness(subject_coverages)
        recommendations = self._recommendations(subject_coverages, missing, low)

        total_questions = sum(q_by_subject.get(s["slug"], 0) for s in relevant_subjects)
        covered = sum(1 for sc in subject_coverages if sc.question_count > 0)

        return CoverageReport(
            exam=self.exam,
            total_questions=total_questions,
            total_subjects=len(relevant_subjects),
            covered_subjects=covered,
            subject_coverage=subject_coverages,
            exam_readiness_score=readiness,
            missing_subjects=missing,
            low_coverage_subjects=low,
            import_priority=priority,
            recommendations=recommendations,
        )

    def _readiness(self, coverages: list[SubjectCoverage]) -> float:
        if not coverages:
            return 0.0
        total_weight = sum(sc.weight for sc in coverages)
        if total_weight == 0:
            return 0.0

        penalty = 0.0
        for sc in coverages:
            weight_share = sc.weight / total_weight
            if sc.flag == CoverageFlag.EMPTY:
                penalty += _READINESS_EMPTY_PENALTY * weight_share * 10
            elif sc.flag in (CoverageFlag.CRITICAL, CoverageFlag.LOW):
                penalty += _READINESS_LOW_PENALTY * weight_share * 10

        readiness = max(0.0, 1.0 - penalty)
        return round(readiness, 3)

    @staticmethod
    def _recommendations(
        coverages: list[SubjectCoverage],
        missing: list[str],
        low: list[str],
    ) -> list[str]:
        recs: list[str] = []
        if missing:
            recs.append(
                f"Priority import needed for {len(missing)} empty subject(s): "
                + ", ".join(missing[:5])
                + ("..." if len(missing) > 5 else "")
            )
        if low:
            recs.append(
                f"{len(low)} subject(s) have low coverage (<5 questions): "
                + ", ".join(low[:5])
            )
        heavy_empty = [sc for sc in coverages if sc.flag == CoverageFlag.EMPTY and sc.weight >= 2.0]
        if heavy_empty:
            recs.append(
                f"High-weight subjects with zero questions: "
                + ", ".join(sc.subject_slug for sc in heavy_empty)
                + " — these critically impact exam readiness."
            )
        total_q = sum(sc.question_count for sc in coverages)
        if total_q < 100:
            recs.append(
                f"Total question pool ({total_q}) is small. Aim for ≥20 per subject "
                f"for meaningful adaptive selection."
            )
        return recs
