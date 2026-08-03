"""
Detector: auto-detects exam routing, difficulty, and source type from an
IngestedQuestion, enriching it with additional metadata.
"""
from __future__ import annotations

from .models import IngestedQuestion, SourceType

# Subjects exclusive to PMGO (weight_pm > 0, weight_prf == 0)
_PMGO_ONLY_SUBJECTS = {
    "direito-penal-militar",
    "direito-processual-penal-militar",
    "legislacao-institucional-pm",
    "criminologia",
    "medicina-legal",
    "realidade-goias",
}

# Subjects that appear in both exams
_SHARED_SUBJECTS = {
    "direito-constitucional",
    "direito-penal",
    "direito-processual-penal",
    "direito-administrativo",
    "lingua-portuguesa",
    "legislacao-especial",
    "direitos-humanos",
    "informatica",
    "raciocinio-logico",
    "etica-servico-publico",
}

# Subjects exclusive to PRF (weight_prf > 0, weight_pm == 0)
_PRF_ONLY_SUBJECTS = {
    "legislacao-transito",
    "fisica-aplicada",
    "geopolitica-brasileira",
    "lingua-espanhola",
}

_SOURCE_TYPE_KEYWORDS = {
    SourceType.SEED: {"seed", "pmgo/seed", "pmgo-seed"},
    SourceType.AUTHORIZED_IMPORT: {"import", "authorized", "aocp"},
    SourceType.LICENSED: {"licensed", "licenciado"},
}


def detect_exam(q: IngestedQuestion) -> str:
    """Return 'PMGO', 'PRF', or 'BOTH' based on subject routing."""
    slug = q.subject_slug
    if slug in _PMGO_ONLY_SUBJECTS:
        return "PMGO"
    if slug in _PRF_ONLY_SUBJECTS:
        return "PRF"
    return "BOTH"


def detect_source_type(source: str) -> SourceType:
    lower = source.lower()
    for stype, keywords in _SOURCE_TYPE_KEYWORDS.items():
        if any(kw in lower for kw in keywords):
            return stype
    return SourceType.UNKNOWN


def enrich(q: IngestedQuestion) -> IngestedQuestion:
    """
    Enrich the question with auto-detected metadata.
    Returns the same object (mutated in place) for convenience.
    """
    if q.source_type == SourceType.UNKNOWN:
        q.source_type = detect_source_type(q.source)

    # Tag with exam routing
    exam = detect_exam(q)
    tag = f"exam:{exam.lower()}"
    if tag not in q.tags:
        q.tags.append(tag)

    return q
