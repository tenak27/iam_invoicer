#!/bin/sh
# Sauvegarde de toutes les bases du serveur : base principale et base de chaque client
# (iam_*), une par fichier, au format pg_dump compressé. Lancée chaque nuit par cron
# (voir deploy/vps/installer.sh). Conserve 14 jours dans deploy/backups/<date>/.
# Restaurer une base : docker compose exec -T db pg_restore -U iam -d <base> --clean < fichier.dump
set -e
cd "$(dirname "$0")"
stamp=$(date +%Y-%m-%d_%H%M)
mkdir -p "backups/$stamp"
bases=$(docker compose --env-file .env exec -T db psql -U iam -d iam_invoicer -Atc "SELECT datname FROM pg_database WHERE datname = 'iam_invoicer' OR datname LIKE 'iam\_%' ORDER BY 1")
n=0
for base in $bases; do
  docker compose --env-file .env exec -T db pg_dump -U iam -d "$base" -Fc > "backups/$stamp/$base.dump"
  n=$((n + 1))
done
find ./backups -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
echo "$(date '+%F %T') Sauvegarde : $n base(s) dans backups/$stamp"
