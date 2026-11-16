// Gerador do contrato em PDF (roda no navegador, jsPDF). Porta quase literal de contratos/index.html
// (helpers, PLANOS, BRANDS, clausulasContrato e gerarPDFAvanteza), com o mínimo de reescrita:
//  - tipos TypeScript; a marca vai por parâmetro (era a global CUR_BRAND);
//  - devolve o documento em base64 em vez de baixar e mexer na tela (quem chama decide);
//  - fontes Manrope de /fonts (public/fonts, licença OFL em public/fonts/OFL.txt);
//  - nova cláusula "Registro de conversas e reuniões" (LGPD), depois da limitação de responsabilidade
//    (não muda a numeração das cláusulas citadas no texto: 2, 6.x, 9.x e 10).
import type { jsPDF as JsPDF } from "jspdf";
import type { FormContrato } from "./modelo";
import { ativo } from "@/lib/zona-comercial";

// ── Helpers (iguais aos do app antigo) ──────────────────────────────────────
export function formatDate(isoStr: string): string {
  if (!isoStr) return "";
  const [y, m, d] = isoStr.split("-");
  const months = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  return `${parseInt(d)} de ${months[parseInt(m) - 1]} de ${y}`;
}

export function fmtBRL(v: unknown): string {
  let t = String(v ?? "").replace(/[^\d.,]/g, "");
  if (!t) return "";
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (!/^\d+\.\d{1,2}$/.test(t)) t = t.replace(/\./g, "");
  const n = parseFloat(t);
  return isNaN(n) ? String(v) : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function numExtenso(n: number): string {
  const u = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
  const d = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
  const c = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];
  if (n < 20) return u[n];
  if (n < 100) return d[Math.floor(n / 10)] + (n % 10 ? " e " + u[n % 10] : "");
  if (n === 100) return "cem";
  if (n < 1000) return c[Math.floor(n / 100)] + (n % 100 ? " e " + numExtenso(n % 100) : "");
  if (n < 1000000) {
    const m = Math.floor(n / 1000), r = n % 1000;
    const head = m === 1 ? "mil" : numExtenso(m) + " mil";
    return head + (r ? (r < 100 || r % 100 === 0 ? " e " : " ") + numExtenso(r) : "");
  }
  return String(n);
}

export function valorPorExtenso(preco: string): string {
  const f = fmtBRL(preco);
  if (!f) return "";
  const [r, cts] = f.replace(/\./g, "").split(",").map((x) => parseInt(x, 10));
  const reais = r === 1 ? "um real" : numExtenso(r) + (r >= 1000000 || (r % 1000000 === 0 && r) ? " de reais" : " reais");
  const cent = cts ? (cts === 1 ? "um centavo" : numExtenso(cts) + " centavos") : "";
  return r === 0 ? cent : reais + (cent ? " e " + cent : "");
}

export function isoLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addMonthsClamp(date: Date, n: number): Date {
  const d = new Date(date.getFullYear(), date.getMonth() + n, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(date.getDate(), last));
  return d;
}

export const CONTRATADA = { razao: "51.112.136 PEDRO HENRIQUE MARTINS DA SILVA", cnpj: "51.112.136/0001-24", rep: "Pedro Henrique Martins da Silva", cidade: "Goiânia – GO" };

export interface Marca { fantasia: string; eyebrow: string; title: string; reg: boolean; tagline: string; header: string; footer: string; mark: string; metodologia: string; gerado: string; arquivo: string }
export const BRANDS: Record<string, Marca> = {
  nexo: { fantasia: "Nexo Consultoria & Growth", eyebrow: "NEXO CONSULTORIA & GROWTH", title: "Growth Engine", reg: true,
    tagline: "Gestão de Marketplaces & Publicidade Digital  ·  Consultoria e Aceleração de Vendas",
    header: "NEXO  CONSULTORIA & GROWTH  ·  GROWTH ENGINE®", footer: "Growth Engine®  ·  Nexo Consultoria & Growth  ·  Confidencial",
    mark: "N", metodologia: "da metodologia exclusiva Growth Engine®", gerado: "Growth Engine®  ·  Nexo Consultoria & Growth", arquivo: "GrowthEngine" },
  avanteza: { fantasia: "Avanteza Consultoria e Estratégia", eyebrow: "AVANTEZA  ·  CONSULTORIA E ESTRATÉGIA", title: "Plano de Crescimento", reg: false,
    tagline: "Gestão de Marketplaces & Publicidade Digital  ·  Consultoria e Estratégia",
    header: "AVANTEZA  ·  CONSULTORIA E ESTRATÉGIA", footer: "Avanteza Consultoria e Estratégia  ·  Confidencial",
    mark: "A", metodologia: "da metodologia de trabalho da CONTRATADA", gerado: "Avanteza Consultoria e Estratégia", arquivo: "Avanteza" },
};

export interface Cronograma { pgto2Dias: number; pgto2Str: string; diaRec: number; cronograma: string; itens: Array<{ n: number; iso: string }> }
export function calcCronograma(inicio: string, pgto2Dias: number, nParc: number | string): Cronograma {
  const ini = new Date(inicio + "T00:00:00");
  const p2 = new Date(ini); p2.setDate(p2.getDate() + pgto2Dias);
  const n = parseInt(String(nParc)) || 1;
  const parts = Array.from({ length: n }, (_, i) => {
    const dt = i === 0 ? formatDate(inicio) : formatDate(isoLocal(addMonthsClamp(p2, i - 1)));
    return `${i + 1}ª parcela: ${dt}${i === 0 ? " (assinatura)" : ""}`;
  });
  const itens = Array.from({ length: n }, (_, i) => ({ n: i + 1, iso: i === 0 ? inicio : isoLocal(addMonthsClamp(p2, i - 1)) }));
  return { pgto2Dias, pgto2Str: formatDate(isoLocal(p2)), diaRec: p2.getDate(), cronograma: parts.join("; "), itens };
}

