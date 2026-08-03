"""
StudyRuntimePort — data access contract for the infrastructure layer.

NOT consumed by the runtime. Documents what callers must fetch before
assembling and starting a session. Infrastructure adapters should implement
this protocol.
"""
from __future__ import annotations

from typing import Optional, Protocol, runtime_checkable
from uuid import UUID

from .context import StudySessionReport
from ..models.session import StudySession


@runtime_checkable
class StudyRuntimePort(Protocol):
    """
    Persistence contract for Study Runtime infrastructure adapters.

    The runtime itself is stateless per-call — callers are responsible for
    persisting sessions and reports between requests.
    """

    async def persist_session(self, session: StudySession) -> None:
        """Persist current session snapshot after each step."""
        ...

    async def load_session(self, session_id: UUID) -> Optional[StudySession]:
        """Restore a session from persistence (for resume after restart)."""
        ...

    async def persist_report(self, report: StudySessionReport) -> None:
        """Persist the final session report."""
        ...

    async def get_user_sessions(
        self, user_id: UUID, limit: int = 10
    ) -> list[StudySession]:
        """Retrieve recent sessions for a user (for trend analysis)."""
        ...
