"use client";

// Aba "Conversa" da ficha: as mensagens do WhatsApp do Lead (direto do Vendedor IA) e as importadas no CRM antigo,
// com o atalho para abrir a conversa na tela de Conversas.
import { useCallback, useEffect, useState } from "react";
import { dataHora } from "@/lib/comercial/formatar";
import { apiUrl } from "@/lib/api-url";

interface MensagemDTO { id: string; autor: string; deMim: boolean; texto: string; enviadaEm: string; origem: string }

export function AbaConversa({ oportunidadeId }: { oportunidadeId: string }) {
  const [msgs, setMsgs] = useState<MensagemDTO[] | null>(null);
  const [href, setHref] = useState<string | null>(null);
  const carregar = useCallback(async () => {
    const r = await fetch(apiUrl(`/api/comercial/oportunidades/${oportunidadeId}/conversa`));
    if (!r.ok) { setMsgs([]); return; }
    const j = (await r.json()) as { mensagens: MensagemDTO[]; conversaHref: string | null };
    setMsgs(j.mensagens);
    setHref(j.conversaHref);
  }, [oportunidadeId]);
  useEffect(() => { setMsgs(null); void carregar(); }, [carregar]);

  return (
    <div className="px-5 pb-8 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted-foreground">Mensagens do WhatsApp deste lead. Para responder, abra a conversa.</p>
        {href && <a href={href} className="rounded-md bg-primary px-3 py-1.5 text-[12px] font-bold text-primary-foreground">Abrir a conversa →</a>}
      </div>
      <ol className="mt-4 space-y-2">
        {msgs === null && <li className="text-[12px] text-muted-foreground">Carregando…</li>}
        {msgs?.length === 0 && <li className="text-[12px] text-muted-foreground">Nenhuma mensagem ainda.</li>}
        {msgs?.map((m) => (
          <li key={m.id} className={`max-w-[85%] rounded-md px-3 py-2 ${m.deMim ? "ml-auto bg-secondary" : "border border-border bg-background"}`}>
            <p className="text-[11px] font-semibold text-muted-foreground">{m.autor} · {dataHora(m.enviadaEm)}{m.origem === "ARQUIVO" ? " · importada" : ""}</p>
            <p className="whitespace-pre-wrap text-[13px]">{m.texto}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
