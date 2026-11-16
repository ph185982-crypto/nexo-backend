// Cópia do CRM (schema `crm`) para as tabelas do Comercial do Vendedor IA (`public.com_*`).
// Desenho: ETAPA3_DESENHO.md, seção 3. Mesmo banco (Supabase), SQL puro, ids preservados.
//
// Modos (um por execução):
//   --relatorio   só lê: quantas linhas há em cada lado, o que falta copiar, usuários e motivos a criar
//   --copiar      insere o que falta (INSERT … SELECT … ON CONFLICT DO NOTHING), numa transação só.
//                 Rodar de novo insere 0 (idempotente).
//   --verificar   compara origem × destino (contagem, md5 dos ids, contagens por status/etapa, somas,
//                 sequência do número). Sai com código ≠ 0 se algo divergir.
//   --refazer     (só no corte) numa transação: apaga as tabelas com_* e o que veio do CRM em CalendarEvent,
//                 e copia tudo de novo. Exige --sim.
//   --desfazer    apaga, por id, as linhas que vieram do CRM (com_*, CalendarEvent, motivos e usuários criados
//                 pela cópia e sem uso). Exige --sim.
//
// Conexão: DIRECT_URL (ou DATABASE_URL) com um papel que enxergue os schemas `crm` e `public`
// (o `postgres` do Supabase; o papel do app do CRM, crm_app, NÃO enxerga public).
// Alternativa só leitura (--relatorio e --verificar): --api-supabase <ref do projeto> com
// SUPABASE_ACCESS_TOKEN no ambiente: consultas pela API de gestão com read_only=true.
// Opções: --org <id> (organização do Vendedor IA; obrigatória se houver mais de uma),
//         --permitir-extras (no --verificar, linhas a mais no destino viram aviso, não erro).
// Nunca imprime segredo.
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const valor = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const MODOS = ["--relatorio", "--copiar", "--verificar", "--refazer", "--desfazer"];
const modos = MODOS.filter(flag);
if (modos.length !== 1) {
  console.error(`Use exatamente um modo: ${MODOS.join(" | ")}`);
  process.exit(2);
}
const modo = modos[0];
const refApi = valor("--api-supabase");
if (refApi && !["--relatorio", "--verificar"].includes(modo)) {
  console.error("--api-supabase é só leitura: use com --relatorio ou --verificar");
  process.exit(2);
}
if (["--refazer", "--desfazer"].includes(modo) && !flag("--sim")) {
  console.error(`${modo} apaga dados: confirme com --sim`);
  process.exit(2);
}

