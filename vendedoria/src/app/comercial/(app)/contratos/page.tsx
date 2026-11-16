"use client";

// Comercial › Contratos: histórico (filtros por situação e busca), "Novo contrato" (formulário + PDF no navegador,
// envio pela ClickSign no servidor) e a ficha de cada contrato. ?novo=1&oportunidade=<id> abre o formulário
// pré-preenchido pela oportunidade; ?abrir=<id> abre a ficha.
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiUrl } from "@/lib/api-url";
import { data } from "@/lib/comercial/formatar";
import { reais, ROTULO_MODELO, type FormContrato } from "@/lib/comercial/contratos/modelo";
import { FormularioContrato, type ResultadoGerado } from "@/components/comercial/contratos/formulario";
import { FichaContrato, type ContratoDetalhe } from "@/components/comercial/contratos/ficha-contrato";
import { StatusContrato } from "@/components/comercial/contratos/status";

interface ContratoItem {
  id: string; razaoSocial: string; nomeFantasia: string | null; modelo: string; plano: string | null; valor: number | null; status: string; provedor: string; origem: string;
  criadoEm: string; enviadoEm: string | null; assinadoEm: string | null; filename: string; arquivos: string[];
  oportunidade: { id: string; funilId: string; nome: string } | null;
}

const FILTROS = [["", "Todos"], ["ABERTOS", "Aguardando"], ["ASSINADO", "Assinados"], ["GERADO", "Não enviados"], ["CANCELADO", "Cancelados"], ["ERRO", "Com erro"]] as const;

interface Novo { inicial?: Partial<FormContrato>; oportunidadeId?: string | null; contatoId?: string | null; titulo?: string; substitui?: { id: string; filename: string; enviado: boolean } | null }