export interface Cliente {
  cnpj: string; razao: string; fantasia: string; rep: string; email: string; whats: string; end: string; inicio: string; venc: string;
  plano: string; preco: string; duracao: number; duracaoExtenso: string; fimStr: string; primeiraParcelaStr: string; renov: string;
  garantia: boolean; marca: string; modelo: string;
}

function garantiaTexto(cliente: Cliente, n: number): string {
  return `${n}.1 A CONTRATADA oferece garantia contratual de execução: caso, ao longo dos ${cliente.duracao} (${cliente.duracaoExtenso}) meses de vigência deste contrato, os serviços prestados não gerem nenhum resultado, isto é, nenhuma venda nos canais de vendas geridos pela CONTRATADA, a CONTRATADA restituirá à CONTRATANTE a integralidade dos valores pagos a título de mensalidades durante esse período.\n\n` +
    `${n}.2 A restituição será realizada em até 30 (trinta) dias contados da solicitação por escrito da CONTRATANTE, feita até o término da vigência, com base nos relatórios de vendas dos canais geridos.\n\n` +
    `${n}.3 A garantia pressupõe o cumprimento, pela CONTRATANTE, das obrigações previstas neste contrato (acessos às contas, disponibilidade de produtos e estoque e pagamentos em dia) e não abrange os valores investidos diretamente pela CONTRATANTE em anúncios (Ads), pagos às plataformas.`;
}

interface Plano { nome: string; tipo: string; canaisAds?: string; reunioes?: string; sla?: string; limiteAds?: string; solucoes?: string; canaisVenda?: string; planejamento?: string; cadastro?: string; extra?: string[]; disparos?: string; adsExternos?: string; minhaPagina?: string; otimizacao?: boolean; escopo?: string[] }
export const PLANOS: Record<string, Plano> = {
  BASE: { nome: "Growth Engine® BASE", tipo: "Consultoria", canaisAds: "01 (um) canal de gestão de publicidade", reunioes: "semanais", sla: "4h úteis", limiteAds: "R$ 15.000,00",
    solucoes: "1 (uma) solução tecnológica", canaisVenda: "01 (um) canal de vendas (marketplace)", planejamento: "anual",
    cadastro: "até 10 (dez) produtos por mês",
    extra: ["Gerenciamento completo da conta por 3 (três) meses, incluindo acompanhamento diário de campanhas, ajustes de lances e segmentação"] },
  ESCALE: { nome: "Growth Engine® ESCALE", tipo: "Consultoria + Gestão de Publicidade", canaisAds: "02 (dois) canais de gestão de publicidade: Mercado Ads e Shopee Ads", reunioes: "semanais", sla: "2h úteis", limiteAds: "R$ 30.000,00",
    solucoes: "2 (duas) soluções tecnológicas", canaisVenda: "02 (dois) canais de vendas (marketplaces)", planejamento: "semestral",
    disparos: "2 (dois) por mês", adsExternos: "mensal", minhaPagina: "trimestral" },
  GROWTH: { nome: "Growth Engine® GROWTH", tipo: "Assessoria Estratégica + Gestão de Publicidade", canaisAds: "Product Ads, Follow/Brand Ads, Display Ads e Video Ads", reunioes: "ilimitadas", sla: "1h útil", limiteAds: "R$ 60.000,00",
    solucoes: "4 (quatro) soluções tecnológicas", canaisVenda: "multicanal (múltiplos marketplaces)", planejamento: "trimestral",
    disparos: "5 (cinco) por mês", adsExternos: "semanal", minhaPagina: "quinzenal", cadastro: "até 15 (quinze) produtos por mês", otimizacao: true },
  MARKETPLACE: { nome: "Plano Marketplace [3 Canais]", tipo: "Gestão de 3 canais de vendas: Mercado Livre, Shopee e TikTok Shop",
    escopo: [
      "Gestão de 3 (três) canais de vendas em marketplaces: Mercado Livre, Shopee e TikTok Shop",
      "Revisão e correção dos anúncios atuais (marca, unidade e atributos) em até 7 (sete) dias após o kickoff",
      "Cadastro de produtos ilimitado nos canais contratados, com catálogo padronizado, fotos, infográficos e clipes",
      "Estruturação da Loja Oficial no Mercado Livre e proteção da marca nos canais",
      "Gestão de publicidade nos canais: Mercado Ads, Shopee Ads e anúncios no TikTok Shop",
      "Produção de conteúdo e edição dos vídeos, com vídeos curtos semanais",
      "Linha editorial de lives (TikTok Shop e Shopee Live)",
      "Reuniões semanais de resultados",
      "Dashboard de resultados em tempo real (faturamento por canal, pedidos e ticket médio, posição nas buscas, anúncios e retorno, reputação, lives e afiliadas)",
      "Plano de ação de 90 dias: mês 1, organização dos canais (diagnóstico, Loja Oficial, fichas corrigidas e catálogo nos 3 canais); mês 2, ativação (Ads por linha de produto, Full no Mercado Livre, grade de lives e embaixadoras como afiliadas); mês 3, escala (otimização do investimento, preço e margem por canal e política de preço com revendedores)",
    ] },
};

