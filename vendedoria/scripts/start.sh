#!/bin/sh
# Sem set -e global: DB temporariamente indisponível não derruba o container

echo "=== [1/3] Applying database schema ==="
MAX_TRIES=10
WAIT=6
i=1
while [ $i -le $MAX_TRIES ]; do
  if node_modules/.bin/prisma db push --accept-data-loss 2>&1; then
    echo "DB schema push OK"
    break
  fi
  echo "Attempt $i/$MAX_TRIES failed. Retrying in ${WAIT}s..."
  i=$((i + 1))
  sleep $WAIT
done
if [ $i -gt $MAX_TRIES ]; then
  echo "WARNING: DB push falhou apos $MAX_TRIES tentativas — iniciando app mesmo assim"
fi

echo "=== [2/3] Running seed ==="
node prisma/seed.js && echo "Seed OK" || echo "Seed skipped (already seeded or DB unavailable)"

echo "=== [3/3] Starting Nexo Vendas ==="
exec node server.js
