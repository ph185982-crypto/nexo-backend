"""
Camada de conteúdo sem banco — o edital inteiro (matérias, tópicos, lei seca,
questões) já viaja dentro do próprio deploy como arquivos JSON em
prf/seeds/. Com o Postgres fora do ar, isto substitui as leituras que antes
iam ao banco por índices carregados uma vez na memória do processo.

Nada aqui grava nada. Todo estado de progresso (XP, sequência, respostas,
revisão espaçada) vive no navegador do candidato — ver prf/local/state.py
para o contrato do que o cliente manda e recebe.

IDs são determinísticos via uuid5: a mesma questão, artigo ou tópico sempre
produz o mesmo UUID em qualquer cold start, então o cliente pode guardar
esses ids entre sessões sem risco de ficarem obsoletos.
"""
from __future__ import annotations

import json
import logging
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_NS = uuid.UUID("6f1a6e2e-3b0a-4a27-9c8b-2f6a6a1b9c11")
SEEDS_DIR = Path(__file__).resolve().parent.parent / "seeds"


def _id(*parts: str) -> uuid.UUID:
    return uuid.uuid5(_NS, "|".join(parts))


def subject_id(subject_slug: str) -> uuid.UUID:
    return _id("subject", subject_slug)


def topic_id(subject_slug: str, topic_slug: str) -> uuid.UUID:
    return _id("topic", subject_slug, topic_slug)


def article_id(document_slug: str, article_number: str) -> uuid.UUID:
    return _id("article", document_slug, str(article_number))


def question_id(source_file: str, index: int) -> uuid.UUID:
    return _id("question", source_file, str(index))


def alt_id(qid: uuid.UUID, letter: str) -> uuid.UUID:
    return _id("alt", str(qid), letter)


def flashcard_id(art_id: uuid.UUID, index: int) -> uuid.UUID:
    return _id("flashcard", str(art_id), str(index))


