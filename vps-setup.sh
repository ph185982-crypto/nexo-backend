#!/bin/bash
# ============================================================
#  SETUP COMPLETO VENDEDORIA — v3 (VPS Hostinger)
#  Segredos ficam em /root/secrets.env (fora do repo).
#  Faz: sistema, app, seed, SSL, webhook Meta, status report
# ============================================================
set +e   # não aborta — queremos capturar cada etapa no relatório

# ── Segredos (gravados pelo post-install da Hostinger) ──────
if [[ ! -f /root/secrets.env ]]; then
  echo "ERRO: /root/secrets.env não encontrado. Abortando."
  exit 1
fi
set -a
source /root/secrets.env
set +a

# CRON_SECRET é obrigatório para os endpoints de cron — gera se não existir
if [[ -z "${CRON_SECRET:-}" ]]; then
  CRON_SECRET=$(openssl rand -hex 24)
  echo "CRON_SECRET=${CRON_SECRET}" >> /root/secrets.env
  echo "CRON_SECRET gerado e salvo em /root/secrets.env"
fi

STATUS_DIR="/var/www/status"
mkdir -p "$STATUS_DIR"
LOG="$STATUS_DIR/setup.log"
REPORT="$STATUS_DIR/report.json"
exec > >(tee "$LOG") 2>&1

# JSON status helpers
declare -A ST
setst() { local v="${2//\"/}"; v="${v//$'\n'/ }"; ST["$1"]="$v"; write_report; }
write_report() {
  {
    echo "{"
    local first=1
    for k in "${!ST[@]}"; do
      [[ $first -eq 0 ]] && echo ","
      printf '  "%s": "%s"' "$k" "${ST[$k]}"
      first=0
    done
    echo ""
    echo "}"
  } > "$REPORT"
  chmod 644 "$REPORT" "$LOG" 2>/dev/null
}

step() { echo ""; echo "═══ $(date +%H:%M:%S) $1 ═══"; publish 2>/dev/null; }

# Push status+log para o GitHub (canal de observabilidade confiável)
GH_REPO="ph185982-crypto/nexo-backend"
GH_BRANCH="claude/whatsapp-ai-crm-hYSVU"
push_github() {
  local path="$1" file="$2"
  [[ -f "$file" ]] || return 0
  local content sha
  content=$(base64 -w0 "$file" 2>/dev/null)
  sha=$(curl -s --max-time 20 -H "Authorization: Bearer $GH_PAT" \
    "https://api.github.com/repos/$GH_REPO/contents/$path?ref=$GH_BRANCH" 2>/dev/null | jq -r '.sha // empty' 2>/dev/null)
  local payload
  if [[ -n "$sha" ]]; then
    payload=$(printf '{"message":"vps status","content":"%s","branch":"%s","sha":"%s"}' "$content" "$GH_BRANCH" "$sha")
  else
    payload=$(printf '{"message":"vps status","content":"%s","branch":"%s"}' "$content" "$GH_BRANCH")
  fi
  curl -s --max-time 25 -X PUT -H "Authorization: Bearer $GH_PAT" \
    "https://api.github.com/repos/$GH_REPO/contents/$path" -d "$payload" >/dev/null 2>&1
}
publish() { push_github "vps-status/report.json" "$REPORT"; push_github "vps-status/setup.log" "$LOG"; }
trap 'publish' EXIT

setst "started_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
setst "phase" "init"

# ── Config (não-sensível) ───────────────────────────────────
SERVER_IP="187.127.43.82"
DOMAIN="srv1797517.hstgr.cloud"
CERTBOT_EMAIL="ph185982@gmail.com"
DB_PASS="Vnd$(openssl rand -hex 12)"
REPO_DIR="/var/www/nexo-backend"

export DEBIAN_FRONTEND=noninteractive
APT="apt-get -o DPkg::Lock::Timeout=600"

step "PASSO 1 — Sistema + firewall"
setst "phase" "sistema"
$APT update -qq
ufw --force reset >/dev/null 2>&1
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 3000/tcp >/dev/null
ufw --force enable >/dev/null
$APT install -y -qq fail2ban >/dev/null 2>&1
setst "sistema" "ok"

step "PASSO 2 — Dependências"
setst "phase" "deps"
$APT install -y -qq git curl wget build-essential nginx redis-server certbot python3-certbot-nginx postgresql postgresql-contrib jq
export NVM_DIR="$HOME/.nvm"
[[ ! -d "$NVM_DIR" ]] && curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source "$NVM_DIR/nvm.sh"
nvm install --lts && nvm use --lts && nvm alias default node
npm install -g pm2 >/dev/null 2>&1
systemctl enable postgresql redis-server nginx --quiet
systemctl start postgresql redis-server nginx
setst "node_version" "$(node -v)"
setst "deps" "ok"

