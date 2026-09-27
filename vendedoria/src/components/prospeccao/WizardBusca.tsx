"use client";

// Assistente de busca em 3 passos: O quê (segmentos) → Onde (cidades) → Ajustes.
// Serve para criar, editar e duplicar uma busca.

import React, { useState } from "react";
import { X, Loader2, ChevronLeft, ChevronRight, Check, Store, MapPin, SlidersHorizontal } from "lucide-react";
import { api, fmtNum, type Busca } from "./api";
import { btn, inputCls, useAviso } from "./ui";
import { useExecucoes } from "./execucoes";

const SEGMENTOS_SUGERIDOS: Array<[string, string[]]> = [
  ["Moda e beleza", ["Loja de roupa", "Moda feminina", "Calçados", "Loja de cosméticos", "Perfumaria", "Salão de beleza", "Barbearia", "Clínica de estética"]],
  ["Saúde e bem-estar", ["Academia", "Studio de pilates", "Clínica odontológica", "Clínica médica", "Farmácia", "Ótica", "Petshop", "Clínica veterinária"]],
  ["Alimentação", ["Restaurante", "Lanchonete", "Pizzaria", "Cafeteria", "Padaria"]],
  ["Casa e automotivo", ["Loja de móveis", "Loja de decoração", "Material de construção", "Auto peças", "Oficina mecânica", "Lava jato", "Loja de celular"]],
  ["Serviços", ["Imobiliária", "Escritório de contabilidade", "Escola de idiomas", "Curso profissionalizante", "Advocacia", "Corretora de seguros", "Gráfica"]],
];

const CIDADES_SUGERIDAS = [
  "Goiânia", "Aparecida de Goiânia", "Anápolis", "Rio Verde", "Trindade",
  "Senador Canedo", "Catalão", "Itumbiara", "Jataí", "Luziânia",
  "Brasília", "Uberlândia", "Uberaba",
];

const PASSOS = [
  { titulo: "O quê", desc: "Tipos de empresa", icon: Store },
  { titulo: "Onde", desc: "Cidades", icon: MapPin },
  { titulo: "Ajustes", desc: "Filtros e revisão", icon: SlidersHorizontal },
];

