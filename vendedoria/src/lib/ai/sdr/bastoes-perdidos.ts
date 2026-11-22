// Recuperação ÚNICA dos bastões que não saíram em 17–18/11/2026 (ver passarBastaoRecuperado).
// Os 4 leads foram conferidos um a um na conversa: respondem às perguntas e a IA já prometeu o
// contato do Pedro. Roda uma vez (marca em AlertaEnviadoMax) no gatilho oportunista; depois de
// rodar em produção este arquivo pode ser apagado.

import { prisma } from "@/lib/prisma/client";

const MARCA = "bastoes-perdidos-2026-11-18-v1";

export const LEADS_SEM_BASTAO: Array<{ id: string; nome: string }> = [
  { id: "cmwl8mlxo001v5i85ngu6g4a3", nome: "Eloisa (LYON DIESEL) — ligação marcada 18/11 às 9h" },
  { id: "cmwl6wup100035i858daoa0cv", nome: "Daniela (Dany Moda Íntima) — R$ 80 mil/mês, CNPJ, loja física" },
  { id: "cmwlhrcfc000p14e3h0ej0ap6", nome: "Cleonice (CleoArt) — ligação combinada 18/11 às 14h" },
  { id: "cmwlynh4o00016fmgb2dvpdf4", nome: "Djavan (almofadas) — quer ser chamado hoje" },
];

// 22/11: o Giliardo (moda fitness, começando do zero, "terça à tarde") ficou preso no portão pedindo "nome da empresa"
// (ele ainda não tem empresa). Com o portão corrigido para quem está começando, o bastão sai pela mesma recuperação.
const MARCA_2 = "bastoes-perdidos-2026-11-22-v1";
export const LEADS_SEM_BASTAO_2: Array<{ id: string; nome: string }> = [
  { id: "cmwptod0j0001uu55v7tnjh77", nome: "Giliardo (moda fitness, começando do zero) — pediu terça à tarde" },
];
export const recuperarBastoesPerdidos2 = (passar?: (id: string) => Promise<{ ok: boolean; motivo: string }>) =>
  recuperarBastoesPerdidos(LEADS_SEM_BASTAO_2, passar, MARCA_2);

export async function recuperarBastoesPerdidos(
  leads: Array<{ id: string; nome: string }> = LEADS_SEM_BASTAO,
  passar?: (id: string) => Promise<{ ok: boolean; motivo: string }>,
  marca: string = MARCA,
): Promise<Array<{ id: string; nome: string; ok: boolean; motivo: string }>> {
  try {
    await prisma.alertaEnviadoMax.create({ data: { chave: marca } });
  } catch {
    return []; // já rodou
  }
  const fazer = passar ?? (await import("./agent")).passarBastaoRecuperado;
  const out: Array<{ id: string; nome: string; ok: boolean; motivo: string }> = [];
  let algumaFalha = false;
  for (const l of leads) {
    try {
      const r = await fazer(l.id);
      out.push({ ...l, ...r });
      // "já escalado/bloqueado" não é falha: alguém (ou a IA) já cuidou do lead.
      if (!r.ok && !/já |encontrado/.test(r.motivo)) algumaFalha = true;
    } catch (e) {
      algumaFalha = true;
      out.push({ ...l, ok: false, motivo: e instanceof Error ? e.message : String(e) });
      console.error(`[SDR] Bastão recuperado falhou | lead=${l.id}:`, e);
    }
  }
  // Se algo falhou de verdade, libera a marca para a próxima rodada tentar de novo (os já escalados são ignorados).
  if (algumaFalha) await prisma.alertaEnviadoMax.deleteMany({ where: { chave: marca } }).catch(() => {});
  console.log(`[SDR] Bastões perdidos: ${out.filter((o) => o.ok).length}/${out.length} escalados`);
  return out;
}
