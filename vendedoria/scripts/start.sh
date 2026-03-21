#!/bin/sh
set -e

echo "Running database migrations..."
node_modules/.bin/prisma db push --accept-data-loss

echo "Running seed (skips if already seeded)..."
node prisma/seed.js || echo "Seed skipped (already exists)"

echo "Starting VendedorIA..."
exec node server.js
