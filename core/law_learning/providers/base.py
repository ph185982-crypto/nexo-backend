"""
ExplanationProvider Protocol — pluggable article explainer.

Current implementation: StaticExplanationProvider (uses DB's simple_text field).
Future implementation: AI-powered provider (GPT-4o, Claude, etc.) — swap without
touching any other file in this module.
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable

from ..interfaces.context import ArticleContext
from ..interfaces.output import ArticleExplanation


@runtime_checkable
class ExplanationProvider(Protocol):
    """
    Produces a plain-language enrichment for a legal article.

    Implementors must be stateless — the same ArticleContext must always
    produce the same ArticleExplanation (or a deterministically generated one).
    """

    @property
    def provider_name(self) -> str:
        """Identifier string stored in ArticleExplanation.provider_name."""
        ...

    def explain(self, context: ArticleContext) -> ArticleExplanation:
        """
        Generate explanation for the article in context.article.

        Must not perform any I/O — all required data arrives via context.
        """
        ...
