<p align="center"><img src="resources/logo.svg" alt="IAM INVOICER" width="520"></p>

# IAM INVOICER

Logiciel de facturation, de caisse, de stock et de comptabilité SYSCOHADA d'IAM Technology, adapté au Burkina Faso.
Il fonctionne sur **Windows, macOS, Android, iOS et dans un navigateur**. Toutes les versions partagent les mêmes données grâce à un serveur installé sur votre nom de domaine.

## Fonctionnalités

| Module | Contenu |
|---|---|
| Ventes | Devis → bon de livraison → facture → avoir, numérotation automatique `FAC-2026-0001`, PDF avec montant en lettres |
| Caisse | Point de vente tactile et lecteur de codes-barres, ouverture et clôture de caisse par caissier, paiement en espèces, Orange Money, Moov Money ou Wave (y compris paiement mixte), rendu de monnaie, entrées et sorties d'espèces, écart de caisse, ticket 80 mm |
| Achats | Bon de commande → bon de réception (entrée en stock) → facture fournisseur |
| Stock | Plusieurs dépôts, stock par dépôt, transferts, suivi par lot ou numéro de série avec traçabilité, CMUP, inventaire par dépôt, alertes de seuil |
| Paiements | Encaissements et décaissements partiels, soldes clients et fournisseurs |
| Comptabilité | SYSCOHADA révisé : écritures générées automatiquement (ventes, achats, règlements, caisse), opérations diverses, journaux, grand livre, balance, compte de résultat, plan comptable modifiable, exports Excel |
| Rapports | CA par mois, client et article avec marges, TVA collectée et déductible |
| CRM | Pipeline d'opportunités par glisser-déposer, prévision pondérée, activités et agenda commercial, conversion d'un prospect en client et en devis |
| Projets | Chantiers par client, tâches et jalons (tableau par glisser-déposer, retards), temps passés, dépenses par poste avec justificatif et écriture automatique, refacturation avec marge, budget global et par poste, coût horaire interne, marge réelle et alertes |
| Factures récurrentes | Contrats mensuels, trimestriels, semestriels ou annuels (maintenance, abonnements, loyers), factures créées automatiquement à échéance |
| RH et paie | Salariés, paie mensuelle (CNSS détaillée : prestations familiales, risques professionnels, pension ; IUTS progressif, TPA, cotisations supplémentaires paramétrables), primes, absences, avances, bulletins PDF, déclarations, congés, écritures de paie |
| Immobilisations | Registre, amortissement linéaire prorata temporis, dotations annuelles (681/28xx), cession et mise au rebut avec écritures |
| Budgets et trésorerie | Budget mensuel par compte avec prévu/réalisé, trésorerie prévisionnelle à 8, 13 ou 26 semaines (factures, paie, prévisions) avec alerte de découvert |
| Facture certifiée | SECeF (DGI) : certification à la validation, code, compteurs et QR code imprimés ; mode simulation et connecteur API |
| Hors ligne | Ordinateur (base locale synchronisée avec le serveur), web et mobile : consultation des dernières données, ventes, règlements, temps et congés saisis hors connexion puis envoyés au retour du réseau, sans doublon |
| Communications | Envoi des documents par e-mail (PDF joint) et par SMS (Orange, Twilio ou passerelle HTTP), relances des factures en retard (une ou toutes), modèles de messages à variables, journal des envois |
| Signatures | Cachet et signature de la société sur les documents, signature du client sur place (doigt, stylet, souris) ou à distance par lien sécurisé (e-mail/SMS), preuve : empreinte SHA-256, date, IP, appareil |
| Modèles de documents | Mise en page moderne ou classique, couleur au choix, conditions générales, pied de page |
| Administration | Société, pays (identifiant fiscal, devise, TVA et régimes adaptés : IFU, NCC, NINEA, NIF, NIU…), logo dès la création, utilisateurs et rôles, journal d'activité, sauvegarde |
| Taxes | TVA par ligne, taxes ajoutées au total (droit de timbre, taxe spécifique), retenues à la source déduites du net à payer et comptabilisées automatiquement ; modèles par pays |
| États et déclarations | Bilan SYSCOHADA (actif/passif, contrôle d'équilibre), compte de résultat (classes 6, 7 et 8), déclarations du mois : TVA, retenues à la source, salaires ; impression à l'en-tête de la société |
| Import | Clients, fournisseurs, articles, stock initial, salariés et plan comptable depuis Excel (.xlsx), CSV ou copier-coller, avec reconnaissance des colonnes et compte rendu ligne par ligne |
| Utilisateurs | Rôles, matrice des droits modifiable (rôles × modules), photo de profil |
| Sauvegardes | Sauvegarde automatique quotidienne de la base du poste, dans un dossier au choix (Google Drive, OneDrive, Dropbox) |
| Site web | Site de présentation à la racine du domaine (offres, téléchargements, contact), application sous /app/ |
| Licences | Paliers Essentiel, Pro, Entreprise ou sur mesure ; évaluation complète de 30 jours ; modules et nombre d'utilisateurs selon la licence ; application au nom de la société (Entreprise) |
| Écrans | Ordinateur, tablette et téléphone : listes en cartes sur téléphone, menu réduit sur tablette, contenu centré sur grand écran, cibles tactiles de 44 px |

### Adaptation au Burkina Faso

- Valeurs par défaut : Burkina Faso, Ouagadougou, **IFU**, FCFA, TVA 18 %.
- Le régime fiscal (RNI, RSI, CME) et le service des impôts de rattachement apparaissent dans les mentions légales des documents.
- Moyens de paiement : espèces, Orange Money, Moov Money, Wave, virement, chèque et carte. Le mobile money est comptabilisé au compte 552 (monnaie électronique), les espèces au 571, la banque au 521.

### Écritures comptables automatiques

| Pièce | Débit | Crédit | Journal |
|---|---|---|---|
| Facture client | 411 Clients (TTC) | 701 Marchandises / 706 Services (HT), 4431 TVA facturée | VT |
| Avoir | inverse de la facture | | VT |
| Facture fournisseur | 601 Marchandises / 605 Autres achats (HT), 4452 TVA récupérable | 401 Fournisseurs (TTC) | AC |
| Encaissement | 571 / 552 / 521 | 411 | CA / MM / BQ |
| Décaissement | 401 (ou 411 si remboursement d'avoir) | 571 / 552 / 521 | CA / MM / BQ |
| Sortie de caisse | compte de charge choisi (618, 6053…) | 571 | CA |
| Écart de caisse | 658 (manquant) ou 571 (excédent) | 571 ou 758 | CA |

Les pièces validées avant l'activation de la comptabilité peuvent être comptabilisées en un clic : **Comptabilité → Journaux & écritures → Générer les écritures**.

### Règles de gestion

- Un document est d'abord un **brouillon** (modifiable, sans numéro). À la **validation**, il reçoit un numéro définitif et continu par type et par année, le stock est mis à jour et l'écriture comptable est passée.
- Une facture validée ne s'annule pas : on établit un **avoir**.
- Une vente au **client comptoir** doit être réglée en totalité. Pour une vente à crédit, il faut choisir le client.
- Une caisse ne peut être clôturée avec un écart que si l'écart est expliqué. Les règlements d'une caisse clôturée ne peuvent plus être supprimés.

### Rôles

| Rôle | Accès |
|---|---|
| Administrateur | Tout |
| Commercial | Ventes, caisse, clients, articles, paiements |
| Magasinier | Achats, stock, fournisseurs, articles |
| Comptable | Ventes, achats, paiements, tiers, rapports, comptabilité |
| Caissier | Caisse uniquement (ses propres sessions) |
| Ressources humaines | Salariés, paie, congés |

Le commercial accède aussi au CRM et aux projets ; le comptable à la paie, aux projets, aux immobilisations et aux budgets.

Les communications (e-mails, SMS, relances) sont ouvertes à l'administrateur, au commercial et au comptable. Les modèles de messages, la messagerie et les SMS se configurent dans **Société & paramètres** (administrateur).

## Points à faire valider avant usage réel

- **Paie** : les taux CNSS, le plafond, le barème IUTS, les abattements et les réductions pour charges de famille sont des valeurs par défaut, modifiables dans *RH → Paramètres de paie*. **Faites-les vérifier par votre comptable ou auprès de la DGI et de la CNSS** : la réglementation évolue.
- **Facture certifiée (SECeF)** : le mode « simulation » permet de tester le circuit. Le mode « API » suit le modèle des API e-MCF ; son format doit être ajusté à la documentation officielle remise par la DGI avec vos identifiants. En mode API, une facture non certifiée ne peut pas être validée.
- **Hors ligne** : les ventes enregistrées sans réseau reçoivent leur numéro et leur date au moment de la synchronisation. Sur ordinateur relié au serveur en ligne, une **base locale** garde les données de travail : on peut démarrer, se connecter (après une première connexion en ligne sur le poste, valable 30 jours) et vendre sans Internet ; tout part automatiquement au retour du réseau (*Société & paramètres → Données → Base locale de ce poste*).

## E-mails, SMS et signatures

- **E-mail** : *Société & paramètres → Messagerie*. Gmail : `smtp.gmail.com`, port 587, avec un « mot de passe d'application ». Bouton « Envoyer un e-mail d'essai ».
- **SMS** : *Société & paramètres → SMS*. Orange (compte sur developer.orange.com, API « SMS Burkina Faso »), Twilio, ou toute passerelle qui accepte une URL du type `https://…/send?to={to}&text={message}&key={key}`.
- Les mots de passe et clés sont stockés à part et ne sont jamais renvoyés à l'interface.
- **Signature à distance** : nécessite le serveur en ligne (le client ouvre `https://votre-domaine/sign/…`). En mode « ce poste », renseignez l'adresse publique dans *Documents & signature*.
- Une signature reste liée au contenu signé (empreinte SHA-256) : si le document est modifié ensuite, l'application l'indique.

## Où sont les données ?

L'emplacement se choisit à l'écran de connexion, sous **Base de données … — modifier** :

| Mode | Pour qui | Synchronisation |
|---|---|---|
| **Ce poste uniquement** | Un seul ordinateur | Aucune |
| **Serveur en ligne (domaine)** | Plusieurs sites, ordinateurs, téléphones et tablettes | Oui, en temps réel par Internet |
| **Serveur du bureau** | Plusieurs postes dans les mêmes locaux | Oui, par le réseau local |

Les applications Android et iOS, ainsi que la version navigateur, se connectent toujours à un **serveur en ligne**.

> Sans connexion, chaque appareil relié au serveur en ligne (ordinateur, téléphone, navigateur) continue sur ses données locales ; ventes, règlements, temps passés, congés et fiches clients sont envoyés au retour du réseau, une seule fois. Les numéros définitifs sont attribués par le serveur à ce moment-là.

## Mettre en ligne le serveur sur votre domaine

Il vous faut un serveur Linux (VPS, 1 Go de mémoire suffit) avec Docker, et un nom de domaine, par exemple `facturation.iam.bf`.

1. Chez votre registraire, créez un enregistrement DNS **A** qui pointe `facturation.iam.bf` vers l'adresse IP du serveur.
2. Sur le serveur :
   ```bash
   git clone <votre dépôt> iam-invoicer && cd iam-invoicer
   cp deploy/.env.example deploy/.env      # renseignez DOMAIN et DB_PASSWORD
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
   ```
   Caddy obtient automatiquement le certificat HTTPS.
3. Ouvrez `https://facturation.iam.bf`. La première visite affiche la configuration initiale (société et compte administrateur).
4. Sur chaque appareil, renseignez l'adresse `facturation.iam.bf` :
   - sur ordinateur, à l'écran de connexion, sous **Serveur en ligne (domaine)** ;
   - sur téléphone, au premier lancement de l'application.
5. Mettez en place les sauvegardes quotidiennes avec cron : `0 2 * * * /chemin/iam-invoicer/deploy/backup.sh`. Les fichiers sont dans `deploy/backups/` ; copiez-les régulièrement hors du serveur.

Si vous migrez depuis le mode « Ce poste », saisissez à nouveau les fiches ou demandez une reprise de données. Le transfert automatique d'une base locale vers le serveur n'existe pas encore.

**Sans Docker**, il faut Node.js 20 ou plus récent :

```bash
npm ci && npm run build:all-server
DATABASE_URL=postgres://iam:motdepasse@localhost:5432/iam_invoicer PORT=8080 npm run server
```

Variables : `PORT`, `HOST`, `DATABASE_URL` (sinon base intégrée dans `DATA_DIR`), `CORS_ORIGIN`, `DB_POOL_SIZE`. Placez un proxy HTTPS (Caddy ou nginx) devant le port 8080.

**Sécurité :** mots de passe chiffrés avec scrypt, jetons de connexion valables 30 jours et révoqués à la déconnexion ou à la désactivation du compte, blocage après 10 mots de passe erronés, liens d'impression à usage unique. Le serveur doit être exposé **uniquement en HTTPS**.

## Fabriquer les applications

| Plateforme | Commande | Où |
|---|---|---|
| Windows (.exe) | `npm run dist:win` | Windows |
| macOS (.dmg, Intel et Apple Silicon) | `npm run dist:mac` | Mac |
| Android (.apk ou .aab) | `npm run android` (ouvre Android Studio) | Android Studio + JDK 21 |
| iOS (App Store / TestFlight) | `npm run ios` (ouvre Xcode) | Mac + Xcode |
| Serveur + application web | `npm run build:all-server` | partout |

**Sans Mac ni Android Studio**, utilisez GitHub. Le workflow `.github/workflows/build.yml` fabrique le .exe, le .dmg et l'APK Android, et vérifie que la version iOS compile. Il se lance à chaque tag `v*` ou depuis **Actions → build → Run workflow**. Les fichiers sont à télécharger dans l'onglet **Artifacts** de l'exécution.

### Signatures et publication dans les magasins

- **Windows :** l'installateur n'est pas signé, donc Windows SmartScreen affiche un avertissement à la première installation. Un certificat de signature de code le supprime.
- **macOS :** sans compte Apple Developer (99 $/an), l'application n'est pas signée. Au premier lancement, faites clic droit → **Ouvrir**. Pour signer, ajoutez les secrets `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` et `APPLE_TEAM_ID` dans GitHub, puis retirez `identity: null` de `electron-builder.yml`.
- **Android :** l'APK produit par GitHub est une version de test, installable directement si l'installation de sources inconnues est autorisée. Pour le Play Store (compte à 25 $), générez une clé (`keytool`) et produisez un `.aab` signé avec Android Studio (**Build → Generate Signed Bundle**).
- **iOS :** il faut un compte Apple Developer et Xcode sur un Mac. Ouvrez `ios/App/App.xcodeproj`, choisissez votre équipe dans **Signing & Capabilities**, puis **Product → Archive** pour envoyer sur TestFlight ou l'App Store. Sur iOS, le serveur doit être en HTTPS.

Identifiant des applications mobiles : `com.iamtechnology.invoicer`.

## Logo

| Fichier | Contenu |
|---|---|
| `resources/logo-mark.svg` | Pictogramme : une facture validée, avec l'étoile du Burkina Faso |
| `resources/logo.svg` | Logo horizontal « IAM INVOICER » |
| `resources/icon.png` | Icône 1024 px pour Windows et macOS |

Après une modification du logo, `npm run icons` régénère toutes les icônes : web, Windows, macOS, Android (icône adaptative) et iOS, ainsi que les écrans de démarrage.

## Développement

```bash
npm install
npm run dev              # application de bureau en développement
npm run dev:web          # version navigateur (http://localhost:5173), à connecter à un serveur
npm test                 # tests : métier, comptabilité, caisse, serveur HTTP
npm run e2e              # parcours complet dans l'application de bureau (Playwright)
node tests/web-e2e.mjs http://127.0.0.1:8080   # parcours web ordinateur et téléphone (Edge ou Chrome), serveur démarré
npm run typecheck
node tests/responsive-audit.mjs http://127.0.0.1:8080 sortie   # adaptation aux écrans (7 tailles, toutes les pages)
node tests/desktop-sync-probe.mjs                              # synchronisation bureau ↔ serveur, coupure comprise
```

Licences (éditeur) : voir [tools/licence/README.md](tools/licence/README.md). Guide d'installation complet : [docs/IAM-INVOICER-Guide-installation.pdf](docs/IAM-INVOICER-Guide-installation.pdf).

Si l'application démarre comme un simple Node depuis VS Code, retirez la variable `ELECTRON_RUN_AS_NODE` de l'environnement.

### Organisation du code

```
src/shared/        règles métier communes (documents, TVA, droits, comptes de trésorerie, montants en lettres)
src/main/          cœur métier + application de bureau (Electron)
  backend.ts       source des données : poste (PGlite), PostgreSQL du bureau, ou serveur en ligne (HTTPS)
  db.ts, schema.ts base de données et migrations — ajouter une migration, ne jamais modifier une migration livrée
  router.ts        point d'entrée unique des appels + contrôle des droits
  services/        documents, stock, paiements, caisse (cash.ts), comptabilité (accounting.ts), jetons (tokens.ts)
  pdf.ts           facture A4 et ticket de caisse 80 mm
src/server/        serveur web : API JSON, impression, application web (app.ts), démarrage (main.ts)
src/renderer/      interface React adaptative, commune à l'ordinateur, au web et au mobile
  src/bridge.ts    pont HTTP utilisé par le navigateur et par les applications iOS et Android
android/, ios/     projets natifs Capacitor
deploy/            Docker, PostgreSQL, Caddy (HTTPS), sauvegardes
tests/             tests vitest + parcours de bout en bout
```

Données locales de l'application de bureau : `%APPDATA%\IAM INVOICER\data` sous Windows, `~/Library/Application Support/IAM INVOICER/data` sous macOS. Un ancien dossier « IAM ERP » est repris automatiquement.
