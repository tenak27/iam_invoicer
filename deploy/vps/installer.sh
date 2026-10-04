#!/bin/bash
# Installation d'IAM INVOICER sur un VPS (Ubuntu ou Debian), en une commande :
#
#   curl -fsSL https://raw.githubusercontent.com/tenak27/iam_invoicer/main/deploy/vps/installer.sh | sudo bash -s -- cloud.iam.bf
#
# Ce que fait le script :
#   - installe Docker si besoin ;
#   - récupère IAM INVOICER dans /opt/iam-invoicer et génère deploy/.env (mots de passe aléatoires) ;
#   - démarre PostgreSQL et le serveur IAM INVOICER, avec l'hébergement de plusieurs clients
#     (une base PostgreSQL par client) ; PostgreSQL n'est jamais exposé sur Internet ;
#   - HTTPS : si un nginx sert déjà d'autres sites sur ce serveur, ajoute un site nginx pour le
#     domaine (certificat Let's Encrypt via certbot) sans toucher aux autres ; sinon, Caddy ;
#   - programme une sauvegarde de toutes les bases chaque nuit (14 jours conservés).
# Relancer le script met à jour l'installation sans toucher aux données ni aux mots de passe.
# Changer de domaine : relancer avec le nouveau domaine.
set -euo pipefail

DOMAIN="${1:-}"
REPO="${IAM_REPO:-https://github.com/tenak27/iam_invoicer.git}"
DIR="${IAM_DIR:-/opt/iam-invoicer}"

say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
warn() { printf '  \033[1;33m! %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
# Code d'activation lisible : XXXX-XXXX-XXXX
gen_code() { openssl rand -hex 6 | tr 'a-f' 'A-F' | fold -w4 | paste -sd- ; }

[ "$(id -u)" = "0" ] || die "Lancez le script en administrateur : sudo bash installer.sh votre-domaine"
ENV="$DIR/deploy/.env"
if [ -z "$DOMAIN" ] && [ -f "$ENV" ]; then DOMAIN=$(grep -E '^DOMAIN=' "$ENV" | cut -d= -f2-); fi
[ -n "$DOMAIN" ] || die "Indiquez le nom de domaine : sudo bash installer.sh cloud.iam.bf"
echo "$DOMAIN" | grep -Eq '^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' || die "Nom de domaine invalide : $DOMAIN"

# Mode : un nginx sert déjà le port 80 → on s'insère derrière lui ; sinon Caddy
if ss -tln | grep -qE ':80\s' ; then
  if systemctl is-active --quiet nginx; then MODE=nginx
  else die "Le port 80 est déjà utilisé par un autre programme que nginx : libérez-le ou installez IAM INVOICER derrière ce programme."; fi
else MODE=caddy; fi
say "Domaine $DOMAIN — mode $([ "$MODE" = nginx ] && echo 'derrière le nginx existant' || echo 'Caddy (serveur dédié)')"

IP=$(curl -fsS4 --max-time 10 https://api.ipify.org || true)
RESOLVED=$(getent ahostsv4 "$DOMAIN" | awk '{print $1; exit}' || true)
DNS_OK=1
if [ -n "$IP" ] && [ "$RESOLVED" != "$IP" ]; then
  DNS_OK=0
  warn "$DOMAIN pointe vers « ${RESOLVED:-rien} » alors que ce serveur a l'adresse $IP."
  warn "Créez un enregistrement DNS de type A : $DOMAIN → $IP, puis relancez ce script pour le HTTPS."
fi

say "Paquets système"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq || warn "apt-get update a signalé des erreurs (on continue)"
apt-get install -y -qq ca-certificates curl git openssl > /dev/null
if ! command -v docker > /dev/null; then
  say "Installation de Docker"
  curl -fsSL https://get.docker.com | sh > /dev/null
fi
systemctl enable --now docker > /dev/null
# Pare-feu déjà actif : on ouvre seulement HTTP et HTTPS (on ne l'active jamais d'office,
# pour ne pas couper les autres services du serveur).
if command -v ufw > /dev/null && ufw status | grep -q 'Status: active'; then
  ufw allow 80/tcp > /dev/null; ufw allow 443/tcp > /dev/null
fi

say "Récupération d'IAM INVOICER dans $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q --depth 1 origin main && git -C "$DIR" reset -q --hard origin/main
else
  git clone -q --depth 1 "$REPO" "$DIR"
fi

if [ ! -f "$ENV" ]; then
  say "Génération des mots de passe (deploy/.env)"
  umask 077
  cat > "$ENV" <<EOF
DOMAIN=$DOMAIN
DB_PASSWORD=$(openssl rand -hex 24)
ADMIN_TOKEN=$(openssl rand -hex 32)
SETUP_CODE=$(openssl rand -hex 6 | tr a-f A-F | sed 's/(....)(....)(....)/--/')
IAM_PORT=8090
IAM_IMAGE=ghcr.io/tenak27/iam-invoicer:latest
EOF
else
  sed -i "s/^DOMAIN=.*/DOMAIN=$DOMAIN/" "$ENV"
  grep -q '^ADMIN_TOKEN=.\+' "$ENV" || { sed -i '/^ADMIN_TOKEN=/d' "$ENV"; echo "ADMIN_TOKEN=$(openssl rand -hex 32)" >> "$ENV"; }
  grep -q '^IAM_PORT=' "$ENV" || echo "IAM_PORT=8090" >> "$ENV"
  grep -q '^SETUP_CODE=.\+' "$ENV" || { sed -i '/^SETUP_CODE=/d' "$ENV"; echo "SETUP_CODE=$(gen_code)" >> "$ENV"; }
  grep -q '^IAM_IMAGE=' "$ENV" || echo "IAM_IMAGE=ghcr.io/tenak27/iam-invoicer:latest" >> "$ENV"
fi
# Image imposée à l'appel (ex. IAM_IMAGE=ghcr.io/tenak27/iam-invoicer:main pour la dernière version de développement)
if [ -n "${IAM_IMAGE:-}" ]; then sed -i "s#^IAM_IMAGE=.*#IAM_IMAGE=$IAM_IMAGE#" "$ENV"; fi
chmod 600 "$ENV"
IAM_PORT=$(grep -E '^IAM_PORT=' "$ENV" | cut -d= -f2-)
mkdir -p "$DIR/deploy/telechargements" "$DIR/deploy/backups"

cd "$DIR/deploy"
if [ "$MODE" = nginx ]; then
  COMPOSE=(docker compose --env-file .env -f docker-compose.yml -f docker-compose.nginx.yml)
  SERVICES=(db app)
else
  COMPOSE=(docker compose --env-file .env -f docker-compose.yml)
  SERVICES=()
fi
# Image téléchargée depuis GitHub (aucune compilation sur le serveur) ; IAM_BUILD=1 pour construire ici
if [ "${IAM_BUILD:-0}" = "1" ]; then
  say "Construction locale de l'image (5 à 10 minutes, 1,5 Go de mémoire)"
  "${COMPOSE[@]}" up -d --build --remove-orphans "${SERVICES[@]}"
else
  say "Téléchargement de l'image $(grep -E '^IAM_IMAGE=' "$ENV" | cut -d= -f2-) et démarrage"
  "${COMPOSE[@]}" pull -q "${SERVICES[@]:-app}" db
  "${COMPOSE[@]}" up -d --no-build --remove-orphans "${SERVICES[@]}"
fi

say "Attente du démarrage du serveur"
OK=0
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T app wget -qO- http://127.0.0.1:8080/health > /dev/null 2>&1; then OK=1; break; fi
  sleep 5
done
[ "$OK" = "1" ] || { "${COMPOSE[@]}" logs --tail 60 app; die "Le serveur ne répond pas : voir les journaux ci-dessus."; }

SCHEME=https
if [ "$MODE" = nginx ]; then
  say "Site nginx pour $DOMAIN (les autres sites ne sont pas modifiés)"
  SITE="/etc/nginx/sites-available/iam-invoicer-$DOMAIN"
  # Conserve le bloc HTTPS ajouté par certbot lors d'une installation précédente
  if [ ! -f "$SITE" ] || ! grep -q "proxy_pass http://127.0.0.1:$IAM_PORT" "$SITE"; then
    cat > "$SITE" <<EOF
# IAM INVOICER — généré par deploy/vps/installer.sh
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:$IAM_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
    }
}
EOF
  fi
  ln -sf "$SITE" "/etc/nginx/sites-enabled/iam-invoicer-$DOMAIN"
  nginx -t 2>&1 | tail -2 || die "Configuration nginx refusée : rien n'a été rechargé."
  systemctl reload nginx
  if [ "$DNS_OK" = "1" ]; then
    command -v certbot > /dev/null || apt-get install -y -qq certbot python3-certbot-nginx > /dev/null
    if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect --keep-until-expiring > /tmp/iam-certbot.log 2>&1; then
      echo "  Certificat HTTPS installé (renouvellement automatique par certbot)."
    else
      SCHEME=http; warn "Certificat HTTPS non obtenu : voir /tmp/iam-certbot.log. Le site reste accessible en HTTP."
    fi
  else
    SCHEME=http
  fi
