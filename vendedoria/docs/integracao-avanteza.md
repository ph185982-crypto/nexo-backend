# Integração com a Central Avanteza — métricas para o painel "Dashboards"

A Central (`avanteza/`, app.avanteza.com.br) mostra no painel **Dashboards** os números comerciais e financeiros da
Avanteza. A fonte é este app, por um endpoint **somente leitura** que devolve **só agregados**.

## Endpoint

```
GET /api/integracoes/avanteza/metricas?from=YYYY-MM-DD&to=YYYY-MM-DD
Authorization: Bearer <AVANTEZA_METRICS_KEY>
```

| Resposta | Quando |
|---|---|
| 200 | chave certa e período válido (JSON abaixo, `Cache-Control: no-store`) |
| 400 | `from`/`to` ausentes, datas inválidas, `from` depois de `to` ou período maior que 366 dias |
| 401 | sem `Authorization`, formato errado ou chave errada (`WWW-Authenticate: Bearer`) |
| 503 | `AVANTEZA_METRICS_KEY` não configurada neste projeto (a rota nunca fica "aberta") |
| 500 | falha ao consultar o banco (sem detalhes no corpo) |

- A chave é comparada em tempo constante (`sha256` dos dois lados + `timingSafeEqual`).
- A rota está em `PREFIXOS_PUBLICOS` (`src/lib/auth/rotas-publicas.ts`) **só** para passar pelo NextAuth: ela mesma faz a
  autenticação. Nenhuma outra rota de `/api/integracoes/` foi aberta.
- Datas e dias são de **Brasília** (UTC-3). O período anterior tem o mesmo número de dias, logo antes de `from`.

## Escopo e privacidade

- **Financeiro: só a empresa Avanteza.** `tipo_negocio` = `nexo` (e o legado `vendedoria`, que a migração do Max renomeia
  para `nexo`). **Pessoal**, `lukaizen`, `geral` e receitas previstas sem tipo (que valem pessoal) **nunca** entram.
  O payload traz `escopo` declarando isso.
- **Comercial (leads/funil):** todas as organizações do Vendedor IA, ou só uma se `AVANTEZA_METRICS_ORG_ID` estiver definida.
- **Só agregados:** contagens, somas e séries diárias. Sem nome, telefone, e-mail, texto de conversa nem descrição de
  lançamento. Os únicos textos são rótulos: nome/tipo da etapa do funil e categoria do lançamento.
- Só leitura: nada de `create/update/delete`, nem a migração `tipo_negocio` nem a geração de parcelas que o painel
  financeiro faz ao abrir (teste em `tests/avanteza-metricas.test.ts` garante).

## Payload (versão 1)

```jsonc
{
  "versao": 1, "geradoEm": "ISO", "escopo": { "financeiro": "avanteza", "tiposNegocio": ["nexo","vendedoria"], "excluido": [...], "comercial": "...", "observacao": "..." },
  "atual":    BlocoPeriodo,   // from..to
  "anterior": BlocoPeriodo,   // período anterior, mesmo tamanho (para variação)
  "previstos": { "referencia": "hoje", "aReceber": {...}, "aPagar": {...}, "saldoProjetado30": n, "saldoProjetado90": n },
  "contratos": { "ativos": n, "recorrentes": n, "parcelados": n, "valorMensalRecorrente": n, "saldoAReceberParcelados": n }
}
// BlocoPeriodo
{
  "periodo": { "from", "to", "dias" },
  "leads": { "novos", "porEtapa": [{ "etapa", "tipo", "quantidade" }], "ganhos", "perdidos" },
  "conversao": { "leadsDaCoorte", "viraramCliente", "taxaPct" },
  "vendas": { "quantidade", "valor", "ticketMedio", "comValor" },
  "faturamento": { "vendido", "contratosRecorrentesNovos", "valorMensalRecorrenteNovo", "contratosParceladosNovos", "valorParceladoNovo" },
  "financeiro": { "receitas", "despesas", "resultado", "receitasPorCategoria": [...], "despesasPorCategoria": [...] },
  "series": [{ "data", "leadsNovos", "ganhos", "vendas", "receitas", "despesas" }]  // um item por dia
}
```

Definições:

- **Leads novos:** `Lead.createdAt` no período. **por etapa:** esses mesmos leads, na etapa em que estão hoje.
- **Ganhos / perdidos:** leads que *entraram* numa etapa de ganho (`GANHO`) / de perda (`LOST`, `DESCARTADO`, `JUNK`) no
  período, pelo `LeadStageHistory` (um lead conta uma vez). Perdidos é contagem de leads distintos.
