#!/bin/sh
# IAM Technology — active le coffre des clés sur le serveur : donne une clé SECRETS_KEY à chaque
# logiciel qui n'en a pas encore, relance son serveur (qui chiffre alors les secrets restés en clair),
# puis refait une sauvegarde chiffrée pour que les nouvelles clés soient dans le dépôt.
#
# À lancer une seule fois, sur le serveur, en root. Sans danger si on le relance : une clé déjà
# présente n'est jamais remplacée (la remplacer rendrait les secrets illisibles). N'affiche aucune clé.
set -eu
umask 077

for dir in /opt/iam-mails /opt/iam-btp /opt/iam-ecommerce /opt/iam-education /opt/iam-cloud /opt/iam-sante /opt/iam-location /opt/faso-artisans /opt/iam-traffic; do
  env="$dir/deploy/.env"
  projet=$(basename "$dir")
  if [ ! -f "$env" ]; then echo "$projet : pas de fichier .env, ignoré"; continue; fi
  if grep -q '^SECRETS_KEY=.\+' "$env"; then
    echo "$projet : clé déjà présente"
  else
    sed -i '/^SECRETS_KEY=$/d' "$env"
    echo "SECRETS_KEY=$(openssl rand -hex 32)" >> "$env"
    echo "$projet : clé créée"
  fi
  (cd "$dir/deploy" && docker compose --env-file .env -p "$projet" up -d app >/dev/null 2>&1) && echo "$projet : serveur relancé"
done

if [ -x /opt/iam-sauvegardes/iam-sauvegarde.sh ]; then /opt/iam-sauvegardes/iam-sauvegarde.sh; fi
