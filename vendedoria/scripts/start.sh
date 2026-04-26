#!/bin/sh

echo "Running database migrations in background..."
(node_modules/.bin/prisma db push --accept-data-loss && \
  echo "[start] Migrations OK" && \
  node prisma/seed.js || echo "[start] Seed skipped (already seeded)") &

echo "Starting VendedorIA..."
exec node server.js