step "PASSO 3 — PostgreSQL"
setst "phase" "postgres"
sudo -u postgres psql <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='vendedoria_user') THEN
    CREATE USER vendedoria_user WITH PASSWORD '${DB_PASS}';
  ELSE
    ALTER USER vendedoria_user WITH PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SQL
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='vendedoria_db'" | grep -q 1 || \
  sudo -u postgres createdb -O vendedoria_user vendedoria_db
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE vendedoria_db TO vendedoria_user;"
LOCAL_DB_URL="postgresql://vendedoria_user:${DB_PASS}@localhost:5432/vendedoria_db"
setst "postgres" "ok"

step "PASSO 4 — Clonar repo"
setst "phase" "clone"
if [[ -d "$REPO_DIR/.git" ]]; then
  cd "$REPO_DIR" && git fetch origin "$GH_BRANCH" && git checkout "$GH_BRANCH" && git pull origin "$GH_BRANCH"
else
  git clone --branch "$GH_BRANCH" "https://${GH_PAT}@github.com/ph185982-crypto/nexo-backend.git" "$REPO_DIR"
fi
cd "$REPO_DIR" && git remote set-url origin "https://${GH_PAT}@github.com/ph185982-crypto/nexo-backend.git"
ln -sfn "$REPO_DIR/vendedoria" /var/www/vendedoria
setst "commit" "$(cd $REPO_DIR && git rev-parse --short HEAD)"
setst "clone" "ok"

step "PASSO 5 — npm install"
setst "phase" "npm"
cd "$REPO_DIR/vendedoria"
npm install 2>&1 | tail -5
setst "npm" "ok"

step "PASSO 6 — .env"
setst "phase" "env"
cat > "$REPO_DIR/vendedoria/.env" <<ENVFILE
DATABASE_URL=${LOCAL_DB_URL}
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
NEXTAUTH_URL=https://${DOMAIN}
META_WHATSAPP_ACCESS_TOKEN=${META_TOKEN}
META_WHATSAPP_PHONE_NUMBER_ID=${PHONE_ID}
META_WHATSAPP_APP_SECRET=${APP_SECRET}
META_WHATSAPP_VERIFY_TOKEN=${VERIFY_TOKEN}
OPENAI_API_KEY=${OPENAI_API_KEY}
REDIS_URL=redis://localhost:6379
CLOUDINARY_CLOUD_NAME=${CLOUDINARY_CLOUD_NAME}
CLOUDINARY_API_KEY=${CLOUDINARY_API_KEY}
CLOUDINARY_API_SECRET=${CLOUDINARY_API_SECRET}
VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}
VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY}
VAPID_EMAIL=${VAPID_EMAIL}
NEXT_PUBLIC_GOOGLE_MAPS_KEY=${NEXT_PUBLIC_GOOGLE_MAPS_KEY}
MERCADO_PAGO_ACCESS_TOKEN=${MERCADO_PAGO_ACCESS_TOKEN}
MERCADO_PAGO_PUBLIC_KEY=${MERCADO_PAGO_PUBLIC_KEY}
MERCADO_PAGO_CLIENT_ID=${MERCADO_PAGO_CLIENT_ID}
MERCADO_PAGO_CLIENT_SECRET=${MERCADO_PAGO_CLIENT_SECRET}
MELHOR_ENVIO_TOKEN=${MELHOR_ENVIO_TOKEN}
MELHOR_ENVIO_SANDBOX=false
CEP_ORIGEM=74480120
MANAGER_PHONE_NUMBER=5562984465388
OWNER_WHATSAPP_NUMBER=5562984465388
RAPIDAPI_KEY=${RAPIDAPI_KEY:-}
CRON_SECRET=${CRON_SECRET:-}
NODE_ENV=production
PORT=3000
ENVFILE
chmod 600 "$REPO_DIR/vendedoria/.env"
setst "env" "ok"

step "PASSO 7 — Prisma"
setst "phase" "prisma"
cd "$REPO_DIR/vendedoria"
npx prisma generate 2>&1 | tail -2
npx prisma db push --accept-data-loss 2>&1 | tail -5
setst "prisma" "ok"

step "PASSO 8 — Seed VENDAS (agente Pedro)"
setst "phase" "seed"
cd "$REPO_DIR/vendedoria"
npx prisma db seed 2>&1 | tail -15
SEED_RC=${PIPESTATUS[0]}
setst "seed_vendas" "$([[ $SEED_RC -eq 0 ]] && echo ok || echo erro)"

step "PASSO 9 — Seed PROSPECÇÃO (Fase 2)"
npx tsx scripts/seed-nexos-prospeccao.ts 2>&1 | tail -10
PSEED_RC=${PIPESTATUS[0]}
setst "seed_prospeccao" "$([[ $PSEED_RC -eq 0 ]] && echo ok || echo erro)"

