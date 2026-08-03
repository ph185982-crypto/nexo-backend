"""
ArticleRelationshipFinder — builds RelatedArticleRef list from pre-loaded context.

The engine never queries the KGE or DB directly. Callers populate
ArticleContext.related_content from KGE calls before invoking analyze().
This analyzer classifies and scores the relationships that were found.
"""
from __future__ import annotations

from uuid import UUID

from ..interfaces.context import ArticleContext
from ..interfaces.output import RelatedArticleRef


def find_related(context: ArticleContext) -> list[RelatedArticleRef]:
    """
    Return a list of related article references, classified and scored.

    Relationship types:
      same_chapter    — sibling articles in same chapter/section
      cross_referenced — articles linked by KGE edges
      often_confused  — topics that appear together in error analyses
    """
    refs: list[RelatedArticleRef] = []

    if not context.related_content:
        return refs

    related = context.related_content

    # 1. Sibling articles (same chapter/section — strongest structural relationship)
    sibling_ids = set(related.sibling_article_ids)
    for i, article_id in enumerate(related.sibling_article_ids[:10]):
        label = _label_for(article_id, related.related_article_labels, i)
        refs.append(RelatedArticleRef(
            article_id=article_id,
            label=label,
            relationship_type="same_chapter",
            strength=0.85,
        ))

    # 2. KGE cross-referenced articles (not already added as siblings)
    already = sibling_ids
    for i, article_id in enumerate(related.related_article_ids[:15]):
        if article_id in already:
            continue
        already.add(article_id)
        label = _label_for(article_id, related.related_article_labels, i)
        # Strength decays slightly per position (KGE returns them ranked)
        strength = max(0.70 - i * 0.03, 0.40)
        refs.append(RelatedArticleRef(
            article_id=article_id,
            label=label,
            relationship_type="cross_referenced",
            strength=round(strength, 3),
        ))

    # 3. Topics as proxy for "often confused" — mark high-overlap topics
    # (when related_topic_ids co-occur with many of the same cross-refs, flag them)
    # We can't derive often_confused without error data, but we note any article
    # that appears in the same topic as the current article.
    # (This is a placeholder — a future caller can pass confusion_pairs from the
    # Learning Engine and we can use them here.)

    # Sort by strength descending
    refs.sort(key=lambda r: r.strength, reverse=True)
    return refs


def _label_for(article_id: UUID, labels: list[str], index: int) -> str:
    """Return the label at index if available, otherwise a generic label."""
    if index < len(labels):
        return labels[index]
    return f"Art. {str(article_id)[:8]}…"
