"use client";

// Formulário de contrato: porta do painel "Fechar o contrato agora" do app Contratos (contratos/index.html), com os
// mesmos campos, máscara e consulta de CNPJ, cartões de modelo/plano/2º pagamento, vencimento automático e
// garantia. Sem PIN, sem localStorage e sem ZapSign: o histórico mora no servidor e só ele fala com a ClickSign.
import { useEffect, useMemo, useState } from "react";
import { apiUrl } from "@/lib/api-url";
import { camposFaltando, type FormContrato } from "@/lib/comercial/contratos/modelo";
import { PLANOS_FORM, fmtBRL } from "@/lib/comercial/contratos/pdf";

export const FORM_VAZIO: FormContrato = {
  modelo: "growth", plano: "ESCALE", preco: "1.997,90", pgto2: "45", cnpj: "", razao: "", fantasia: "", rep: "", email: "", whats: "",
  end: "", inicio: "", duracao: "12", venc: "", marca: "avanteza", renov: "", garantia: false,
};

function maskCNPJ(v: string) {
  v = v.replace(/\D/g, "").slice(0, 14);
  if (v.length > 12) return v.slice(0, 2) + "." + v.slice(2, 5) + "." + v.slice(5, 8) + "/" + v.slice(8, 12) + "-" + v.slice(12);
  if (v.length > 8) return v.slice(0, 2) + "." + v.slice(2, 5) + "." + v.slice(5, 8) + "/" + v.slice(8);
  if (v.length > 5) return v.slice(0, 2) + "." + v.slice(2, 5) + "." + v.slice(5);
  if (v.length > 2) return v.slice(0, 2) + "." + v.slice(2);
  return v;
}

