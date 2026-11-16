// Proposta pública: o cliente lê, baixa em PDF (impressão do navegador) e aceita ou recusa. Sem login.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Logo } from "@/components/ui/logo";
import { codigoProposta, propostaPublica, vencida, type ItemProposta } from "@/lib/comercial/propostas/servico";
import { RespostaProposta } from "./resposta";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Proposta Avanteza", robots: { index: false, follow: false } };

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (d: Date | null) => (d ? d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "long", year: "numeric" }) : "");

export default async function PropostaPublica({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const p = await propostaPublica(token);
  if (!p) notFound();
  const itens = p.itens as unknown as ItemProposta[];
  const unico = Number(p.valorUnico), mensal = Number(p.valorMensal);
  const expirou = p.status === "ENVIADA" && vencida(p);
  const op = p.oportunidade;

  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground print:bg-card print:py-0 sm:py-12">
      <article className="mx-auto max-w-[780px] rounded-md border border-border bg-card p-6 print:max-w-none print:border-0 print:rounded-none print:p-0 sm:p-10">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
          <Logo className="text-[26px] text-foreground" />
          <div className="text-[12px] text-muted-foreground sm:text-right">
            <p className="font-semibold text-foreground">Proposta {codigoProposta(p)}</p>
            {p.enviadaEm && <p>Enviada em {dia(p.enviadaEm)}</p>}
            {p.validaAte && <p>Válida até {dia(p.validaAte)}</p>}
          </div>
        </header>

        {p.status !== "ENVIADA" || expirou ? (
          <p role="status" className={`mt-6 rounded-md px-4 py-3 text-[14px] font-semibold print:hidden ${p.status === "ACEITA" ? "bg-primary text-primary-foreground" : "bg-laranja text-marinho"}`}>
            {p.status === "ACEITA" ? `Proposta aceita por ${p.respostaNome} em ${dia(p.respondidaEm)}. Obrigado! Vamos entrar em contato para começar.`
              : p.status === "RECUSADA" ? `Proposta recusada por ${p.respostaNome} em ${dia(p.respondidaEm)}.`
              : p.status === "OBSOLETA" ? "Esta versão foi substituída por uma mais nova. Peça o link atualizado ao seu consultor."
              : "A validade desta proposta terminou. Fale com o seu consultor para renová-la."}
          </p>
        ) : null}

        <h1 className="mt-8 font-titulo text-[26px] font-extrabold leading-tight tracking-tight sm:text-[32px]">{p.titulo}</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">Para {op.contato.nome}{op.pessoa ? ` · aos cuidados de ${op.pessoa.nome}` : ""}</p>
        <div className="mt-6 whitespace-pre-line text-[15px] leading-relaxed">{p.introducao}</div>

        <h2 className="mt-10 font-titulo text-[18px] font-extrabold">Investimento</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead><tr className="border-b-2 border-primary text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              <th className="py-2 pr-2 font-semibold">Item</th><th className="hidden px-2 py-2 text-right font-semibold sm:table-cell">Qtd.</th><th className="hidden px-2 py-2 text-right font-semibold sm:table-cell">Valor</th><th className="py-2 pl-2 text-right font-semibold">Total</th>
            </tr></thead>
            <tbody>
              {itens.map((i, n) => (
                <tr key={n} className="border-b border-border">
                  <td className="py-3 pr-2 font-semibold">{i.nome}<span className="block text-[12px] font-normal text-muted-foreground"><span className="sm:hidden">{i.quantidade.toLocaleString("pt-BR")} × {reais(i.valorUnitario)} · </span>{i.recorrencia === "MENSAL" ? "Mensal" : "Pagamento único"}{i.desconto ? ` · ${i.desconto.toLocaleString("pt-BR")}% de desconto` : ""}</span></td>
                  <td className="hidden px-2 py-3 text-right tabular-nums sm:table-cell">{i.quantidade.toLocaleString("pt-BR")}</td>
                  <td className="hidden px-2 py-3 text-right tabular-nums sm:table-cell">{reais(i.valorUnitario)}</td>
                  <td className="py-3 pl-2 text-right font-semibold tabular-nums">{reais(i.total)}{i.recorrencia === "MENSAL" ? "/mês" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-3">
          {unico > 0 && <div className="rounded-md border border-border px-4 py-3 text-right"><span className="block text-[11px] uppercase tracking-[0.06em] text-muted-foreground">Valor único</span><b className="font-titulo text-[22px] font-extrabold tabular-nums">{reais(unico)}</b></div>}
          {mensal > 0 && <div className="rounded-md bg-primary px-4 py-3 text-right text-primary-foreground print:border print:border-primary print:bg-card print:text-foreground"><span className="block text-[11px] uppercase tracking-[0.06em] opacity-90">Mensal</span><b className="font-titulo text-[22px] font-extrabold tabular-nums">{reais(mensal)}</b></div>}
        </div>

        {p.condicoes.trim() && (<>
          <h2 className="mt-10 font-titulo text-[18px] font-extrabold">Condições</h2>
          <div className="mt-3 whitespace-pre-line text-[14px] leading-relaxed">{p.condicoes}</div>
        </>)}

        <footer className="mt-10 border-t border-border pt-6 text-[13px] text-muted-foreground">
          {op.responsavel && <p>Consultor: <span className="font-semibold text-foreground">{op.responsavel.name}</span> · <span className="select-all">{op.responsavel.email}</span></p>}
          <p className="mt-1">Avanteza Consultoria e Estratégia</p>
        </footer>

        <RespostaProposta token={token} aberta={p.status === "ENVIADA" && !expirou} />
      </article>
    </main>
  );
}
