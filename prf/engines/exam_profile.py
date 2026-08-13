"""
Exam Profile — o formato da prova como dado, não como código.

Quando o próximo edital sair (ou a banca trocar de AOCP pra CEBRASPE), o
que muda é isto: blocos, itens por matéria, peso, regra de eliminação.
Motor de prioridade e estimativa de aprovação nunca precisam ser tocados —
eles só leem o perfil. Editar o edital é editar EXAM_BLOCKS_PM /
ITEMS_PER_SUBJECT_SIMULADO_PM em seed_data.py, nunca este arquivo.
"""
from __future__ import annotations
from dataclasses import dataclass, field


@dataclass
class BlockProfile:
    name: str
    weight: float
    subjects: list[str] = field(default_factory=list)


@dataclass
class ExamProfile:
    exam_id: str                          # "PMGO" | "PRF"
    blocks: list[BlockProfile]
    items_per_subject: dict[str, int]     # subject_slug -> itens no blueprint
    elimination_pct: float = 0.60         # fração mínima do total pra não ser eliminado
    zero_eliminates: bool = True          # zerar qualquer matéria do blueprint elimina

    @property
    def max_points(self) -> float:
        return sum(
            self.items_per_subject.get(slug, 0) * block.weight
            for block in self.blocks for slug in block.subjects
        )

    @property
    def survive_threshold(self) -> float:
        return round(self.max_points * self.elimination_pct, 1)

    def block_weight_of(self, subject_slug: str) -> float:
        for block in self.blocks:
            if subject_slug in block.subjects:
                return block.weight
        return 0.0

    def items_of(self, subject_slug: str) -> int:
        return self.items_per_subject.get(subject_slug, 0)


def exam_profile_for(is_pm: bool) -> ExamProfile:
    from prf.seeds.seed_data import (
        EXAM_BLOCKS_PM, ITEMS_PER_SUBJECT_SIMULADO_PM,
        EXAM_BLOCKS, ITEMS_PER_SUBJECT_SIMULADO,
    )
    blocks_src = EXAM_BLOCKS_PM if is_pm else EXAM_BLOCKS
    items_src = ITEMS_PER_SUBJECT_SIMULADO_PM if is_pm else ITEMS_PER_SUBJECT_SIMULADO
    blocks = [
        BlockProfile(
            name=bi.get("name", f"Bloco {bn}"),
            weight=bi.get("weight", 1),
            subjects=list(bi["subjects"]),
        )
        for bn, bi in sorted(blocks_src.items())
    ]
    return ExamProfile(
        exam_id="PMGO" if is_pm else "PRF",
        blocks=blocks,
        items_per_subject=dict(items_src),
    )
