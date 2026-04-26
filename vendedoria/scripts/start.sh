#!/bin/sh
set -e

echo "[start] DATABASE_URL set: $([ -n "$DATABASE_URL" ] && echo yes || echo NO)"
echo "[start] REDIS_URL set: $([ -n "$REDIS_URL" ] && echo yes || echo NO)"
echo "[start] NODE_ENV: $NODE_ENV"
echo "[start] pwd: $(pwd)"
echo "[start] ls node_modules/.bin/prisma: $(ls node_modules/.bin/prisma 2>&1)"

echo "Running database migrations..."
node_modules/.bin/prisma db push --accept-data-loss
echo "[start] prisma db push exit: $?"

echo "Running seed (skips if already seeded)..."
node prisma/seed.js || echo "Seed skipped (already exists)"

echo "Starting VendedorIA..."
exec node server.js
