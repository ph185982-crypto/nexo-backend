from __future__ import annotations
import statistics
from collections import defaultdict

from ..interfaces.observations import SessionRecord
from ..interfaces.profile import FormatPreference


_KNOWN_FORMATS = ["questions", "review", "simulation", "reading", "audio"]
_MIN_SESSIONS_FOR_RELIABLE = 3


class PreferredFormatAnalyzer:
    """
    Which study format produces the best performance for this user?

    Signal: accuracy per session grouped by mode (study format).
    Format with highest mean accuracy → primary preference.
    """

    def analyze(self, sessions: list[SessionRecord]) -> FormatPreference:
        perf = self._performance_by_format(sessions)

        if not perf:
            return FormatPreference(
                primary="questions",
                secondary="review",
                performance_by_format={},
            )

        ranked = sorted(perf.items(), key=lambda x: x[1], reverse=True)
        primary = ranked[0][0]
        secondary = ranked[1][0] if len(ranked) > 1 else primary

        return FormatPreference(
            primary=primary,
            secondary=secondary,
            performance_by_format={k: round(v, 4) for k, v in perf.items()},
        )

    # ── Private ───────────────────────────────────────────────────────

    @staticmethod
    def _performance_by_format(sessions: list[SessionRecord]) -> dict[str, float]:
        acc_by_format: dict[str, list[float]] = defaultdict(list)

        for s in sessions:
            if not s.is_completed or s.questions_total == 0:
                continue
            mode = s.mode or "questions"
            accuracy = s.questions_correct / s.questions_total
            acc_by_format[mode].append(accuracy)

        return {
            fmt: statistics.mean(accs)
            for fmt, accs in acc_by_format.items()
            if len(accs) >= _MIN_SESSIONS_FOR_RELIABLE
        }