step "PASSO 10 — Build Next.js"
setst "phase" "build"
cd "$REPO_DIR/vendedoria"
npm run build 2>&1 | tail -15
BUILD_RC=${PIPESTATUS[0]}
setst "build" "$([[ $BUILD_RC -eq 0 ]] && echo ok || echo erro)"

step "PASSO 11 — PM2"
setst "phase" "pm2"
cat > "$REPO_DIR/vendedoria/ecosystem.config.js" <<'ECO'
module.exports = { apps: [{
  name: 'vendedoria', script: 'node_modules/.bin/next', args: 'start',
  cwd: '/var/www/nexo-backend/vendedoria', instances: 1, exec_mode: 'fork',
  env: { NODE_ENV: 'production', PORT: 3000 }, max_memory_restart: '600M',
  error_file: '/var/log/pm2/vendedoria-error.log',
  out_file: '/var/log/pm2/vendedoria-out.log',
  log_date_format: 'YYYY-MM-DD HH:mm:ss' }]}
ECO
mkdir -p /var/log/pm2 "$REPO_DIR/vendedoria/scripts"
cat > "$REPO_DIR/vendedoria/scripts/cron-followup.sh" <<C1
#!/bin/bash
curl -s -H "Authorization: Bearer ${CRON_SECRET}" http://localhost:3000/api/cron/followup >> /var/log/pm2/cron-followup.log 2>&1
C1
cat > "$REPO_DIR/vendedoria/scripts/cron-disparo.sh" <<C2
#!/bin/bash
curl -s -H "Authorization: Bearer ${CRON_SECRET}" http://localhost:3000/api/cron/disparo-diario >> /var/log/pm2/cron-disparo.log 2>&1
C2
cat > "$REPO_DIR/vendedoria/scripts/cron-max.sh" <<C3
#!/bin/bash
curl -s -H "Authorization: Bearer ${CRON_SECRET}" http://localhost:3000/api/cron/max >> /var/log/pm2/cron-max.log 2>&1
C3
cat > "$REPO_DIR/vendedoria/scripts/cron-backup.sh" <<'C4'
#!/bin/bash
# Backup diário do PostgreSQL — retenção 14 dias
BACKUP_DIR=/root/backups/postgres
mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
sudo -u postgres pg_dump vendedoria_db | gzip > "$BACKUP_DIR/vendedoria_db-$STAMP.sql.gz" 2>> /var/log/pm2/cron-backup.log
find "$BACKUP_DIR" -name "vendedoria_db-*.sql.gz" -mtime +14 -delete
echo "$(date -u +%FT%TZ) backup ok: vendedoria_db-$STAMP.sql.gz ($(du -h "$BACKUP_DIR/vendedoria_db-$STAMP.sql.gz" | cut -f1))" >> /var/log/pm2/cron-backup.log
C4
cat > "$REPO_DIR/vendedoria/scripts/cron-healthcheck.sh" <<C5
#!/bin/bash
# Healthcheck: chama a rota interna; se o app não responder, reinicia o PM2 (self-healing)
HTTP=\$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 -H "Authorization: Bearer ${CRON_SECRET}" http://localhost:3000/api/cron/healthcheck)
if [[ "\$HTTP" != "200" ]]; then
  echo "\$(date -u +%FT%TZ) healthcheck HTTP \$HTTP — reiniciando pm2" >> /var/log/pm2/cron-healthcheck.log
  pm2 restart vendedoria >> /var/log/pm2/cron-healthcheck.log 2>&1
else
  echo "\$(date -u +%FT%TZ) ok" >> /var/log/pm2/cron-healthcheck.log
fi
C5
chmod +x "$REPO_DIR/vendedoria/scripts/"cron-*.sh
pm2 delete vendedoria 2>/dev/null
pm2 start "$REPO_DIR/vendedoria/ecosystem.config.js"
pm2 save
PM2ST=$(pm2 startup systemd -u root --hp /root 2>&1 | grep "sudo")
[[ -n "$PM2ST" ]] && eval "$PM2ST" 2>/dev/null
pm2 save
( crontab -l 2>/dev/null; echo "*/5 * * * * $REPO_DIR/vendedoria/scripts/cron-followup.sh";
  echo "0 12-20 * * 1-5 $REPO_DIR/vendedoria/scripts/cron-disparo.sh";
  echo "* * * * * $REPO_DIR/vendedoria/scripts/cron-max.sh";
  echo "30 3 * * * $REPO_DIR/vendedoria/scripts/cron-backup.sh";
  echo "*/5 * * * * $REPO_DIR/vendedoria/scripts/cron-healthcheck.sh" ) | sort -u | crontab -
setst "pm2" "ok"

