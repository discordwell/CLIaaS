#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Starting Postgres..."
docker compose up -d

echo "Waiting for Postgres to be healthy..."
until docker compose exec -T postgres pg_isready -U cliaas > /dev/null 2>&1; do
  sleep 1
done
echo "Postgres is ready."

# Ensure .env.local exists with DATABASE_URL
if [ ! -f .env.local ]; then
  cp .env.local.example .env.local
  echo "Created .env.local from example."
fi

# Source DATABASE_URL for drizzle-kit
export $(grep -v '^#' .env.local | xargs)

echo "Running migrations..."
pnpm db:migrate

echo "Seeding database..."
pnpm db:seed

echo "Done! Database is ready."