- **Conversão lead→cliente:** da *coorte* dos leads criados no período, quantos estão hoje em etapa de ganho
  (`viraramCliente / leadsDaCoorte`). Nunca passa de 100%. `null` se não houve lead novo.
- **Vendas:** negócios ganhos no período; `valor` = soma de `Lead.valorContrato` dos que têm valor (`comValor`);
  `ticketMedio` = valor / comValor. Pedidos do checkout de produto (`Checkout`, `PedidoNacional`) **não** entram: não têm
  escopo Avanteza/pessoal.
- **Faturamento (vendido):** o mesmo valor das vendas; mais os contratos de receita novos (`ContratoReceita` com
  `data_inicio` no período: recorrentes pelo valor mensal, parcelados pelo `valor_total`).
- **Receitas / despesas:** `Transacao` confirmadas (`confirmado = true`) com `data_transacao` no período. Resultado = receitas − despesas.
  Receitas já recebidas de previstos viram `Transacao`, então **não** há dupla contagem com `previstos`.
- **Previstos (retrato de hoje):** `ReceitaPrevistaMax` pendentes/atrasadas e `ContaPagarMax` pendentes. `total`/`quantidade`
  = vencimento de hoje em diante; `atrasado` = vencimento anterior a hoje; `proximosN` = vence em até N dias;
  `deContratos` = parcelas geradas por contratos. As parcelas de contratos recorrentes existem até 12 meses à frente
  (geradas pelo painel financeiro; este endpoint não gera).
- **Contratos ativos:** `ContratoReceita` com `status = ativo` (Avanteza); `valorMensalRecorrente` = soma das parcelas dos recorrentes.
- **CAC não é calculado aqui:** a Central divide o investimento da Meta pelos novos clientes (`leads.ganhos`) do período.

## Configuração (Vercel do projeto nexo-vendedoria)

| Variável | Obrigatória | Para quê |
|---|---|---|
| `AVANTEZA_METRICS_KEY` | sim | chave do endpoint (a **mesma** vai na Central). Gere com `openssl rand -base64 36`. Sem ela: 503. |
| `AVANTEZA_METRICS_ORG_ID` | não | restringe o comercial a uma organização (id de `WhatsappBusinessOrganization`). Vazio = todas. |

Teste local: `DATABASE_URL=... npx tsx --test tests/avanteza-metricas.test.ts`.

---

# API de serviço do Financeiro (Central Avanteza → Vendedor IA)

A tela **Financeiro** da Central (`/financeiro`) lê e escreve nas MESMAS tabelas do Max (`Transacao`, `ContaPagarMax`,
`ReceitaPrevistaMax`, `ContratoReceita`, `MetaFinanceiraMax`/`AporteMetaMax`) por esta API. O Max continua respondendo no
WhatsApp, sem mudança de schema.

```
{GET|POST|PATCH|DELETE} /api/integracoes/avanteza/financeiro/<recurso>?escopo=empresa|pessoal
Authorization: Bearer <AVANTEZA_FINANCE_KEY>
```

- **Autenticação própria** (a rota está na lista pública do middleware; o prefixo é exato): sem `AVANTEZA_FINANCE_KEY` na
  Vercel responde **503**; chave ausente/errada **401**; comparação em tempo constante (hash dos dois lados). É uma chave
  **diferente** da `AVANTEZA_METRICS_KEY` (a de métricas, só leitura de agregados, não abre o financeiro).
- **Mesma regra de negócio:** a rota valida com zod e executa as rotas `/api/financeiro/*` (as da tela do Vendedor IA), que usam
  `src/lib/finance/*`. Só dentro dessa execução `auth()` devolve a sessão de serviço (`src/lib/finance/servico.ts`, AsyncLocalStorage).
  O histórico (`HistoricoFinanceiro`) audita as escritas como sempre.
- **Escopo obrigatório:** `escopo=empresa` (`tipo_negocio = nexo`) ou `escopo=pessoal` (`pessoal`; em receitas previstas, vazio também).
  `todos` é recusado. Criações recebem o negócio do escopo (o corpo não o escolhe). Ids de outro escopo respondem **404**.
  Reclassificar Empresa × Pessoal: `PATCH transacoes/:id` com `{"tipo_negocio":"nexo"|"pessoal"}` (e `receitas/:id` com `acao:"editar"`;
  `contas/:id` com `acao:"editar"`). Lançamentos de `lukaizen`/`geral` ficam fora dos dois escopos.
- **Sem logs de valores:** a rota não escreve log; erros internos voltam como `{"error":"falha ao processar"}`; erros de validação
  listam só os nomes dos campos.
