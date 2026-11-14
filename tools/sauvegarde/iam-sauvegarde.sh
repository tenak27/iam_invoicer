#!/bin/sh
# IAM Technology — dépôt chiffré des bases et des clés de tous les logiciels du serveur.
#
# Chaque nuit (cron, voir LISEZMOI.md) : pour chaque logiciel IAM qui tourne (dossier /opt/iam-* ou
# /opt/faso-artisans), exporte toutes ses bases (pg_dump, une par fichier), ses rôles, et copie ses
# clés (deploy/.env, tokens.json). Le tout est mis dans une seule archive, chiffrée avec le certificat
# public depot.crt : le serveur peut écrire une archive, il ne peut pas la relire. La clé privée reste
# sur le poste d'IAM Technology, qui vient chercher les archives (recuperer.ps1).
#
# Ne touche à aucun autre site du serveur : seuls les conteneurs « db » lancés depuis /opt/iam-* ou
# /opt/faso-artisans sont lus.
set -eu
umask 077

DEST=${IAM_SAUVEGARDES:-/opt/iam-sauvegardes}
CERT="$DEST/depot.crt"
GARDER=${GARDER:-7}

[ -s "$CERT" ] || { echo "Certificat absent : $CERT" >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl absent" >&2; exit 1; }

stamp=$(date +%Y-%m-%d_%H%M)
work=$(mktemp -d "$DEST/.travail.XXXXXX")
trap 'rm -rf "$work"' EXIT INT TERM

docker ps --filter label=com.docker.compose.service=db \
  --format '{{.Names}}|{{.Label "com.docker.compose.project.working_dir"}}' > "$work/.conteneurs"

logiciels=0
bases_total=0
while IFS='|' read -r name dir; do
  case "$dir" in
    /opt/iam-*|/opt/faso-artisans*) ;;
    *) continue ;;
  esac
  # /opt/iam-invoicer/deploy → iam-invoicer
  label=$(echo "$dir" | cut -d/ -f3)
  out="$work/$label"
  mkdir -p "$out/bases" "$out/cles"

  bases=$(docker exec "$name" psql -U iam -d postgres -Atc \
    "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres' ORDER BY 1")
  for base in $bases; do
    docker exec "$name" pg_dump -U iam -d "$base" -Fc > "$out/bases/$base.dump"
    bases_total=$((bases_total + 1))
  done
  docker exec "$name" pg_dumpall -U iam --globals-only > "$out/bases/roles.sql"

  for f in "$dir/.env" "$dir/tokens.json"; do
    if [ -f "$f" ]; then cp "$f" "$out/cles/$(basename "$f" | sed 's/^\./point-/')"; fi
  done
  logiciels=$((logiciels + 1))
done < "$work/.conteneurs"
rm -f "$work/.conteneurs"

[ "$logiciels" -gt 0 ] || { echo "Aucun logiciel IAM trouvé : rien à sauvegarder" >&2; exit 1; }

# Empreinte de chaque fichier, contrôlée à la relecture (verifier.ps1)
(cd "$work" && find . -type f ! -name SHA256SUMS | sort | xargs sha256sum > SHA256SUMS)

archive="$DEST/iam-$stamp.tar.cms"
tar -C "$work" -cf - . \
  | openssl cms -encrypt -binary -stream -aes-256-cbc -outform DER -out "$archive.partiel" "$CERT"
mv "$archive.partiel" "$archive"
(cd "$DEST" && sha256sum "iam-$stamp.tar.cms" > "iam-$stamp.tar.cms.sha256")

# Ne garder que les dernières archives : le dépôt durable est le poste d'IAM Technology
ls -1t "$DEST"/iam-*.tar.cms 2>/dev/null | tail -n +$((GARDER + 1)) | while read -r old; do
  rm -f "$old" "$old.sha256"
done

echo "$(date '+%F %T') Dépôt chiffré : $logiciels logiciel(s), $bases_total base(s), $(du -h "$archive" | cut -f1) — $archive"
