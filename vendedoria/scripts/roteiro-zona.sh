#!/bin/bash
# Roteiro do endereço único (F5/C1–C6): Central reescrevendo /comercial/* para o Vendedor IA.
# Local: Central em CENTRAL (next start com VENDEDORIA_URL apontando para VENDEDORIA), Vendedor IA em VENDEDORIA.
# Variáveis: CENTRAL, VENDEDORIA, DATABASE_URL (banco do Vendedor IA, só para achar oportunidade/proposta de teste),
# AVZ_SESSION (cookie avz_session válido da Central), FUNIL_ID, VERIFY_TOKEN (META_WHATSAPP_VERIFY_TOKEN do Vendedor IA).
# Não use em produção com dados reais: cria uma proposta de teste na oportunidade mais recente.
set -u
TMP=$(mktemp -d); cd "$TMP"
C=${CENTRAL:-http://127.0.0.1:3300}; V=${VENDEDORIA:-http://127.0.0.1:3200}; J=$TMP/jar.txt
DB=$DATABASE_URL; FUNIL=${FUNIL_ID:?FUNIL_ID}; VT=${VERIFY_TOKEN:?VERIFY_TOKEN}
ok(){ printf "%-4s %s\n" "$1" "$2"; }
printf '# Netscape HTTP Cookie File\n%s\tFALSE\t/\tFALSE\t0\tavz_session\t%s\n' "$(echo $C | sed -E 's#https?://([^:/]+).*#\1#')" "$AVZ_SESSION" > $J
r=$(curl -s -o /dev/null -w "%{http_code} %{redirect_url}" -b $J -c $J "$C/comercial/oportunidades"); ok "${r%% *}" "1. /comercial/oportunidades sem sessão do Vendedor IA → ${r#* }"
L=$(curl -s -o /dev/null -w "%{redirect_url}" -b $J -c $J "${r#* }"); ok 302 "2. Central /sso/authorize → ${L%%\?*}"
r=$(curl -s -o /dev/null -w "%{http_code} %{redirect_url}" -b $J -c $J "$L"); ok "${r%% *}" "3. callback pela zona → ${r#* } (cookie: $(grep -o 'authjs.session-token' $J | head -1))"
ok $(curl -s -b $J -c $J "$C/comercial/oportunidades" -o pag.html -w "%{http_code}") "4. página logada via Central (href crus /api: $(grep -c 'href="/api/' pag.html))"
for u in $(grep -oE '/comercial/_next/static/[^"]+\.(css|js|woff2)' pag.html | sort -u | awk -F. '{print $NF" "$0}' | sort -u -k1,1 | cut -d' ' -f2) /comercial/fonts/Manrope-Bold.ttf /comercial/icon-192.png /comercial/manifest.json "/comercial/_next/image?url=%2Ficon-192.png&w=64&q=75"; do ok $(curl -s -o /dev/null -w "%{http_code}" "$C$u") "5. sem cookie: $u ($(curl -s -o /dev/null -w '%{content_type}' "$C$u"))"; done
OP=$(psql $DB -Atc "select id from com_oportunidade order by \"criadoEm\" desc limit 1")
ok $(curl -s -o /dev/null -w "%{http_code}" -b $J "$C/comercial/api/comercial/quadro?funilId=$FUNIL") "6. REST GET /comercial/api/comercial/quadro"
ok $(curl -s -o /dev/null -w "%{http_code}" -b $J -X PATCH -H 'content-type: application/json' -d '{"valorMensal":900}' "$C/comercial/api/comercial/oportunidades/$OP") "6. REST PATCH oportunidade"
G=$(curl -s -b $J -H 'content-type: application/json' -d '{"query":"{ whatsappBusinessOrganizations { id } }"}' -w " %{http_code}" "$C/comercial/api/graphql"); ok "${G##* }" "7. GraphQL /comercial/api/graphql → ${G:0:60}"
ok $(curl -s -o /dev/null -w "%{http_code}" -b $J "$C/comercial/api/auth/session") "8. NextAuth /comercial/api/auth/session: $(curl -s -b $J "$C/comercial/api/auth/session" | head -c 60)"
PID=$(curl -s -b $J -X POST "$C/comercial/api/comercial/oportunidades/$OP/propostas" | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
LINK=$(curl -s -b $J -X POST "$C/comercial/api/comercial/propostas/$PID/enviar"); ok "-" "9. link público gerado: $LINK"
TOKEN=$(psql $DB -Atc "select token from com_proposta where id='$PID'")
ok $(curl -s -o pub.html -w "%{http_code}" "$C/comercial/p/$TOKEN") "10. proposta pública /comercial/p/<token> SEM sessão ($(curl -sI "$C/comercial/p/$TOKEN" | grep -i x-robots | tr -d '\r'))"
for u in $(grep -oE '/comercial/_next/static/css/[^"\\]+' pub.html | sort -u); do ok $(curl -s -o /dev/null -w "%{http_code}" "$C$u") "10. CSS da proposta pública sem sessão"; done
ok $(curl -s -o /dev/null -w "%{http_code}" -X POST -H 'content-type: application/json' -d '{}' "$C/comercial/api/comercial/publico/propostas/$TOKEN/visita") "10. API pública (visita) sem sessão"
for p in /comercial/conversas /comercial/leads /comercial/ligacoes /comercial/prospeccao /comercial/disparos /comercial/agente /comercial/configuracoes /comercial/crm/dashboard; do ok $(curl -s -o /dev/null -w "%{http_code}" -b $J "$C$p") "11. tela antiga sob a zona: $p"; done
r=$(curl -s -o /dev/null -w "%{http_code} %{redirect_url}" -b $J "$C/crm/conversations"); ok "${r%% *}" "11. /crm/conversations na Central → ${r#* }"
for u in /comercial/api/comercial/oportunidades "/comercial/api/comercial/quadro?funilId=$FUNIL" /comercial/api/graphql /comercial/api/comercial/contratos /comercial/api/conversations; do ok $(curl -s -o /dev/null -w "%{http_code}" -b "avz_session=$AVZ_SESSION" "$C$u") "12. sem sessão do Vendedor IA (só Central): $u"; ok $(curl -s -o /dev/null -w "%{http_code}" "$V$u") "12. direto no Vendedor IA sem sessão: $u"; done
ok $(curl -s -o /dev/null -w "%{http_code}" "$C/comercial/oportunidades") "13. sem sessão da Central (302 → /login da Central)"
W=$(curl -s -w " %{http_code}" "$V/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=$VT&hub.challenge=777"); ok "${W##* }" "14. domínio antigo GET /api/webhooks/whatsapp (challenge ${W%% *})"
ok $(curl -s -o /dev/null -w "%{http_code}" -X POST -d '{}' "$V/api/webhooks/whatsapp") "14. domínio antigo POST webhook sem assinatura (esperado 401)"
ok $(curl -s -o /dev/null -w "%{http_code}" -b $J "$V/crm/conversations") "15. domínio antigo /crm/conversations logado"
ok $(curl -s -o /dev/null -w "%{http_code}" "$V/login") "15. domínio antigo /login"
ok $(curl -s -o /dev/null -w "%{http_code}" "$V/api/health") "15. domínio antigo /api/health"
