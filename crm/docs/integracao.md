# Integração CRM ⇄ Vendedor IA

O CRM e o Vendedor IA são dois sistemas, cada um com **banco próprio**. Eles só conversam por HTTP.
Nunca por tabela compartilhada, nunca por leitura direta do banco do outro.

## Vendedor IA → CRM: eventos (implementado, lado do CRM)

`POST {CRM_URL}/api/integracoes/vendedor-ia/eventos`

- **Autenticação:** `Authorization: Bearer avz_live_…` (chave de serviço). Crie com
  `npm run chave:criar -- "Vendedor IA"`; a chave aparece uma única vez, o banco guarda só o hash.
  Guarde-a como segredo (`CRM_API_KEY`) no projeto do Vendedor IA. Para revogar: preencher `revogadaEm` em `ChaveIntegracao`.
- **Idempotência:** `eventoId` é único. Reenviar o mesmo evento é seguro e responde `200` com `{"status":"DUPLICADO"}`.
  O Vendedor IA deve gerar o `eventoId` de forma determinística (ex.: `lead.qualificado:{leadId}`) ou guardar o que enviou,
  e reenviar em caso de timeout ou resposta 5xx.
- **Respostas:** `200` (`PROCESSADO`, `IGNORADO` ou `DUPLICADO`), `400` formato inválido, `401` chave inválida, `500` falha (pode reenviar).

### `lead.qualificado`

Cria (ou reaproveita) a pessoa e a empresa e abre **uma** oportunidade na etapa "Qualificação" do funil padrão,
com origem de histórico `INTEGRACAO` e ator `vendedor-ia`. Se já existe oportunidade **em andamento** para o mesmo
`lead.id`, o evento é registrado e ignorado.

```json
{
  "eventoId": "lead.qualificado:cmw0abc123",
  "tipo": "lead.qualificado",
  "ocorridoEm": "2026-11-03T14:20:00Z",
  "lead": {
    "id": "cmw0abc123",
    "telefone": "5562984465388",
    "nome": "João da Oficina",
    "email": null,
    "empresa": "Oficina Rocha",
    "segmento": "Autopeças",
    "faturamentoMensal": 60000,
    "dorPrincipal": "Não sei onde estou perdendo margem",
    "origem": "Click-to-WhatsApp",
    "scoreSdr": 80
  }
}
```

Campos obrigatórios: `eventoId` (8–120 caracteres), `tipo` (`dominio.acao`), e `lead.id` quando `lead` é enviado.
Telefone: só dígitos; com 10 ou 11 dígitos assume DDI 55.

### Demais tipos (implementados)

Todos exigem `lead.id`. Tipo com formato válido mas desconhecido é registrado em `EventoIntegracao` e respondido `IGNORADO`.

| Tipo | Efeito no CRM |
|---|---|
| `lead.escalado` | Garante a oportunidade, registra feedback do sistema e cria a tarefa **"Assumir a conversa de …"** (prioridade alta, prazo de 1 hora, origem `INTEGRACAO`, responsável o primeiro administrador). Só uma tarefa aberta por oportunidade. |
| `reuniao.agendada` (`reuniaoEm`) | Garante a oportunidade e cria um compromisso de **ligação** de 30 min no horário (origem `INTEGRACAO`). Mesmo horário não duplica. Sem `reuniaoEm`: ignorado. |
| `lead.perdido` (`motivo`) | Move a oportunidade em andamento para a etapa **Perdida** do funil dela, com o motivo se existir no catálogo (ex.: `Sem interesse`, `Fora do perfil (ICP)`, `Pediu para não receber mensagens`). Sem oportunidade em andamento: ignorado (lead que nunca qualificou não vira oportunidade). |
| `lead.ganho` (`motivo`) | Idem, para a etapa **Ganha**. |
| `intencao.detectada` (`intencao`, `texto`) | Feedback de WhatsApp com o sinal (um dos 13 de `src/lib/atividades/intencoes.ts`); atualiza a atividade e a saúde do negócio. Sem oportunidade em andamento: ignorado. `intencao` fora da lista: `400`. |

## CRM → Vendedor IA (previsto, ainda não implementado)

- ler a conversa de um lead (hoje a oportunidade só tem um link para o Vendedor IA);
- pausar/retomar a IA em um lead (assumir o atendimento);
- enviar mensagem pelo WhatsApp do Vendedor IA.

O Vendedor IA já tem chaves de API (`Authorization: Bearer nexo_live_…`), então o caminho é expor essas
operações lá e chamá-las daqui com uma chave guardada em variável de ambiente.

## Lado do Vendedor IA (implementado)

`vendedoria/src/lib/crm-externo/`. Variáveis de ambiente: `CRM_URL` (ex.: `https://crm.exemplo.com`) e `CRM_API_KEY`
(a chave `avz_live_…`). **Sem as duas, nada é enviado** e nada é gravado: o Vendedor IA segue como está.

- **Outbox:** cada evento é gravado em `CrmEventoOutbox` antes de enviar. Falha de rede, timeout, `5xx`, `401`, `429`:
  reenvia com espera crescente (1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h), até 8 tentativas. `400` (formato recusado) não é refeito.
  O `GET /api/health` (chamado de hora em hora) reenvia os pendentes e mostra `crm` no JSON.
- **Quando emite:** `moverLeadPorTipo` segue a **intenção** pedida (qualificado, escalado, perdido, ganho), mesmo que a coluna não mude
  (no mapa canônico `ESCALATED` e `QUALIFICADO` caem na mesma coluna). Chave por hora, então repetir na mesma hora colapsa; o CRM também deduplica por conteúdo.
  O SDR envia `reuniao.agendada` à parte, com o horário. O arrasto manual no kanban do Vendedor IA também emite (ganho, perda, escalada).
- **Intenção:** detector por regras (`intencoes.ts`), sem chamar o modelo, na mensagem do lead. Padrões conservadores, no máximo 2 sinais
  por mensagem e 1 por lead, sinal e dia. Cobre 9 dos 13 sinais; os outros 4 (`DECISOR_ENGAJADO`, `ESCOPO_MUDOU`, `NAO_COMPARECEU`, `SEM_RETORNO`)
  dependem de contexto e ficam para o registro manual no CRM.
- **Falha nunca derruba o atendimento:** `emitirEventoCrm` não lança.
