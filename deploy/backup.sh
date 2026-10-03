#!/bin/sh
# Sauvegarde quotidienne de la base (à lancer par cron, ex. 0 2 * * * /chemin/deploy/backup.sh).
# Conserve 30 jours de sauvegardes dans deploy/backups/.
set -e
cd "$(dirname "$0")"
stamp=$(date +%Y%m%d-%H%M)
docker compose exec -T db pg_dump -U iam -d iam_invoicer -Fc -f "/backups/iam-invoicer-$stamp.dump"
find ./backups -name 'iam-invoicer-*.dump' -mtime +30 -delete
echo "Sauvegarde : backups/iam-invoicer-$stamp.dump"