/** Planos do formulário (cartões): valor padrão e, no Marketplace, o valor de renovação. */
export const PLANOS_FORM = [
  { valor: "BASE", preco: "1.497,90", rotulo: "R$1.497", desc: "Consultoria" },
  { valor: "ESCALE", preco: "1.997,90", rotulo: "R$1.997", desc: "Consultoria + Gestão de Publicidade", popular: true },
  { valor: "GROWTH", preco: "4.497,90", rotulo: "R$4.497", desc: "Assessoria Estratégica + Gestão de Publicidade" },
  { valor: "MARKETPLACE", preco: "1.997,00", rotulo: "R$1.997", desc: "3 canais: Mercado Livre, Shopee e TikTok Shop", renov: "2.799,99" },
] as const;

function scopeByPlan(plano: string): string {
  const p = PLANOS[plano] || PLANOS.ESCALE;
  if (p.escopo) return p.escopo.map((x) => "• " + x).join("\n");
  const l = [
    `Tipo de serviço: ${p.tipo}`,
    `Gestão de publicidade (Ads): ${p.canaisAds}, com limite de investimento sob gestão de ${p.limiteAds}`,
    `Gestão dos canais de vendas em marketplaces: ${p.canaisVenda}`,
    `Reuniões ${p.reunioes} de alinhamento e resultados`,
    `Grupo de WhatsApp para atendimento, com tempo máximo de resposta (SLA) de ${p.sla}`,
    `Soluções tecnológicas: ${p.solucoes}`,
    `Planejamento estratégico ${p.planejamento}`,
  ];
  if (p.disparos) l.push(`Disparos para a base de clientes: ${p.disparos}`);
  if (p.adsExternos) l.push(`Gestão de Ads em outras plataformas (TikTok, Google, Facebook, entre outras): periodicidade ${p.adsExternos}`);
  if (p.minhaPagina) l.push(`Minha Página — manutenção ${p.minhaPagina}`);
  if (p.cadastro) l.push(`Cadastro de produtos nos marketplaces: ${p.cadastro}`);
  if (p.otimizacao) l.push("Otimização de cadastros (títulos, descrições, imagens e ficha técnica) para maior conversão");
  (p.extra || []).forEach((x) => l.push(x));
  return l.map((x) => "• " + x).join("\n");
}

/** Cláusula nova (LGPD): registro de conversas e reuniões para gestão das entregas. */
export const CLAUSULA_REGISTRO = {
  title: "Registro de conversas e reuniões",
  paras: [
    "Para organizar e comprovar as entregas deste contrato, a CONTRATADA poderá registrar as conversas mantidas pelos canais oficiais de atendimento (como o grupo de WhatsApp e o e-mail) e gravar ou transcrever as reuniões, inclusive com apoio de ferramentas de inteligência artificial. Esses registros servem apenas à execução e à gestão das entregas deste contrato, são acessados somente pela equipe envolvida, não são compartilhados com terceiros para outros fins e são tratados conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018, art. 7º, V).",
    "Os registros são mantidos durante a vigência e pelo prazo necessário ao cumprimento de obrigações legais e ao exercício de direitos. A CONTRATANTE pode, a qualquer tempo, pedir acesso, cópia ou correção dos registros, ou a exclusão daquilo que não precise ser guardado por lei, e pode pedir que uma reunião específica não seja gravada.",
  ],
};

interface Clausula { title: string; short?: string; key?: string; paras?: string[]; list?: string[] }

