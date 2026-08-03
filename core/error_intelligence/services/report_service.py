"""
ReportService — generates structured, human-readable diagnostic reports.

Converts an ErrorAnalysis into a comprehensive dict suitable for:
  - API responses
  - Logging / audit trail
  - Injection into AI tutor prompts
"""
from __future__ import annotations

from datetime import datetime, timezone

from ..interfaces.analysis import ErrorAnalysis


def generate_report(analysis: ErrorAnalysis) -> dict:
    """
    Returns a structured report dict with three sections:
      summary   — one-line diagnosis for quick display
      diagnosis — full breakdown for detailed view
      actions   — prioritised remediation list
    """
    return {
        "report_generated_at": datetime.now(timezone.utc).isoformat(),
        "user_id": str(analysis.user_id),
        "question_id": str(analysis.question_id),
        "summary": _build_summary(analysis),
        "diagnosis": _build_diagnosis(analysis),
        "evolution": _build_evolution(analysis),
        "pattern": _build_pattern(analysis),
        "actions": _build_actions(analysis),
        "knowledge": _build_knowledge(analysis),
        "signals": {
            "review_priority": analysis.review_priority,
            "estimated_gain": round(analysis.estimated_gain, 4),
            "classifier_scores": {
                k: round(v, 3) for k, v in analysis.classifier_scores.items()
            },
        },
    }


def _build_summary(a: ErrorAnalysis) -> dict:
    severity_icons = {
        "LOW": "🟢",
        "MEDIUM": "🟡",
        "HIGH": "🟠",
        "CRITICAL": "🔴",
    }
    return {
        "classification": a.classification,
        "severity": a.severity,
        "severity_icon": severity_icons.get(a.severity, "⚪"),
        "root_cause": a.root_cause,
        "knowledge_gap": a.knowledge_gap,
        "one_liner": f"[{a.severity}] {a.classification} — {a.root_cause}",
    }


def _build_diagnosis(a: ErrorAnalysis) -> dict:
    return {
        "classification": a.classification,
        "severity": a.severity,
        "root_cause": a.root_cause,
        "knowledge_gap": a.knowledge_gap,
        "review_priority": a.review_priority,
        "estimated_gain": round(a.estimated_gain, 4),
    }


def _build_evolution(a: ErrorAnalysis) -> dict | None:
    if a.evolution is None:
        return None
    return {
        "direction": a.evolution.direction,
        "description": a.evolution.description,
        "delta": round(a.evolution.delta, 3),
    }


def _build_pattern(a: ErrorAnalysis) -> dict | None:
    if a.pattern_match is None:
        return None
    return {
        "pattern_type": a.pattern_match.pattern_type,
        "description": a.pattern_match.description,
        "occurrences": a.pattern_match.occurrences,
        "confidence": round(a.pattern_match.confidence, 3),
        "examples": a.pattern_match.examples,
    }


def _build_actions(a: ErrorAnalysis) -> list[dict]:
    return sorted(
        [
            {
                "action_type": act.action_type,
                "target": act.target_label,
                "reason": act.reason,
                "priority": act.priority,
                "estimated_time_mins": act.estimated_time_mins,
                "expected_learning_gain": round(act.expected_learning_gain, 3),
            }
            for act in a.recommended_actions
        ],
        key=lambda x: x["priority"],
        reverse=True,
    )


def _build_knowledge(a: ErrorAnalysis) -> dict:
    rk = a.related_knowledge
    return {
        "articles_count": len(rk.articles),
        "topics_count": len(rk.topics),
        "questions_count": len(rk.questions),
        "flashcards_count": len(rk.flashcards),
        "study_path_length": len(rk.study_path),
        "mission_step_hints": rk.mission_step_hints,
    }
