"use client";

import { useEffect, useState } from "react";
import { dataHora } from "@/lib/formatar";

interface Resumo { resumo: string; proximosPassos: string[]; riscos: string[]; temperatura: string; geradoEm: string }
const TEMPERATURA: Record<string, string> = { QUENTE: "Quente", MORNA: "Morna", FRIA: "Fria", RISCO_ALTO: "Risco alto" };

/** Resumo da IA: situação, próximos passos e riscos. Gerado sob pedido; avisa quando há atividade mais nova que ele. */
export function ResumoIa({ oportunidadeId, ultimaAtividadeEm }: { oportunidadeId: string; ultimaAtividadeEm: string }) {
  const [resumo, setResumo] = useState<Resumo | null | undefined>(undefined);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setResumo(undefined); setErro(null);
    fetch(`/api/oportunidades/${oportunidadeId}`).then((r) => r.json()).then((d: { resumoIa: Resumo | null }) => { if (vivo) setResumo(d.resumoIa ?? null); }).catch(() => { if (vivo) setResumo(null); });
    return () => { vivo = false; };
  }, [oportunidadeId]);

  const gerar = async () => {
    setGerando(true); setErro(null);
    const r = await fetch(`/api/oportunidades/${oportunidadeId}/resumo`, { method: "POST" });
    const j = (await r.json().catch(() => ({}))) as { resumo?: Resumo; erro?: string };
    setGerando(false);
    if (r.ok && j.resumo) setResumo(j.resumo); else setErro(j.erro ?? "Não foi possível gerar o resumo");
  };

  const desatualizado = resumo && new Date(ultimaAtividadeEm) > new Date(resumo.geradoEm);
  return (
    <section className="mx-5 mt-4 rounded-xl border border-linha p-3.5" aria-label="Resumo da IA">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-extrabold">Resumo da IA</h3>
        {resumo !== undefined && (
          <button onClick={gerar} disabled={gerando} className="text-[12px] font-bold text-azul disabled:opacity-50">{gerando ? "Gerando…" : resumo ? "Atualizar" : "Gerar"}</button>
        )}
      </div>
      {resumo === undefined && <p className="mt-1.5 text-[12px] text-cinza">Carregando…</p>}
      {resumo === null && !gerando && <p className="mt-1.5 text-[12px] text-cinza">Lê interações, conversas, reuniões e combinados e diz em que pé está, o que fazer e o que pode dar errado.</p>}
      {resumo && (
        <div className={gerando ? "opacity-50" : ""}>
          <p className="mt-1.5 text-[13px] leading-relaxed">{resumo.resumo}</p>
          {resumo.proximosPassos.length > 0 && (
            <>
              <p className="mt-2.5 text-[11px] font-bold uppercase tracking-[0.04em] text-cinza">Próximos passos</p>
              <ol className="mt-1 list-decimal space-y-1 pl-4 text-[12.5px]">{resumo.proximosPassos.map((p) => <li key={p}>{p}</li>)}</ol>
            </>
          )}
          {resumo.riscos.length > 0 && (
            <>
              <p className="mt-2.5 text-[11px] font-bold uppercase tracking-[0.04em] text-cinza">Riscos</p>
              <ul className="mt-1 space-y-1 text-[12.5px]">{resumo.riscos.map((r) => <li key={r} className="flex gap-1.5"><i className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-critico" aria-hidden />{r}</li>)}</ul>
            </>
          )}
          <p className="mt-2.5 text-[11px] text-cinza">
            {TEMPERATURA[resumo.temperatura] ?? resumo.temperatura} · gerado {dataHora(resumo.geradoEm)}
            {desatualizado && <span className="font-bold text-grafite"> · há atividade mais nova</span>}
          </p>
        </div>
      )}
      {erro && <p role="alert" className="mt-2 text-[12px] font-semibold text-critico">{erro}</p>}
    </section>
  );
}

/** Faixa no topo da ficha quando a oportunidade aberta está parada há 14 dias ou mais. */
export function AlertaParada({ dias }: { dias: number }) {
  return (
    <div role="status" className="mx-5 mt-3 flex items-start gap-2.5 rounded-xl bg-laranja px-3.5 py-2.5 text-grafite">
      <i className="mt-1.5 h-2 w-2 flex-none rounded-full bg-grafite" aria-hidden />
      <p className="text-[12.5px]"><b>Oportunidade parada.</b> Sem atividade há {dias} dias. Registre um contato, agende o próximo passo ou encerre com motivo.</p>
    </div>
  );
}
