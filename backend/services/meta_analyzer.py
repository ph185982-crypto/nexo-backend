"""
Meta Ads Intelligence Analyzer
Analisa métricas de campanhas e anúncios do Meta Ads e produz diagnóstico priorizado.
"""
import os, logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class Issue:
    level:       str    # "crítico" | "atenção" | "oportunidade"
    entity:      str    # "campanha" | "anúncio" | "conta"
    entity_name: str
    metric:      str
    value:       float
    threshold:   float
    description: str
    action:      str
    impact:      str    # "alto" | "médio" | "baixo"
    priority:    int    # 1-10 (1 = mais urgente)


class MetaAnalyzer:

    # ── Thresholds ────────────────────────────────────────────────────────────
    CTR_WEAK          = 1.0     # %
    CPM_HIGH          = 50.0    # R$
    FREQ_SATURATED    = 3.0
    ROAS_MIN          = 2.0
    PLAY_RATE_MIN     = 20.0    # %
    COMPLETION_MIN    = 15.0    # %
    CPC_HIGH          = 5.0     # R$
    CTR_GREAT         = 2.0     # % — escalar
    ROAS_SCALE        = 3.0     # ROAS para escalar

    def analyze(self, campaigns: list, ads: list, account_ins: dict) -> dict:
        issues: list[Issue] = []

        # Análise da conta geral
        issues += self._analyze_account(account_ins)

        # Análise por campanha
        for c in campaigns:
            issues += self._analyze_campaign(c)

        # Análise por anúncio
        for a in ads:
            issues += self._analyze_ad(a)

        # Ordena por prioridade
        issues.sort(key=lambda x: (x.priority, x.level != "crítico"))

        # Score de saúde (0-100)
        score = self._health_score(issues, account_ins)

        # Recomendações de escala
        scale_now   = [a for a in ads if a.get("purchase_roas", 0) >= self.ROAS_SCALE and a.get("ctr", 0) >= self.CTR_GREAT]
        pause_now   = [a for a in ads if a.get("purchase_roas", 0) < 1.0 and a.get("spend", 0) > 50]

        return {
            "health_score":   score,
            "health_label":   "Excelente" if score >= 80 else "Bom" if score >= 60 else "Atenção" if score >= 40 else "Crítico",
            "issues":         [self._issue_to_dict(i) for i in issues],
            "summary": {
                "total_issues":   len(issues),
                "critical":       sum(1 for i in issues if i.level == "crítico"),
                "warnings":       sum(1 for i in issues if i.level == "atenção"),
                "opportunities":  sum(1 for i in issues if i.level == "oportunidade"),
                "campaigns_analyzed": len(campaigns),
                "ads_analyzed":   len(ads),
            },
            "scale_now": [{"id": a["id"], "name": a["name"], "roas": a.get("purchase_roas"), "ctr": a.get("ctr")} for a in scale_now],
            "pause_now": [{"id": a["id"], "name": a["name"], "spend": a.get("spend"), "roas": a.get("purchase_roas")} for a in pause_now],
            "top_recommendations": self._top_recommendations(issues),
        }

    def _analyze_account(self, ins: dict) -> list:
        issues = []
        cpm   = ins.get("cpm", 0)
        ctr   = ins.get("ctr", 0)
        freq  = ins.get("frequency", 0)
        roas  = ins.get("purchase_roas", 0)
        spend = ins.get("spend", 0)

        if spend == 0:
            return issues

        if cpm > self.CPM_HIGH:
            issues.append(Issue(
                level="atenção", entity="conta", entity_name="Conta Geral",
                metric="CPM", value=cpm, threshold=self.CPM_HIGH,
                description=f"CPM médio da conta em R${cpm:.2f} — público muito concorrido",
                action="Expanda os públicos ou tente interesses mais amplos. Considere públicos lookalike 5-10%.",
                impact="alto", priority=2
            ))

        if ctr < self.CTR_WEAK and spend > 100:
            issues.append(Issue(
                level="crítico", entity="conta", entity_name="Conta Geral",
                metric="CTR", value=ctr, threshold=self.CTR_WEAK,
                description=f"CTR geral em {ctr:.2f}% — criativos estão fraturados",
                action="Teste novos ângulos de copy: problema→solução, prova social, antes/depois. Priorize vídeo UGC.",
                impact="alto", priority=1
            ))

        if freq > self.FREQ_SATURATED:
            issues.append(Issue(
                level="crítico", entity="conta", entity_name="Conta Geral",
                metric="Frequência", value=freq, threshold=self.FREQ_SATURATED,
                description=f"Frequência {freq:.1f} — público saturado, vendo o mesmo anúncio muitas vezes",
                action="Pause campanhas atuais e crie novos públicos. Lookalike de compradores, interesses diferentes.",
                impact="alto", priority=1
            ))

        if 0 < roas < self.ROAS_MIN and spend > 200:
            issues.append(Issue(
                level="crítico", entity="conta", entity_name="Conta Geral",
                metric="ROAS", value=roas, threshold=self.ROAS_MIN,
                description=f"ROAS {roas:.2f}x abaixo do break-even — conta com prejuízo",
                action="Revise a página de vendas, oferta e preço. Verifique o pixel do Meta e rastreamento de conversões.",
                impact="alto", priority=1
            ))

        return issues

    def _analyze_campaign(self, c: dict) -> list:
        issues = []
        name  = c.get("name", c.get("id", "?"))
        spend = c.get("spend", 0)
        if spend < 20:
            return issues  # Sem dados suficientes

        roas = c.get("purchase_roas", 0)
        ctr  = c.get("ctr", 0)
        cpm  = c.get("cpm", 0)
        freq = c.get("frequency", 0)

        if roas >= self.ROAS_SCALE and ctr >= self.CTR_GREAT:
            issues.append(Issue(
                level="oportunidade", entity="campanha", entity_name=name,
                metric="ROAS", value=roas, threshold=self.ROAS_SCALE,
                description=f"Campanha '{name}' com ROAS {roas:.2f}x e CTR {ctr:.2f}% — candidata a escala",
                action=f"Aumente o budget em 20-30% a cada 48h. Não altere o público ou criativos.",
                impact="alto", priority=3
            ))

        if 0 < roas < 1.5 and spend > 100:
            issues.append(Issue(
                level="crítico", entity="campanha", entity_name=name,
                metric="ROAS", value=roas, threshold=1.5,
                description=f"Campanha '{name}': ROAS {roas:.2f}x com R${spend:.0f} gasto — pause imediatamente",
                action="Pause esta campanha. Identifique qual anúncio está drenando budget sem converter.",
                impact="alto", priority=1
            ))

        if freq > 4:
            issues.append(Issue(
                level="crítico", entity="campanha", entity_name=name,
                metric="Frequência", value=freq, threshold=4.0,
                description=f"Campanha '{name}': frequência {freq:.1f} — público completamente saturado",
                action="Amplie o público ou pause. Crie campanha nova com lookalike fresh.",
                impact="médio", priority=2
            ))

        return issues

    def _analyze_ad(self, a: dict) -> list:
        issues = []
        name  = a.get("name", a.get("id", "?"))
        spend = a.get("spend", 0)
        if spend < 10:
            return issues

        ctr           = a.get("ctr", 0)
        cpm           = a.get("cpm", 0)
        roas          = a.get("purchase_roas", 0)
        plays         = a.get("video_plays", 0)
        impressions   = a.get("impressions", 1)
        p100          = a.get("video_p100", 0)
        effective_st  = a.get("effective_status", "")

        play_rate     = (plays / impressions * 100) if impressions > 0 else 0
        completion    = (p100 / max(plays, 1) * 100) if plays > 0 else 0

        if effective_st == "DISAPPROVED":
            issues.append(Issue(
                level="crítico", entity="anúncio", entity_name=name,
                metric="Status", value=0, threshold=1,
                description=f"Anúncio '{name}' REPROVADO pelo Meta",
                action="Revise as políticas de publicidade. Altere o criativo e/ou copy. Solicite revisão.",
                impact="alto", priority=1
            ))

        if ctr < self.CTR_WEAK and spend > 30:
            issues.append(Issue(
                level="atenção", entity="anúncio", entity_name=name,
                metric="CTR", value=ctr, threshold=self.CTR_WEAK,
                description=f"Anúncio '{name}': CTR {ctr:.2f}% — criativo fraco, não está chamando atenção",
                action="Teste novo ângulo: foco no problema do cliente, depoimento, ou oferta de urgência. Use UGC.",
                impact="médio", priority=4
            ))

        if plays > 0 and play_rate < self.PLAY_RATE_MIN:
            issues.append(Issue(
                level="atenção", entity="anúncio", entity_name=name,
                metric="Play Rate", value=round(play_rate, 1), threshold=self.PLAY_RATE_MIN,
                description=f"Anúncio '{name}': apenas {play_rate:.1f}% das impressões geram plays — thumbnail fraca",
                action="Teste nova thumbnail com rosto humano, texto grande e cor contrastante. Evite imagens genéricas.",
                impact="médio", priority=4
            ))

        if plays > 100 and completion < self.COMPLETION_MIN:
            issues.append(Issue(
                level="atenção", entity="anúncio", entity_name=name,
                metric="Completion Rate", value=round(completion, 1), threshold=self.COMPLETION_MIN,
                description=f"Anúncio '{name}': apenas {completion:.1f}% assistem até o fim — hook dos 3s fraco",
                action="Reescreva os primeiros 3 segundos com uma afirmação chocante ou pergunta direta ao público.",
                impact="médio", priority=5
            ))

        if roas >= self.ROAS_SCALE and ctr >= self.CTR_GREAT:
            issues.append(Issue(
                level="oportunidade", entity="anúncio", entity_name=name,
                metric="ROAS", value=roas, threshold=self.ROAS_SCALE,
                description=f"Anúncio '{name}': ROAS {roas:.2f}x e CTR {ctr:.2f}% — escale agora",
                action=f"Aumente o budget deste adset em 20-30%. Crie variações do criativo para testar.",
                impact="alto", priority=3
            ))

        return issues

    def _health_score(self, issues: list, ins: dict) -> int:
        score = 100
        for i in issues:
            if i.level == "crítico":      score -= 15
            elif i.level == "atenção":    score -= 7
            # oportunidades não penalizam
        # Bônus por ROAS positivo
        roas = ins.get("purchase_roas", 0)
        if roas >= 3:   score = min(100, score + 10)
        elif roas >= 2: score = min(100, score + 5)
        return max(0, score)

    def _top_recommendations(self, issues: list) -> list[str]:
        """3-5 recomendações mais impactantes em linguagem direta."""
        seen = set()
        recs = []
        for i in sorted(issues, key=lambda x: x.priority):
            if i.action not in seen and len(recs) < 5:
                seen.add(i.action)
                recs.append(f"[{i.entity.upper()}] {i.action}")
        return recs

    @staticmethod
    def _issue_to_dict(i: Issue) -> dict:
        return {
            "level":       i.level,
            "entity":      i.entity,
            "entity_name": i.entity_name,
            "metric":      i.metric,
            "value":       i.value,
            "threshold":   i.threshold,
            "description": i.description,
            "action":      i.action,
            "impact":      i.impact,
            "priority":    i.priority,
        }
