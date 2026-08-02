from __future__ import annotations
from collections import defaultdict, deque
from typing import Iterable, Optional
from uuid import UUID

from .edge import EdgeType, KnowledgeEdge
from .node import KnowledgeNode, NodeMetrics, NodeType, make_node_id


class KnowledgeGraph:
    """
    Directed graph of KnowledgeNodes connected by typed edges.

    The static instance (built once from DB) has no metrics.
    Call `overlay_metrics()` to get a new graph with user data attached.
    """

    def __init__(self) -> None:
        self._nodes: dict[str, KnowledgeNode] = {}
        self._out: dict[str, list[KnowledgeEdge]] = defaultdict(list)  # source → edges
        self._in: dict[str, list[KnowledgeEdge]] = defaultdict(list)   # target → edges
        self._by_type: dict[NodeType, list[str]] = defaultdict(list)

    # ------------------------------------------------------------------
    # Mutation (used only during graph construction)
    # ------------------------------------------------------------------

    def add_node(self, node: KnowledgeNode) -> None:
        if node.node_id in self._nodes:
            return
        self._nodes[node.node_id] = node
        self._by_type[node.node_type].append(node.node_id)

    def add_edge(self, edge: KnowledgeEdge) -> None:
        # Silently skip if either endpoint is missing (FK but entity not loaded)
        if edge.source_id not in self._nodes or edge.target_id not in self._nodes:
            return
        self._out[edge.source_id].append(edge)
        self._in[edge.target_id].append(edge)

    # ------------------------------------------------------------------
    # Read (query time)
    # ------------------------------------------------------------------

    def get_node(self, node_id: str) -> Optional[KnowledgeNode]:
        return self._nodes.get(node_id)

    def get_by_entity(self, node_type: NodeType, entity_id: UUID) -> Optional[KnowledgeNode]:
        return self._nodes.get(make_node_id(node_type, entity_id))

    def nodes_of_type(self, node_type: NodeType) -> list[KnowledgeNode]:
        return [self._nodes[nid] for nid in self._by_type.get(node_type, [])]

    def outgoing(
        self, node_id: str, edge_types: Optional[Iterable[EdgeType]] = None
    ) -> list[KnowledgeEdge]:
        edges = self._out.get(node_id, [])
        if edge_types is None:
            return edges
        allowed = set(edge_types)
        return [e for e in edges if e.edge_type in allowed]

    def incoming(
        self, node_id: str, edge_types: Optional[Iterable[EdgeType]] = None
    ) -> list[KnowledgeEdge]:
        edges = self._in.get(node_id, [])
        if edge_types is None:
            return edges
        allowed = set(edge_types)
        return [e for e in edges if e.edge_type in allowed]

    def neighbors(
        self, node_id: str, edge_types: Optional[Iterable[EdgeType]] = None
    ) -> list[KnowledgeNode]:
        return [
            self._nodes[e.target_id]
            for e in self.outgoing(node_id, edge_types)
            if e.target_id in self._nodes
        ]

    def predecessors(
        self, node_id: str, edge_types: Optional[Iterable[EdgeType]] = None
    ) -> list[KnowledgeNode]:
        return [
            self._nodes[e.source_id]
            for e in self.incoming(node_id, edge_types)
            if e.source_id in self._nodes
        ]

    def bfs(
        self,
        start_id: str,
        direction: str = "out",           # "out" | "in" | "both"
        edge_types: Optional[Iterable[EdgeType]] = None,
        max_depth: int = 3,
    ) -> list[KnowledgeNode]:
        """BFS from start_id, returns all reachable nodes (excluding start)."""
        visited: set[str] = {start_id}
        queue: deque[tuple[str, int]] = deque([(start_id, 0)])
        result: list[KnowledgeNode] = []

        while queue:
            current, depth = queue.popleft()
            if depth >= max_depth:
                continue

            edges: list[KnowledgeEdge] = []
            if direction in ("out", "both"):
                edges.extend(self.outgoing(current, edge_types))
            if direction in ("in", "both"):
                edges.extend(self.incoming(current, edge_types))

            for edge in edges:
                neighbor_id = edge.target_id if direction != "in" else edge.source_id
                if neighbor_id not in visited and neighbor_id in self._nodes:
                    visited.add(neighbor_id)
                    queue.append((neighbor_id, depth + 1))
                    result.append(self._nodes[neighbor_id])

        return result

    # ------------------------------------------------------------------
    # User overlay
    # ------------------------------------------------------------------

    def overlay_metrics(
        self, metrics_map: dict[str, NodeMetrics]
    ) -> "KnowledgeGraph":
        """
        Return a *new* KnowledgeGraph with NodeMetrics attached where available.
        The original static graph is never mutated.
        """
        enriched = KnowledgeGraph()
        # Copy all edges
        for edges in self._out.values():
            for e in edges:
                enriched._out[e.source_id].append(e)
        for edges in self._in.values():
            for e in edges:
                enriched._in[e.target_id].append(e)

        for nid, node in self._nodes.items():
            enriched._nodes[nid] = (
                node.with_metrics(metrics_map[nid])
                if nid in metrics_map
                else node
            )
            enriched._by_type[node.node_type].append(nid)

        return enriched

    def __len__(self) -> int:
        return len(self._nodes)
