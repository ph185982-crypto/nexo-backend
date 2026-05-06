#!/bin/sh

echo "=== Nexo Vendas — Starting ==="

# Run DB migrations in background so Render health check passes immediately.
# Workers verify DB state before processing, so late migration is safe.
echo "[start] Running prisma db push in background..."
(node_modules/.bin/prisma db push --accept-data-loss 2>&1 && \
  echo "[start] DB schema OK" && \
  node prisma/seed.js 2>&1 && echo "[start] Seed OK" || echo "[start] Seed skipped") &

echo "[start] Starting server..."
exec node server.js
