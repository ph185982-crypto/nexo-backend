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

### Outros tipos

Qualquer tipo com formato válido é **registrado** em `EventoIntegracao` e respondido como `IGNORADO`
("tipo ainda não tratado"). Nada se perde, e o tratamento entra quando o tipo for definido:

| Tipo previsto | Efeito previsto no CRM |
|---|---|
| `lead.escalado` | marcar a oportunidade como "precisa de humano" |
| `reuniao.agendada` | criar compromisso/tarefa ligados à oportunidade |
| `intencao.detectada` | registrar um dos 13 sinais de intenção como feedback (alimenta a saúde do negócio) |
| `lead.perdido` | mover para "Perdida" com motivo do catálogo |

## CRM → Vendedor IA (previsto, ainda não implementado)

- ler a conversa de um lead (hoje a oportunidade só tem um link para o Vendedor IA);
- pausar/retomar a IA em um lead (assumir o atendimento);
- enviar mensagem pelo WhatsApp do Vendedor IA.

O Vendedor IA já tem chaves de API (`Authorization: Bearer nexo_live_…`), então o caminho é expor essas
operações lá e chamá-las daqui com uma chave guardada em variável de ambiente.

## O que falta do lado do Vendedor IA

Nada foi alterado no `vendedoria/` por esta integração. Falta enviar o evento: quando o SDR marca o lead como
qualificado (hoje `moverLeadPorTipo(..., "QUALIFICADO")`), disparar o `POST` acima em segundo plano, sem
nunca atrasar ou derrubar a conversa (mesma regra de fail-safe do `pipeline-mover`).
