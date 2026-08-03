"""
Deduplicator: filters out questions whose content hash already exists in a seen set.

The deduplicator is stateless — the caller manages the seen_hashes set so it
can persist across pipeline runs (e.g., to avoid re-importing questions already
in the database).
"""
from __future__ import annotations

from .models import IngestedQuestion


class Deduplicator:
    """
    Stateful deduplicator for a single pipeline run.
    Pass existing_hashes from the DB to avoid re-importing known questions.
    """

    def __init__(self, existing_hashes: set[str] | None = None) -> None:
        self._seen: set[str] = set(existing_hashes or [])
        self.duplicates_skipped = 0

    def is_duplicate(self, q: IngestedQuestion) -> bool:
        if q.content_hash in self._seen:
            self.duplicates_skipped += 1
            return True
        self._seen.add(q.content_hash)
        return False

    def filter(self, questions: list[IngestedQuestion]) -> list[IngestedQuestion]:
        result = []
        for q in questions:
            if not self.is_duplicate(q):
                result.append(q)
        return result