- Respostas com `Cache-Control: no-store`. Corpo e query com campos desconhecidos são recusados (400).

| Método e recurso | O que faz |
|---|---|
| `GET transacoes` | extrato paginado: `tipo`, `categoria`, `texto`, `data_inicio`, `data_fim`, `confirmado`, `page`, `pageSize` (≤100) |
| `POST transacoes` | `{tipo, valor, descricao, categoria, data_transacao?, empresa?}` (sem data = dia de Brasília) |
| `PATCH transacoes/:id` | edita; aceita `tipo_negocio` (reclassificar) e `confirmado` |
| `POST transacoes/:id/confirmar` | marca o lançamento como confirmado |
| `DELETE transacoes/:id` | exclui (o livro-razão grava a cópia antes) |
| `GET contas` · `POST contas` | contas a pagar (`status`); criação `{descricao, valor, data_vencimento, categoria?, recorrente?, frequencia?}` |
| `PATCH contas/:id` | `{acao:"pagar"}` (gera a despesa no extrato) · `{acao:"cancelar"}` · `{acao:"editar", …}` |
| `DELETE contas/:id` | exclui a conta |
| `GET receitas` · `POST receitas` | receitas previstas (`mes|dia|de|ate`, `status`, `contrato_id`); `modo` `avulsa`, `parcelada` ou `recorrente` (gera as parcelas) |
| `PATCH receitas/:id` | `{acao:"confirmar"}` (baixa: marca recebida e lança a entrada) · `perder` · `reverter_perda` · `editar` |
| `GET contratos` · `PATCH contratos/:id` | contratos de receita com andamento das parcelas · `{acao:"encerrar"}` / `{acao:"editar", …}` |
| `GET metas` · `POST metas/aportes` · `PATCH metas/:id` · `DELETE metas/aportes/:id` | metas de poupança (**só `escopo=pessoal`**; empresa = 404) |
| `GET resumo` | visão geral (mesmo cálculo de `/api/financeiro/overview`): `mes|dia|de|ate` |
| `GET dre` | DRE gerencial (mesmo cálculo da aba DRE) |
| `GET categorias` | categorias de receita/despesa usadas no escopo |
| `GET projecao` | projeção de caixa dia a dia (`dias` 1–60, padrão 30) **do escopo pedido**: saldo do mês até hoje (confirmados), gasto médio diário dos últimos 60 dias, receitas previstas e contas a pagar pendentes de cada dia, `primeiro_negativo` |
| `GET orcamentos` · `POST orcamentos` · `DELETE orcamentos?categoria=` | limites mensais por categoria com o gasto do mês (`gasto_atual`, só despesas pessoais); `POST {categoria, limite_mensal}` cria ou atualiza. **Só `escopo=pessoal`** (empresa = 404: a tabela não tem campo de negócio) |
| `GET dividas` · `PATCH dividas/:id` | dívidas ativas com `restante` e `progresso`; `{acao:"pagar_parcela", valor}` (lança a despesa pessoal) · `{acao:"quitar"}`. **Só `escopo=pessoal`.** Não existe criação por esta API (o Max cadastra) |
| `GET contratos-despesa` · `POST contratos-despesa` · `PATCH contratos-despesa/:id` | contratos de despesa (financiamento, parcela, internet…) com `pagas`, `restantes`, `proxima`; criação `{descricao, valor_parcela, primeiro_vencimento, parcelas_total?, dia_vencimento?, credor?, categoria?, entrada?, entrada_data?, saldo_devedor?, estimada?, observacao?}` (gera as contas do mês e do seguinte); `{acao:"editar"\|"encerrar"\|"reativar"}` (editar aceita `tipo_negocio` para reclassificar). Nunca apaga |
| `GET historico` · `POST historico/:id/restaurar` | livro-razão do escopo (`entidade`, `acao`, `de`, `ate`, `q`, `page`, `pageSize`) e restauração de **lançamentos, receitas previstas e contas excluídos** |

### Etapa 2: projeção, orçamentos, dívidas, contratos de despesa e histórico

- **Projeção sempre por escopo.** A rota da tela (`/api/financeiro/projecao`) continua somando os dois lados quando chamada sem
  `?escopo=`; a API de serviço sempre passa `nexo`/`pessoal`, que filtra as quatro fontes (lançamentos, burn, receitas
  previstas — vazio vale pessoal —, contas a pagar). Teste de banco garante que conta/receita pessoal não aparece na empresa.
  Também passou a contar só lançamentos `confirmado = true`, como a visão geral. Não existem cenários na regra de negócio: é um
  único caminho. A projeção **não** inclui contas e receitas já vencidas em aberto, e o gasto médio diário e as contas
  pendentes podem se sobrepor (regra herdada da tela; é estimativa, não saldo bancário).
