#!/usr/bin/env bash
# CLIaaS database backup script
# Performs pg_dump + gzip with 7-day rotation.
# Designed to be run via cron on the VPS.
#
# Usage: scripts/db-backup.sh
# Cron example: 0 3 * * * /opt/cliaas/current/scripts/db-backup.sh

set -euo pipefail

BACKUP_DIR="/opt/cliaas/backups"
ENV_FILE="/opt/cliaas/shared/.env"
RETENTION_DAYS=7
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/cliaas_${TIMESTAMP}.sql.gz"

# Load DATABASE_URL from env file
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found" >&2
  exit 1
fi

DATABASE_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)

if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL not set in $ENV_FILE" >&2
  exit 1
fi

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

# Perform backup
echo "Starting backup to $BACKUP_FILE"
pg_dump "$DATABASE_URL" --no-owner --no-acl | gzip > "$BACKUP_FILE"
echo "Backup complete: $(du -h "$BACKUP_FILE" | cut -f1)"

# Rotate old backups
echo "Removing backups older than ${RETENTION_DAYS} days..."
find "$BACKUP_DIR" -name "cliaas_*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete

echo "Backup rotation complete. Current backups:"
ls -lh "$BACKUP_DIR"/cliaas_*.sql.gz 2>/dev/null || echo "  (none)"
