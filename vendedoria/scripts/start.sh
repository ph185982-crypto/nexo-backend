#!/bin/sh
set -e

echo "=== [1/3] Applying database schema ==="
node_modules/.bin/prisma db push --accept-data-loss

echo "=== [2/3] Running seed ==="
node prisma/seed.js && echo "Seed OK" || echo "Seed skipped (already seeded or error)"

echo "=== [3/3] Starting Nexo Vendas ==="
exec node server.js