- **Histórico por escopo.** `HistoricoFinanceiro` não tem coluna de escopo; vale o retrato mais recente da linha
  (`src/lib/finance/historico-escopo.ts`): `tipo_negocio` `nexo` = empresa, `pessoal` = pessoal (vazio vale pessoal em receita
  prevista e meta); dívidas, orçamentos e aportes só existem no pessoal; DRE e modelos legados não têm escopo e **não aparecem
  em nenhum dos dois**. Uma linha reclassificada aparece só no escopo em que está agora. Restaurar exige que a linha seja do
  escopo pedido (senão 404) e segue a regra da tela: só `Transacao`, `ReceitaPrevistaMax` e `ContaPagarMax`.
- Escritas continuam auditadas pelo próprio livro-razão (`HistoricoFinanceiro`), como as da tela.

| Variável (Vercel do **nexo-vendedoria**) | Obrigatória | Para quê |
|---|---|---|
| `AVANTEZA_FINANCE_KEY` | sim, para a Central usar o Financeiro | chave da API acima (a **mesma** vai na Central). `openssl rand -base64 36`. Sem ela: 503. |

Testes: `DATABASE_URL=... npx tsx --test tests/avanteza-financeiro-api.test.ts` (banco descartável).

## Correções de despesas feitas junto (2026-11-16)

- `POST /api/financeiro/transacoes` sem data usava `new Date()` (UTC): lançamentos feitos depois das 21h de Brasília caíam no dia
  seguinte (e, no último dia do mês, no mês seguinte). Agora usa o dia de Brasília; datas só-dia são lidas em UTC.
- A visão geral e a DRE da tela somavam lançamentos `confirmado = false`; as métricas da Central não. Agora todos exigem `confirmado = true`.
- Max: confirmar uma receita prevista duas vezes lançava a entrada em dobro; pagar uma conta duas vezes lançava a despesa (e a
  próxima recorrência) em dobro. Agora o segundo pedido responde "já está confirmada/paga" sem lançar. Receita prevista sem
  negócio confirmada pelo Max virava `geral` (fora dos dois escopos); agora vira `pessoal`, como na tela.

# Max → Central: Inbox de combinados dos clientes (F2)

O Max (assistente do dono no WhatsApp; só o número do dono chega a ele) passa a registrar na Central o que é combinado com
os **clientes da consultoria** — nada do financeiro do Max mudou. Cliente HTTP: `src/lib/integracoes/avanteza-central.ts`
(respostas validadas com zod, timeout em toda chamada, só a leitura de pendências repete uma vez; escrita nunca repete).
Ferramentas: `src/lib/max/tools/central.ts`. Contrato das rotas: `avanteza/docs/eventos.md` (seção Capturas).

| Ferramenta do Max | Pedido do dono | Rota da Central |
|---|---|---|
| `registrar_para_cliente` | "para a Showman: …", mensagem encaminhada, áudio transcrito, legenda de foto/PDF | `POST /api/capturas` (`origem: whatsapp_max`) |
| `pendencias_do_cliente` | "o que falta para a Ladies?" | `GET /api/capturas/pendencias?cliente=` |
| `concluir_acao` | "concluí X da Showman" (ação ambígua → pergunta qual e reenvia com `acao_id`) | `POST /api/capturas/concluir` |
| `importar_conversa` | `.txt`/`.zip` do "Exportar conversa" mandado como documento | `POST /api/capturas/importar` (arquivo cru, até 4 MB) |

- Cliente ambíguo → a Central responde 409 com as opções e o Max pergunta. Cliente desconhecido → o Max pergunta o nome.
- Documento `.txt`/`.zip`: o responder guarda só a referência da mídia (`max_contexto_pedro`, chave `max-importacao-pendente`)
  e o arquivo é baixado da Meta de novo quando o Max chama `importar_conversa`; depois de importado a referência é apagada.
  Arquivo acima de 4 MB: o Max pede para exportar "sem mídia".

## Configuração (Vercel do projeto nexo-vendedoria)

- `AVANTEZA_CAPTURE_KEY` — a **mesma** da Central (`openssl rand -base64 36`). Sem ela as ferramentas respondem "integração
  não configurada" e nada é chamado.
- `CENTRAL_URL` — opcional, padrão `https://app.avanteza.com.br`.