// ─── Executor: Prisma (leitura e escrita) ou API de gestão do Supabase (só leitura) ─────────
let prisma = null;
async function consultarApi(sql) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN não definido");
  const r = await fetch(`https://api.supabase.com/v1/projects/${refApi}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  const corpo = await r.text();
  if (!r.ok) throw new Error(`API Supabase ${r.status}: ${corpo.slice(0, 300)}`);
  return JSON.parse(corpo);
}
const normal = (linhas) => linhas.map((l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])));
async function q(sql, db = prisma) {
  if (refApi) return consultarApi(sql);
  return normal(await db.$queryRawUnsafe(sql));
}
async function exec(sql, db) {
  if (refApi) throw new Error("escrita não permitida no modo API");
  return db.$executeRawUnsafe(sql);
}
const um = async (sql, db) => (await q(sql, db))[0] ?? {};

// ─── Tabelas: origem no CRM, destino no Vendedor IA, na ordem de dependência ────────────────
// `ins`: INSERT … SELECT que copia (usa _map_usuario, _map_motivo e :org). `filtro`: o que da origem entra.
const T = [
  {
    nome: "Funil", origem: 'crm."Funil"', destino: "public.com_funil",
    ins: `insert into public.com_funil(id,nome,ordem,padrao,ativo) select id,nome,ordem,padrao,ativo from crm."Funil" on conflict do nothing`,
  },
  {
    nome: "Etapa", origem: 'crm."Etapa"', destino: "public.com_etapa",
    ins: `insert into public.com_etapa(id,"funilId",nome,ordem,tipo,descricao,"kanbanColumnType")
      select e.id,e."funilId",e.nome,e.ordem,e.tipo,e.descricao,
        case when e.tipo='GANHA' then 'GANHO' when e.tipo='PERDIDA' then 'LOST'
             when lower(e.nome) ~ 'qualifica' then 'EM_QUALIFICACAO'
             when lower(e.nome) ~ 'proposta' then 'PROPOSTA_NEGOCIACAO'
             when lower(e.nome) ~ 'contrato' then 'CONTRATO'
             when lower(e.nome) ~ '^leads?$' then 'TRIAGE' else null end
      from crm."Etapa" e on conflict do nothing`,
  },
  {
    nome: "Contato", origem: 'crm."Contato"', destino: "public.com_contato",
    ins: `insert into public.com_contato(id,tipo,nome,telefone,email,documento,segmento,cargo,"cicloDeVida",origem,"empresaId","responsavelId","leadId","criadoEm","atualizadoEm")
      select c.id,c.tipo,c.nome,c.telefone,c.email,c.documento,c.segmento,c.cargo,c."cicloDeVida",c.origem,c."empresaId",mu.user_id,l.id,c."criadoEm",c."atualizadoEm"
      from crm."Contato" c left join _map_usuario mu on mu.crm_id=c."responsavelId" left join public."Lead" l on l.id=c."vendedorIaLeadId"
      order by (c."empresaId" is null) desc on conflict do nothing`,
  },
  {
    nome: "Oportunidade", origem: 'crm."Oportunidade"', destino: "public.com_oportunidade",
    ins: `insert into public.com_oportunidade(id,numero,nome,"contatoId","pessoaId","funilId","etapaId",status,"responsavelId","valorUnico","valorMensal",probabilidade,origem,tags,"finalizaEm","etapaDesdeEm","encerradaEm","motivoId","motivoDetalhe","ultimaAtividadeEm","leadId","criadoEm","atualizadoEm","resumoIa","resumoIaEm")
      select o.id,o.numero,o.nome,o."contatoId",o."pessoaId",o."funilId",o."etapaId",o.status,mu.user_id,o."valorUnico",o."valorMensal",o.probabilidade,o.origem,o.tags,o."finalizaEm",o."etapaDesdeEm",o."encerradaEm",mm.motivo_id,o."motivoDetalhe",o."ultimaAtividadeEm",l.id,o."criadoEm",o."atualizadoEm",o."resumoIa",o."resumoIaEm"
      from crm."Oportunidade" o left join _map_usuario mu on mu.crm_id=o."responsavelId" left join _map_motivo mm on mm.crm_id=o."motivoId" left join public."Lead" l on l.id=o."vendedorIaLeadId"
      on conflict do nothing`,
  },
  {
    nome: "HistoricoEtapa", origem: 'crm."HistoricoEtapa"', destino: "public.com_historico_etapa",
    ins: `insert into public.com_historico_etapa(id,"oportunidadeId","deEtapaId","deFunilNome","deEtapaNome","paraEtapaId","paraFunilNome","paraEtapaNome","paraTipo","entrouEm","saiuEm",origem,ator,motivo)
      select h.id,h."oportunidadeId",h."deEtapaId",h."deFunilNome",h."deEtapaNome",h."paraEtapaId",h."paraFunilNome",h."paraEtapaNome",h."paraTipo",h."entrouEm",h."saiuEm",h.origem,coalesce(mu.user_id,h.ator),h.motivo
      from crm."HistoricoEtapa" h left join _map_usuario mu on mu.crm_id=h.ator on conflict do nothing`,
  },
  {
    nome: "Feedback", origem: 'crm."Feedback"', destino: "public.com_feedback",
    ins: `insert into public.com_feedback(id,"oportunidadeId","contatoId",tipo,texto,intencao,importante,autor,"autorNome","criadoEm")
      select f.id,f."oportunidadeId",f."contatoId",f.tipo,f.texto,f.intencao,f.importante,coalesce(mu.user_id,f.autor),f."autorNome",f."criadoEm"
      from crm."Feedback" f left join _map_usuario mu on mu.crm_id=f.autor on conflict do nothing`,
  },
  {
    nome: "Tarefa", origem: 'crm."Tarefa"', destino: "public.com_tarefa",
    ins: `insert into public.com_tarefa(id,titulo,descricao,tipo,prioridade,"prazoEm",status,"concluidaEm",recorrencia,checklist,origem,"responsavelId","contatoId","oportunidadeId","paiId","criadoEm","atualizadoEm")
      select t.id,t.titulo,t.descricao,t.tipo,t.prioridade,t."prazoEm",t.status,t."concluidaEm",t.recorrencia,t.checklist,t.origem,mu.user_id,t."contatoId",t."oportunidadeId",t."paiId",t."criadoEm",t."atualizadoEm"
      from crm."Tarefa" t left join _map_usuario mu on mu.crm_id=t."responsavelId" order by (t."paiId" is null) desc on conflict do nothing`,
  },
  {
    // Compromisso vira CalendarEvent (agenda única); participantes viram CalendarAttendee.
    nome: "Compromisso", origem: 'crm."Compromisso"', destino: 'public."CalendarEvent"', destinoFiltro: `"oportunidadeId" is not null or "contatoId" is not null`,
    ins: `insert into public."CalendarEvent"(id,title,description,location,"startTime","endTime",status,provider,"organizationId","leadId","oportunidadeId","contatoId",tipo,origem,"responsavelId","createdAt","updatedAt")
      select c.id,c.assunto,c.descricao,c.local,c.inicio,c.fim,
        case c.status when 'REALIZADO' then 'COMPLETED' when 'CANCELADO' then 'CANCELLED' else 'SCHEDULED' end,
        'LOCAL',:org,l.id,c."oportunidadeId",c."contatoId",c.tipo,c.origem,mu.user_id,c."criadoEm",c."criadoEm"
      from crm."Compromisso" c left join _map_usuario mu on mu.crm_id=c."responsavelId"
        left join crm."Oportunidade" o on o.id=c."oportunidadeId" left join public."Lead" l on l.id=o."vendedorIaLeadId"
      on conflict do nothing`,
    depois: `insert into public."CalendarAttendee"(id,"calendarEventId",name,email,status)
      select 'cpa_'||md5(c.id||':'||p.email),c.id,p.email,p.email,'INVITED' from crm."Compromisso" c cross join lateral unnest(c.participantes) as p(email)
      on conflict do nothing`,
  },
  {
    nome: "Mensagem", origem: 'crm."Mensagem"', destino: "public.com_mensagem", filtro: `origem <> 'EXTENSAO'`,
    ins: `insert into public.com_mensagem(id,"contatoId","oportunidadeId",canal,autor,"deMim",texto,"enviadaEm",origem,hash,"analisadaEm","criadoEm")
      select id,"contatoId","oportunidadeId",canal,autor,"deMim",texto,"enviadaEm",origem,hash,"analisadaEm","criadoEm" from crm."Mensagem" where origem <> 'EXTENSAO' on conflict do nothing`,
  },
  {
    nome: "AnaliseAgente", origem: 'crm."AnaliseAgente"', destino: "public.com_analise_agente",
    ins: `insert into public.com_analise_agente(id,"oportunidadeId",fonte,"fonteRef",texto,status,resumo,erro,sugestoes,modelo,"tokensEntrada","tokensSaida","criadoEm","concluidaEm")
      select id,"oportunidadeId",fonte,"fonteRef",texto,status,resumo,erro,sugestoes,modelo,"tokensEntrada","tokensSaida","criadoEm","concluidaEm" from crm."AnaliseAgente" on conflict do nothing`,
  },
  {
    nome: "Combinado", origem: 'crm."Combinado"', destino: "public.com_combinado",
    ins: `insert into public.com_combinado(id,"oportunidadeId",descricao,tipo,responsavel,"prazoEm",pilar,status,acao,"alvoCombinadoId","alvoCartaoId",evidencia,confianca,origem,"analiseId","cartaoId","tarefaId","compromissoId","decididoEm","decididoPorId","entregueEm","criadoEm","atualizadoEm")
      select c.id,c."oportunidadeId",c.descricao,c.tipo,c.responsavel,c."prazoEm",c.pilar,c.status,c.acao,c."alvoCombinadoId",c."alvoCartaoId",c.evidencia,c.confianca,c.origem,c."analiseId",c."cartaoId",c."tarefaId",c."compromissoId",c."decididoEm",coalesce(mu.user_id,c."decididoPorId"),c."entregueEm",c."criadoEm",c."atualizadoEm"
      from crm."Combinado" c left join _map_usuario mu on mu.crm_id=c."decididoPorId" on conflict do nothing`,
  },
  {
    nome: "ModeloEntrega", origem: 'crm."ModeloEntrega"', destino: "public.com_modelo_entrega",
    ins: `insert into public.com_modelo_entrega(id,nome,descricao,padrao,ativo) select id,nome,descricao,padrao,ativo from crm."ModeloEntrega" on conflict do nothing`,
  },
  {
    nome: "ModeloEntregaItem", origem: 'crm."ModeloEntregaItem"', destino: "public.com_modelo_entrega_item",
    ins: `insert into public.com_modelo_entrega_item(id,"modeloId",titulo,descricao,pilar,"prazoDias",cliente,ordem,checklist)
      select id,"modeloId",titulo,descricao,pilar,"prazoDias",cliente,ordem,checklist from crm."ModeloEntregaItem" on conflict do nothing`,
  },
  {
    nome: "Entrega", origem: 'crm."Entrega"', destino: "public.com_entrega",
    ins: `insert into public.com_entrega(id,"oportunidadeId","contatoId",nome,status,"inicioEm","fimPrevistoEm","renovacaoEm","valorMensal","modeloId",diagnostico,"concluidaEm","renovacaoOportunidadeId","criadoEm","atualizadoEm")
      select id,"oportunidadeId","contatoId",nome,status,"inicioEm","fimPrevistoEm","renovacaoEm","valorMensal","modeloId",diagnostico,"concluidaEm","renovacaoOportunidadeId","criadoEm","atualizadoEm" from crm."Entrega" on conflict do nothing`,
  },
  {
    nome: "EntregaCartao", origem: 'crm."EntregaCartao"', destino: "public.com_entrega_cartao",
    ins: `insert into public.com_entrega_cartao(id,"entregaId",titulo,descricao,pilar,coluna,ordem,"dataAlvo",cliente,"responsavelId",checklist,"colunaDesdeEm","planejadoEm","concluidoEm","criadoEm")
      select k.id,k."entregaId",k.titulo,k.descricao,k.pilar,k.coluna,k.ordem,k."dataAlvo",k.cliente,mu.user_id,k.checklist,k."colunaDesdeEm",k."planejadoEm",k."concluidoEm",k."criadoEm"
      from crm."EntregaCartao" k left join _map_usuario mu on mu.crm_id=k."responsavelId" on conflict do nothing`,
  },
  {
    nome: "Produto", origem: 'crm."Produto"', destino: "public.com_produto",
    ins: `insert into public.com_produto(id,nome,codigo,descricao,valor,recorrencia,ativo,"criadoEm") select id,nome,codigo,descricao,valor,recorrencia,ativo,"criadoEm" from crm."Produto" on conflict do nothing`,
  },
  {
    nome: "OportunidadeProduto", origem: 'crm."OportunidadeProduto"', destino: "public.com_oportunidade_produto",
    ins: `insert into public.com_oportunidade_produto(id,"oportunidadeId","produtoId",nome,quantidade,"valorUnitario",desconto,recorrencia,"criadoEm")
      select id,"oportunidadeId","produtoId",nome,quantidade,"valorUnitario",desconto,recorrencia,"criadoEm" from crm."OportunidadeProduto" on conflict do nothing`,
  },
  {
    nome: "Proposta", origem: 'crm."Proposta"', destino: "public.com_proposta",
    ins: `insert into public.com_proposta(id,numero,"oportunidadeId",versao,status,titulo,introducao,condicoes,itens,"valorUnico","valorMensal","validaAte",token,"enviadaEm","visualizadaEm","respondidaEm","respostaNome","respostaComentario","criadoPorId","criadoEm","atualizadoEm")
      select p.id,p.numero,p."oportunidadeId",p.versao,p.status,p.titulo,p.introducao,p.condicoes,p.itens,p."valorUnico",p."valorMensal",p."validaAte",p.token,p."enviadaEm",p."visualizadaEm",p."respondidaEm",p."respostaNome",p."respostaComentario",coalesce(mu.user_id,p."criadoPorId"),p."criadoEm",p."atualizadoEm"
      from crm."Proposta" p left join _map_usuario mu on mu.crm_id=p."criadoPorId" on conflict do nothing`,
  },
  {
    nome: "Automacao", origem: 'crm."Automacao"', destino: "public.com_automacao",
    ins: `insert into public.com_automacao(id,nome,descricao,ativo,gatilho,criterios,acoes,"criadaPorId","criadoEm","atualizadoEm")
      select a.id,a.nome,a.descricao,a.ativo,a.gatilho,a.criterios,a.acoes,coalesce(mu.user_id,a."criadaPorId"),a."criadoEm",a."atualizadoEm"
      from crm."Automacao" a left join _map_usuario mu on mu.crm_id=a."criadaPorId" on conflict do nothing`,
  },
  {
    nome: "AutomacaoExecucao", origem: 'crm."AutomacaoExecucao"', destino: "public.com_automacao_execucao",
    ins: `insert into public.com_automacao_execucao(id,"automacaoId","oportunidadeId","referenciaId",gatilho,indice,"acaoTipo",chave,status,"executarEm","executadaEm",detalhe,"criadoEm")
      select id,"automacaoId","oportunidadeId","referenciaId",gatilho,indice,"acaoTipo",chave,status,"executarEm","executadaEm",detalhe,"criadoEm" from crm."AutomacaoExecucao" on conflict do nothing`,
  },
  {
    nome: "Meta", origem: 'crm."Meta"', destino: "public.com_meta",
    ins: `insert into public.com_meta(id,escopo,ano,mes,tipo,valor,"criadoEm","atualizadoEm") select id,escopo,ano,mes,tipo,valor,"criadoEm","atualizadoEm" from crm."Meta" on conflict do nothing`,
  },
  {
    nome: "ContaGoogle", origem: 'crm."ContaGoogle"', destino: "public.com_conta_google",
    ins: `insert into public.com_conta_google(id,"usuarioId",email,"refreshTokenCifrado","accessToken","accessExpiraEm",escopos,ativa,erro,"ultimaSincronizacaoEm","criadoEm","atualizadoEm")
      select g.id,mu.user_id,g.email,g."refreshTokenCifrado",g."accessToken",g."accessExpiraEm",g.escopos,g.ativa,g.erro,g."ultimaSincronizacaoEm",g."criadoEm",g."atualizadoEm"
      from crm."ContaGoogle" g join _map_usuario mu on mu.crm_id=g."usuarioId" on conflict do nothing`,
  },
  {
    nome: "ReuniaoGoogle", origem: 'crm."ReuniaoGoogle"', destino: "public.com_reuniao_google",
    ins: `insert into public.com_reuniao_google(id,"contaId","conferenceRecord",titulo,inicio,fim,"meetingCode",emails,participantes,transcricao,status,"oportunidadeId","analiseId","criadoEm","atualizadoEm")
      select id,"contaId","conferenceRecord",titulo,inicio,fim,"meetingCode",emails,participantes,transcricao,status,"oportunidadeId","analiseId","criadoEm","atualizadoEm" from crm."ReuniaoGoogle" on conflict do nothing`,
  },
  {
    nome: "EventoIntegracao", origem: 'crm."EventoIntegracao"', destino: "public.com_evento_integracao",
    ins: `insert into public.com_evento_integracao(id,"eventoId",origem,tipo,payload,status,detalhe,"recebidoEm")
      select id,"eventoId",origem,tipo,payload,status,detalhe,"recebidoEm" from crm."EventoIntegracao" on conflict do nothing`,
  },
];
// Fora da cópia (de propósito): Configuracao (credenciais Google: reentrar na tela), ChaveIntegracao e
// TentativaLogin (morrem com a ponte HTTP e o login próprio do CRM).

const SQL_MAPA_USUARIO = `create temp table _map_usuario on commit drop as
  select u.id as crm_id, coalesce(x.id, u.id) as user_id from crm."Usuario" u
  left join lateral (select id from public."User" where lower(email)=lower(u.email) order by "createdAt" limit 1) x on true`;
const SQL_CRIA_USUARIOS = `insert into public."User"(id,name,email,role,ativo,"createdAt","updatedAt")
  select u.id,u.nome,lower(u.email),case u.papel when 'ADMIN' then 'ADMIN' else 'SELLER' end,u.ativo,u."criadoEm",now()
  from crm."Usuario" u where not exists (select 1 from public."User" x where lower(x.email)=lower(u.email)) on conflict do nothing`;
const SQL_CRIA_MOTIVOS = `insert into public."MotivoEncerramento"(id,"organizationId",tipo,nome,ordem,ativo,"createdAt")
  select m.id,:org,m.tipo,m.nome,m.ordem,m.ativo,now() from crm."MotivoEncerramento" m
  where not exists (select 1 from public."MotivoEncerramento" x where x."organizationId"=:org and x.tipo=m.tipo and x.nome=m.nome) on conflict do nothing`;
const SQL_MAPA_MOTIVO = `create temp table _map_motivo on commit drop as
  select m.id as crm_id, x.id as motivo_id from crm."MotivoEncerramento" m
  join public."MotivoEncerramento" x on x."organizationId"=:org and x.tipo=m.tipo and x.nome=m.nome`;
const SEQUENCIAS = [["public.com_oportunidade", "numero"], ["public.com_proposta", "numero"]];

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const comOrg = (sql, org) => sql.replaceAll(":org", lit(org));
const existeTabela = async (t, db) => Boolean((await um(`select to_regclass(${lit(t)}) is not null as ok`, db)).ok);
const ondeOrigem = (t) => (t.filtro ? ` where ${t.filtro}` : "");
const ondeDestino = (t) => (t.destinoFiltro ? ` where ${t.destinoFiltro}` : "");

async function organizacao(db) {
  const pedida = valor("--org") ?? process.env.COMERCIAL_ORG_ID;
  const orgs = await q(`select id from public."WhatsappBusinessOrganization" order by "createdAt"`, db);
  if (pedida) {
    if (!orgs.some((o) => o.id === pedida)) throw new Error(`organização ${pedida} não existe`);
    return pedida;
  }
  if (orgs.length === 1) return orgs[0].id;
  throw new Error(`${orgs.length} organizações no Vendedor IA: informe --org <id>`);
}

// ─── Relatório (só leitura) ─────────────────────────────────────────────────────────────────
async function relatorio() {
  console.log("== Relatório (somente leitura) ==");
  const migrado = await existeTabela("public.com_oportunidade");
  if (!migrado) console.log("! Tabelas com_* ainda não existem neste banco (migração 20261116200000_comercial_nucleo pendente).");
  const orgs = await q(`select count(*)::int as n from public."WhatsappBusinessOrganization"`);
  console.log(`Organizações no Vendedor IA: ${orgs[0].n}`);
  console.log(["tabela".padEnd(22), "origem".padStart(7), "destino".padStart(8), "já copiadas".padStart(12), "a copiar".padStart(9)].join(" "));
  let total = 0;
  for (const t of T) {
    const o = await um(`select count(*)::int as n from ${t.origem}${ondeOrigem(t)}`);
    let d = "—", ja = 0;
    if (migrado && (await existeTabela(t.destino))) {
      d = (await um(`select count(*)::int as n from ${t.destino}${ondeDestino(t)}`)).n;
      ja = (await um(`select count(*)::int as n from ${t.origem} s where ${t.filtro ? `(${t.filtro}) and ` : ""}exists (select 1 from ${t.destino} x where x.id=s.id)`)).n;
    }
    total += o.n - ja;
    console.log([t.nome.padEnd(22), String(o.n).padStart(7), String(d).padStart(8), String(ja).padStart(12), String(o.n - ja).padStart(9)].join(" "));
  }
  const u = await um(`select count(*)::int as total, count(x.id)::int as casam from crm."Usuario" u left join lateral (select id from public."User" where lower(email)=lower(u.email) limit 1) x on true`);
  console.log(`Usuários do CRM: ${u.total} (casam por e-mail com User: ${u.casam}; a criar sem senha, só SSO: ${u.total - u.casam})`);
  const m = await um(`select count(*)::int as total, count(x.id)::int as existem from crm."MotivoEncerramento" m left join lateral (select x.id from public."MotivoEncerramento" x where x.tipo=m.tipo and x.nome=m.nome limit 1) x on true`);
  console.log(`Motivos do CRM: ${m.total} (já existem por tipo+nome no Vendedor IA: ${m.existem}; a inserir: ${m.total - m.existem})`);
  const l = await um(`select (select count(*)::int from crm."Oportunidade") as ops,
    (select count(*)::int from crm."Oportunidade" o where o."vendedorIaLeadId" is not null) as com_lead,
    (select count(*)::int from crm."Oportunidade" o join public."Lead" l on l.id=o."vendedorIaLeadId") as lead_existe,
    (select count(*)::int from crm."Contato" c where c."vendedorIaLeadId" is not null) as contatos_com_lead,
    (select count(*)::int from crm."Contato" c join public."Lead" l on l.id=c."vendedorIaLeadId") as contatos_lead_existe`);
  console.log(`Ponte Lead: oportunidades ${l.ops}, com lead ${l.com_lead}, lead existe ${l.lead_existe}; contatos com lead ${l.contatos_com_lead}, lead existe ${l.contatos_lead_existe} (lead ausente vira leadId nulo)`);
  const ext = await um(`select count(*)::int as n from crm."Mensagem" where origem='EXTENSAO'`);
  console.log(`Mensagens da extensão (ficam de fora): ${ext.n}`);
  const fora = await um(`select (select count(*)::int from crm."Configuracao") as cfg, (select count(*)::int from crm."ChaveIntegracao") as chaves, (select count(*)::int from crm."TentativaLogin") as tent`);
  console.log(`Fora da cópia por desenho: Configuracao ${fora.cfg}, ChaveIntegracao ${fora.chaves}, TentativaLogin ${fora.tent}`);
  console.log(`Total de linhas a copiar: ${total}`);
}

// ─── Cópia ────────────────────────────────────────────────────────────────────────────────
async function copiarEm(tx, org) {
  const ins = {};
  ins.User = await exec(SQL_CRIA_USUARIOS, tx);
  await exec(SQL_MAPA_USUARIO, tx);
  ins.MotivoEncerramento = await exec(comOrg(SQL_CRIA_MOTIVOS, org), tx);
  await exec(comOrg(SQL_MAPA_MOTIVO, org), tx);
  for (const t of T) {
    ins[t.nome] = await exec(comOrg(t.ins, org), tx);
    if (t.depois) ins[`${t.nome} (participantes)`] = await exec(t.depois, tx);
  }
  for (const [tabela, col] of SEQUENCIAS) {
    await exec(`select setval(pg_get_serial_sequence(${lit(tabela)}, ${lit(col)}), coalesce((select max(${col}) from ${tabela}), 0) + 1, false)`, tx);
  }
  return ins;
}

function imprimirInseridas(ins) {
  for (const [k, v] of Object.entries(ins)) console.log(`${k.padEnd(32)} inseridas=${v}`);
  console.log(`TOTAL inseridas=${Object.values(ins).reduce((s, n) => s + n, 0)}`);
}

async function copiar() {
  const org = await organizacao();
  const ins = await prisma.$transaction((tx) => copiarEm(tx, org), { timeout: 600_000, maxWait: 30_000 });
  console.log("== Cópia concluída ==");
  imprimirInseridas(ins);
}

const DELETAR_COM = [...T].reverse();
async function apagarCopiados(tx, { tudo }) {
  const apagadas = {};
  for (const t of DELETAR_COM) {
    if (t.nome === "Compromisso") {
      await exec(`delete from public."CalendarAttendee" where "calendarEventId" in (select id from crm."Compromisso")${tudo ? ` or "calendarEventId" in (select id from public."CalendarEvent" where ${t.destinoFiltro})` : ""}`, tx);
      apagadas[t.nome] = await exec(`delete from public."CalendarEvent" where id in (select id from crm."Compromisso")${tudo ? ` or ${t.destinoFiltro}` : ""}`, tx);
      continue;
    }
    // Ordem inversa de dependência; FKs com cascade (filhas) já sumiram antes.
    apagadas[t.nome] = await exec(tudo ? `delete from ${t.destino}` : `delete from ${t.destino} where id in (select id from ${t.origem})`, tx);
  }
  return apagadas;
}

async function refazer() {
  const org = await organizacao();
  const r = await prisma.$transaction(async (tx) => {
    const apagadas = await apagarCopiados(tx, { tudo: true });
    const ins = await copiarEm(tx, org);
    return { apagadas, ins };
  }, { timeout: 600_000, maxWait: 30_000 });
  console.log("== Refeito: com_* apagadas e copiadas de novo ==");
  for (const [k, v] of Object.entries(r.apagadas)) console.log(`${k.padEnd(32)} apagadas=${v}`);
  imprimirInseridas(r.ins);
}

async function desfazer() {
  const r = await prisma.$transaction(async (tx) => {
    const apagadas = await apagarCopiados(tx, { tudo: false });
    // Motivos e usuários que a cópia criou (mesmo id do CRM) e que ninguém mais usa.
    apagadas.MotivoEncerramento = await exec(`delete from public."MotivoEncerramento" m where m.id in (select id from crm."MotivoEncerramento")
      and not exists (select 1 from public."Lead" l where l."motivoEncerramentoId"=m.id) and not exists (select 1 from public.com_oportunidade o where o."motivoId"=m.id)`, tx);
    apagadas.User = await exec(`delete from public."User" u where u.id in (select id from crm."Usuario") and u.password is null
      and not exists (select 1 from public."Account" a where a."userId"=u.id) and not exists (select 1 from public."Session" s where s."userId"=u.id)
      and not exists (select 1 from public.com_oportunidade o where o."responsavelId"=u.id) and not exists (select 1 from public.com_contato c where c."responsavelId"=u.id)
      and not exists (select 1 from public.com_tarefa t where t."responsavelId"=u.id)`, tx);
    return apagadas;
  }, { timeout: 600_000, maxWait: 30_000 });
  console.log("== Desfeito ==");
  for (const [k, v] of Object.entries(r)) console.log(`${k.padEnd(32)} apagadas=${v}`);
}

// ─── Verificação ────────────────────────────────────────────────────────────────────────────
async function verificar() {
  const extrasOk = flag("--permitir-extras");
  const erros = [];
  const avisos = [];
  const cmp = (rotulo, a, b) => {
    const ok = JSON.stringify(a) === JSON.stringify(b);
    console.log(`${ok ? "OK " : "ERR"} ${rotulo}: origem=${JSON.stringify(a)} destino=${JSON.stringify(b)}`);
    if (!ok) erros.push(rotulo);
  };
  if (!(await existeTabela("public.com_oportunidade"))) {
    console.log("ERR tabelas com_* não existem (migração pendente)");
    process.exitCode = 1;
    return;
  }
  console.log("== Verificação (origem crm × destino public) ==");
  for (const t of T) {
    const o = await um(`select count(*)::int as n, coalesce(md5(string_agg(id, ',' order by id)), '') as h from ${t.origem}${ondeOrigem(t)}`);
    const presentes = await um(`select count(*)::int as n, coalesce(md5(string_agg(s.id, ',' order by s.id)), '') as h from ${t.origem} s where ${t.filtro ? `(${t.filtro}) and ` : ""}exists (select 1 from ${t.destino} x where x.id=s.id)`);
    const d = await um(`select count(*)::int as n, coalesce(md5(string_agg(id, ',' order by id)), '') as h from ${t.destino}${ondeDestino(t)}`);
    cmp(`${t.nome}: todas as linhas copiadas (contagem, md5 dos ids)`, [o.n, o.h], [presentes.n, presentes.h]);
    if (d.n !== o.n || d.h !== o.h) {
      const msg = `${t.nome}: destino tem ${d.n - presentes.n} linha(s) que não vieram do CRM`;
      if (extrasOk) { avisos.push(msg); console.log(`AVISO ${msg}`); } else { erros.push(msg); console.log(`ERR ${msg}`); }
    }
  }
  // Oportunidade: por status, por etapa (nome), somas, datas, número e sequência.
  const opO = await um(`select coalesce(json_agg(x order by x.k), '[]') as v from (select status as k, count(*)::int as n from crm."Oportunidade" group by 1) x`);
  const opD = await um(`select coalesce(json_agg(x order by x.k), '[]') as v from (select status as k, count(*)::int as n from public.com_oportunidade where id in (select id from crm."Oportunidade") group by 1) x`);
  cmp("Oportunidade por status", opO.v, opD.v);
  const etO = await um(`select coalesce(json_agg(x order by x.k), '[]') as v from (select e.nome as k, count(*)::int as n from crm."Oportunidade" o join crm."Etapa" e on e.id=o."etapaId" group by 1) x`);
  const etD = await um(`select coalesce(json_agg(x order by x.k), '[]') as v from (select e.nome as k, count(*)::int as n from public.com_oportunidade o join public.com_etapa e on e.id=o."etapaId" where o.id in (select id from crm."Oportunidade") group by 1) x`);
  cmp("Oportunidade por etapa", etO.v, etD.v);
  const agg = (tab, filtro = "") => `select coalesce(sum("valorUnico"),0)::text as unico, coalesce(sum("valorMensal"),0)::text as mensal, min("criadoEm")::text as min, max("criadoEm")::text as max, coalesce(max(numero),0)::int as numero, count("encerradaEm")::int as encerradas from ${tab}${filtro}`;
  const aO = await um(agg('crm."Oportunidade"'));
  const aD = await um(agg("public.com_oportunidade", ` where id in (select id from crm."Oportunidade")`));
  cmp("Oportunidade somas/datas/número", aO, aD);
  const seq = await um(`select (select coalesce(max(numero),0) from public.com_oportunidade)::int as maxnum,
    (select last_value from public.com_oportunidade_numero_seq)::int as ultimo, (select is_called from public.com_oportunidade_numero_seq) as chamado`);
  const proximo = seq.chamado ? seq.ultimo + 1 : seq.ultimo;
  if (proximo > seq.maxnum) console.log(`OK  sequência do número da oportunidade: próximo=${proximo} > máximo=${seq.maxnum}`);
  else { erros.push("sequência do número"); console.log(`ERR sequência do número da oportunidade: próximo=${proximo} <= máximo=${seq.maxnum}`); }
  const respO = await um(`select count("responsavelId")::int as n from crm."Oportunidade"`);
  const respD = await um(`select count("responsavelId")::int as n from public.com_oportunidade where id in (select id from crm."Oportunidade")`);
  cmp("Oportunidade com responsável", respO.n, respD.n);
  const motO = await um(`select count("motivoId")::int as n from crm."Oportunidade"`);
  const motD = await um(`select count("motivoId")::int as n from public.com_oportunidade where id in (select id from crm."Oportunidade")`);
  cmp("Oportunidade com motivo", motO.n, motD.n);
  const leadO = await um(`select count(*)::int as n from crm."Oportunidade" o join public."Lead" l on l.id=o."vendedorIaLeadId"`);
  const leadD = await um(`select count("leadId")::int as n from public.com_oportunidade where id in (select id from crm."Oportunidade")`);
  cmp("Oportunidade ligada a Lead existente", leadO.n, leadD.n);
  // Contato: por tipo, por ciclo de vida, ponte com Lead.
  const grp = (col, tab, filtro = "") => `select coalesce(json_agg(x order by x.k), '[]') as v from (select ${col} as k, count(*)::int as n from ${tab}${filtro} group by 1) x`;
  cmp("Contato por tipo", (await um(grp("tipo", 'crm."Contato"'))).v, (await um(grp("tipo", "public.com_contato", ` where id in (select id from crm."Contato")`))).v);
  cmp("Contato por ciclo de vida", (await um(grp(`"cicloDeVida"`, 'crm."Contato"'))).v, (await um(grp(`"cicloDeVida"`, "public.com_contato", ` where id in (select id from crm."Contato")`))).v);
  const cl = await um(`select count(*)::int as n from crm."Contato" c join public."Lead" l on l.id=c."vendedorIaLeadId"`);
  const cd = await um(`select count("leadId")::int as n from public.com_contato where id in (select id from crm."Contato")`);
  cmp("Contato ligado a Lead existente", cl.n, cd.n);
  // Filhas por oportunidade (md5 de oportunidadeId:quantidade).
  for (const [nome, o, d] of [["HistoricoEtapa", 'crm."HistoricoEtapa"', "public.com_historico_etapa"], ["Feedback", 'crm."Feedback"', "public.com_feedback"], ["Tarefa", 'crm."Tarefa"', "public.com_tarefa"]]) {
    const h = (tab, f = "") => `select coalesce(md5(string_agg(k || ':' || n, ',' order by k)), '') as h from (select coalesce("oportunidadeId",'-') as k, count(*)::int as n from ${tab}${f} group by 1) x`;
    cmp(`${nome} por oportunidade (md5)`, (await um(h(o))).h, (await um(h(d, ` where id in (select id from ${o})`))).h);
  }
  cmp("Tarefa por status", (await um(grp("status", 'crm."Tarefa"'))).v, (await um(grp("status", "public.com_tarefa", ` where id in (select id from crm."Tarefa")`))).v);
  // Usuários e motivos mapeados.
  const um1 = await um(`select count(*)::int as total, count(x.id)::int as casam from crm."Usuario" u left join lateral (select id from public."User" where lower(email)=lower(u.email) limit 1) x on true`);
  cmp("Usuários do CRM existem em User (por e-mail)", um1.total, um1.casam);
  const mo = await um(`select count(*)::int as total, count(x.id)::int as casam from crm."MotivoEncerramento" m left join lateral (select x.id from public."MotivoEncerramento" x where x.tipo=m.tipo and x.nome=m.nome limit 1) x on true`);
  cmp("Motivos do CRM existem no Vendedor IA", mo.total, mo.casam);
  // Órfãos no destino (FK sem pai) — as FKs do banco já impedem; conferência explícita das pontes opcionais.
  const orf = await um(`select
    (select count(*)::int from public.com_contato c where c."leadId" is not null and not exists (select 1 from public."Lead" l where l.id=c."leadId")) as contato_lead,
    (select count(*)::int from public.com_oportunidade o where o."leadId" is not null and not exists (select 1 from public."Lead" l where l.id=o."leadId")) as op_lead,
    (select count(*)::int from public.com_contato c where c."empresaId" is not null and not exists (select 1 from public.com_contato e where e.id=c."empresaId")) as empresa`);
  cmp("Órfãos no destino", orf, { contato_lead: 0, op_lead: 0, empresa: 0 });

  console.log(erros.length ? `\nVERMELHO: ${erros.length} divergência(s)` : `\nVERDE${avisos.length ? ` (com ${avisos.length} aviso(s))` : ""}`);
  if (erros.length) process.exitCode = 1;
}

// ─── Início ────────────────────────────────────────────────────────────────────────────────
async function main() {
  if (!refApi) {
    const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!url) throw new Error("DIRECT_URL/DATABASE_URL não definido");
    prisma = new PrismaClient({ datasources: { db: { url } } });
  }
  try {
    if (!(await existeTabela("crm.\"Oportunidade\""))) throw new Error('schema "crm" não encontrado ou sem acesso (use o papel dono, ex.: postgres)');
    if (modo === "--relatorio") await relatorio();
    else if (modo === "--copiar") await copiar();
    else if (modo === "--verificar") await verificar();
    else if (modo === "--refazer") await refazer();
    else if (modo === "--desfazer") await desfazer();
  } finally {
    await prisma?.$disconnect();
  }
}

main().catch((e) => {
  console.error(`[comercial-copiar] ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
