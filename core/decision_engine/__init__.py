"""
Decision Engine — the single orchestrator of all study decisions.

The engine decides what the user studies. Nothing else does.
Import the public API from here.
"""
from .engine import DecisionEngine
from .interfaces.enums import StepType, DecisionReason, MissionPriority
from .interfaces.inputs import DecisionInput, SubjectMasterySnapshot, TopicSnapshot
from .interfaces.inputs import ReviewQueueItem, RecentError, MissionHistoryEntry
from .interfaces.outputs import MissionPlan, MissionStep
from .interfaces.metrics import MissionMetrics, MissionResult, StepMetrics
from .interfaces.execution import MissionExecution, StepExecution

__all__ = [
    "DecisionEngine",
    "StepType",
    "DecisionReason",
    "MissionPriority",
    "DecisionInput",
    "SubjectMasterySnapshot",
    "TopicSnapshot",
    "ReviewQueueItem",
    "RecentError",
    "MissionHistoryEntry",
    "MissionPlan",
    "MissionStep",
    "MissionMetrics",
    "MissionResult",
    "StepMetrics",
    "MissionExecution",
    "StepExecution",
]
