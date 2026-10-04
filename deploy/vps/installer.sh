#!/bin/bash
# Installation d'IAM INVOICER sur un VPS (Ubuntu 22.04/24.04 ou Debian 12), en une commande :
#
#   curl -fsSL https://raw.githubusercontent.com/tenak27/iam_invoicer/main/deploy/vps/installer.sh | sudo bash -s -- cloud.iam.bf
#
# Ce que fait le script :
#   - installe Docker si besoin, ouvre les ports 22, 80 et 443 (pare-feu ufw) ;
#   - récupère IAM INVOICER dans /opt/iam-invoicer et génère deploy/.env (mots de passe aléatoires) ;
#   - démarre PostgreSQL, le serveur IAM INVOICER et Caddy (certificat HTTPS automatique) ;
#   - active l'hébergement de plusieurs clients (une base PostgreSQL par client) ;
#   - programme une sauvegarde de toutes les bases chaque nuit (14 jours conservés).
# Relancer le script met à jour l'installation sans toucher aux données ni aux mots de passe.
set -euo pipefail

DOMAIN="${1:-}"
REPO="${IAM_REPO:-https://github.com/tenak27/iam_invoicer.git}"
DIR="${IAM_DIR:-/opt/iam-invoicer}"

say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "Lancez le script en administrateur : sudo bash installer.sh votre-domaine"
if [ -z "$DOMAIN" ] && [ -f "$DIR/deploy/.env" ]; then DOMAIN=$(grep -E '^DOMAIN=' "$DIR/deploy/.env" | cut -d= -f2-); fi
[ -n "$DOMAIN" ] || die "Indiquez le nom de domaine : sudo bash installer.sh cloud.iam.bf"
echo "$DOMAIN" | grep -Eq '^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' || die "Nom de domaine invalide : $DOMAIN"

say "Vérification du domaine $DOMAIN"
IP=$(curl -fsS4 --max-time 10 https://api.ipify.org || true)
RESOLVED=$(getent ahostsv4 "$DOMAIN" | awk '{print $1; exit}' || true)
if [ -n "$IP" ] && [ "$RESOLVED" != "$IP" ]; then
  echo "  Attention : $DOMAIN pointe vers « ${RESOLVED:-rien} » et ce serveur a l'adresse $IP."
  echo "  Créez un enregistrement DNS de type A : $DOMAIN → $IP (le certificat HTTPS en dépend)."
  echo "  L'installation continue ; le site sera accessible en HTTPS dès que le DNS sera à jour."
fi

say "Paquets système"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git openssl ufw > /dev/null
if ! command -v docker > /dev/null; then
  say "Installation de Docker"
  curl -fsSL https://get.docker.com | sh > /dev/null
fi
systemctl enable --now docker > /dev/null

say "Pare-feu : SSH, HTTP et HTTPS uniquement (PostgreSQL n'est pas exposé)"
ufw allow OpenSSH > /dev/null || ufw allow 22/tcp > /dev/null
ufw allow 80/tcp > /dev/null
ufw allow 443/tcp > /dev/null
ufw --force enable > /dev/null

say "Récupération d'IAM INVOICER dans $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q origin main && git -C "$DIR" reset -q --hard origin/main
else
  git clone -q --depth 1 "$REPO" "$DIR"
fi

ENV="$DIR/deploy/.env"
if [ ! -f "$ENV" ]; then
  say "Génération des mots de passe (deploy/.env)"
  umask 077
  cat > "$ENV" <<EOF
DOMAIN=$DOMAIN
DB_PASSWORD=$(openssl rand -hex 24)
ADMIN_TOKEN=$(openssl rand -hex 32)
EOF
else
  sed -i "s/^DOMAIN=.*/DOMAIN=$DOMAIN/" "$ENV"
  grep -q '^ADMIN_TOKEN=.\+' "$ENV" || { sed -i '/^ADMIN_TOKEN=/d' "$ENV"; echo "ADMIN_TOKEN=$(openssl rand -hex 32)" >> "$ENV"; }
fi
chmod 600 "$ENV"
mkdir -p "$DIR/deploy/telechargements" "$DIR/deploy/backups"

say "Construction et démarrage (5 à 10 minutes la première fois)"
cd "$DIR/deploy"
docker compose --env-file .env up -d --build --remove-orphans

say "Sauvegarde automatique de toutes les bases chaque nuit à 2 h"
chmod +x "$DIR/deploy/backup.sh" "$DIR/deploy/vps/"*.sh
cat > /etc/cron.d/iam-invoicer <<EOF
0 2 * * * root $DIR/deploy/backup.sh >> /var/log/iam-invoicer-sauvegarde.log 2>&1
EOF

say "Attente du démarrage du serveur"
for _ in $(seq 1 60); do
  if docker compose --env-file .env exec -T app wget -qO- http://127.0.0.1:8080/health > /dev/null 2>&1; then OK=1; break; fi
  sleep 5
done
[ "${OK:-0}" = "1" ] || { docker compose --env-file .env logs --tail 50 app; die "Le serveur ne répond pas : voir les journaux ci-dessus."; }

TOKEN=$(grep -E '^ADMIN_TOKEN=' "$ENV" | cut -d= -f2-)
cat <<EOF

$(printf '\033[1;32m')✓ IAM INVOICER est installé.$(printf '\033[0m')

  Site et application : https://$DOMAIN   (application : https://$DOMAIN/app/)
  Adresse d'un client : https://$DOMAIN/t/<identifiant-du-client>

  Pour créer les bases de vos clients depuis IAM INVOICER (poste de l'éditeur) :
    Administration → Émission de licences → Bases clients en ligne
      Adresse du serveur     : $DOMAIN
      Jeton d'administration : $TOKEN

  Conservez ce jeton en lieu sûr (il est aussi dans $ENV, lisible par root uniquement).
  Sauvegardes : $DIR/deploy/backups (chaque nuit, 14 jours)
  Mise à jour : sudo bash $DIR/deploy/vps/installer.sh
EOF
