"""
CoverageAuditor — analyses a question corpus against a subject catalogue
and produces a CoverageReport.

Pure domain logic: no DB I/O. The caller provides:
  - questions: list of dicts with at least {subject_slug, topic_slug, difficulty}
  - subjects:  list of dicts with {slug, name, weight_pm|weight_prf, ...}
"""
from __future__ import annotations

from collections import defaultdict

from .models import CoverageFlag, CoverageReport, SubjectCoverage, TopicCoverage

# Thresholds for coverage flags
_GOOD_THRESHOLD = 20
_LOW_THRESHOLD = 5
_CRITICAL_THRESHOLD = 1

# Weights for readiness calculation
_READINESS_EMPTY_PENALTY = 0.15
_READINESS_LOW_PENALTY = 0.05

_VALID_DIFFICULTIES = {"easy", "medium", "hard"}


def _flag(count: int) -> CoverageFlag:
    if count == 0:
        return CoverageFlag.EMPTY
    if count < _CRITICAL_THRESHOLD + 1:
        return CoverageFlag.CRITICAL
    if count < _LOW_THRESHOLD + 1:
        return CoverageFlag.LOW
    return CoverageFlag.GOOD


def _empty_difficulty_dist() -> dict[str, int]:
    return {"easy": 0, "medium": 0, "hard": 0}


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

        questions: list of dicts with at least {subject_slug, topic_slug, difficulty}
        subjects:  list of dicts with {slug, name, weight_pm|weight_prf, ...}
        """
        # Only subjects with positive weight for this exam
        relevant_subjects = [
            s for s in subjects
            if float(s.get(self._weight_key, 0)) > 0 and s.get("is_active", True)
        ]

        # Aggregate by subject and topic
        q_by_subject: dict[str, int] = defaultdict(int)
        diff_by_subject: dict[str, dict[str, int]] = defaultdict(_empty_difficulty_dist)
        # topic_data[subject_slug][topic_slug] = {count, difficulty_dist}
        topic_data: dict[str, dict[str, dict]] = defaultdict(
            lambda: defaultdict(lambda: {"count": 0, "diff": _empty_difficulty_dist()})
        )
        global_diff: dict[str, int] = _empty_difficulty_dist()

        for q in questions:
            slug = q.get("subject_slug", "")
            topic = q.get("topic_slug") or "_unknown"
            diff = q.get("difficulty", "medium")
            if diff not in _VALID_DIFFICULTIES:
                diff = "medium"

            q_by_subject[slug] += 1
            diff_by_subject[slug][diff] += 1
            topic_data[slug][topic]["count"] += 1
            topic_data[slug][topic]["diff"][diff] += 1
            global_diff[diff] += 1

        subject_coverages: list[SubjectCoverage] = []
        missing: list[str] = []
        low: list[str] = []

        for subj in relevant_subjects:
            slug = subj["slug"]
            count = q_by_subject.get(slug, 0)
            weight = float(subj.get(self._weight_key, 0))
            flag = _flag(count)

            # Build topic-level coverage
            topics: list[TopicCoverage] = []
            for t_slug, t_info in topic_data.get(slug, {}).items():
                tc = TopicCoverage(
                    topic_slug=t_slug,
                    question_count=t_info["count"],
                    difficulty_distribution=dict(t_info["diff"]),
                    flag=_flag(t_info["count"]),
                )
                topics.append(tc)

            sc = SubjectCoverage(
                subject_slug=slug,
                subject_name=subj.get("name", slug),
                weight=weight,
                question_count=count,
                topic_count=len(topics),
                flag=flag,
                difficulty_distribution=dict(diff_by_subject.get(slug, _empty_difficulty_dist())),
                topics=topics,
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
            difficulty_distribution=global_diff,
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
                "High-weight subjects with zero questions: "
                + ", ".join(sc.subject_slug for sc in heavy_empty)
                + " — these critically impact exam readiness."
            )
        total_q = sum(sc.question_count for sc in coverages)
        if total_q < 100:
            recs.append(
                f"Total question pool ({total_q}) is small. Aim for ≥20 per subject "
                f"for meaningful adaptive selection."
            )
        # Difficulty balance check
        total_easy = sum(sc.difficulty_distribution.get("easy", 0) for sc in coverages)
        total_hard = sum(sc.difficulty_distribution.get("hard", 0) for sc in coverages)
        if total_q > 0 and total_hard / max(total_q, 1) < 0.15:
            recs.append(
                "Less than 15% of questions are classified as hard. "
                "Add harder questions to better simulate real exam difficulty."
            )
        if total_q > 0 and total_easy / max(total_q, 1) > 0.60:
            recs.append(
                "Over 60% of questions are easy. Consider adding medium/hard questions "
                "to build genuine exam readiness."
            )
        return recs
