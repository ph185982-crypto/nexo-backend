"""
StaticExplanationProvider — uses pre-authored content from the database.

When simple_text is available (DB field legal_articles.simple_text), it becomes
the summary. Keywords are extracted from tags + highlights. No AI required.

Replace with an AI provider when ready — the interface is identical.
"""
from __future__ import annotations

import re

from ..interfaces.context import ArticleContext
from ..interfaces.output import ArticleExplanation


_EXCEPTION_KEYWORDS = frozenset({
    "exceto", "salvo", "ressalvado", "excecao", "excepcionalmente",
    "apenas", "somente", "unicamente",
})

_OBLIGATION_KEYWORDS = frozenset({
    "obrigatorio", "obrigatório", "deve", "deverá", "vedado",
    "proibido", "proibição", "vedação",
})


class StaticExplanationProvider:
    """
    Explanation built entirely from data already stored in the database.
    Zero AI calls, zero I/O.
    """

    @property
    def provider_name(self) -> str:
        return "static"

    def explain(self, context: ArticleContext) -> ArticleExplanation:
        article = context.article

        summary = self._build_summary(article)
        keywords = self._extract_keywords(article)
        common_mistakes = self._infer_common_mistakes(article, keywords)
        mnemonic = self._build_mnemonic(article, keywords)

        return ArticleExplanation(
            summary=summary,
            keywords=keywords,
            mnemonic=mnemonic,
            common_mistakes=common_mistakes,
            provider_name=self.provider_name,
        )

    # ── Private helpers ──────────────────────────────────────────────────────

    def _build_summary(self, article) -> str:
        if article.has_simple_text:
            # Truncate to ~300 chars if the simple_text is very long
            txt = article.simple_text.strip()
            return txt if len(txt) <= 350 else txt[:347] + "..."

        # Fallback: first sentence of official text + metadata
        first = self._first_sentence(article.official_text)
        label = f"Art. {article.article_number} ({article.document_abbreviation})"
        return f"{label}: {first}"

    def _extract_keywords(self, article) -> list[str]:
        kws: list[str] = []

        # 1. Explicit tags from DB
        kws.extend(t.lower() for t in article.tags if t)

        # 2. Highlighted terms from DB
        kws.extend(h.lower() for h in article.highlights if h)

        # 3. Legal references from text (Art. X, §, inciso)
        legal_refs = re.findall(
            r"(?:art\.?\s*\d+|§\s*\d+|inciso\s+[IVXLCDM]+|alínea\s+[a-z])",
            article.official_text,
            re.IGNORECASE,
        )
        kws.extend(r.lower() for r in legal_refs[:5])

        # 4. Exception/obligation signal words
        text_lower = article.official_text.lower()
        for kw in _EXCEPTION_KEYWORDS | _OBLIGATION_KEYWORDS:
            if kw in text_lower:
                kws.append(kw)

        # Deduplicate, preserve order
        seen: set[str] = set()
        result: list[str] = []
        for kw in kws:
            if kw not in seen:
                seen.add(kw)
                result.append(kw)

        return result[:15]

    def _infer_common_mistakes(self, article, keywords: list[str]) -> list[str]:
        mistakes: list[str] = []
        text_lower = article.official_text.lower()

        if any(kw in text_lower for kw in _EXCEPTION_KEYWORDS):
            mistakes.append(
                "Confundir a exceção com a regra geral — leia o 'exceto' ou 'salvo' com atenção."
            )
        if "prazo" in text_lower or "dias" in text_lower:
            mistakes.append(
                "Errar prazos: memorize o número exato de dias previsto no artigo."
            )
        if "%" in text_lower or "por cento" in text_lower:
            mistakes.append(
                "Confundir percentuais — anote os valores numéricos literalmente."
            )
        if any(kw in text_lower for kw in {"será", "poderá", "deverá"}):
            mistakes.append(
                "Trocar 'será' por 'poderá' (ou vice-versa) muda o caráter obrigatório da norma."
            )
        if not mistakes:
            mistakes.append(
                "Generalizar o artigo sem considerar as condições específicas do caput."
            )

        return mistakes

    def _build_mnemonic(self, article, keywords: list[str]) -> str | None:
        # A very simple mnemonic: first-letter acronym of top tags
        tag_words = [k for k in keywords if len(k) > 3 and k.isalpha()][:5]
        if len(tag_words) >= 3:
            acronym = "".join(w[0].upper() for w in tag_words)
            return f"Sigla de memorização: {acronym} ({', '.join(tag_words)})"
        return None

    @staticmethod
    def _first_sentence(text: str) -> str:
        match = re.search(r"[.;]\s", text)
        if match:
            return text[: match.start() + 1].strip()
        return text[:200].strip() + ("..." if len(text) > 200 else "")