export function clausulasContrato(cliente: Cliente, sched: Cronograma, dateStr: string, marca: Marca, opt: { cronogramaTabela?: boolean } = {}): Clausula[] {
  const P = PLANOS[cliente.plano] || PLANOS.ESCALE;
  const bh = cliente.modelo === "barbearia";
  const ext = valorPorExtenso(cliente.preco);
  const cron = opt.cronogramaTabela ? "conforme o cronograma de pagamentos abaixo" : `Cronograma: ${sched.cronograma}`;
  const out: Clausula[] = [
    { title: "Objeto do contrato", paras: [bh ? "O presente contrato tem por objeto a prestação de serviços de gestão de tráfego pago, gestão de mídias sociais e produção de conteúdo em vídeo pela CONTRATADA em favor da CONTRATANTE, conforme escopo detalhado na cláusula 2." :
      `O presente contrato tem por objeto a prestação de serviços de consultoria e gestão de canais de vendas em marketplaces (Mercado Livre, Shopee e demais canais contratados), incluindo a gestão de publicidade paga (Ads) nesses canais, por meio ${marca.metodologia}, no âmbito do ${P.nome} (${P.tipo}), conforme descrito neste instrumento.`] },
    { title: "Escopo de serviços", list: bh ? [
      "Gestão de campanhas de tráfego pago no Facebook Ads e Instagram Ads",
      "Criação e gerenciamento de campanhas de captação de novos clientes para a barbearia",
      "Produção de vídeos: visitas mensais ao estabelecimento para gravação de conteúdo (antes/depois, depoimentos, bastidores, promoções)",
      "Edição e publicação dos vídeos nas mídias sociais da CONTRATANTE",
      "Criação de peças gráficas e posts para Instagram e Facebook (até 12 posts/mês)",
      "Gestão do feed, stories e interações básicas nas plataformas contratadas",
      "Relatório mensal de desempenho (alcance, engajamento, leads e agendamentos)",
      "Suporte via WhatsApp em horário comercial"] : scopeByPlan(cliente.plano).split("\n").map((x) => x.replace(/^•\s*/, "")) },
    { title: "Prazo de vigência", paras: [
      `O contrato terá duração de ${cliente.duracao} (${cliente.duracaoExtenso}) meses, com início em ${dateStr} e encerramento em ${cliente.fimStr}, podendo ser renovado mediante acordo entre as partes com antecedência mínima de 30 dias.${cliente.renov ? ` Em caso de renovação, o valor mensal passará a ser de R$ ${cliente.renov} (${valorPorExtenso(cliente.renov)}), conforme proposta comercial aceita pela CONTRATANTE.` : ""}`] },
    { title: "Exclusividade e confidencialidade", paras: [
      "A CONTRATADA compromete-se a manter sigilo absoluto sobre todas as informações estratégicas, comerciais, financeiras e operacionais da CONTRATANTE obtidas no decorrer deste contrato, conforme a Lei Geral de Proteção de Dados — Lei nº 13.709/2018."] },
    { title: "Propriedade intelectual", paras: [
      bh ? "Todos os materiais, vídeos, artes e conteúdos criados pela CONTRATADA durante a vigência são de propriedade da CONTRATANTE após o pagamento integral de cada competência, exceto metodologias e processos internos da CONTRATADA, que permanecem de sua exclusiva propriedade intelectual." :
      "Todos os materiais, estratégias e conteúdos criados pela CONTRATADA durante a vigência do contrato são de propriedade da CONTRATANTE após o pagamento integral de cada competência, exceto metodologias, frameworks e processos internos da CONTRATADA, que permanecem de sua exclusiva propriedade intelectual."] },
    { key: "pagamento", title: "Valor e forma de pagamento", paras: [
      `6.1 1º PAGAMENTO (ENTRADA / IMPLEMENTAÇÃO): O 1º pagamento, no valor de R$ ${cliente.preco} (${ext}), equivalente a 1 (uma) mensalidade, é devido na assinatura deste contrato (${dateStr}). ${bh ? "Cobre a implementação inicial das campanhas e perfis." : "Cobre a configuração de estratégias, estruturação de processos e onboarding da equipe da CONTRATADA."}`,
      `6.2 DEMAIS PARCELAS: O valor mensal dos serviços é de R$ ${cliente.preco} (${ext}). O 2º pagamento vence ${sched.pgto2Dias} dias após a assinatura (${sched.pgto2Str}) e os seguintes todo dia ${sched.diaRec} de cada mês${sched.diaRec > 28 ? " (ou no último dia do mês, quando este não existir)" : ""}, totalizando ${cliente.duracao} (${cliente.duracaoExtenso}) parcelas ao longo da vigência, ${cron}.`,
      "6.3 FORMA DE PAGAMENTO: Os pagamentos serão realizados por meio de link de pagamento enviado pela CONTRATADA: o do 1º pagamento logo após a assinatura deste contrato e os demais antes de cada vencimento.",
      "6.4 INADIMPLÊNCIA: O atraso no pagamento implica cobrança de multa de 2% sobre o valor em aberto, juros de 1% ao mês e honorários advocatícios de 20% em caso de cobrança judicial."] },
    { title: "Obrigações da contratada", list: bh ? [
      "Realizar as visitas mensais acordadas para gravação de conteúdo",
      "Gerenciar ativamente as campanhas de tráfego pago",
      "Cumprir o calendário de publicações acordado",
      "Apresentar relatório mensal de resultados",
      "Disponibilizar atendimento via WhatsApp em horário comercial"] : [
      "Alocar equipe multidisciplinar dedicada ao projeto",
      "Cumprir cronograma de entregas previamente acordado",
      "Apresentar relatórios mensais de resultados e desempenho (KPIs)",
      P.sla ? `Manter grupo de WhatsApp para atendimento, respeitando o tempo máximo de resposta (SLA) de ${P.sla}` : "Manter canal de atendimento via WhatsApp em horário comercial",
      "Respeitar os valores e a identidade da marca da CONTRATANTE"] },
    { title: "Obrigações da contratante", list: bh ? [
      "Fornecer acesso às contas de Facebook, Instagram e demais plataformas necessárias",
      "Disponibilizar o estabelecimento nas datas agendadas para gravação",
      "Aprovar ou solicitar revisões em até 2 (dois) dias úteis",
      "Efetuar os pagamentos nos prazos acordados",
      "Indicar um responsável pela comunicação com a equipe da CONTRATADA"] : [
      "Fornecer à CONTRATADA acesso às contas dos marketplaces e plataformas de publicidade, bem como catálogo, estoque, preços e demais informações necessárias",
      `Arcar diretamente com o investimento em publicidade (Ads) nas plataformas, o qual não está incluído na mensalidade${P.limiteAds ? `, respeitado o limite de investimento sob gestão do plano contratado (${P.limiteAds})` : ", com verba definida em conjunto entre as partes"}`,
      "Aprovar ou solicitar revisões nos materiais em até 3 (três) dias úteis",
      "Efetuar os pagamentos nos prazos acordados",
      "Indicar um ponto focal responsável pela comunicação com a equipe da CONTRATADA",
      "Respeitar o prazo mínimo de contrato"] },
    { title: "Rescisão", paras: [
      "9.1 RESCISÃO PELA CONTRATANTE: A CONTRATANTE poderá rescindir este contrato a qualquer momento, sem incidência de multa ou juros, desde que notifique a CONTRATADA por escrito com antecedência mínima de 30 (trinta) dias. Neste caso, ficará devida exclusivamente a parcela do último mês de serviços prestados (equivalente aos 30 dias de atendimento em curso), sem qualquer outro encargo adicional.",
      "9.2 AUSÊNCIA DE AVISO PRÉVIO: Caso a CONTRATANTE não observe o prazo mínimo de aviso de 30 dias, fica devida a parcela correspondente aos 30 (trinta) dias de serviços que seriam prestados nesse período, a título de ressarcimento pela indisponibilização da equipe alocada, sem que isso configure multa.",
      "9.3 RESCISÃO PELA CONTRATADA: A CONTRATADA poderá rescindir este contrato por descumprimento das obrigações da CONTRATANTE, em especial inadimplência superior a 15 dias, mediante notificação por escrito, sem qualquer ônus para a CONTRATANTE além das parcelas já vencidas.",
      `9.4 ${cliente.garantia ? "Ressalvada a Garantia de Execução (cláusula 10), não haverá devolução do valor do 1º pagamento (cláusula 6.1)" : "Em nenhuma hipótese haverá devolução do valor do 1º pagamento (cláusula 6.1)"}, por tratar-se de serviço já executado.`] },
  ];
  if (cliente.garantia) out.push({ key: "garantia", title: "Garantia de execução", paras: garantiaTexto(cliente, 10).split("\n\n") });
  out.push(
    { title: "Limitação de responsabilidade", paras: [
      (cliente.garantia ? "Ressalvada a Garantia de Execução prevista na cláusula 10, a" : "A") + " CONTRATADA não se responsabiliza por resultados que dependam exclusivamente de fatores externos ao seu controle, tais como sazonalidade do mercado, mudanças de algoritmos de plataformas de terceiros, crises econômicas ou inação da CONTRATANTE no cumprimento de suas obrigações."] },
    { title: CLAUSULA_REGISTRO.title, paras: [...CLAUSULA_REGISTRO.paras] },
    { title: "Foro e legislação aplicável", paras: [
      "As partes elegem o foro da comarca de Goiânia – GO para dirimir quaisquer dúvidas ou litígios decorrentes do presente contrato, com renúncia expressa a qualquer outro foro, por mais privilegiado que seja."] },
    { title: "Aceite e validade jurídica", paras: [
      "O presente contrato, assinado eletronicamente pelas partes, tem plena validade jurídica nos termos da Lei nº 14.063/2020. A assinatura eletrônica possui a mesma validade da assinatura manuscrita."] },
  );
  return out;
}

