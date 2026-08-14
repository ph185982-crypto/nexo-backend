"""
Trajetória — o calendário do candidato, do primeiro dia até a data da prova.

Duas metades, com honestidades diferentes:

- **Passado e hoje**: fato. Vem de `daily_missions` — o que foi gerado, quantas
  etapas fecharam, se a missão foi concluída. É daqui que sai o visto.
- **Futuro**: projeção. O motor de prioridade é adaptativo (o que você errar
  amanhã muda a ordem de depois de amanhã), então a fila projetada é a que
  valeria se nada mudasse. O tipo do dia — conteúdo, simulado, revisão — esse
  sim é fixo e não muda: é o esqueleto do plano.

A projeção consome a MESMA fila de tópicos que `pick_study_topic` consome
(`get_topic_queue`), então o que a tela promete para quarta é o que a missão de
quarta vai entregar, salvo mudança de prioridade.
"""
from __future__ import annotations

from datetime import date, timedelta
from uuid import UUID

from prf.engines.schedule import day_kind, label_for, CONTEUDO, SIMULADO, REVISAO

# Teto de dias projetados. Sem data de prova não há corrida definida; 90 dias
# já cobre um ciclo inteiro de edital sem transformar a tela num relatório.
DEFAULT_HORIZON_DAYS = 90
MAX_HORIZON_DAYS = 400
# Quantos dias para trás a trajetória mostra o que já aconteceu.
HISTORY_DAYS = 30


class PlanService:
    def __init__(self, repo):
        self.repo = repo

    async def build_calendar(self, user_id: UUID) -> dict:
        today = date.today()
        profile = await self.repo.get_profile(user_id)
        exam_date = (profile or {}).get("exam_date")

        if exam_date and exam_date > today:
            horizon = min((exam_date - today).days, MAX_HORIZON_DAYS)
        else:
            horizon = DEFAULT_HORIZON_DAYS
        end = today + timedelta(days=horizon)
        start = today - timedelta(days=HISTORY_DAYS)

        past = {m["date"]: m for m in await self.repo.get_missions_range(user_id, start, end)}
        # Dia sem missão só é "não feita" a partir do momento em que o
        # candidato começou a usar o app. Contar as semanas anteriores à
        # primeira missão como falha inventaria um atraso que nunca existiu.
        first_day = min(past) if past else today

        routines = {}
        for weekday in range(7):
            r = await self.repo.get_routine_for_day(user_id, weekday)
            if r:
                routines[weekday] = r

        queues = await self._topic_queues(user_id, profile)

        days = []
        planned: set = set()
        cursor = {slug: 0 for slug in queues}
        subject_cycle = list(queues.keys())
        cycle_pos = 0

        d = start
        while d <= end:
            kind = day_kind(d)
            routine = routines.get(d.weekday())
            is_rest = bool(routine and routine.get("is_rest_day")) and kind == CONTEUDO

            entry = {
                "date": d.isoformat(),
                "weekday": d.weekday(),
                "kind": kind,
                "kind_label": label_for(kind),
                "is_rest_day": is_rest,
                "is_today": d == today,
                "is_past": d < today,
                "subject_name": None,
                "topic_name": None,
                "status": "future",
                "blocks_done": 0,
                "blocks_total": 0,
                "study_minutes": (routine or {}).get("study_minutes"),
            }

            mission = past.get(d)
            if mission:
                total = mission.get("blocks_total") or 0
                done = mission.get("blocks_done") or 0
                entry["blocks_total"] = total
                entry["blocks_done"] = done
                entry["topic_name"] = mission.get("topic_label")
                entry["kind"] = mission.get("day_kind") or kind
                entry["kind_label"] = label_for(entry["kind"])
                entry["estimated_mins"] = mission.get("estimated_mins")
                if mission.get("status") == "completed" or (total and done >= total):
                    entry["status"] = "done"
                elif done > 0:
                    entry["status"] = "partial"
                elif d < today:
                    entry["status"] = "missed"
                else:
                    entry["status"] = "today"
            elif d < today:
                entry["status"] = "missed" if d >= first_day else "before_start"
            elif d == today:
                entry["status"] = "today"

            # Projeção só do que ainda não aconteceu e só em dia de conteúdo:
            # simulado e revisão não consomem tópico novo da fila.
            if not mission and d >= today and kind == CONTEUDO and not is_rest and subject_cycle:
                # Quando toda a fila do edital é consumida, a projeção recomeça:
                # o segundo passe é aprofundamento, não fim de plano. Um
                # calendário que fica em branco depois do último tópico não
                # ajudaria ninguém a saber o que fazer naquele dia.
                if all(cursor[s] >= len(queues[s]) for s in subject_cycle):
                    for s in subject_cycle:
                        cursor[s] = 0
                for _ in range(len(subject_cycle)):
                    slug = subject_cycle[cycle_pos % len(subject_cycle)]
                    cycle_pos += 1
                    fila = queues[slug]
                    idx = cursor[slug]
                    if idx < len(fila):
                        entry["subject_name"] = fila[idx]["subject_name"]
                        entry["topic_name"] = fila[idx]["name"]
                        cursor[slug] = idx + 1
                        planned.add(fila[idx]["id"])
                        break
            elif not mission and kind == SIMULADO:
                entry["topic_name"] = "Simulado completo"
            elif not mission and kind == REVISAO:
                entry["topic_name"] = "Revisão da semana"

            days.append(entry)
            d += timedelta(days=1)

        futuros = [x for x in days if not x["is_past"]]
        feitos = [x for x in days if x["status"] == "done"]
        perdidos = [x for x in days if x["status"] == "missed"]

        return {
            "today": today.isoformat(),
            "exam_date": exam_date.isoformat() if exam_date else None,
            "days_until_exam": (exam_date - today).days if exam_date else None,
            "days": days,
            "summary": {
                "missions_done": len(feitos),
                "missions_missed": len(perdidos),
                "content_days_ahead": len([x for x in futuros if x["kind"] == CONTEUDO]),
                "simulados_ahead": len([x for x in futuros if x["kind"] == SIMULADO]),
                "revisoes_ahead": len([x for x in futuros if x["kind"] == REVISAO]),
                "topics_total": sum(len(q) for q in queues.values()),
                "topics_planned": len(planned),
                "topics_remaining": max(
                    sum(len(q) for q in queues.values()) - len(planned), 0,
                ),
                "horizon_days": horizon,
            },
        }

    async def _topic_queues(self, user_id: UUID, profile: dict | None) -> dict:
        """Fila de tópicos por matéria, na ordem em que a missão vai consumir."""
        is_pm = (profile or {}).get("target_exam", "PMGO").upper().startswith("PM")
        weight_key = "weight_pm" if is_pm else "weight_prf"

        subjects = [
            s for s in await self.repo.get_subjects()
            if (s.get(weight_key) or 0) > 0
        ]
        subjects.sort(key=lambda s: -(s.get(weight_key) or 0))

        queues: dict[str, list[dict]] = {}
        for s in subjects:
            fila = await self.repo.get_topic_queue(user_id, s["id"], limit=20)
            if not fila:
                continue
            queues[s["slug"]] = [
                {"id": t["id"], "name": t["name"], "subject_name": s["name"]}
                for t in fila
            ]
        return queues
