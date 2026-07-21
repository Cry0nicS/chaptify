#!/usr/bin/env bash
# WAL-safe nightly SQLite backup for Chaptify.
#
# Runs SQLite's online .backup from a throwaway Alpine container against the storage volume, then
# prunes local snapshots older than RETENTION_DAYS. The .backup API is safe under concurrent
# writers, unlike a raw copy of a WAL-mode database. The node:22-alpine app image does not ship the
# sqlite3 CLI, hence the throwaway alpine container.
#
# Schedule on the VPS, e.g. `crontab -e`:
#   15 3 * * *  /opt/chaptify/deploy/backup.sh >> /opt/chaptify/backups/backup.log 2>&1
#
# Override any of these via the environment:
#   CHAPTIFY_VOLUME  Docker volume holding the storage root (confirm with `docker volume ls`).
#                    Compose prefixes it with the project directory name.
#   BACKUP_DIR       Where snapshots are written on the host.
#   RETENTION_DAYS   Local snapshots older than this are deleted.
set -euo pipefail

VOLUME="${CHAPTIFY_VOLUME:-chaptify_chaptify-storage}"
BACKUP_DIR="${BACKUP_DIR:-/opt/chaptify/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date +%F-%H%M)"

mkdir -p "$BACKUP_DIR"

docker run --rm \
    -v "${VOLUME}:/data" \
    -v "${BACKUP_DIR}:/backups" \
    alpine:3.24 sh -c \
    "apk add --no-cache sqlite >/dev/null && \
     sqlite3 /data/database/chaptify.sqlite \".backup '/backups/chaptify-${STAMP}.sqlite'\""

# --- Ship off-box: a backup that only lives on the VPS does not survive the VPS. Wire your
# destination here (S3/R2/Backblaze/rsync). Example with rclone: ---
# rclone copy "${BACKUP_DIR}/chaptify-${STAMP}.sqlite" remote:chaptify-backups/

find "$BACKUP_DIR" -name 'chaptify-*.sqlite' -mtime "+${RETENTION_DAYS}" -delete
