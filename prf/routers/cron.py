"""Tarefas agendadas — o que faz o coach cobrar sem ninguém abrir o app.

A plataforma sabia decidir quando cutucar o candidato e sabia enfileirar a
notificação, mas nada disparava esse cálculo: função serverless só roda quando
alguém a chama, e quem precisa do lembrete é justamente quem não abriu o app.
O agendador da Vercel chama estes endpoints, definidos em vercel.json.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException

from prf.routers.deps import get_repo
from prf.database.repository import PRFRepository
from prf.services.notification_service import NotificationService
from prf.services import push_service

logger = logging.getLogger(__name__)

router = APIRouter()

# O servidor roda em UTC e o candidato estuda no horário de Brasília. Sem isto,
# o "silêncio das 22h às 7h" e o lembrete da noite saem três horas deslocados.
BRT = timezone(timedelta(hours=-3))

# Quem não abre o app há mais que isso recebe o empurrão de retorno.
INACTIVE_DAYS = 3


def _authorize(auth_header: str | None, token_header: str | None) -> None:
    """A Vercel manda CRON_SECRET no Authorization; o token de manutenção também vale."""
    cron_secret = os.getenv("CRON_SECRET")
    maint = os.getenv("MAINTENANCE_TOKEN")

    if cron_secret and auth_header == f"Bearer {cron_secret}":
        return
    if maint and token_header == maint:
        return
    if not cron_secret and not maint:
        raise HTTPException(503, "CRON_SECRET não configurado no ambiente")
    raise HTTPException(403, "Não autorizado")


@router.post("/lembretes")
@router.get("/lembretes")
async def rodar_lembretes(
    authorization: str | None = Header(default=None),
    x_maintenance_token: str | None = Header(default=None),
    repo: PRFRepository = Depends(get_repo),
):
    """Calcula os lembretes de todo mundo e entrega os que estiverem pendentes."""
    _authorize(authorization, x_maintenance_token)

    service = NotificationService(repo)
    users = await repo._fetch(
        "SELECT id FROM prf_users WHERE is_active IS NOT FALSE LIMIT 500",
    )

    queued = 0
    for u in users:
        try:
            await service.check_and_queue_notifications(u["id"])
            queued += 1
        except Exception as e:
            logger.warning(f"[PRF] lembrete de {u['id']} falhou: {e}")

    entregues = await _entregar_pendentes(repo)
    return {
        "usuarios_avaliados": queued,
        "notificacoes_entregues": entregues["enviadas"],
        "inscricoes_removidas": entregues["removidas"],
        "push_configurado": push_service.is_configured(),
    }


@router.post("/retorno")
@router.get("/retorno")
async def rodar_retorno(
    authorization: str | None = Header(default=None),
    x_maintenance_token: str | None = Header(default=None),
    repo: PRFRepository = Depends(get_repo),
):
    """Chama de volta quem sumiu — o lembrete que mais importa é o de quem parou."""
    _authorize(authorization, x_maintenance_token)

    limite = datetime.now(BRT) - timedelta(days=INACTIVE_DAYS)
    sumidos = await repo._fetch(
        """SELECT u.id, COALESCE(st.current_streak, 0) AS streak
             FROM prf_users u
             LEFT JOIN user_streaks st ON st.user_id = u.id
            WHERE u.is_active IS NOT FALSE
              AND NOT EXISTS (
                    SELECT 1 FROM question_attempts a
                     WHERE a.user_id = u.id AND a.created_at > $1)
              AND NOT EXISTS (
                    SELECT 1 FROM notification_queue n
                     WHERE n.user_id = u.id AND n.type = 'gentle_return'
                       AND n.created_at > $1)
            LIMIT 200""",
        limite,
    )

    for u in sumidos:
        try:
            await service_send_return(repo, u["id"])
        except Exception as e:
            logger.warning(f"[PRF] retorno de {u['id']} falhou: {e}")

    entregues = await _entregar_pendentes(repo)
    return {
        "inativos_encontrados": len(sumidos),
        "notificacoes_entregues": entregues["enviadas"],
    }


@router.post("/audio")
@router.get("/audio")
async def rodar_audio(
    authorization: str | None = Header(default=None),
    x_maintenance_token: str | None = Header(default=None),
    repo: PRFRepository = Depends(get_repo),
):
    """Produz o áudio do dia: uma aula da ida e um drill da volta.

    O gargalo do plano não é o motor de estudo, é o acervo — o candidato tem
    80 minutos de carro por dia e o áudio só existia para os tópicos em que
    alguém lembrou de disparar a geração à mão. Com esta tarefa rodando
    diariamente, o acervo caminha sozinho até cobrir o edital.

    Dois passos na mesma execução, nunca mais que isso: são dez idas ao
    modelo para a aula e oito para o drill, e o tempo da função serverless
    não comporta uma terceira peça. O drill roda mesmo se a aula falhar,
    porque ele trabalha na fila das aulas que já existem.
    """
    _authorize(authorization, x_maintenance_token)

    from prf.services.audio_pipeline import (
        SCRIPT_VERSION, gerar_proxima_aula, gerar_proximo_drill,
        refazer_episodio_antigo,
    )

    # Refazer o que está em formato antigo vem ANTES de cobrir tópico novo.
    # Uma aula sem jurisprudência e sem debate, no tópico de maior peso, custa
    # mais ponto do que a ausência de aula num tópico de peso menor. A troca é
    # feita gravando a nova antes de aposentar a velha, então o acervo nunca
    # encolhe durante a transição.
    atrasados = await repo.count_outdated_episodes(SCRIPT_VERSION)
    pendente_refazer = (atrasados.get("aulas") or 0) + (atrasados.get("drills") or 0)

    aula = drill = None
    if pendente_refazer:
        for kind in ("aula", "drill"):
            try:
                r = await refazer_episodio_antigo(repo, kind=kind)
            except Exception as e:
                logger.error(f"[PRF] refação de {kind} falhou: {e}")
                r = {"generated": False, "reason": str(e)}
            if kind == "aula":
                aula = r
            else:
                drill = r

    # Só depois de zerada a fila de refação é que o acervo cresce.
    if not pendente_refazer:
        try:
            aula = await gerar_proxima_aula(repo)
        except Exception as e:
            logger.error(f"[PRF] geração de aula falhou: {e}")
            aula = {"generated": False, "reason": str(e)}

        try:
            drill = await gerar_proximo_drill(repo)
        except Exception as e:
            logger.error(f"[PRF] geração de drill falhou: {e}")
            drill = {"generated": False, "reason": str(e)}

    return {
        "modo": "refazendo formato antigo" if pendente_refazer else "cobrindo tópico novo",
        "script_version": SCRIPT_VERSION,
        "episodios_em_formato_antigo": atrasados,
        "aula": aula,
        "drill": drill,
    }


async def service_send_return(repo: PRFRepository, user_id) -> None:
    await NotificationService(repo).send_gentle_return(user_id)


async def _entregar_pendentes(repo: PRFRepository) -> dict:
    """Manda para o celular tudo que está na fila e ainda não saiu.

    Sem VAPID configurado a fila continua servindo o app — a notificação
    aparece quando o candidato abre a tela —, só não chega como push.
    """
    if not push_service.is_configured():
        return {"enviadas": 0, "removidas": 0}

    pendentes = await repo._fetch(
        """SELECT n.id, n.user_id, n.title, n.body, n.type,
                  s.endpoint, s.p256dh, s.auth
             FROM notification_queue n
             JOIN push_subscriptions s ON s.user_id = n.user_id
            WHERE NOT n.is_sent
              AND (n.scheduled_for IS NULL OR n.scheduled_for <= NOW())
            ORDER BY n.created_at
            LIMIT 300""",
    )

    enviadas = 0
    mortas: list[str] = []
    entregues: set = set()

    for p in pendentes:
        try:
            status = await push_service.send_push(
                {"endpoint": p["endpoint"], "p256dh": p["p256dh"], "auth": p["auth"]},
                title=p["title"], body=p["body"], tag=str(p["type"]),
            )
        except Exception as e:
            logger.warning(f"[PRF] push falhou: {e}")
            continue

        if status in (404, 410):
            # Inscrição morta: app desinstalado ou permissão revogada.
            mortas.append(p["endpoint"])
        elif status < 300:
            enviadas += 1
            entregues.add(p["id"])

    if entregues:
        await repo._execute(
            "UPDATE notification_queue SET is_sent = TRUE, sent_at = NOW() "
            " WHERE id = ANY($1::uuid[])",
            list(entregues),
        )
    if mortas:
        await repo._execute(
            "DELETE FROM push_subscriptions WHERE endpoint = ANY($1::text[])", mortas,
        )

    return {"enviadas": enviadas, "removidas": len(mortas)}
