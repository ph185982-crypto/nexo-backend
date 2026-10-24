// Agregação do resultado por anúncio. Função pura (a rota só busca os leads).

import { eventoDaColuna, ehQualificadoOuAlem } from "@/lib/crm/funil-config";

export interface LinhaAnuncio {
  adSourceId: string | null;
  adHeadline: string | null;
  leads: number;
  qualificados: number;
  ganhos: number;
  valorGanho: number;
  ganhosSemValor: number;
}

export interface LeadDeAnuncio {
  adSourceId: string | null;
  adHeadline: string | null;
  valorContrato: number | null;
  kanbanColumn: { type: string; name: string } | null;
}

export function agregarPorAnuncio(leads: LeadDeAnuncio[]): { anuncios: LinhaAnuncio[]; total: Omit<LinhaAnuncio, "adSourceId" | "adHeadline"> } {
  const mapa = new Map<string, LinhaAnuncio>();
  for (const l of leads) {
    const chave = l.adSourceId ?? "(sem id)";
    let linha = mapa.get(chave);
    if (!linha) {
      linha = { adSourceId: l.adSourceId, adHeadline: l.adHeadline, leads: 0, qualificados: 0, ganhos: 0, valorGanho: 0, ganhosSemValor: 0 };
      mapa.set(chave, linha);
    }
    if (!linha.adHeadline && l.adHeadline) linha.adHeadline = l.adHeadline;
    linha.leads++;
    const ev = l.kanbanColumn ? eventoDaColuna(l.kanbanColumn) : null;
    if (l.kanbanColumn && ehQualificadoOuAlem(l.kanbanColumn)) linha.qualificados++; // ganho implica qualificado
    if (ev === "Purchase") {
      linha.ganhos++;
      if (l.valorContrato && l.valorContrato > 0) linha.valorGanho += l.valorContrato;
      else linha.ganhosSemValor++;
    }
  }
  const anuncios = [...mapa.values()].sort((a, b) => b.leads - a.leads);
  const total = anuncios.reduce(
    (t, a) => ({
      leads: t.leads + a.leads, qualificados: t.qualificados + a.qualificados, ganhos: t.ganhos + a.ganhos,
      valorGanho: t.valorGanho + a.valorGanho, ganhosSemValor: t.ganhosSemValor + a.ganhosSemValor,
    }),
    { leads: 0, qualificados: 0, ganhos: 0, valorGanho: 0, ganhosSemValor: 0 },
  );
  return { anuncios, total };
}