/** Monta o "cliente" do gerador a partir do formulário (era o começo do gerarPDF). */
export function clienteDoForm(f: FormContrato): { cliente: Cliente; sched: Cronograma; marca: Marca } {
  const plano = f.plano || "ESCALE";
  const preco = fmtBRL(f.preco || "1.997,90");
  const pgto2Dias = parseInt(f.pgto2) || 45;
  const duracaoMeses = parseInt(f.duracao) || 12;
  const primeira = new Date(f.inicio + "T00:00:00"); primeira.setMonth(primeira.getMonth() + 1);
  const fim = new Date(f.inicio + "T00:00:00"); fim.setMonth(fim.getMonth() + duracaoMeses);
  const palavras = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove", "vinte", "vinte e um", "vinte e dois", "vinte e três", "vinte e quatro"];
  const cliente: Cliente = {
    cnpj: f.cnpj, razao: f.razao, fantasia: f.fantasia, rep: f.rep, email: f.email, whats: f.whats, end: f.end, inicio: f.inicio, venc: f.venc,
    plano, preco, duracao: duracaoMeses, duracaoExtenso: palavras[duracaoMeses] || String(duracaoMeses), fimStr: formatDate(isoLocal(fim)),
    primeiraParcelaStr: formatDate(isoLocal(primeira)), renov: fmtBRL(f.renov), garantia: !!f.garantia, marca: f.marca, modelo: f.modelo,
  };
  return { cliente, sched: calcCronograma(f.inicio, pgto2Dias, duracaoMeses), marca: BRANDS[f.marca] || BRANDS.avanteza };
}

