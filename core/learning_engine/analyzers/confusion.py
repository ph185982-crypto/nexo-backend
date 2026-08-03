from __future__ import annotations
from collections import Counter, defaultdict

from ..interfaces.observations import ErrorRecord
from ..interfaces.profile import ConceptConfusionMatrix


_MAX_PAIRS = 15
_MAX_CONFUSED = 8


class ConfusionAnalyzer:
    """
    Which topics does this user repeatedly confuse?

    Method:
    - Group errors by topic_id.
    - Topics with the most errors are "most confused."
    - Co-occurring errors (same error_type, different topics) form confused pairs.
    - Confusion score = min(count_a, count_b) / max(count_a, count_b)
    """

    def analyze(self, errors: list[ErrorRecord]) -> ConceptConfusionMatrix:
        if not errors:
            return ConceptConfusionMatrix(confused_pairs=(), most_confused=())

        topic_counts = self._count_by_topic(errors)
        confused_pairs = self._find_confused_pairs(errors, topic_counts)
        most_confused = self._most_confused_topics(topic_counts)

        return ConceptConfusionMatrix(
            confused_pairs=tuple(confused_pairs),
            most_confused=tuple(most_confused),
        )

    # ── Private ───────────────────────────────────────────────────────

    @staticmethod
    def _count_by_topic(errors: list[ErrorRecord]) -> Counter:
        counter: Counter = Counter()
        for e in errors:
            if e.topic_id:
                counter[str(e.topic_id)] += e.times_repeated
        return counter

    @staticmethod
    def _find_confused_pairs(
        errors: list[ErrorRecord],
        topic_counts: Counter,
    ) -> list[tuple[str, str, float]]:
        """
        Pair topics that share the same error_type and subject_id.
        These are likely conceptually adjacent and confused.
        """
        # Group topic_ids by (subject_id, error_type) bucket
        buckets: dict[tuple, list[str]] = defaultdict(list)
        for e in errors:
            if e.topic_id and e.subject_id:
                key = (str(e.subject_id), e.error_type or "general")
                tid = str(e.topic_id)
                if tid not in buckets[key]:
                    buckets[key].append(tid)

        pairs: list[tuple[str, str, float]] = []
        seen: set[frozenset] = set()

        for topics in buckets.values():
            if len(topics) < 2:
                continue
            for i in range(len(topics)):
                for j in range(i + 1, len(topics)):
                    a, b = topics[i], topics[j]
                    key_set = frozenset([a, b])
                    if key_set in seen:
                        continue
                    seen.add(key_set)
                    count_a = topic_counts.get(a, 1)
                    count_b = topic_counts.get(b, 1)
                    score = min(count_a, count_b) / max(count_a, count_b)
                    pairs.append((a, b, round(score, 4)))

        pairs.sort(key=lambda t: t[2], reverse=True)
        return pairs[:_MAX_PAIRS]

    @staticmethod
    def _most_confused_topics(topic_counts: Counter) -> list[str]:
        return [tid for tid, _ in topic_counts.most_common(_MAX_CONFUSED)]