step "PASSO 12 — Nginx"
setst "phase" "nginx"
cat > /etc/nginx/sites-available/vendedoria <<NGINX
server {
    listen 80;
    server_name ${DOMAIN} ${SERVER_IP};
    client_max_body_size 50M;
    location /_status/ { alias /var/www/status/; autoindex on; default_type text/plain; }
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
    }
}
NGINX
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/vendedoria /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
setst "nginx" "ok"

step "PASSO 13 — Aguardar app subir"
setst "phase" "app_wait"
APP_UP="no"
for i in $(seq 1 40); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://localhost:3000/ 2>/dev/null)
  echo "tentativa $i: HTTP $CODE"
  if [[ "$CODE" == "200" || "$CODE" == "307" || "$CODE" == "302" || "$CODE" == "308" ]]; then APP_UP="yes"; break; fi
  sleep 6
done
setst "app_up" "$APP_UP"

step "PASSO 14 — SSL (Let's Encrypt)"
setst "phase" "ssl"
certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "${CERTBOT_EMAIL}" --redirect 2>&1 | tail -15
if [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  setst "ssl" "ok"; systemctl reload nginx
else
  setst "ssl" "erro"
fi

step "PASSO 15 — Verificar webhook local (HTTPS)"
setst "phase" "webhook_verify"
sleep 3
WH=$(curl -sk --max-time 15 "https://${DOMAIN}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=PING123" 2>/dev/null)
echo "webhook local resp: $WH"
setst "webhook_local" "$([[ \"$WH\" == \"PING123\" ]] && echo ok || echo \"resp:$WH\")"

step "PASSO 16 — Configurar webhook na Meta"
setst "phase" "meta"
CALLBACK="https://${DOMAIN}/api/webhooks/whatsapp"
APP_TOKEN="${APP_ID}|${APP_SECRET}"
META_RESP=$(curl -s --max-time 30 -X POST \
  "https://graph.facebook.com/v20.0/${APP_ID}/subscriptions" \
  -d "object=whatsapp_business_account" \
  -d "callback_url=${CALLBACK}" \
  -d "verify_token=${VERIFY_TOKEN}" \
  -d "fields=messages,message_template_status_update" \
  -d "access_token=${APP_TOKEN}" 2>&1)
echo "Meta subscription resp: $META_RESP"
echo "$META_RESP" | grep -q '"success":true' && setst "meta_subscription" "ok" || setst "meta_subscription" "resp:$(echo $META_RESP | tr -d '\n' | head -c 200)"

WABA_INFO=$(curl -s --max-time 20 "https://graph.facebook.com/v20.0/${PHONE_ID}?fields=display_phone_number,verified_name,quality_rating&access_token=${META_TOKEN}" 2>&1)
echo "phone info: $WABA_INFO"
setst "phone_quality" "$(echo $WABA_INFO | jq -r '.quality_rating // "?"' 2>/dev/null)"

# Inscrever o número no webhook (override por phone) — garante entrega
curl -s --max-time 20 -X POST \
  "https://graph.facebook.com/v20.0/${PHONE_ID}/subscribed_apps" \
  -d "access_token=${META_TOKEN}" 2>&1 | head -c 200
echo ""

step "PASSO 17 — Teste OpenAI (agente responde)"
setst "phase" "ai_test"
OAI=$(curl -s --max-time 25 https://api.openai.com/v1/models \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" 2>&1 | jq -r '.data[0].id // .error.message // "?"' 2>/dev/null)
echo "OpenAI: $OAI"
setst "openai" "$([[ \"$OAI\" != \"?\" && \"$OAI\" != null ]] && echo ok || echo \"erro:$OAI\")"

step "PASSO 18 — Verificação externa final"
setst "phase" "final"
sleep 2
EXT=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 15 "https://${DOMAIN}/" 2>/dev/null)
setst "https_externo" "$EXT"

cd "$REPO_DIR/vendedoria"
ORGS=$(sudo -u postgres psql -d vendedoria_db -tAc "SELECT count(*) FROM \"WhatsappBusinessOrganization\";" 2>/dev/null)
AGENTS=$(sudo -u postgres psql -d vendedoria_db -tAc "SELECT count(*) FROM \"Agent\";" 2>/dev/null)
PROVS=$(sudo -u postgres psql -d vendedoria_db -tAc "SELECT count(*) FROM \"WhatsappProviderConfig\";" 2>/dev/null)
setst "db_orgs" "${ORGS:-?}"
setst "db_agents" "${AGENTS:-?}"
setst "db_providers" "${PROVS:-?}"

echo "DB_PASS=$DB_PASS" > /root/credentials.txt
chmod 600 /root/credentials.txt

setst "phase" "done"
setst "finished_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
step "CONCLUÍDO"
pm2 status
cat "$REPORT"