function validCNPJ(c: string) {
  c = c.replace(/\D/g, "");
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = (n: number) => {
    const w = n === 1 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let s = 0;
    for (let i = 0; i < w.length; i++) s += parseInt(c[i]) * w[i];
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(1) === parseInt(c[12]) && calc(2) === parseInt(c[13]);
}

const hoje = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
/** Vencimento mensal = dia do 2º pagamento (syncVenc do app antigo). */
const diaDoVencimento = (inicio: string, pgto2: string) => { if (!inicio) return ""; const d = new Date(inicio + "T00:00:00"); d.setDate(d.getDate() + (parseInt(pgto2, 10) || 45)); return String(d.getDate()); };

const rotulo = "mb-1 block text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground";
const entrada = "w-full rounded-md border border-border bg-card px-3 py-2.5 text-[14px] text-foreground focus:border-laranja focus:outline-none focus:ring-2 focus:ring-laranja";
const secao = "mb-3 mt-6 border-l-[3px] border-laranja pl-2.5 text-[12px] font-extrabold uppercase tracking-[0.1em] text-foreground";
const cartao = (sel: boolean) => `relative flex cursor-pointer flex-col gap-1 rounded-md border px-4 py-3 text-left ${sel ? "border-laranja bg-secondary" : "border-border bg-card hover:border-laranja"}`;

export interface ResultadoGerado { id: string; status: string; aviso?: string | null; erroEnvio?: string | null; notificado?: boolean }

export function FormularioContrato({ inicial, oportunidadeId, contatoId, substitui, emailContratadaPadrao, onGerado, onCancelar }: {
  inicial?: Partial<FormContrato>;
  oportunidadeId?: string | null;
  contatoId?: string | null;
  /** "Gerar de novo"/editar: a nova versão substitui esta. */
  substitui?: { id: string; filename: string; enviado: boolean } | null;
  emailContratadaPadrao?: string;
  onGerado: (r: ResultadoGerado) => void;
  onCancelar?: () => void;
}) {
  const [f, setF] = useState<FormContrato>(() => ({ ...FORM_VAZIO, inicio: hoje(), ...inicial }));
  const [cnpjSt, setCnpjSt] = useState<{ tipo: "" | "ok" | "err"; msg: string }>({ tipo: "", msg: "" });
  const [canal, setCanal] = useState<"email" | "whatsapp">("email");
  const [enviarAuto, setEnviarAuto] = useState(true);
  const [emailContratada, setEmailContratada] = useState(emailContratadaPadrao ?? "");
  const [cancelarAnterior, setCancelarAnterior] = useState(true);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const set = <K extends keyof FormContrato>(k: K, v: FormContrato[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => { if (emailContratadaPadrao && !emailContratada) setEmailContratada(emailContratadaPadrao); }, [emailContratadaPadrao]); // eslint-disable-line react-hooks/exhaustive-deps
  // Vencimento automático (segue o 2º pagamento).
  useEffect(() => { const v = diaDoVencimento(f.inicio, f.pgto2); if (v && v !== f.venc) set("venc", v); }, [f.inicio, f.pgto2]); // eslint-disable-line react-hooks/exhaustive-deps

  // Consulta de CNPJ (meio segundo depois do último dígito).
  useEffect(() => {
    const raw = f.cnpj.replace(/\D/g, "");
    if (raw.length !== 14) { setCnpjSt({ tipo: "", msg: "" }); return; }
    if (!validCNPJ(raw)) { setCnpjSt({ tipo: "err", msg: "CNPJ inválido: verifique os dígitos" }); return; }
    if (inicial?.cnpj && inicial.cnpj.replace(/\D/g, "") === raw && f.razao) return; // veio preenchido
    setCnpjSt({ tipo: "", msg: "Consultando Receita Federal…" });
    let vivo = true;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(apiUrl(`/api/comercial/cnpj?cnpj=${raw}`));
        const d = await r.json();
        if (!vivo) return;
        if (!r.ok || d.erro) { setCnpjSt({ tipo: "err", msg: d.erro || "Não encontrado na Receita Federal" }); return; }
        const qsa = Array.isArray(d.qsa) ? d.qsa : [];
        const adm = qsa.find((q: Record<string, string>) => /adm|sócio/i.test(q.qualificacao_socio || q.qual || "")) || qsa[0];
        setF((x) => ({
          ...x, razao: d.razao_social || x.razao, fantasia: d.nome_fantasia || x.fantasia,
          end: [d.logradouro, d.numero, d.complemento, d.bairro, d.municipio, d.uf].filter(Boolean).join(", ") || d.endereco_completo || x.end,
          rep: x.rep || (adm ? adm.nome_socio || adm.nome || "" : ""),
        }));
        setCnpjSt({ tipo: "ok", msg: `✓ ${d.razao_social}` });
      } catch { if (vivo) setCnpjSt({ tipo: "err", msg: "Erro ao consultar. Verifique a conexão." }); }
    }, 500);
    return () => { vivo = false; clearTimeout(t); };
  }, [f.cnpj]); // eslint-disable-line react-hooks/exhaustive-deps

  const falta = useMemo(() => camposFaltando(f), [f]);

  async function gerar() {
    setErro(null);
    if (falta.length) { setErro(`Preencha: ${falta.join(", ")}`); return; }
    const tel = f.whats.replace(/\D/g, "");
    if (enviarAuto) {
      if (canal === "whatsapp" && tel.length < 10) { setErro("Para enviar por WhatsApp, preencha o WhatsApp do cliente."); return; }
      if (canal === "email" && !f.email) { setErro("Para enviar por e-mail, preencha o e-mail do cliente."); return; }
    }
    setGerando(true);
    try {
      const form = { ...f, preco: fmtBRL(f.preco) || f.preco };
      const { gerarPDFAvanteza } = await import("@/lib/comercial/contratos/pdf");
      const pdf = await gerarPDFAvanteza(form);
      // Baixa uma cópia, como o app antigo fazia.
      const a = document.createElement("a");
      a.href = URL.createObjectURL(pdf.blob); a.download = pdf.filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      const r = await fetch(apiUrl("/api/comercial/contratos"), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          form, base64_pdf: pdf.base64, oportunidadeId: oportunidadeId ?? null, contatoId: contatoId ?? null, substituiId: substitui?.id ?? null,
          enviar: enviarAuto ? { canal, emailContratada: emailContratada.trim(), cancelarAnterior } : false,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.erro || `Erro ${r.status}`); return; }
      onGerado({ id: j.contrato.id, status: j.contrato.status, aviso: j.aviso ?? null, erroEnvio: j.erroEnvio ?? null, notificado: j.notificado });
    } catch (e) {
      console.error(e);
      setErro("Erro ao gerar o PDF. Tente novamente.");
    } finally {
      setGerando(false);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void gerar(); }} className="mx-auto w-full max-w-[860px] pb-10" aria-label="Novo contrato">
      {substitui && (
        <div className="mb-4 rounded-md border border-border bg-secondary px-4 py-3 text-[13px]">
          <p><b>Nova versão de:</b> {substitui.filename}</p>
          {substitui.enviado && (
            <label className="mt-1.5 flex items-center gap-2 font-medium">
              <input type="checkbox" checked={cancelarAnterior} onChange={(e) => setCancelarAnterior(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--laranja))]" />
              Cancelar a versão anterior na ClickSign ao enviar a nova
            </label>
          )}
        </div>
      )}

      <div className={secao} style={{ marginTop: 0 }}>Modelo de contrato</div>
      <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="Modelo de contrato">
        {([["growth", "Growth Engine®", "Gestão de canais em marketplaces + publicidade (Ads) e consultoria"], ["barbearia", "Barbearia", "Tráfego pago + gestão de mídias sociais + produção de vídeos"]] as const).map(([v, n, d]) => (
          <button type="button" role="radio" aria-checked={f.modelo === v} key={v} onClick={() => set("modelo", v)} className={cartao(f.modelo === v)}>
            <span className="text-[13px] font-bold">{n}</span><span className="text-[11.5px] text-muted-foreground">{d}</span>
          </button>
        ))}
      </div>

      <label className="mt-4 block">
        <span className={rotulo}>Marca da contratada no contrato</span>
        <select value={f.marca} onChange={(e) => set("marca", e.target.value)} className={entrada}>
          <option value="avanteza">Avanteza Consultoria e Estratégia</option>
          <option value="nexo">Nexo Consultoria &amp; Growth</option>
        </select>
      </label>

      <div className={secao}>2º pagamento (após a assinatura)</div>
      <div className="grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="Dias até o 2º pagamento">
        {["30", "45", "60"].map((d) => (
          <button type="button" role="radio" aria-checked={f.pgto2 === d} key={d} onClick={() => set("pgto2", d)} className={`${cartao(f.pgto2 === d)} items-center`}>
            <span className="text-[22px] font-extrabold tabular-nums">{d}</span><span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">dias</span>
          </button>
        ))}
      </div>

      <div className={secao}>Dados do cliente</div>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <label className="block">
          <span className={rotulo}>CNPJ do cliente</span>
          <input value={f.cnpj} onChange={(e) => set("cnpj", maskCNPJ(e.target.value))} placeholder="00.000.000/0001-00" maxLength={18} autoComplete="off" className={entrada} />
          <span role="status" className={`mt-1 block min-h-[16px] text-[11px] ${cnpjSt.tipo === "err" ? "text-destructive" : "text-muted-foreground"}`}>{cnpjSt.msg}</span>
        </label>
        <label className="block"><span className={rotulo}>Razão social</span><input value={f.razao} onChange={(e) => set("razao", e.target.value)} placeholder="Preenchido automaticamente" className={entrada} /></label>
        <label className="block"><span className={rotulo}>Nome fantasia</span><input value={f.fantasia} onChange={(e) => set("fantasia", e.target.value)} placeholder="Preenchido automaticamente" className={entrada} /></label>
        <label className="block"><span className={rotulo}>Representante legal</span><input value={f.rep} onChange={(e) => set("rep", e.target.value)} placeholder="Nome completo do sócio" className={entrada} /></label>
        <label className="block"><span className={rotulo}>E-mail</span><input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="contato@empresa.com.br" className={entrada} /></label>
        <label className="block"><span className={rotulo}>WhatsApp</span><input value={f.whats} onChange={(e) => set("whats", e.target.value)} placeholder="(62) 99999-9999" className={entrada} /></label>
      </div>
      <label className="mt-3.5 block"><span className={rotulo}>Endereço completo</span><input value={f.end} onChange={(e) => set("end", e.target.value)} placeholder="Preenchido automaticamente pelo CNPJ" className={entrada} /></label>

      {f.modelo !== "barbearia" && (
        <>
          <div className={secao}>Plano contratado</div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="radiogroup" aria-label="Plano">
            {PLANOS_FORM.map((p) => (
              <button type="button" role="radio" aria-checked={f.plano === p.valor} key={p.valor}
                onClick={() => setF((x) => ({ ...x, plano: p.valor, preco: p.preco, renov: "renov" in p ? p.renov : "" }))} className={cartao(f.plano === p.valor)}>
                {"popular" in p && <span className="absolute -top-2.5 left-3 rounded-full bg-primary px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-primary-foreground">Mais escolhido</span>}
                <span className="text-[14px] font-bold">{p.valor}</span>
                <span className="text-[22px] font-extrabold leading-none tabular-nums">{p.rotulo}<sub className="text-[10px] font-normal text-muted-foreground">/mês</sub></span>
                <span className="text-[11.5px] text-muted-foreground">{p.desc}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
        <label className="block"><span className={rotulo}>Valor mensal negociado (R$)</span>
          <input value={f.preco} onChange={(e) => set("preco", e.target.value)} onBlur={() => { const v = fmtBRL(f.preco); if (v) set("preco", v); }} placeholder="Ex: 2.500,00" autoComplete="off" inputMode="decimal" className={entrada} /></label>
        <label className="block"><span className={rotulo}>Valor mensal na renovação (R$, opcional)</span>
          <input value={f.renov} onChange={(e) => set("renov", e.target.value)} placeholder="Ex: 2.799,99" autoComplete="off" inputMode="decimal" className={entrada} /></label>
      </div>

      <div className={secao}>Vigência e pagamento</div>
      <div className="grid gap-3.5 sm:grid-cols-3">
        <label className="block"><span className={rotulo}>Data de início</span><input type="date" value={f.inicio} onChange={(e) => set("inicio", e.target.value)} className={entrada} /></label>
        <label className="block"><span className={rotulo}>Duração (meses)</span><input type="number" min={1} max={60} value={f.duracao} onChange={(e) => set("duracao", e.target.value)} className={entrada} /></label>
        <label className="block"><span className={rotulo}>Vencimento mensal (dia)</span><input type="number" readOnly value={f.venc} title="O vencimento mensal segue o dia do 2º pagamento" className={`${entrada} bg-secondary text-muted-foreground`} /></label>
      </div>
      <label className="mt-3.5 flex items-start gap-2.5 text-[13px] font-semibold">
        <input type="checkbox" checked={f.garantia} onChange={(e) => set("garantia", e.target.checked)} className="mt-0.5 h-4 w-4 flex-none accent-[hsl(var(--laranja))]" />
        Incluir Garantia de Execução: restituição integral dos valores pagos se não houver nenhuma venda durante a vigência
      </label>

      <div className={secao}>Assinatura eletrônica (ClickSign)</div>
      <label className="flex items-center gap-2.5 text-[13px] font-semibold">
        <input type="checkbox" checked={enviarAuto} onChange={(e) => setEnviarAuto(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--laranja))]" />
        Enviar para assinatura ao gerar
      </label>
      {enviarAuto && (
        <div className="mt-3 grid gap-3.5 sm:grid-cols-2">
          <label className="block"><span className={rotulo}>Enviar ao cliente por</span>
            <select value={canal} onChange={(e) => setCanal(e.target.value === "whatsapp" ? "whatsapp" : "email")} className={entrada}><option value="email">E-mail</option><option value="whatsapp">WhatsApp</option></select></label>
          <label className="block"><span className={rotulo}>E-mail da contratada (assina como CONTRATADA)</span>
            <input type="email" value={emailContratada} onChange={(e) => setEmailContratada(e.target.value)} placeholder="seu@email.com" className={entrada} /></label>
        </div>
      )}

      {erro && <p role="alert" className="mt-4 rounded-md border border-destructive px-3 py-2 text-[13px] font-semibold text-destructive">{erro}</p>}
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <button type="submit" disabled={gerando || falta.length > 0} className="min-h-[48px] flex-1 rounded-md bg-laranja px-5 text-[15px] font-extrabold text-marinho hover:bg-laranja/90 disabled:bg-secondary disabled:text-muted-foreground">
          {gerando ? "Gerando…" : enviarAuto ? "Gerar contrato e enviar para assinatura" : "Gerar contrato PDF"}
        </button>
        {onCancelar && <button type="button" onClick={onCancelar} className="min-h-[48px] rounded-md border border-border px-5 text-[14px] font-bold">Cancelar</button>}
      </div>
      <p className="mt-2 text-center text-[11.5px] text-muted-foreground">
        {falta.length ? `Falta: ${falta.join(", ")}` : "O PDF é baixado e fica guardado no histórico do contrato."}
      </p>
    </form>
  );
}
