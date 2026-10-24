# SDR — qualificação, ligação marcada e follow-ups

## Regra de ouro (verificada no código, não só no prompt)

O lead só chega ao Pedro (handoff) com **nome real, empresa, o que vende, dor específica,
faturamento, loja física, CNPJ** e dentro do **ICP** (loja física + R$ 40 mil/mês + CNPJ),
**com a ligação marcada**. `src/lib/ai/sdr/handoff-gate.ts` barra o resto:

- faltam dados → a IA refaz a resposta pedindo o primeiro que falta (uma nova chamada); sem tempo, pergunta direta;
- dados completos mas fora do ICP → nutrição (coluna "Mornos"), nunca a agenda do Pedro.

## Adaptação ao lead

`src/lib/ai/sdr/estilo.ts` mede como o lead escreve (curto/longo, formal/informal, emoji, áudio)
e o prompt manda a IA espelhar.

## Ligação

Horários livres em Brasília (`src/lib/agenda/slots.ts`), descontando Google Agenda (se conectado em
Configurações → Integrações) e as ligações já marcadas no CRM. Ao fechar, cria o evento no
Calendário do CRM (+ Google com Meet), move o card para "Reunião Agendada" e manda o bastão completo.

## Follow-ups e a janela de 24h

O WhatsApp só entrega texto livre até 24h depois da última mensagem do cliente. Os toques agora
cabem dentro da janela; fora dela só com template (`FOLLOWUP_TEMPLATE_NAME`). Sem template e com a
janela fechada, o follow-up encerra e cria uma notificação "ligue para o lead" — nenhum some em silêncio.
O workflow `.github/workflows/cron-vendedoria.yml` processa os vencidos a cada 10 min (secret `CRON_SECRET`).

## Disparos

Falha da conta na Meta (131042 pagamento, 131031, 131048, 368) pausa o disparo, avisa o dono e devolve
o lead para a fila sem gastar tentativa. Prospecção → Disparo mostra quantas empresas nunca receberam e
tem o botão para devolvê-las à fila. O limite diário agora vale por dia (antes valia por chamada).

## Testes

`DATABASE_URL=... npm run test:capi` (38 testes, inclui o fluxo do SDR com IA e Meta simuladas).