// ── Fontes da marca ─────────────────────────────────────────────────────────
const FONTES_MARCA: Array<[string, string, string]> = [
  ["Manrope-ExtraBold.ttf", "ManropeTitulo", "normal"],
  ["Manrope-Medium.ttf", "Manrope", "normal"],
  ["Manrope-Bold.ttf", "Manrope", "bold"],
];
const FONTES_MARCA_B64: Record<string, string> = {};
async function loadBrandFont(doc: JsPDF) {
  await Promise.all(FONTES_MARCA.map(async ([arquivo]) => {
    if (FONTES_MARCA_B64[arquivo]) return;
    const r = await fetch(ativo("/fonts/" + arquivo)); // /comercial/fonts/… responde nos dois domínios
    if (!r.ok) throw new Error("font");
    const buf = new Uint8Array(await r.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    FONTES_MARCA_B64[arquivo] = btoa(bin);
  }));
  FONTES_MARCA.forEach(([arquivo, familia, estilo]) => {
    doc.addFileToVFS(arquivo, FONTES_MARCA_B64[arquivo]);
    doc.addFont(arquivo, familia, estilo);
  });
}

type Cor = [number, number, number];

/** Gera o contrato (identidade Avanteza v2.0). Devolve o PDF em base64 e o nome do arquivo. */
export async function gerarPDFAvanteza(f: FormContrato): Promise<{ base64: string; filename: string; blob: Blob }> {
  const { cliente, sched, marca: CUR_BRAND } = clienteDoForm(f);
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  // Sem as fontes da marca (falha de rede), o contrato sai em Helvetica — nunca deixa de ser gerado.
  let disp: [string, string] = ["helvetica", "bold"], corpo = "helvetica";
  try { await loadBrandFont(doc); disp = ["ManropeTitulo", "normal"]; corpo = "Manrope"; } catch { /* Helvetica */ }

  const W = 210, H = 297, ML = 20, MR = 20, TW = W - ML - MR;
  // Paleta Avanteza v2.0. Laranja só no quadrado do logotipo.
  const K: Record<"marinho" | "creme" | "areia" | "laranja" | "suave" | "branco", Cor> = { marinho: [11, 27, 51], creme: [245, 240, 230], areia: [234, 217, 194], laranja: [255, 106, 31],
    suave: [100, 116, 139], branco: [255, 255, 255] };
  const fill = (c: Cor) => doc.setFillColor(c[0], c[1], c[2]);
  const txt = (c: Cor) => doc.setTextColor(c[0], c[1], c[2]);
  const draw = (c: Cor) => doc.setDrawColor(c[0], c[1], c[2]);
  const D = (size: number) => doc.setFont(disp[0], disp[1]).setFontSize(size);
  const B = (size: number, style = "normal") => doc.setFont(corpo, style).setFontSize(size);
  const P = PLANOS[cliente.plano] || PLANOS.ESCALE;
  const bh = cliente.modelo === "barbearia";
  const planoLabel = bh ? "Gestão de Tráfego & Mídias Sociais · Barbearia" : P.nome;
  const dateStr = formatDate(cliente.inicio);
  const curto = (iso: string) => iso.split("-").reverse().join("/");
  const BODY = 8.8, LH = 4.6;

  const spaced = (s: string, x: number, y: number, cs: number, align?: "right" | "center") => {
    const w = doc.getTextWidth(s) + cs * (s.length - 1);
    const x0 = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    doc.text(s, x0, y, { charSpace: cs });
    return w;
  };
  const brackets = (x: number, y: number, w: number, h: number, c: Cor, t: number, tick: number) => {
    fill(c);
    doc.rect(x, y, t, h, "F"); doc.rect(x, y, tick, t, "F"); doc.rect(x, y + h - t, tick, t, "F");
    doc.rect(x + w - t, y, t, h, "F"); doc.rect(x + w - tick, y, tick, t, "F"); doc.rect(x + w - tick, y + h - t, tick, t, "F");
  };
  const wordmark = (x: number, y: number, size: number, c: Cor, subSize: number, gap: number) => {
    const em = size * 25.4 / 72;
    txt(c); D(size);
    const wl = spaced("avanteza", x, y, -0.045 * em);
    const q = 0.2 * em;
    fill(K.laranja); doc.rect(x + wl + 0.06 * em, y - q, q, q, "F");
    const w = wl + 0.06 * em + q;
    const sub = "CONSULTORIA E ESTRATÉGIA";
    txt(c); B(subSize, "normal");
    const cs = Math.max(0.2, (w * 0.96 - doc.getTextWidth(sub)) / (sub.length - 1));
    spaced(sub, x + w / 2, y + gap, cs, "center");
    return w;
  };

  // ══ CAPA ═══════════════════════════════════════════
  fill(K.marinho); doc.rect(0, 0, W, H, "F");
  txt(K.creme); B(6.8, "bold"); spaced("CONTRATO DE PRESTAÇÃO DE SERVIÇOS", ML, 20, 0.6);
  B(6.8, "bold"); spaced(curto(cliente.inicio).replace(/\//g, "."), W - MR, 20, 0.6, "right");

  wordmark(ML - 1.2, 56, 60, K.creme, 7.4, 9.6);
  brackets(W - MR - 30, 34, 30, 30, K.areia, 2.6, 7);

  txt(K.creme); D(38);
  doc.text("Do plano", ML, 112);
  doc.text("à prática", ML, 127.5);
  const wp = doc.getTextWidth("à prática");
  txt(K.areia); doc.text(".", ML + wp + 0.4, 127.5);
  txt(K.areia); B(10, "normal");
  doc.text(`${planoLabel}  ·  ${cliente.fantasia || cliente.razao}`, ML, 139, { maxWidth: TW });

  const cy0 = 152, ch = 64, cw = (TW - 5) / 2;
  const partes: Array<[string, string, string[], string]> = [
    ["CONTRATANTE", cliente.razao, [`CNPJ ${cliente.cnpj}`, cliente.rep && `Rep. legal: ${cliente.rep}`, cliente.email].filter(Boolean) as string[], cliente.end],
    ["CONTRATADA", CONTRATADA.razao, [`Nome fantasia: ${CUR_BRAND.fantasia}`, `CNPJ ${CONTRATADA.cnpj}`, `Rep. legal: ${CONTRATADA.rep}`], CONTRATADA.cidade],
  ];
  partes.forEach(([lab, nome, linhas, rodape], i) => {
    const x = ML + i * (cw + 5);
    fill(K.creme); doc.rect(x, cy0, cw, ch, "F");
    txt(K.suave); B(6.4, "bold"); spaced(lab, x + 6, cy0 + 9, 0.45);
    txt(K.marinho); D(10);
    const nl = doc.splitTextToSize(nome, cw - 12);
    doc.text(nl, x + 6, cy0 + 17);
    let yy = cy0 + 17 + nl.length * 4.6 + 1.6;
    txt(K.marinho); B(7.4, "normal");
    linhas.forEach((l) => { const ll = doc.splitTextToSize(l, cw - 12); doc.text(ll, x + 6, yy); yy += ll.length * 3.8 + 0.9; });
    if (rodape) {
      txt(K.suave); B(6.5, "normal");
      const fl = doc.splitTextToSize(rodape, cw - 12);
      doc.text(fl, x + 6, cy0 + ch - 6 - (fl.length - 1) * 3.1);
    }
  });

  const by = 222, bandH = 27, mw = TW / 4;
  fill(K.areia); doc.rect(ML, by, TW, bandH, "F");
  const metricas: Array<[string, string]> = [
    ["VALOR MENSAL", `R$ ${cliente.preco}`], ["VIGÊNCIA", `${cliente.duracao} meses`],
    ["1º PAGAMENTO", "Na assinatura"], ["2º PAGAMENTO", curto(sched.itens[1] ? sched.itens[1].iso : cliente.inicio)],
  ];
  metricas.forEach(([l, v], i) => {
    const x = ML + 6 + i * mw;
    if (i) { draw(K.marinho); doc.setLineWidth(0.2); doc.line(ML + i * mw, by + 7, ML + i * mw, by + bandH - 7); }
    txt(K.marinho); B(5.8, "bold"); spaced(l, x, by + 10, 0.35);
    D(11.5); doc.text(v, x, by + 19);
  });

  // ══ PÁGINAS INTERNAS ═══════════════════════════════
  let y = 0;
  const header = () => {
    fill(K.branco); doc.rect(0, 0, W, H, "F");
    wordmark(ML, 16.5, 13, K.marinho, 3.3, 2.9);
    txt(K.suave); B(6.4, "normal");
    doc.text(`CONTRATO  ·  ${(cliente.fantasia || cliente.razao).toUpperCase()}`, W - MR, 16.5, { align: "right" });
    draw(K.areia); doc.setLineWidth(0.4); doc.line(ML, 24, W - MR, 24);
    y = 36;
  };
  const newPage = () => { doc.addPage(); header(); };
  const ensure = (h: number) => { if (y + h > H - 24) newPage(); };

  const heading = (n: number, title: string) => {
    ensure(20);
    const num = `[${String(n).padStart(2, "0")}]`;
    txt(K.suave); D(11); doc.text(num, ML, y);
    const nw = doc.getTextWidth(num);
    txt(K.marinho); D(11); doc.text(title, ML + nw + 2.5, y);
    y += 7;
  };
  const line = (s: string, x: number, c: Cor, style = "normal") => { txt(c); B(BODY, style); doc.text(s, x, y); y += LH; };
  const para = (text: string, c: Cor = K.marinho, x = ML, w = TW) => {
    B(BODY, "normal");
    const m = text.match(/^(\d+\.\d+)\s+([\s\S]*)$/);
    if (m) {
      const ind = 9;
      const ls: string[] = doc.splitTextToSize(m[2], w - ind);
      ensure(LH + 1);
      txt(c === K.marinho ? K.marinho : K.areia); B(BODY, "bold"); doc.text(m[1], x, y);
      ls.forEach((s, i) => { if (i) ensure(LH); line(s, x + ind, c); });
    } else {
      (doc.splitTextToSize(text, w) as string[]).forEach((s) => { ensure(LH); line(s, x, c); });
    }
    y += 2.4;
  };
  const lista = (items: string[]) => {
    items.forEach((it) => {
      B(BODY, "normal");
      const ls: string[] = doc.splitTextToSize(it, TW - 6);
      ensure(LH + 1);
      fill(K.marinho); doc.rect(ML + 0.3, y - 2.4, 1.7, 1.7, "F");
      ls.forEach((s, i) => { if (i) ensure(LH); line(s, ML + 6, K.marinho); });
      y += 1.1;
    });
    y += 2.4;
  };
  const tabela = () => {
    const rows = sched.itens, rh = 7.6;
    const total = (parseFloat(String(cliente.preco).replace(/\./g, "").replace(",", ".")) || 0) * rows.length;
    ensure(rh * (rows.length + 2) + 6);
    y += 1;
    const top = y;
    fill(K.marinho); doc.rect(ML, y, TW, rh, "F");
    txt(K.creme); B(6.4, "bold");
    spaced("PARCELA", ML + 5, y + 5, 0.35); spaced("VENCIMENTO", ML + 32, y + 5, 0.35); spaced("VALOR", W - MR - 5, y + 5, 0.35, "right");
    y += rh;
    rows.forEach((r, i) => {
      fill(i % 2 ? K.creme : K.branco); doc.rect(ML, y, TW, rh, "F");
      txt(K.marinho); D(9); doc.text(`${r.n}ª`, ML + 5, y + 5.1);
      txt(K.marinho); B(8.6, "normal"); doc.text(r.n === 1 ? `${curto(r.iso)}  ·  na assinatura` : curto(r.iso), ML + 32, y + 5.1);
      B(8.6, "bold"); doc.text(`R$ ${cliente.preco}`, W - MR - 5, y + 5.1, { align: "right" });
      y += rh;
    });
    fill(K.areia); doc.rect(ML, y, TW, rh, "F");
    txt(K.marinho); B(6.4, "bold"); spaced("TOTAL DO PERÍODO", ML + 5, y + 5, 0.35);
    D(9); doc.text(`R$ ${total.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, W - MR - 5, y + 5.2, { align: "right" });
    y += rh;
    draw(K.areia); doc.setLineWidth(0.2); doc.rect(ML, top, TW, y - top);
    y += 7;
  };
  const destaque = (paras: string[]) => {
    const pad = 7, w = TW - pad * 2;
    B(BODY, "normal");
    const blocks = paras.map((p) => {
      const m = p.match(/^(\d+\.\d+)\s+([\s\S]*)$/);
      return m ? { n: m[1] as string | null, ls: doc.splitTextToSize(m[2], w - 9) as string[] } : { n: null, ls: doc.splitTextToSize(p, w) as string[] };
    });
    const h = pad + 8 + blocks.reduce((a, b) => a + b.ls.length * LH + 2.4, 0) + pad - 5;
    if (h > H - 60) { paras.forEach((p) => para(p)); return; }
    ensure(h + 2);
    fill(K.marinho); doc.rect(ML, y, TW, h, "F");
    brackets(W - MR - 15, y + 4, 9, 6.5, K.areia, 0.9, 2.2);
    txt(K.areia); B(6.6, "bold"); spaced("RESULTADO OU SEU INVESTIMENTO DE VOLTA", ML + pad, y + pad + 2, 0.45);
    let yy = y + pad + 9.5;
    blocks.forEach((b) => {
      if (b.n) { txt(K.areia); B(BODY, "bold"); doc.text(b.n, ML + pad, yy); }
      txt(K.creme); B(BODY, "normal");
      b.ls.forEach((s) => { doc.text(s, ML + pad + (b.n ? 9 : 0), yy); yy += LH; });
      yy += 2.4;
    });
    y += h + 6;
  };

  newPage();
  const cls = clausulasContrato(cliente, sched, dateStr, CUR_BRAND, { cronogramaTabela: true });
  cls.forEach((c, i) => {
    heading(i + 1, c.short || c.title);
    if (c.list) lista(c.list);
    else if (c.key === "garantia") destaque(c.paras ?? []);
    else if (c.key === "pagamento") { (c.paras ?? []).forEach((p, j) => { para(p); if (j === 1) tabela(); }); }
    else (c.paras ?? []).forEach((p) => para(p));
    y += 2;
  });

  // ── Assinaturas ──
  const sh = 76;
  if (y + sh > H - 24) newPage(); else y += 4;
  const sy = y;
  txt(K.marinho); D(15);
  const tw = doc.getTextWidth("Assinaturas");
  brackets(ML, sy, tw + 12, 13, K.marinho, 1.3, 3.2);
  doc.text("Assinaturas", ML + 6, sy + 9.2);
  txt(K.suave); B(8.2, "normal"); doc.text(`Goiânia – GO, ${dateStr}`, ML, sy + 22);
  const sc = (TW - 12) / 2;
  ([["CONTRATANTE", cliente.razao, `CNPJ ${cliente.cnpj}`, cliente.rep ? `Rep. legal: ${cliente.rep}` : ""],
    ["CONTRATADA", CONTRATADA.razao, `CNPJ ${CONTRATADA.cnpj}  ·  ${CUR_BRAND.fantasia}`, `Rep. legal: ${CONTRATADA.rep}`]] as Array<[string, string, string, string]>).forEach(([lab, nome, l1, l2], i) => {
    const x = ML + i * (sc + 12), ly = sy + 44;
    draw(K.marinho); doc.setLineWidth(0.4); doc.line(x, ly, x + sc, ly);
    txt(K.suave); B(6.4, "bold"); spaced(lab, x, ly - 3, 0.45);
    txt(K.marinho); D(8.4); const nl = (doc.splitTextToSize(nome, sc) as string[]).slice(0, 2); doc.text(nl, x, ly + 6.5);
    const off = (nl.length - 1) * 4;
    txt(K.suave); B(7.2, "normal");
    doc.text((doc.splitTextToSize(l1, sc) as string[])[0], x, ly + 12 + off);
    if (l2) doc.text((doc.splitTextToSize(l2, sc) as string[])[0], x, ly + 16.5 + off);
  });
  txt(K.suave); B(6.6, "normal");
  doc.text("Documento assinado eletronicamente pelas partes, com validade jurídica nos termos da Lei nº 14.063/2020.", ML, sy + 72);

  // ── Rodapés ──
  const n = doc.getNumberOfPages();
  for (let pg = 1; pg <= n; pg++) {
    doc.setPage(pg);
    const capa = pg === 1;
    if (!capa) { draw(K.areia); doc.setLineWidth(0.4); doc.line(ML, H - 16, W - MR, H - 16); }
    fill(K.areia); doc.rect(ML, H - 11.6, 6, 1.5, "F");
    txt(capa ? K.creme : K.marinho); B(7.6, "bold"); doc.text("Visão para ir além.", ML + 8.5, H - 10.3);
    D(8); doc.text(`${String(pg).padStart(2, "0")} / ${String(n).padStart(2, "0")}`, W - MR, H - 10.3, { align: "right" });
  }

  const filename = `Contrato_${bh ? "Barbearia" : CUR_BRAND.arquivo}_${cliente.razao.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)}${bh ? "" : "_" + cliente.plano}.pdf`;
  const base64 = doc.output("datauristring").split(",")[1];
  return { base64, filename, blob: doc.output("blob") };
}
