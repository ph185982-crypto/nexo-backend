"use client";

// Ficha do contrato: dados, versões, arquivos (original e assinado), eventos da ClickSign e ações
// (enviar, reenviar, atualizar status, cancelar, gerar de novo a partir do formulário salvo).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiUrl } from "@/lib/api-url";
import { dataHora } from "@/lib/comercial/formatar";
import { cnpjFormatado, reais, ROTULO_MODELO, ROTULO_STATUS, type FormContrato } from "@/lib/comercial/contratos/modelo";
import { StatusContrato } from "./status";

export interface ContratoDetalhe {
  id: string; status: string; provedor: string; origem: string; filename: string; razaoSocial: string; nomeFantasia: string | null; cnpj: string | null;
  representante: string | null; emailCliente: string | null; telefoneCliente: string | null; modelo: string; plano: string | null; valor: number | null;
  duracaoMeses: number | null; inicioEm: string | null; vencimentoDia: number | null; envelopeId: string | null; pastaClicksign: string | null;
  enviadoEm: string | null; assinadoEm: string | null; criadoEm: string; ultimoErro: string | null; formJson: FormContrato; substituiId: string | null;
  oportunidade: { id: string; funilId: string; nome: string; status: string } | null; contato: { id: string; nome: string } | null;
  arquivos: Array<{ id: string; tipo: string; nome: string; sha256: string; criadoEm: string }>;
  eventos: Array<{ id: string; tipo: string; recebidoEm: string }>;
  versoesAnteriores: Array<{ id: string; status: string; criadoEm: string; filename: string }>;
  versoesPosteriores: Array<{ id: string; status: string; criadoEm: string; filename: string }>;
}

const ROTULO_EVENTO: Record<string, string> = {
  ENVIADO: "Enviado para assinatura", REENVIADO: "Lembrete reenviado", CANCELADO: "Cancelado", ERRO_ENVIO: "Erro no envio",
  AUTOMACAO_ASSINADO: "Automação: oportunidade ganha e Central avisada", IMPORTADO: "Importado do histórico do navegador",
  sign: "Um signatário assinou", close: "Envelope finalizado", auto_close: "Envelope finalizado (todas as assinaturas)",
  document_closed: "PDF assinado disponível", cancel: "Cancelado na ClickSign", refusal: "Recusado pelo signatário", deadline: "Prazo encerrado",
  add_signer: "Signatário adicionado", upload: "Documento enviado",
};

const botao = "rounded-md border border-border px-3 py-1.5 text-[12px] font-bold hover:border-primary disabled:opacity-50";