fi

say "Sauvegarde automatique de toutes les bases chaque nuit à 2 h"
chmod +x "$DIR/deploy/backup.sh" "$DIR/deploy/vps/"*.sh
cat > /etc/cron.d/iam-invoicer <<EOF
0 2 * * * root $DIR/deploy/backup.sh >> /var/log/iam-invoicer-sauvegarde.log 2>&1
EOF

TOKEN=$(grep -E '^ADMIN_TOKEN=' "$ENV" | cut -d= -f2-)
CODE=$(grep -E '^SETUP_CODE=' "$ENV" | cut -d= -f2-)
cat <<EOF

$(printf '\033[1;32m')✓ IAM INVOICER est installé.$(printf '\033[0m')

  Site et application : $SCHEME://$DOMAIN   (application : $SCHEME://$DOMAIN/app/)
  Adresse d'un client : $SCHEME://$DOMAIN/t/<identifiant-du-client>
  Code d'activation de la base principale (première visite de /app/) : $CODE

  Pour créer les bases de vos clients depuis IAM INVOICER (poste de l'éditeur) :
    Administration → Émission de licences → Bases clients en ligne
      Adresse du serveur     : $DOMAIN
      Jeton d'administration : $TOKEN

  Conservez ce jeton en lieu sûr (il est aussi dans $ENV, lisible par root uniquement).
  Sauvegardes : $DIR/deploy/backups (chaque nuit, 14 jours)
  Mise à jour : sudo bash $DIR/deploy/vps/installer.sh
EOF
