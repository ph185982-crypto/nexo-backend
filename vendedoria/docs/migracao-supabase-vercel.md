# Migração: VPS → Supabase + Vercel

A ferramenta passa a rodar como funções serverless na Vercel, com o Postgres no
Supabase. Este documento cobre o que muda no runtime, como transferir os dados
que ainda estão na VPS e o que precisa ser configurado à mão.

## O que muda no runtime

Em serverless não existe processo de longa duração: cada requisição roda num
ambiente novo, com teto de tempo, e tudo que estava em memória some quando a
resposta é devolvida. Três coisas foram reescritas por causa disso.

**Buscas de empresas** guardavam cursor e contadores num `Map` de módulo. Agora
vivem na tabela `SourcingRun`: cada invocação processa combinações de termo ×
cidade até o orçamento de tempo acabar, grava onde parou e agenda a próxima.

**Disparos** já tinham fila persistente (`DisparoJob`), mas o processador rodava
num laço único dormindo 30–90s entre mensagens — o que estourava o teto da
função no meio de um envio. Agora, quando o intervalo não cabe no tempo
restante, a invocação encerra e deixa o intervalo para quem agenda a
continuação.

**Geração de arte** usava o `puppeteer` completo, que espera um Chrome instalado.
Passa a resolver o binário por ambiente: `@sparticuz/chromium` na Vercel, o
Chrome do sistema quando `PUPPETEER_EXECUTABLE_PATH` está definido.

O agendamento das continuações fica em `src/lib/jobs/fila.ts`. Com
`QSTASH_TOKEN` definido ele usa o QStash, que entrega o callback com atraso real
e retry. Sem o token, encadeia por uma chamada à própria aplicação — o que serve
para lotes sem atraso, mas **não honra o intervalo anti-bloqueio entre
disparos**. Para disparo em volume, configure o QStash.

## Transferir os dados da VPS

O banco de produção ainda está na VPS (`vendedoria_db`, acessível só por
localhost). O schema já foi criado no Supabase, mas as tabelas estão vazias.

Rode no console da VPS. O valor de `DIRECT_URL` está no painel da Vercel, em
Settings → Environment Variables do projeto `nexo-vendedoria` (é a conexão de
sessão, porta 5432 — a de 6543 é pooler em transaction mode e não serve para
restaurar).

```bash
export SUPA='<cole aqui o valor de DIRECT_URL>'

# 1. Confirma que o destino responde
psql "$SUPA" -c 'select current_database();'

# 2. Para o app da VPS, para ninguém escrever no banco antigo durante a cópia
pm2 stop vendedoria

# 3. Dump + restore num passo só
sudo -u postgres pg_dump vendedoria_db \
  --clean --if-exists --no-owner --no-privileges --schema=public \
  | psql "$SUPA" -v ON_ERROR_STOP=0 2>&1 | tail -40

# 4. Compara as contagens dos dois lados
for T in WhatsappBusinessOrganization ProspectLead Lead WhatsappMessage FinancialTransaction; do
  A=$(sudo -u postgres psql -d vendedoria_db -tAc "select count(*) from \"$T\";")
  B=$(psql "$SUPA" -tAc "select count(*) from \"$T\";")
  echo "$T: VPS=$A Supabase=$B"
done
```

O `--clean --if-exists` derruba e recria só as tabelas que o dump traz. A
`SourcingRun`, criada depois, sobrevive — mas se a VPS estiver atrasada em
relação ao schema atual do Prisma, colunas novas podem faltar depois da
restauração. Confira com `npx prisma migrate diff` apontando para o Supabase
antes de considerar a migração concluída.

Enquanto o `pm2 stop` estiver valendo, a VPS não recebe webhooks do WhatsApp.
Aponte o webhook da Meta para a URL da Vercel antes de parar o app, ou faça a
cópia numa janela de baixo movimento.

## Variáveis que faltam na Vercel

Estas existem no projeto antigo mas são do tipo `encrypted` — a API devolve o
blob cifrado, não dá para copiar programaticamente. Pegue os valores no painel
do projeto antigo (ou no `.env` da VPS) e cadastre em `nexo-vendedoria`:

- `META_WHATSAPP_ACCESS_TOKEN`
- `META_WHATSAPP_APP_SECRET`
- `OPENAI_API_KEY`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` — regenerar invalida as inscrições de
  push existentes, então prefira copiar
- `NEXT_PUBLIC_GOOGLE_MAPS_KEY`

`NEXTAUTH_SECRET`, `AUTH_SECRET` e `CRON_SECRET` foram gerados novos. As sessões
abertas caem uma vez e os crons antigos da VPS param de autenticar — o que é o
comportamento desejado ao desligar a VPS.

`REDIS_URL` fica **de fora de propósito**: sem ela os workers BullMQ não sobem e
os follow-ups saem por cron, que é o modo correto em serverless.

## Crons

O plano Hobby permite dois crons, e só diários. O `vercel.json` declara os dois
que cabem:

| Rota | Horário (UTC) |
|---|---|
| `/api/cron/disparo-diario` | `0 12 * * *` |
| `/api/cron/daily-summary` | `0 21 * * *` |

Os demais rodavam com frequência que o plano não comporta — `followup` e
`healthcheck` a cada 5 minutos, `max` a cada minuto. Para mantê-los, aponte um
agendador externo (QStash ou cron-job.org) para as rotas abaixo, mandando
`Authorization: Bearer $CRON_SECRET`:

| Rota | Frequência original |
|---|---|
| `/api/cron/max` | a cada minuto |
| `/api/cron/followup` | a cada 5 minutos |
| `/api/cron/healthcheck` | a cada 5 minutos |
| `/api/cron/oferta` | conforme uso |
| `/api/cron/importar-produtos` | conforme uso |

A cada minuto dá cerca de 43 mil execuções por mês, o que passa da cota gratuita
do QStash (500 mensagens/dia). Ou reduza a frequência do `max`, ou use um cron
externo sem cota por chamada.

## Branch de produção

A API da Vercel não permite trocar o branch de produção, e o projeto foi criado
apontando para `master` — que não contém o diretório `vendedoria`. O deploy atual
foi publicado com `target: production` explícito a partir de
`claude/whatsapp-ai-crm-hYSVU`.

Para que os próximos pushes virem produção sozinhos, ajuste em Settings → Git →
Production Branch. Sem isso, cada push nesse branch gera apenas um preview.
