# Financeiro — regras do módulo

## Competência mensal
- A **Visão Geral** é por competência: sem filtro mostra só o **mês corrente (data de Brasília)**. Na virada do dia 1º passa sozinha para o mês novo e compara com o mês anterior.
- Filtros: **Mês** (com ‹ ›), **Dia**, **Período** livre; escopo **Tudo / Nexo / Pessoal**. Lógica em `src/lib/finance/periodo.ts` (`resolverPeriodo`, `periodoAnterior`).
- Nada some: receitas em aberto de meses anteriores aparecem à parte ("em atraso de períodos anteriores").

## Nexo × Pessoal
Usa o campo `tipo_negocio` (`nexo`, `pessoal`, e `lukaizen`/`geral` agrupados em "outros"). Em `ReceitaPrevistaMax` vazio conta como pessoal. Ver `src/lib/finance/escopo.ts`.

## Receita perdida
`PATCH /api/financeiro/receitas/:id` com `acao`: `confirmar` | `perder` (motivo opcional) | `reverter_perda`. A receita **não é apagada**: fica com status `perdida`, `motivo_perda` e `data_perda`. Não conta como receita nem entra na projeção/alertas do Max (que só olham `pendente`/`atrasada`).

## Contratos e parcelamentos
`POST /api/financeiro/receitas` com `modo`:
- `avulsa` — um recebimento;
- `parcelada` — `valor_total` dividido em `meses` (sobra de centavos nas primeiras parcelas);
- `recorrente` — `valor_parcela` por mês, por `meses` meses ou **indeterminado** (`meses` nulo; o sistema mantém 12 meses gerados à frente, sem cron: `garantirParcelasContratos`).

As parcelas (`ReceitaPrevistaMax` com `contrato_id`/`parcela_numero`) são geradas automaticamente; a mesma função pura (`src/lib/finance/parcelas.ts`) alimenta a prévia do formulário. Dia 31 é limitado ao último dia de cada mês. `PATCH /api/financeiro/contratos/:id {acao:"encerrar"}` marca as parcelas futuras pendentes como perdidas.

## Histórico nunca se perde
`src/lib/finance/historico.ts` instala um middleware no Prisma compartilhado: toda criação/alteração/exclusão nos modelos financeiros grava um retrato em `HistoricoFinanceiro` (`max_historico_financeiro`) — vindo das telas, do bot do WhatsApp ou de cron.
- Exclusões são gravadas **antes** de executar; se o registro falhar, a exclusão é abortada.
- Aba **Histórico** lista tudo e **restaura** lançamentos excluídos (`Transacao`, `ReceitaPrevistaMax`, `ContaPagarMax`).
- `carimbarHistoricoInicial` cria (uma vez) a entrada "criado" dos lançamentos que já existiam antes.
- Atenção: só escritas feitas pelo `prisma` de `@/lib/prisma/client` são auditadas — não instancie `new PrismaClient()` para escrever em tabelas financeiras.

## Esquema (somente aditivo)
O build roda `prisma db push --accept-data-loss`: nunca remova/renomeie colunas financeiras. Adicionados: colunas em `max_receitas_previstas`, `max_contratos_receita`, `max_historico_financeiro`.

Teste: `DATABASE_URL=... DIRECT_URL=... npx tsx tests/test-financeiro.ts` (banco descartável).