function Contratos() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<ContratoItem[] | null>(null);
  const [conta, setConta] = useState<{ ok: boolean; mensagem?: string } | null>(null);
  const [emailContratada, setEmailContratada] = useState("");
  const [aberto, setAberto] = useState<string | null>(params.get("abrir"));
  const [novo, setNovo] = useState<Novo | null>(params.get("novo") ? {} : null);
  const [resultado, setResultado] = useState<ResultadoGerado | null>(null);
  const [versao, setVersao] = useState(0);

  // Pré-preenchimento pela oportunidade (botão "Gerar contrato" da ficha).
  const opParam = params.get("oportunidade");
  useEffect(() => {
    if (!params.get("novo") || !opParam) return;
    let vivo = true;
    fetch(apiUrl(`/api/comercial/contratos/preencher?oportunidade=${encodeURIComponent(opParam)}`)).then((r) => r.json()).then((j) => {
      if (!vivo || !j.form) return;
      const { oportunidadeId, contatoId, oportunidadeNome, ...inicial } = j.form;
      setNovo({ inicial, oportunidadeId, contatoId, titulo: `Contrato da oportunidade ${oportunidadeNome}` });
    }).catch(() => {});
    return () => { vivo = false; };
  }, [opParam]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let vivo = true;
    const t = setTimeout(() => {
      const u = new URLSearchParams({ conta: "1", ...(status ? { status } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
      fetch(apiUrl(`/api/comercial/contratos?${u}`)).then((r) => r.json()).then((j) => {
        if (!vivo) return;
        setLista(j.contratos ?? []); setConta(j.clicksign ?? null); setEmailContratada(j.emailContratada ?? "");
      }).catch(() => { if (vivo) setLista([]); });
    }, q ? 250 : 0);
    return () => { vivo = false; clearTimeout(t); };
  }, [status, q, versao]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  const limparUrl = () => router.replace("/comercial/contratos");

  function gerado(r: ResultadoGerado) {
    setNovo(null); setResultado(r); setAberto(r.id); recarregar(); limparUrl();
  }
  function gerarDeNovo(c: ContratoDetalhe) {
    setAberto(null);
    setNovo({ inicial: { ...c.formJson, _idOriginal: undefined }, oportunidadeId: c.oportunidade?.id ?? null, contatoId: c.contato?.id ?? null,
      titulo: "Gerar de novo", substitui: { id: c.id, filename: c.filename, enviado: ["ENVIADO", "ASSINADO_PARCIAL"].includes(c.status) } });
  }

  if (novo) {
    return (
      <div className="flex h-full flex-col overflow-y-auto">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
          <div>
            <h1 className="text-[20px] font-extrabold">{novo.titulo ?? "Novo contrato"}</h1>
            <p className="text-[12px] text-muted-foreground">Preencha, gere o PDF e envie para assinatura pela ClickSign.</p>
          </div>
        </header>
        <div className="px-4 py-5 sm:px-6">
          <FormularioContrato key={JSON.stringify(novo.inicial ?? {})} inicial={novo.inicial} oportunidadeId={novo.oportunidadeId} contatoId={novo.contatoId}
            substitui={novo.substitui} emailContratadaPadrao={emailContratada} onGerado={gerado} onCancelar={() => { setNovo(null); limparUrl(); }} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className={`flex min-w-0 flex-1 flex-col overflow-y-auto ${aberto ? "hidden lg:flex" : ""}`}>
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
          <div>
            <h1 className="text-[20px] font-extrabold">Contratos</h1>
            <p className="text-[12px] text-muted-foreground">Gerados aqui e enviados pela ClickSign. Assinado, a oportunidade é ganha e a Central é avisada.</p>
          </div>
          <button onClick={() => { setResultado(null); setNovo({}); }} className="rounded-md bg-laranja px-4 py-2.5 text-[13px] font-extrabold text-marinho hover:bg-laranja/90">Novo contrato</button>
        </header>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-6">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por empresa, CNPJ ou representante" aria-label="Buscar contratos"
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-[13px] sm:w-[300px]" />
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrar contratos">
            {FILTROS.map(([v, r]) => (
              <button key={v} role="tab" aria-selected={status === v} onClick={() => setStatus(v)}
                className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${status === v ? "border-primary bg-secondary text-foreground" : "border-border bg-card text-muted-foreground"}`}>{r}</button>
            ))}
          </div>
        </div>
        {conta && !conta.ok && (
          <p role="status" className="mx-4 mt-3 rounded-md border border-destructive px-3 py-2 text-[12.5px] font-semibold text-destructive sm:mx-6">ClickSign indisponível: {conta.mensagem}. Dá para gerar o PDF; o envio volta quando o servidor estiver configurado.</p>
        )}
        {resultado?.erroEnvio && (
          <p role="alert" className="mx-4 mt-3 rounded-md border border-destructive px-3 py-2 text-[12.5px] font-semibold text-destructive sm:mx-6">Contrato salvo, mas o envio falhou: {resultado.erroEnvio}</p>
        )}
        <div className="px-4 py-4 sm:px-6">
          {lista === null && <p className="text-[13px] text-muted-foreground">Carregando…</p>}
          {lista?.length === 0 && (
            <div className="rounded-md border border-dashed border-border bg-card px-4 py-8 text-center">
              <p className="text-[14px] font-semibold">Nenhum contrato aqui.</p>
              <p className="mt-1 text-[12px] text-muted-foreground">Use “Novo contrato” ou o botão “Gerar contrato” na ficha da oportunidade.</p>
            </div>
          )}
          {!!lista?.length && (
            <ul className="divide-y divide-border rounded-md border border-border bg-card">
              {lista.map((c) => (
                <li key={c.id}>
                  <button onClick={() => setAberto(c.id)} aria-current={aberto === c.id}
                    className={`flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 border-l-[3px] px-4 py-3 text-left hover:bg-background ${aberto === c.id ? "border-l-laranja bg-background" : "border-l-transparent"}`}>
                    <span className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                      <span className="block truncate text-[14px] font-bold">{c.nomeFantasia || c.razaoSocial}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {ROTULO_MODELO[c.modelo] ?? c.modelo}{c.plano ? ` · ${c.plano}` : ""}{c.oportunidade ? ` · ${c.oportunidade.nome}` : ""}{c.provedor !== "clicksign" ? " · ZapSign (importado)" : ""}
                      </span>
                    </span>
                    <span className="flex-1 text-[12px] sm:flex-none sm:text-right">
                      <span className="block font-bold">{c.valor !== null ? `${reais(c.valor)}/mês` : "—"}</span>
                      <span className="block text-muted-foreground">{c.assinadoEm ? `Assinado em ${data(c.assinadoEm)}` : c.enviadoEm ? `Enviado em ${data(c.enviadoEm)}` : `Gerado em ${data(c.criadoEm)}`}</span>
                    </span>
                    <StatusContrato status={c.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {aberto && (
        <aside className="w-full border-l border-border lg:w-[460px] lg:flex-none">
          <FichaContrato id={aberto} emailContratadaPadrao={emailContratada} onFechar={() => { setAberto(null); limparUrl(); }} onGerarDeNovo={gerarDeNovo} onMudou={recarregar} />
        </aside>
      )}
      {resultado && !resultado.erroEnvio && aberto === resultado.id && (
        <p role="status" className="sr-only">{resultado.status === "ENVIADO" ? "Contrato gerado e enviado para assinatura." : "Contrato gerado."}</p>
      )}
    </div>
  );
}

export default function ContratosPage() {
  return <Suspense fallback={<p className="p-6 text-[13px] text-muted-foreground">Carregando…</p>}><Contratos /></Suspense>;
}