class ContentStore:
    """Índice em memória de todo o conteúdo estático do edital."""

    def __init__(self):
        from prf.seeds import seed_data as sd
        from prf.seeds.topic_aliases import resolve_topic_slug

        self.subjects: list[dict] = []
        self._subject_by_id: dict[str, dict] = {}
        self._subject_by_slug: dict[str, dict] = {}

        for s in sd.SUBJECTS:
            sid = subject_id(s["slug"])
            row = {**s, "id": sid}
            self.subjects.append(row)
            self._subject_by_id[str(sid)] = row
            self._subject_by_slug[s["slug"]] = row

        self.topics: list[dict] = []
        self._topic_by_id: dict[str, dict] = {}
        self._topics_by_subject: dict[str, list[dict]] = {}
        for subj_slug, tlist in sd.TOPICS.items():
            subj = self._subject_by_slug.get(subj_slug)
            if not subj:
                continue
            bucket = self._topics_by_subject.setdefault(subj_slug, [])
            for order, t in enumerate(tlist):
                tid = topic_id(subj_slug, t["slug"])
                row = {
                    **t, "id": tid, "subject_id": subj["id"],
                    "subject_slug": subj_slug, "display_order": order,
                }
                self.topics.append(row)
                self._topic_by_id[str(tid)] = row
                bucket.append(row)

        self.legal_documents = {d["slug"]: d for d in sd.LEGAL_DOCUMENTS}

        self.articles: list[dict] = []
        self._article_by_id: dict[str, dict] = {}
        self._articles_by_topic: dict[str, list[dict]] = {}
        self._articles_by_subject: dict[str, list[dict]] = {}

        for path in sorted((SEEDS_DIR / "articles").glob("*.json")):
            try:
                rows = json.loads(path.read_text(encoding="utf-8"))
            except Exception as e:
                logger.warning(f"[LOCAL] Falha lendo {path.name}: {e}")
                continue
            for a in rows:
                subj_slug = a.get("subject_slug")
                subj = self._subject_by_slug.get(subj_slug)
                if not subj:
                    continue
                raw_topic = a.get("topic_slug") or ""
                resolved_topic = resolve_topic_slug(subj_slug, raw_topic) or raw_topic
                tid = topic_id(subj_slug, resolved_topic) if resolved_topic else None
                aid = article_id(a.get("document_slug", "doc"), a.get("article_number", ""))
                doc = self.legal_documents.get(a.get("document_slug") or "", {})
                row = {
                    **a, "id": aid, "subject_id": subj["id"],
                    "subject_slug": subj_slug,
                    "topic_id": tid, "topic_slug": resolved_topic,
                    "document_name": doc.get("abbreviation") or doc.get("name") or a.get("document_slug"),
                }
                self.articles.append(row)
                self._article_by_id[str(aid)] = row
                self._articles_by_subject.setdefault(subj_slug, []).append(row)
                if tid:
                    self._articles_by_topic.setdefault(str(tid), []).append(row)

        self.questions: list[dict] = []
        self._question_by_id: dict[str, dict] = {}
        self._questions_by_topic: dict[str, list[dict]] = {}
        self._questions_by_subject: dict[str, list[dict]] = {}

        for path in sorted((SEEDS_DIR / "questions").glob("*.json")):
            try:
                rows = json.loads(path.read_text(encoding="utf-8"))
            except Exception as e:
                logger.warning(f"[LOCAL] Falha lendo {path.name}: {e}")
                continue
            for idx, q in enumerate(rows):
                subj_slug = q.get("subject_slug")
                subj = self._subject_by_slug.get(subj_slug)
                if not subj:
                    continue
                raw_topic = q.get("topic_slug") or ""
                resolved_topic = resolve_topic_slug(subj_slug, raw_topic) or raw_topic
                tid = topic_id(subj_slug, resolved_topic) if resolved_topic else None
                qid = question_id(path.name, idx)
                alts = []
                for a in q.get("alternatives") or []:
                    alts.append({
                        **a, "id": alt_id(qid, a["letter"]),
                    })
                row = {
                    **q, "id": qid, "subject_id": subj["id"],
                    "subject_slug": subj_slug,
                    "topic_id": tid, "topic_slug": resolved_topic,
                    "alternatives": alts,
                }
                self.questions.append(row)
                self._question_by_id[str(qid)] = row
                self._questions_by_subject.setdefault(subj_slug, []).append(row)
                if tid:
                    self._questions_by_topic.setdefault(str(tid), []).append(row)

        logger.info(
            f"[LOCAL] Conteúdo carregado: {len(self.subjects)} matérias, "
            f"{len(self.topics)} tópicos, {len(self.articles)} artigos, "
            f"{len(self.questions)} questões"
        )

    # ── Matérias / tópicos ──────────────────────────────────────────────
    def get_subjects(self) -> list[dict]:
        return self.subjects

    def get_subject(self, sid: str) -> Optional[dict]:
        return self._subject_by_id.get(str(sid))

    def get_topics(self, subject_slug: str) -> list[dict]:
        return self._topics_by_subject.get(subject_slug, [])

    def get_topic(self, tid: str) -> Optional[dict]:
        return self._topic_by_id.get(str(tid))

    # ── Artigos ──────────────────────────────────────────────────────────
    def get_articles(
        self, subject_id_: Optional[str] = None, topic_id_: Optional[str] = None,
        limit: int = 15,
    ) -> list[dict]:
        if topic_id_:
            rows = self._articles_by_topic.get(str(topic_id_), [])
        elif subject_id_:
            subj = self.get_subject(subject_id_)
            rows = self._articles_by_subject.get(subj["slug"], []) if subj else []
        else:
            rows = self.articles
        rows = sorted(rows, key=lambda r: -(r.get("frequency_score") or 0))
        return rows[:limit]

    def get_articles_by_ids(self, ids: list[str]) -> list[dict]:
        out = []
        for i in ids:
            a = self._article_by_id.get(str(i))
            if a:
                out.append(a)
        return out

    # ── Questões ─────────────────────────────────────────────────────────
    def get_questions(
        self, subject_id_: Optional[str] = None, topic_id_: Optional[str] = None,
        limit: int = 15, question_type: Optional[str] = None,
        exclude_ids: Optional[set] = None,
    ) -> list[dict]:
        if topic_id_:
            rows = self._questions_by_topic.get(str(topic_id_), [])
        elif subject_id_:
            subj = self.get_subject(subject_id_)
            rows = self._questions_by_subject.get(subj["slug"], []) if subj else []
        else:
            rows = self.questions
        if question_type:
            rows = [r for r in rows if r.get("question_type") == question_type]
        if exclude_ids:
            rows = [r for r in rows if str(r["id"]) not in exclude_ids]
        return rows[:limit]

    def get_questions_by_ids(self, ids: list[str]) -> list[dict]:
        out = []
        for i in ids:
            q = self._question_by_id.get(str(i))
            if q:
                out.append(q)
        return out

    def get_question(self, qid: str) -> Optional[dict]:
        return self._question_by_id.get(str(qid))

    # ── Flashcards (gerados sem LLM a partir dos artigos) ───────────────
    def get_flashcards(self, topic_id_: str, limit: int = 12) -> list[dict]:
        from prf.services.flashcard_service import cards_for_article

        cache = self.__dict__.setdefault("_flashcard_cache", {})
        key = str(topic_id_)
        if key not in cache:
            cards: list[dict] = []
            for art in self._articles_by_topic.get(key, []):
                article_for_cards = {**art, "id": str(art["id"])}
                for idx, c in enumerate(cards_for_article(article_for_cards)):
                    fid = flashcard_id(art["id"], idx)
                    cards.append({**c, "id": fid, "topic_id": art["id"] and self.get_topic(key)["id"] if self.get_topic(key) else None})
            cache[key] = cards
        self._flashcard_by_id = getattr(self, "_flashcard_by_id", {})
        out = cache[key][:limit]
        for c in out:
            self._flashcard_by_id[str(c["id"])] = c
        return out

    def get_flashcard(self, fid: str) -> Optional[dict]:
        return getattr(self, "_flashcard_by_id", {}).get(str(fid))

    # ── Tópico do dia ────────────────────────────────────────────────────
    def pick_study_topic(self, subject_slug: str, exclude_topic_ids: Optional[set] = None) -> Optional[dict]:
        """Tópico com mais material e áudio-elegível dentro da matéria,
        excluindo o que já foi descartado hoje (botão de pular missão)."""
        exclude_topic_ids = exclude_topic_ids or set()
        candidates = [
            t for t in self.get_topics(subject_slug)
            if str(t["id"]) not in exclude_topic_ids
            and self._articles_by_topic.get(str(t["id"]))
        ]
        if not candidates:
            return None
        candidates.sort(key=lambda t: -(t.get("weight") or 0))
        return candidates[0]


@lru_cache(maxsize=1)
def get_store() -> "ContentStore":
    return ContentStore()