export function FichaContrato({ id, onFechar, onGerarDeNovo, onMudou, emailContratadaPadrao }: {
  id: string; onFechar: () => void; onGerarDeNovo: (c: ContratoDetalhe) => void; onMudou: () => void; emailContratadaPadrao?: string;
}) {
  const [c, setC] = useState<ContratoDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch(apiUrl(`/api/comercial/contratos/${id}`));
    const j = await r.json().catch(() => ({}));
    if (r.ok) setC(j.contrato); else setErro(j.erro ?? "Não foi possível abrir o contrato");
  }, [id]);
  useEffect(() => { setC(null); setErro(null); setAviso(null); void carregar(); }, [carregar]);

  async function acao(acao: string, extra: Record<string, unknown> = {}, confirmar?: string) {
    if (confirmar && !window.confirm(confirmar)) return;
    setOcupado(true); setErro(null); setAviso(null);
    try {
      const r = await fetch(apiUrl(`/api/comercial/contratos/${id}`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ acao, ...extra }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErro(j.erro ?? `Erro ${r.status}`);
      else setAviso(acao === "enviar" ? (j.notificado === false ? "Envelope ativado, mas a notificação não saiu: use “Reenviar lembrete”." : "Enviado para assinatura.") + (j.aviso ? ` ${j.aviso}` : "")
        : acao === "reenviar" ? "Lembrete reenviado ao cliente." : acao === "cancelar" ? "Contrato cancelado." : `Status na ClickSign: ${ROTULO_STATUS[j.status] ?? j.status}.`);
      await carregar(); onMudou();
    } finally { setOcupado(false); }
  }

  const aberto = c && ["ENVIADO", "ASSINADO_PARCIAL"].includes(c.status);
  const editavel = c?.provedor === "clicksign";
  return (
    <section aria-label="Ficha do contrato" className="flex h-full flex-col overflow-y-auto bg-card">
      <header className="flex items-start gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[17px] font-extrabold">{c?.razaoSocial ?? "Contrato"}</h2>
          <p className="truncate text-[12px] text-muted-foreground">{c?.filename}</p>
        </div>
        {c && <StatusContrato status={c.status} />}
        <button onClick={onFechar} aria-label="Fechar ficha" className="rounded-md px-2 py-0.5 text-[20px] leading-none text-muted-foreground hover:bg-background">×</button>
      </header>
      {!c && !erro && <p className="px-5 py-4 text-[13px] text-muted-foreground">Carregando…</p>}
      {erro && <p role="alert" className="mx-5 mt-4 rounded-md border border-destructive px-3 py-2 text-[13px] font-semibold text-destructive">{erro}</p>}
      {aviso && <p role="status" className="mx-5 mt-4 rounded-md border border-border bg-secondary px-3 py-2 text-[13px] font-semibold">{aviso}</p>}
      {c && (
        <div className="px-5 pb-8">
          <div className="mt-4 flex flex-wrap gap-1.5">
            {editavel && ["GERADO", "ERRO"].includes(c.status) && c.arquivos.some((a) => a.tipo === "ORIGINAL") && (
              <button disabled={ocupado} onClick={() => void acao("enviar", { canal: "email", emailContratada: emailContratadaPadrao ?? "" })} className="rounded-md bg-laranja px-3 py-1.5 text-[12px] font-extrabold text-marinho disabled:opacity-50">Enviar para assinatura</button>
            )}
            {editavel && aberto && <button disabled={ocupado} onClick={() => void acao("reenviar")} className={botao}>Reenviar lembrete</button>}
            {editavel && c.envelopeId && <button disabled={ocupado} onClick={() => void acao("status")} className={botao}>Atualizar status</button>}
            {editavel && <button disabled={ocupado} onClick={() => onGerarDeNovo(c)} className={botao}>Gerar de novo</button>}
            {editavel && !["ASSINADO", "CANCELADO"].includes(c.status) && (
              <button disabled={ocupado} onClick={() => void acao("cancelar", {}, "Cancelar este contrato? O cliente não poderá mais assinar.")} className={`${botao} hover:border-destructive hover:text-destructive`}>Cancelar</button>
            )}
          </div>
          {c.ultimoErro && <p className="mt-3 text-[12px] font-semibold text-destructive">Último erro: {c.ultimoErro}</p>}
          {c.provedor !== "clicksign" && <p className="mt-3 text-[12px] text-muted-foreground">Importado do ZapSign: só leitura. Use “Gerar de novo” para emitir pela ClickSign.</p>}

          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
            <dt className="text-muted-foreground">Modelo</dt><dd className="font-semibold">{ROTULO_MODELO[c.modelo] ?? c.modelo}{c.plano ? ` · ${c.plano}` : ""}</dd>
            <dt className="text-muted-foreground">Valor mensal</dt><dd className="font-semibold">{c.valor !== null ? reais(c.valor) : "—"}{c.duracaoMeses ? ` · ${c.duracaoMeses} meses` : ""}</dd>
            <dt className="text-muted-foreground">CNPJ</dt><dd>{c.cnpj ? cnpjFormatado(c.cnpj) : "—"}</dd>
            <dt className="text-muted-foreground">Representante</dt><dd>{c.representante ?? "—"}</dd>
            <dt className="text-muted-foreground">Contato</dt><dd className="break-all">{[c.emailCliente, c.telefoneCliente].filter(Boolean).join(" · ") || "—"}</dd>
            <dt className="text-muted-foreground">Oportunidade</dt>
            <dd>{c.oportunidade ? <Link className="font-semibold underline-offset-2 hover:underline" href={`/comercial/oportunidades?funil=${c.oportunidade.funilId}&abrir=${c.oportunidade.id}`}>{c.oportunidade.nome}</Link> : "—"}</dd>
            <dt className="text-muted-foreground">Gerado</dt><dd>{dataHora(c.criadoEm)}{c.origem !== "APP" ? ` · ${c.origem === "IMPORTADO_NAVEGADOR" ? "importado do navegador" : "importado da ClickSign"}` : ""}</dd>
            <dt className="text-muted-foreground">Enviado</dt><dd>{c.enviadoEm ? dataHora(c.enviadoEm) : "—"}</dd>
            <dt className="text-muted-foreground">Assinado</dt><dd>{c.assinadoEm ? dataHora(c.assinadoEm) : "—"}</dd>
            {c.pastaClicksign && <><dt className="text-muted-foreground">Pasta</dt><dd className="break-all">{c.pastaClicksign}</dd></>}
          </dl>

          <h3 className="mt-6 text-[13px] font-extrabold">Arquivos</h3>
          {c.arquivos.length === 0 && <p className="mt-1 text-[12px] text-muted-foreground">Sem PDF guardado (importado só com o formulário): use “Gerar de novo”.</p>}
          <ul className="mt-1.5 space-y-1.5">
            {c.arquivos.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-[12.5px]">
                <span className="min-w-0"><b>{a.tipo === "ASSINADO" ? "Assinado" : "Original"}</b> <span className="text-muted-foreground">· {dataHora(a.criadoEm)} · sha256 {a.sha256.slice(0, 10)}…</span></span>
                <a href={apiUrl(`/api/comercial/contratos/${c.id}/arquivo?tipo=${a.tipo}`)} target="_blank" rel="noreferrer" className="flex-none rounded-md border border-primary px-2.5 py-1 font-bold">Abrir PDF</a>
              </li>
            ))}
          </ul>

          {(c.versoesAnteriores.length > 0 || c.versoesPosteriores.length > 0) && (
            <>
              <h3 className="mt-6 text-[13px] font-extrabold">Versões</h3>
              <ul className="mt-1.5 space-y-1 text-[12.5px]">
                {c.versoesPosteriores.map((v) => <li key={v.id}>Substituído por <b>{v.filename}</b> · {dataHora(v.criadoEm)} · {ROTULO_STATUS[v.status] ?? v.status}</li>)}
                {c.versoesAnteriores.map((v) => <li key={v.id} className="text-muted-foreground">Versão anterior: {v.filename} · {dataHora(v.criadoEm)} · {ROTULO_STATUS[v.status] ?? v.status}</li>)}
              </ul>
            </>
          )}

          <h3 className="mt-6 text-[13px] font-extrabold">Eventos</h3>
          {c.eventos.length === 0 && <p className="mt-1 text-[12px] text-muted-foreground">Nenhum evento ainda.</p>}
          <ol className="mt-1.5 border-l border-border pl-3">
            {c.eventos.map((e) => (
              <li key={e.id} className="py-1 text-[12.5px]"><span className="font-semibold">{ROTULO_EVENTO[e.tipo] ?? e.tipo}</span> <span className="text-muted-foreground">· {dataHora(e.recebidoEm)}</span></li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
