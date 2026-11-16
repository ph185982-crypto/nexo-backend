"use client";

import { useEffect, useState } from "react";
import type { EtapaDTO } from "@/lib/comercial/funil/quadro";
import { tipoMotivoDaEtapa } from "@/lib/comercial/funil/encerramento";
import { botaoPrimario, botaoSecundario, campo, Dialogo } from "./dialogo";
import { apiUrl } from "@/lib/api-url";

interface Motivo { id: string; nome: string }

/** Mover para ganha/perdida pergunta o motivo; dá para pular. */
export function DialogoMotivo({ nomeOportunidade, etapa, onCancelar, onConfirmar }: {
  nomeOportunidade: string;
  etapa: EtapaDTO;
  onCancelar: () => void;
  onConfirmar: (motivoId: string | null, detalhe: string | null) => void;
}) {
  const tipo = tipoMotivoDaEtapa(etapa.tipo) ?? "PERDA";
  const [motivos, setMotivos] = useState<Motivo[] | null>(null);
  const [motivoId, setMotivoId] = useState("");
  const [detalhe, setDetalhe] = useState("");

  useEffect(() => {
    let vivo = true;
    fetch(apiUrl(`/api/comercial/motivos?tipo=${tipo}`)).then((r) => r.json()).then((j) => { if (vivo) setMotivos(j.motivos ?? []); }).catch(() => { if (vivo) setMotivos([]); });
    return () => { vivo = false; };
  }, [tipo]);

  return (
    <Dialogo titulo={tipo === "GANHO" ? "Por que ganhamos?" : "Por que perdemos?"} onFechar={onCancelar}>
      <p className="mb-4 text-[13px] text-muted-foreground">{nomeOportunidade} → <strong className="text-foreground">{etapa.nome}</strong>. O motivo alimenta o relatório de ganhos e perdas.</p>
      <label className="mb-3 block">
        <span className="mb-1 block text-[12px] font-semibold text-muted-foreground">Motivo</span>
        <select value={motivoId} onChange={(e) => setMotivoId(e.target.value)} disabled={motivos === null} className={campo}>
          <option value="">{motivos === null ? "Carregando…" : "Escolha o motivo"}</option>
          {motivos?.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
        </select>
      </label>
      <label className="mb-5 block">
        <span className="mb-1 block text-[12px] font-semibold text-muted-foreground">Detalhe (opcional)</span>
        <input value={detalhe} maxLength={500} onChange={(e) => setDetalhe(e.target.value)} placeholder="Ex.: achou caro frente ao concorrente X" className={campo} />
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={botaoSecundario} onClick={onCancelar}>Cancelar</button>
        <button type="button" className={botaoSecundario} onClick={() => onConfirmar(null, null)}>Mover sem motivo</button>
        <button type="button" className={botaoPrimario} disabled={!motivoId} onClick={() => onConfirmar(motivoId, detalhe.trim() || null)}>Confirmar</button>
      </div>
    </Dialogo>
  );
}
