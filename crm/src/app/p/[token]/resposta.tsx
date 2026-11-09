"use client";

import { useEffect, useState } from "react";

/** Aceitar ou recusar, e baixar em PDF (impressão do navegador). Avisa o CRM que o cliente abriu. */
export function RespostaProposta({ token, aberta }: { token: string; aberta: boolean }) {
  const [escolha, setEscolha] = useState<"aceitar" | "recusar" | null>(null);
  const [nome, setNome] = useState("");
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  useEffect(() => { void fetch(`/api/publico/propostas/${token}/visita`, { method: "POST" }).catch(() => {}); }, [token]);

  const responder = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true); setErro(null);
    const r = await fetch(`/api/publico/propostas/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ aceitar: escolha === "aceitar", nome, comentario }) });
    const j = (await r.json().catch(() => ({}))) as { erro?: string; status?: string };
    setEnviando(false);
    if (!r.ok) { setErro(j.erro ?? "Não foi possível registrar sua resposta. Tente de novo."); return; }
    setFeito(j.status === "ACEITA" ? "Proposta aceita. Obrigado! Seu consultor já foi avisado e vai entrar em contato para começar." : "Resposta registrada. Obrigado pelo retorno; seu consultor foi avisado.");
  };

  const botao = "rounded-[10px] px-5 py-3 text-[14px] font-bold";
  return (
    <div className="mt-8 space-y-4 print:hidden">
      {feito ? (
        <p role="status" className="rounded-xl bg-azul px-4 py-3 text-[14px] font-semibold text-bq">{feito}</p>
      ) : aberta && (
        <>
          {!escolha ? (
            <div className="flex flex-wrap gap-3">
              <button onClick={() => setEscolha("aceitar")} className={`${botao} bg-azul text-bq`}>Aceitar proposta</button>
              <button onClick={() => setEscolha("recusar")} className={`${botao} border border-linha`}>Recusar</button>
            </div>
          ) : (
            <form onSubmit={responder} className="space-y-3 rounded-xl border border-linha p-4">
              <p className="font-semibold">{escolha === "aceitar" ? "Confirme o aceite" : "Conte por que não serve agora (opcional)"}</p>
              <label className="block text-[13px]"><span className="mb-1 block text-cinza">Seu nome</span>
                <input id="resposta-nome" required minLength={2} maxLength={120} value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" className="w-full rounded-[10px] border border-linha bg-superficie px-3 py-2.5 text-[14px]" /></label>
              <label className="block text-[13px]"><span className="mb-1 block text-cinza">Comentário {escolha === "aceitar" ? "(opcional)" : ""}</span>
                <textarea id="resposta-comentario" rows={3} maxLength={2000} value={comentario} onChange={(e) => setComentario(e.target.value)} className="w-full rounded-[10px] border border-linha bg-superficie px-3 py-2.5 text-[14px]" /></label>
              {erro && <p role="alert" className="text-[13px] font-semibold text-critico">{erro}</p>}
              <div className="flex flex-wrap gap-3">
                <button type="submit" disabled={enviando} className={`${botao} ${escolha === "aceitar" ? "bg-azul text-bq" : "bg-grafite text-bq"} disabled:opacity-50`}>{enviando ? "Enviando…" : escolha === "aceitar" ? "Confirmar aceite" : "Enviar recusa"}</button>
                <button type="button" onClick={() => setEscolha(null)} className={`${botao} border border-linha`}>Voltar</button>
              </div>
            </form>
          )}
        </>
      )}
      <button onClick={() => window.print()} className="text-[13px] font-bold text-azul underline-offset-2 hover:underline">Baixar em PDF</button>
    </div>
  );
}
