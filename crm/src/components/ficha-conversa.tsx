"use client";

// Aba "Conversa" da ficha: mensagens do WhatsApp trazidas pela extensão ou pelo arquivo "Exportar conversa".
import { useCallback, useEffect, useRef, useState } from "react";
import { dataHora } from "@/lib/formatar";
import { lerArquivoWhatsapp, type MensagemLida } from "@/lib/conversas/arquivo";
import { botaoPrimario, botaoSecundario, campo, Dialogo } from "./dialogo";

interface MensagemDTO { id: string; autor: string; deMim: boolean; texto: string; enviadaEm: string; origem: string }

export function AbaConversa({ oportunidadeId, contatoId, onAtividade }: { oportunidadeId: string; contatoId: string; onAtividade: () => void }) {
  const [msgs, setMsgs] = useState<MensagemDTO[] | null>(null);
  const [arquivo, setArquivo] = useState<{ mensagens: MensagemLida[]; autores: string[] } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const carregar = useCallback(async () => {
    const r = await fetch(`/api/oportunidades/${oportunidadeId}/conversa`);
    if (r.ok) setMsgs((await r.json()).mensagens);
  }, [oportunidadeId]);
  useEffect(() => { setMsgs(null); void carregar(); }, [carregar]);

  const escolherArquivo = async (f: File | undefined) => {
    if (!f) return;
    const lido = lerArquivoWhatsapp(await f.text());
    if (lido.mensagens.length === 0) { setAviso("Não encontrei mensagens nesse arquivo. Use o .txt do “Exportar conversa” (sem mídia)."); return; }
    setAviso(null); setArquivo(lido);
  };

  return (
    <div className="px-5 pb-8 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className={botaoSecundario} onClick={() => entrada.current?.click()}>Importar conversa exportada (.txt)</button>
        <input ref={entrada} type="file" accept=".txt,text/plain" className="hidden" onChange={(e) => { void escolherArquivo(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      <p className="mt-2 text-[12px] text-cinza">Pelo WhatsApp Web, a extensão do CRM envia a conversa aberta com um clique (Configuração → Extensão do WhatsApp). O agente lê o trecho novo e sugere combinados.</p>
      {aviso && <p role="status" className="mt-2 text-[13px] font-semibold text-grafite">{aviso}</p>}
      <ol className="mt-4 space-y-2">
        {msgs === null && <li className="text-[12px] text-cinza">Carregando…</li>}
        {msgs?.length === 0 && <li className="text-[12px] text-cinza">Nenhuma conversa importada ainda.</li>}
        {msgs?.map((m) => (
          <li key={m.id} className={`max-w-[85%] rounded-xl px-3 py-2 ${m.deMim ? "ml-auto bg-azul-8" : "bg-bq"}`}>
            <p className="text-[11px] font-semibold text-cinza">{m.deMim ? "Você" : m.autor} · {dataHora(m.enviadaEm)}</p>
            <p className="whitespace-pre-wrap text-[13px]">{m.texto}</p>
          </li>
        ))}
      </ol>
      {arquivo && <ConfirmarArquivo lido={arquivo} contatoId={contatoId} onFechar={() => setArquivo(null)} onImportado={async (n) => { setArquivo(null); setAviso(n === 0 ? "Essas mensagens já estavam importadas." : `${n} mensagem(ns) nova(s) importada(s). O agente vai ler e sugerir combinados.`); await carregar(); onAtividade(); }} />}
    </div>
  );
}

function ConfirmarArquivo({ lido, contatoId, onFechar, onImportado }: { lido: { mensagens: MensagemLida[]; autores: string[] }; contatoId: string; onFechar: () => void; onImportado: (novas: number) => void }) {
  const [eu, setEu] = useState(lido.autores[0] ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const de = lido.mensagens[0]?.em, ate = lido.mensagens[lido.mensagens.length - 1]?.em;
  return (
    <Dialogo titulo="Importar conversa" onFechar={onFechar}>
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault(); setEnviando(true); setErro(null);
        const mensagens = lido.mensagens.slice(-2000).map((m) => ({ autor: m.autor, deMim: m.autor === eu, texto: m.texto, em: m.em }));
        const r = await fetch("/api/conversas/importar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contatoId, mensagens }) });
        setEnviando(false);
        if (r.ok) onImportado((await r.json()).novas); else setErro(((await r.json().catch(() => null)) as { erro?: string } | null)?.erro ?? "Não foi possível importar");
      }}>
        <p className="text-[13px]">{lido.mensagens.length} mensagens{de && ate ? `, de ${dataHora(de)} a ${dataHora(ate)}` : ""}.{lido.mensagens.length > 2000 && " Só as 2000 mais recentes entram."}</p>
        <label className="block"><span className="mb-1 block text-[12px] font-semibold text-cinza">Quem é você nesta conversa?</span>
          <select value={eu} onChange={(e) => setEu(e.target.value)} className={campo}>{lido.autores.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
        {erro && <p role="alert" className="text-[13px] font-semibold text-critico">{erro}</p>}
        <div className="flex justify-end gap-2"><button type="button" className={botaoSecundario} onClick={onFechar}>Cancelar</button><button type="submit" className={botaoPrimario} disabled={enviando || !eu}>{enviando ? "Importando…" : "Importar"}</button></div>
      </form>
    </Dialogo>
  );
}
