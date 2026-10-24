# API de Conversões da Meta — Click-to-WhatsApp

Fluxo: anúncio → clique → 1ª mensagem com `referral` → lead gravado com `ctwaClid` →
lead entra em **Qualificados** (evento `LeadSubmitted`) → lead entra em **Ganho** (evento `Purchase`).

## Peças

| O quê | Onde |
|---|---|
| Captura do `referral` | `src/lib/meta-referral.ts` (parser) + `src/lib/crm/origem-anuncio.ts` (grava no lead) + webhook `api/webhooks/whatsapp` |
| Regra de qualificação do SDR | `src/lib/ai/sdr/qualificacao.ts` (loja física + faturamento ≥ R$ 40 mil/mês + CNPJ) |
| Mapa de colunas e eventos (config única) | `src/lib/crm/funil-config.ts` |
| Envio à Meta | `src/lib/meta-capi.ts` (+ gancho `src/lib/meta-capi-hook.ts`) |
| Reenvio de falhas | `POST /api/meta/capi/reenviar` (ADMIN ou `x-cron-secret`) |
| Diagnóstico de configuração | `GET /api/meta/capi/diagnostico` (ADMIN) |
| Resultado por anúncio | `/crm/anuncios` (`/anuncios` redireciona) + `GET /api/anuncios/resumo` |

## Regras

- Só lead **INBOUND com `ctwaClid`** gera evento. OUTBOUND nunca.
- Um evento por (lead, nome): tabela `MetaConversionEvent`, unique `(leadId, eventName)`. A Meta não deduplica nesse canal.
- Status: `PENDING`, `SENT`, `FAILED`, `DRY_RUN`, `SKIPPED_NO_CONFIG`. 3 tentativas com espera crescente; 4xx (exceto 429) não repete.
- `FAILED` e `SKIPPED_NO_CONFIG` com menos de 6 dias podem ser reenviados pela rota de reenvio.
- O token só existe em variável de ambiente e na URL da chamada; nunca é gravado nem logado.

## Testar

```bash
# testes (parser, qualificação, payload, envio com fetch falso, movimentação do Kanban)
DATABASE_URL=... DIRECT_URL=... npm run test:capi

# simular um clique em anúncio contra um preview (usa um número de TESTE)
META_WHATSAPP_APP_SECRET=... npx tsx scripts/simular-webhook-referral.ts \
  --url https://SEU-PREVIEW.vercel.app --phone-number-id <id do número> --from 5562999990000
```

Para ver o payload sem enviar: `META_CAPI_DRY_RUN=true`. Para validar no Events Manager
(aba "Testar eventos"), defina `META_TEST_EVENT_CODE`.