export function WizardBusca({ orgId, editar, duplicar, onClose, onSalvo }: {
  orgId: string;
  editar?: Busca;
  duplicar?: Busca;
  onClose: () => void;
  onSalvo: (id: string, criado: boolean) => void;
}) {
  const base = editar ?? duplicar;
  const avisar = useAviso();
  const { executar } = useExecucoes();

  const [passo, setPasso] = useState(0);
  const [segmentos, setSegmentos] = useState<string[]>(base ? [base.termoBusca, ...base.termosSecundarios] : []);
  const [cidades, setCidades] = useState<string[]>(base?.cidades ?? ["Goiânia"]);
  const [customSeg, setCustomSeg] = useState("");
  const [customCidade, setCustomCidade] = useState("");
  const [nome, setNome] = useState(editar ? editar.nome : duplicar ? `${duplicar.nome} (cópia)` : "");
  const [meta, setMeta] = useState(base?.metaEmpresas ?? 500);
  const [apenasCelular, setApenasCelular] = useState(base?.apenasCelular ?? true);
  const [filtroSite, setFiltroSite] = useState(base?.filtroSite ?? "TODOS");
  const [avancado, setAvancado] = useState(false);
  const [pesos, setPesos] = useState({
    pesoSemSite: base?.pesoSemSite ?? 3,
    pesoSemAnuncioAtivo: base?.pesoSemAnuncioAtivo ?? 2,
    pesoInstagramParado: base?.pesoInstagramParado ?? 1,
    pesoRatingBaixo: base?.pesoRatingBaixo ?? 1,
    limiarScoreQualificado: base?.limiarScoreQualificado ?? 4,
  });
  const [iniciarAgora, setIniciarAgora] = useState(!editar);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const toggle = (lista: string[], set: (v: string[]) => void, v: string) =>
    set(lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);

  const adicionar = (lista: string[], set: (v: string[]) => void, v: string, limpar: () => void) => {
    const t = v.trim();
    if (t && !lista.some((x) => x.toLowerCase() === t.toLowerCase())) set([...lista, t]);
    limpar();
  };

  const nomeAuto = segmentos.length && cidades.length
    ? `${segmentos[0]}${segmentos.length > 1 ? ` +${segmentos.length - 1}` : ""} — ${cidades[0]}${cidades.length > 1 ? ` +${cidades.length - 1}` : ""}`
    : "";
  const combinacoes = segmentos.length * cidades.length;
  const potencial = combinacoes * 60; // Places devolve até ~60 por consulta

  const podeAvancar = passo === 0 ? segmentos.length > 0 : passo === 1 ? cidades.length > 0 : true;

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    const corpo = {
      nome: nome.trim() || nomeAuto,
      termoBusca: segmentos[0],
      termosSecundarios: segmentos.slice(1),
      cidades,
      metaEmpresas: meta,
      apenasCelular,
      filtroSite,
      ...pesos,
    };
    try {
      if (editar) {
        await api(`/api/prospeccao/segmentos/${editar.id}`, { method: "PATCH", json: corpo });
        avisar("Busca atualizada.");
        onSalvo(editar.id, false);
      } else {
        const criada = await api<{ id: string }>("/api/prospeccao/segmentos", {
          method: "POST",
          json: { organizationId: orgId, ...corpo },
        });
        avisar(`Busca "${corpo.nome}" criada.`);
        onSalvo(criada.id, true);
        if (iniciarAgora) void executar(criada.id, "sourcing", corpo.nome);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  };

  const chip = (ativo: boolean) =>
    `px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
      ativo ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent/10 hover:text-foreground"
    }`;

  const extrasSeg = segmentos.filter((s) => !SEGMENTOS_SUGERIDOS.some(([, l]) => l.includes(s)));
  const extrasCid = cidades.filter((c) => !CIDADES_SUGERIDAS.includes(c));

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editar ? "Editar busca" : "Nova busca"}
        className="w-full sm:max-w-2xl max-h-[92dvh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Topo */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {editar ? "Editar busca" : duplicar ? "Duplicar busca" : "Nova busca de empresas"}
            </h2>
            <p className="text-xs text-muted-foreground">Passo {passo + 1} de 3 — {PASSOS[passo].desc}</p>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Indicador de passos */}
        <div className="flex gap-2 px-5 py-3">
          {PASSOS.map((p, i) => {
            const Icon = p.icon;
            const feito = i < passo;
            return (
              <button
                key={p.titulo}
                onClick={() => i < passo && setPasso(i)}
                disabled={i > passo}
                className={`flex-1 flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                  i === passo ? "border-primary bg-primary/5 text-primary" : feito ? "border-border text-foreground" : "border-border text-muted-foreground"
                }`}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${feito ? "bg-green-500 text-white" : "bg-muted"}`}>
                  {feito ? <Check className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
                </span>
                <span className="font-medium truncate">{p.titulo}</span>
              </button>
            );
          })}
        </div>

        {/* Corpo */}
        <div className="flex-1 overflow-auto px-5 pb-4 space-y-4">
          {passo === 0 && (
            <>
              <p className="text-sm text-muted-foreground">
                Que tipo de empresa você quer prospectar? Escolha um ou mais — cada um vira uma pesquisa no Google Maps.
              </p>
              {SEGMENTOS_SUGERIDOS.map(([grupo, lista]) => (
                <div key={grupo}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{grupo}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {lista.map((s) => (
                      <button key={s} type="button" onClick={() => toggle(segmentos, setSegmentos, s)} className={chip(segmentos.includes(s))}>{s}</button>
                    ))}
                  </div>
                </div>
              ))}
              {extrasSeg.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {extrasSeg.map((s) => (
                    <button key={s} type="button" onClick={() => toggle(segmentos, setSegmentos, s)} className={chip(true)}>{s} ×</button>
                  ))}
                </div>
              )}
              <input
                value={customSeg}
                onChange={(e) => setCustomSeg(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionar(segmentos, setSegmentos, customSeg, () => setCustomSeg("")); } }}
                placeholder="Outro segmento? Digite e pressione Enter"
                className={inputCls}
              />
            </>
          )}

          {passo === 1 && (
            <>
              <p className="text-sm text-muted-foreground">Em quais cidades? Cada cidade é pesquisada com cada segmento escolhido.</p>
              <div className="flex flex-wrap gap-1.5">
                {[...CIDADES_SUGERIDAS, ...extrasCid].map((c) => (
                  <button key={c} type="button" onClick={() => toggle(cidades, setCidades, c)} className={chip(cidades.includes(c))}>{c}</button>
                ))}
              </div>
              <input
                value={customCidade}
                onChange={(e) => setCustomCidade(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionar(cidades, setCidades, customCidade, () => setCustomCidade("")); } }}
                placeholder="Outra cidade? Digite e pressione Enter (ex.: Campinas SP)"
                className={inputCls}
              />
            </>
          )}

          {passo === 2 && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Quantas empresas buscar</span>
                  <input type="number" min={20} max={5000} step={50} value={meta}
                    onChange={(e) => setMeta(Math.min(5000, Math.max(20, Number(e.target.value) || 20)))} className={inputCls} />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Telefone</span>
                  <select value={apenasCelular ? "CELULAR" : "TODOS"} onChange={(e) => setApenasCelular(e.target.value === "CELULAR")} className={inputCls}>
                    <option value="CELULAR">Só celular (WhatsApp)</option>
                    <option value="TODOS">Qualquer telefone</option>
                  </select>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Site</span>
                  <select value={filtroSite} onChange={(e) => setFiltroSite(e.target.value)} className={inputCls}>
                    <option value="TODOS">Com ou sem site</option>
                    <option value="SEM_SITE">Só sem site</option>
                    <option value="COM_SITE">Só com site</option>
                  </select>
                </label>
              </div>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Nome da busca</span>
                <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder={nomeAuto} className={inputCls} />
              </label>

              <div className="rounded-lg border border-border">
                <button type="button" onClick={() => setAvancado((v) => !v)} className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
                  Critérios de qualificação (avançado)
                  <ChevronRight className={`w-4 h-4 transition-transform ${avancado ? "rotate-90" : ""}`} />
                </button>
                {avancado && (
                  <div className="px-3 pb-3 space-y-2">
                    <p className="text-[11px] text-muted-foreground">
                      Cada sinal soma pontos no score. Empresas abaixo do mínimo são descartadas sem gastar IA.
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      {([
                        ["pesoSemSite", "Sem site"],
                        ["pesoSemAnuncioAtivo", "Sem anúncio"],
                        ["pesoInstagramParado", "IG parado"],
                        ["pesoRatingBaixo", "Nota < 4"],
                        ["limiarScoreQualificado", "Score mínimo"],
                      ] as const).map(([k, l]) => (
                        <label key={k} className="block space-y-1">
                          <span className="text-[11px] text-muted-foreground">{l}</span>
                          <input type="number" min={0} max={20} value={pesos[k]}
                            onChange={(e) => setPesos((p) => ({ ...p, [k]: Math.max(0, Number(e.target.value) || 0) }))}
                            className={inputCls} />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground space-y-1">
                <p>
                  <strong className="text-foreground">{segmentos.length}</strong> segmento(s) ×{" "}
                  <strong className="text-foreground">{cidades.length}</strong> cidade(s) = {combinacoes} pesquisa(s).
                  Meta: <strong className="text-foreground">{fmtNum(meta)}</strong> empresas.
                </p>
                {potencial < meta && (
                  <p className="text-amber-600 dark:text-amber-400">
                    Com essa combinação o potencial é ~{fmtNum(potencial)} empresas. Para chegar à meta, adicione segmentos ou cidades.
                  </p>
                )}
              </div>

              {!editar && (
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input type="checkbox" checked={iniciarAgora} onChange={(e) => setIniciarAgora(e.target.checked)} className="w-4 h-4" />
                  Começar a buscar empresas assim que criar
                </label>
              )}
            </>
          )}

          {erro && <p className="text-sm text-red-500">{erro}</p>}
        </div>

        {/* Rodapé */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border">
          <span className="text-xs text-muted-foreground truncate">
            {passo === 0 ? `${segmentos.length} selecionado(s)` : passo === 1 ? `${cidades.length} cidade(s)` : ""}
          </span>
          <div className="flex gap-2">
            {passo > 0 ? (
              <button onClick={() => setPasso(passo - 1)} className={btn.secundario}><ChevronLeft className="w-4 h-4" /> Voltar</button>
            ) : (
              <button onClick={onClose} className={btn.secundario}>Cancelar</button>
            )}
            {passo < 2 ? (
              <button onClick={() => setPasso(passo + 1)} disabled={!podeAvancar} className={btn.primario}>
                Continuar <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button onClick={() => void salvar()} disabled={salvando || !segmentos.length || !cidades.length} className={btn.primario}>
                {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {editar ? "Salvar alterações" : iniciarAgora ? "Criar e buscar" : "Criar busca"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
