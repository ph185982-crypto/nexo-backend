"""
Knowledge Graph Engine — models and queries the relationships between
subjects, topics, questions, articles, flashcards, errors, and reviews.

The Decision Engine queries this engine for knowledge gaps and error origins.
It never sees graph internals — only typed summary objects.
"""
from .engine import KnowledgeGraphEngine
from .graph.node import NodeType, KnowledgeNode, NodeMetrics
from .graph.edge import EdgeType, KnowledgeEdge
from .graph.graph import KnowledgeGraph
from .queries.gap_query import GapAnalysis, GapResult
from .queries.origin_query import OriginResult
from .queries.related_query import RelatedContent
from .scoring.scorer import ScoredNode
from .ports.repository import KnowledgeGraphRepositoryPort

__all__ = [
    "KnowledgeGraphEngine",
    "KnowledgeGraphRepositoryPort",
    "NodeType", "KnowledgeNode", "NodeMetrics",
    "EdgeType", "KnowledgeEdge",
    "KnowledgeGraph",
    "GapAnalysis", "GapResult",
    "OriginResult",
    "RelatedContent",
    "ScoredNode",
]
