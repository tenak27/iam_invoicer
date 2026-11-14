# Dépôt chiffré des bases et des clés

Chaque nuit, le serveur exporte les bases et les clés de tous les logiciels IAM dans une archive chiffrée.
Chaque jour, le poste d'IAM Technology vient la chercher. Le serveur ne peut pas relire ses propres archives :
il n'a que le certificat public ; la clé privée ne quitte pas le poste.

## Ce qui est sauvegardé

Pour chaque logiciel lancé depuis `/opt/iam-*` ou `/opt/faso-artisans` :

- `bases/<base>.dump` : chaque base PostgreSQL (`pg_dump -Fc`), y compris la base de chaque société cliente d'IAM INVOICER ;
- `bases/roles.sql` : les rôles de la base ;
- `cles/point-env` : le fichier `deploy/.env` (clé de chiffrement `SECRETS_KEY`, mots de passe, jetons) ;
- `cles/tokens.json` : les jetons de la console.

Non sauvegardé : les fichiers déposés par les utilisateurs (volume `files` d'IAM CLOUD) et les installateurs.

## Où

| Lieu | Chemin | Durée |
|---|---|---|
| Serveur | `/opt/iam-sauvegardes/iam-AAAA-MM-JJ_HHMM.tar.cms` | 3 dernières |
| Poste | `%USERPROFILE%\IAM-Sauvegardes\` (avec `journal.txt`) | 60 dernières |
| Clé privée | `%USERPROFILE%\.iam-sauvegardes\depot.key` | à copier sur un support hors du poste |

**Sans `depot.key`, aucune archive ne peut être ouverte.** Gardez-en une copie sur une clé USB rangée ailleurs.
Elle n'a pas de mot de passe ; pour en mettre un sur la copie : `openssl pkey -in depot.key -aes256 -out depot-protegee.key`.

## Programmation

- Serveur : `/etc/cron.d/iam-sauvegardes`, 1 h 30 chaque nuit, journal `/var/log/iam-sauvegardes.log`.
- Poste : tâche planifiée « IAM - Dépôt des sauvegardes », 8 h chaque jour (rattrapée au démarrage si le poste était éteint).
  Elle écrit « ATTENTION » dans `journal.txt` si la dernière archive a plus de deux jours.

## Contrôler

```powershell
.\verifier.ps1          # ouvre la dernière archive, contrôle les empreintes et les exports, efface la copie en clair
```

## Restaurer une base

```powershell
.\verifier.ps1 -Garder C:\restauration      # laisse le contenu en clair dans ce dossier
```

Puis envoyer l'export voulu au serveur et le recharger dans le conteneur du logiciel (exemple : IAM BTP) :

```sh
scp C:\restauration\iam-btp\bases\iam_btp.dump root@<serveur>:/root/
ssh root@<serveur>
cd /opt/iam-btp/deploy
docker compose -p iam-btp exec -T db pg_restore -U iam -d iam_btp --clean --if-exists < /root/iam_btp.dump
rm /root/iam_btp.dump
```

Effacer `C:\restauration` ensuite : il contient les clés en clair.

## Coffre des clés

Les logiciels chiffrent en base les secrets qu'ils doivent relire (secrets de webhook, clé des notifications,
jetons WhatsApp et SMS, mots de passe SMTP, secrets de double authentification) avec la clé `SECRETS_KEY` de leur
fichier `deploy/.env` (`tools/socle/server/coffre.ts`). Sans cette clé, ils fonctionnent mais gardent ces secrets en clair.

Activer le coffre sur le serveur, une seule fois (crée la clé là où elle manque, relance les serveurs, refait une sauvegarde) :

```sh
ssh root@<serveur> /opt/iam-sauvegardes/activer-coffre.sh
```

Une clé ne se change jamais : les secrets déjà chiffrés deviendraient illisibles. Elle est dans chaque archive (`cles/point-env`).

## Changer la paire de clés

Sur le poste : `openssl req -x509 -newkey rsa:4096 -nodes -keyout depot.key -out depot.crt -days 7300 -subj "/CN=IAM"`,
puis copier `depot.crt` dans `/opt/iam-sauvegardes/` du serveur. Garder l'ancienne clé tant que d'anciennes archives existent.
