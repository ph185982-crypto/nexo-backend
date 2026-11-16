# API de serviço para a Central Avanteza — Funil de Entrega

Contrato **estável** entre a Central (Operações → Entregas, `/operacoes/entregas`) e o dono dos dados do funil de entrega.
Hoje o dono é o CRM (modelos `Entrega`, `EntregaCartao`, `ModeloEntrega`). Na Etapa 3 do plano de departamentos o mesmo
contrato será servido pelo Vendedor IA; a Central só troca `CRM_URL`. Por isso: não renomear campos, só acrescentar.

## Autenticação

- Variável no **CRM** (projeto `nexo-crm`): `AVANTEZA_CRM_KEY` (segredo, mínimo 16 caracteres; sugestão: `openssl rand -hex 32`).
- Variável na **Central**: a mesma `AVANTEZA_CRM_KEY` e `CRM_URL` (padrão `https://nexo-crm-tawny.vercel.app`).
- Toda chamada: `Authorization: Bearer <AVANTEZA_CRM_KEY>`.
- `503` sem a variável configurada (a API fica desligada, nunca aberta); `401` chave ausente ou errada (comparação em tempo
  constante, sobre hashes SHA-256). A chave nunca é gravada em log, nem os dados das requisições.
- O middleware do CRM só libera sem sessão o prefixo `/api/integracoes/avanteza/entregas` (e `/api/integracoes/vendedor-ia/`).

## Regras de negócio (as do CRM, sem cópia)

As rotas chamam as mesmas funções da tela de Entrega do CRM: `lib/entrega/servico.ts` (cartões, mover), `ciclo.ts` (concluir e
reabrir a entrega, combinado acompanha o cartão), `edicao.ts` (validação e gravação, compartilhadas com `/api/entregas`),
`rotina.ts` (planejar a semana, herdar responsável, renovação 60 dias antes), `saude.ts` (nota 0–100), `modelo.ts`.
Oportunidade só é criada por `funil/mover.ts` (renovação pela rotina, upsell). A entrega **nasce quando a oportunidade é ganha**:
não há `POST` para criar entrega.

Constantes: colunas `BACKLOG, ESSA_SEMANA, EM_ANDAMENTO, AGUARDANDO_CLIENTE, CONCLUIDO`; pilares `COMERCIAL, PRODUTO, MARKETING,
OPERACAO, FINANCEIRO, TECNOLOGIA`; status `EM_ANDAMENTO, PAUSADA, CONCLUIDA, CANCELADA`. Datas em ISO 8601 (UTC).
Erros: `{ "erro": "texto" }` com `400` (entrada inválida), `404`, `409`, `500` (mensagem genérica).

## Rotas (base `/api/integracoes/avanteza/entregas`)

| Método e caminho | Para quê | Corpo / filtros | Resposta |
|---|---|---|---|
| `GET /` | lista de entregas | `?status=` | `{ entregas: [{ id, nome, status, contato{id,nome}, inicioEm, renovacaoEm, valorMensal, oportunidadeId, saude }] }` |
| `GET /quadro` | quadro kanban | `?status=` (padrão `EM_ANDAMENTO`), `entregaId`, `contatoId`, `q` (cliente/entrega), `responsavelId` (`sem` = sem dono), `pilar`, `atrasados=1` | `{ colunas, pilares, indicadores, entregas, cartoes }` |
| `GET /renovacoes` | renovações até N dias (inclui vencidas) | `?dias=60` (0–365) | `{ renovacoes: [{ entregaId, nome, contato, renovacaoEm, diasParaRenovar, valorMensal, status, renovacaoOportunidadeId }] }` |
| `GET /gatilhos` | automações de gatilho de entrega (leitura) | — | `{ gatilhos: [{id,rotulo}], automacoes: [{ id, nome, ativo, gatilho, rotuloGatilho, execucoes30d }] }` |
| `GET /usuarios` | possíveis responsáveis | — | `{ usuarios: [{ id, nome }] }` |
| `GET /modelos` | modelos de entrega | — | `{ modelos: [{ id, nome, descricao, padrao, ativo, itens[] }] }` |
| `PATCH /modelos/{id}` | definir padrão / desativar | `{ padrao: true }` ou `{ ativo: false }` | `{ ok: true }` |
| `POST /rotina` | executar agora a rotina diária (idempotente) | — | `{ responsaveis, planejados, concluidas, renovacoes, erros }` (`erros` é um número) |
| `GET /{id}` | entrega com cartões, saúde e diagnóstico | — | entrega completa |
| `PATCH /{id}` | editar | `status`, `renovacaoEm`, `fimPrevistoEm`, `diagnostico: { PILAR: texto }` | `{ ok: true }` |
| `POST /{id}/concluir` | concluir (dispara "Entrega concluída") | — | `{ ok: true }` |
| `POST /{id}/upsell` | abre oportunidade de upsell | — | `201 { oportunidadeId }` |
| `POST /{id}/cartoes` | criar cartão | `titulo`*, `descricao`, `pilar`, `coluna`, `dataAlvo`, `cliente`, `responsavelId`, `checklist: [{texto, feito}]` | `201 { id }` |
| `GET /{id}/cartoes/{cartaoId}` | abrir cartão com histórico | — | cartão, `entrega`, `combinados`, `historico: [{ em, tipo, texto }]` |
| `PATCH /{id}/cartoes/{cartaoId}` | mover e/ou editar | `coluna` (+ `posicao`), `titulo`, `descricao`, `pilar`, `dataAlvo`, `cliente`, `responsavelId` (`null` tira), `checklist` | `{ ok: true }` |
| `DELETE /{id}/cartoes/{cartaoId}` | apagar cartão | — | `{ ok: true }` |

Campos de `saude`: `nota`, `rotulo` (`SAUDAVEL|ATENCAO|EM_RISCO`), `progresso`, `total`, `concluidos`, `atrasados`,
`esperandoCliente`, `diasParaRenovar`, `renovacaoProxima` (≤ 60 dias), `porColuna`.
`indicadores` do quadro: `entregas, mrr, cartoesAbertos, atrasados, aguardandoCliente, emRisco, renovacoesProximas`.
Cartão do quadro: `id, entregaId, titulo, pilar, coluna, ordem, dataAlvo, cliente, responsavel{id,nome}|null, diasDeAtraso,
diasNaColuna, concluidoEm, checklist{feitos,total}`.
`historico[].tipo`: `CRIADO, PLANEJADO, COLUNA, CONCLUIDO, COMBINADO, AUTOMACAO` (derivado dos campos do cartão, dos combinados
ligados e das execuções de automação; o CRM não guarda um log de movimentos por cartão).

## Dados sensíveis

Respostas trazem nomes de cliente e textos do funil (títulos, descrições, diagnóstico). Não trazem e-mail, telefone, documento,
nem a `evidencia` dos combinados. A chave é de serviço: guardar só em variável de ambiente.

## Testes

`tests/integracao-avanteza.test.ts` (auth 503/401, middleware, fluxo completo com banco local).
