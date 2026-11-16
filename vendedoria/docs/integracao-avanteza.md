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
