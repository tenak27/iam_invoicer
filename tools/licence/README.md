# Licences IAM INVOICER — guide de l'éditeur

Réservé à IAM Technology. Ce dossier sert à émettre les licences vendues aux clients.

## Principe

- Une licence est un texte signé avec la **clé privée** de l'éditeur (Ed25519). Le logiciel contient seulement la **clé publique** (`src/shared/licence.ts`) : il vérifie la licence hors connexion mais ne peut pas en fabriquer.
- La licence porte la raison sociale du client (et, en option, son identifiant fiscal). Le client ne peut pas la réutiliser pour une autre société.
- Sans licence, le logiciel fonctionne en **évaluation limitée pendant 30 jours** : tous les modules, mais au plus 30 documents, 25 clients, 10 fournisseurs, 50 articles, 3 salariés et 2 utilisateurs actifs (`TRIAL_LIMITS` dans `src/shared/licence.ts`). Ensuite, et à l'expiration d'une licence, il passe en **lecture seule** : consultation, impression et export restent possibles, mais plus aucune création ni modification. Les données ne sont jamais bloquées.
- Tant qu'aucune licence n'est active, les documents portent le filigrane « VERSION D'ÉVALUATION » et une mention en pied de page.

## Paliers

| Palier | Modules | Utilisateurs |
|---|---|---|
| Essentiel | Ventes, caisse, clients, articles, stock, paiements, rapports | 2 |
| Pro | Essentiel + achats, fournisseurs, comptabilité et déclarations, e-mails et SMS | 5 |
| Entreprise | Tous les modules (RH et paie, CRM, projets, immobilisations, budgets), application au nom et au logo du client | illimité |
| Sur mesure | Modules choisis un par un | au choix |

Les modules de chaque palier se règlent dans `TIERS` (`src/shared/licence.ts`). Les coordonnées affichées aux clients sont dans `VENDOR`, dans le même fichier : **complétez le téléphone, l'e-mail et le site** avant de diffuser une version.

## Émettre une licence depuis l'application (recommandé)

Sur le poste de l'éditeur (là où se trouve `%USERPROFILE%.iam-invoicerlicence-private.pem`), ou sur un serveur lancé avec `LICENCE_PRIVATE_KEY_FILE`, le menu **Administration → Émission de licences** apparaît :

- Créez un utilisateur avec le rôle **Gestionnaire de licences** : il ne voit que ce module (aucune donnée commerciale ou comptable). L'administrateur y a aussi accès.
- **Nouvelle licence** : raison sociale, IFU, palier ou modules sur mesure, utilisateurs, durée (1 mois à 3 ans, perpétuelle, ou date précise), marque blanche, contact et note interne.
- La clé se copie en un clic ou s'enregistre en `.txt` avec les instructions d'activation pour le client.
- Le **registre** liste toutes les licences (actives, à renouveler sous 30 jours, expirées, révoquées). **Renouveler** reprend la licence avec un an de plus ; **Révoquer** la signale dans le registre (une licence déjà activée hors ligne reste valable jusqu'à sa fin : préférez des licences annuelles).
- Chaque licence est aussi ajoutée au registre CSV `licences.csv` à côté de la clé ; **Reprendre le registre CSV** importe les licences émises avec l'outil ci-dessous.
- Sur les installations des clients, la clé privée est absente : le menu et le rôle n'apparaissent pas.

## Émettre une licence en ligne de commande

**Le plus simple :** double-cliquez sur **Emettre une licence.cmd** dans ce dossier. Les questions s'enchaînent (client, offre, utilisateurs, durée) et la clé est copiée dans le presse-papiers, prête à envoyer.

En ligne de commande :

```bash
node tools/licence/issue.mjs --client "Pharmacie du Progrès SARL" --tier pro --months 12
node tools/licence/issue.mjs --client "SONABEL" --ifu 00012345A --tier entreprise --perpetual
node tools/licence/issue.mjs --client "Boutique X" --tier sur-mesure --modules sales,clients,products,cash --users 3 --until 2027-06-30
```

- `--client` : la raison sociale **exactement** comme le client l'a saisie dans *Société & paramètres*. Les différences d'accents, de majuscules et de forme juridique (SARL, SA…) sont tolérées.
- `--ifu` : facultatif. S'il est renseigné, l'identifiant fiscal configuré chez le client doit correspondre.
- `--months N`, `--until AAAA-MM-JJ` ou `--perpetual` : durée de la licence (12 mois par défaut).
- `--users N` : remplace le nombre d'utilisateurs du palier (0 = illimité).
- `--white-label` : application au nom et au logo du client, sur n'importe quel palier.

La commande affiche la clé à envoyer au client. Il la colle dans **Administration → Licence → Activer**. Chaque licence est ajoutée au registre `~/.iam-invoicer/licences.csv`, qui s'ouvre dans Excel.

## La clé privée

- Fichier : `C:\Users\konat\.iam-invoicer\licence-private.pem`. Il n'est **jamais** dans le dépôt Git.
- **Sauvegardez-le** dans deux endroits sûrs, par exemple une clé USB chiffrée et un coffre-fort de mots de passe. Sans lui, impossible d'émettre de nouvelles licences pour les versions déjà installées.
- S'il fuit, n'importe qui peut fabriquer des licences. Il faut alors générer une nouvelle paire de clés, remplacer la clé publique dans `src/shared/licence.ts`, publier une nouvelle version et rééditer les licences des clients.

## Limites

Comme toute application installée chez le client, la protection est dissuasive, pas absolue : une personne techniquement compétente peut modifier le programme. La vraie protection, ce sont le service, les mises à jour et l'assistance réservés aux clients sous licence.
