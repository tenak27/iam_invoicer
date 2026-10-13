# IAM INVOICER — système de design (référence)

Source de vérité pour toute nouvelle page. Les jetons sont dans `src/renderer/src/styles.css` (`:root` et thème sombre).

## Direction

Le modèle est celui d'une interface d'administration : menu vertical semi-sombre, contenu clair, barre supérieure flottante et cartes ombrées sans bordure. Il est inspiré des grands thèmes d'administration (type Vuexy), sans en reprendre le code ni les images.

Profil ui-ux-pro-max : **Invoice & Billing Tool**, avec une grille modulaire (bento) sur 12 colonnes pour le tableau de bord.

Signature IAM : la bande tissée Faso Dan Fani (`.weave`), l'or de l'étoile pour le focus, et le personnage d'accueil animé (`components/Mascot.tsx`), une illustration originale.

## Thèmes au choix (v0.14)

L'utilisateur choisit son thème dans la barre du haut (bouton « Apparence », `ThemeMenu` dans `components/Topbar.tsx`) et sur les écrans de connexion. Le choix est propre à l'appareil (`theme.ts`, clés `iam.palette` et `iam.theme`). La racine porte toujours `data-palette` et `data-theme` (clair ou sombre, « automatique » résolu) : toute règle de thème s'écrit avec ces deux attributs.

| Thème | Idée | Action | Fond | Menu |
|---|---|---|---|---|
| **Ciel** (par défaut) | Ciel lumineux, cartes blanches très arrondies | `#1b6ef3` | `#e8f1fd` | Blanc, entrée active en pastille bleu pâle |
| **Améthyste** | Menu violet pleine hauteur, feuillage au pied | `#5b4a9e` | `#f1f0f8` | Violet ; l'entrée active prend la couleur de la page et la rejoint (coins concaves) |
| **Lavande** | Pervenche très sobre (socle de la feuille de styles) | `#5a63c2` | `#eef0fa` | Blanc |

Chaque thème a son mode sombre. Les trois partagent : les titres en Plus Jakarta Sans (`--display`, fichiers latins embarqués par `fonts.css`), les indicateurs compacts (icône dans un carré pastel à gauche, couleur `--k1` à `--k4`), la carte d'accueil illustrée (`components/Scenery.tsx` : ciel, soleil, nuages qui dérivent, collines et baobabs aux couleurs `--sky-*` et `--sc-*`, Awa posée sur la colline) et les écrans de connexion sur le même ciel.

Ajouter un thème : une entrée dans `PALETTES` (`theme.ts`), un bloc de jetons clair et un bloc sombre **complets** dans l'acte 12 de `styles.css` (le bloc sombre doit redéfinir tous les jetons du bloc clair), puis les mêmes jetons dans `site/index.html`.

## Première ouverture (ordinateur)

Sur Windows et macOS, tant qu'aucune société n'existe sur le poste, l'application demande : **Créer une société** (base sur cet ordinateur) ou **Charger une base depuis le cloud** (adresse de la base en ligne, société retrouvée, redémarrage). Le serveur du bureau reste accessible par le lien du bas (`FirstRunScreen` dans `pages/Auth.tsx`).

## Couleurs

Le tableau ci-dessous décrit le socle d'origine ; les valeurs en vigueur sont celles du thème choisi (voir plus haut).


| Jeton | Clair | Sombre | Usage |
|---|---|---|---|
| `--c-primary` | `#1d6fd6` | `#6ea8f0` | Actions, élément actif, graphiques |
| `--c-success` | `#17874f` | `#4fd18b` | Encaissé, payé |
| `--c-info` | `#0784a3` | `#3cc6e0` | Clients, Moov Money |
| `--c-warning` | `#c76a05` | `#ffb05c` | Orange Money, dettes, stock bas |
| `--c-danger` | `#d93f40` | `#ff7a7b` | Retards, articles |
| `--bg` / `--surface` | `#f6f7fb` / `#fff` | `#25293c` / `#2f3349` | Fond / cartes |
| `--side-bg` | `#2f3349` | `#2f3349` | Menu semi-sombre |
| `--text` / `--text-2` / `--muted` | `#2f2b3d` / `#5d596c` / `#6d6b77` | `#e1def5` / `#c7c5dc` / `#acabc1` | Titres / texte / secondaire |

Les contrastes du texte sont vérifiés à 4,5:1 au moins dans les deux thèmes. Les pastilles teintées (`.tint-*`, `.hue-*`) utilisent la couleur d'étiquette sur un fond à 16 % (`color-mix`). Elles sont décoratives et toujours accompagnées d'un libellé.

## Typographie

- **Public Sans** (variable), pour tout le texte : titres en 600, chiffres clés en 700, texte en 400.
- Chiffres tabulaires partout (`tnum`).
- Tailles : 12,5 · 13,5 · 14,5 (base) · 17,5 (titre de carte) · 20 · 24 (titre de page) · 28 (montant de la carte d'accueil).

## Composants

- **`.dcard`** : carte du tableau de bord, avec un en-tête `.dcard-head` (titre et sous-titre en gris, action à droite) et une ombre qui s'accentue au survol.
- **`.tint`** : pastille d'icône carrée (sm 38, md 42) ou ronde (lg 48), icônes Phosphor en version *duotone*.
- **`.rows`** : liste avec icône, libellé et sous-titre, montant à droite, barre de progression facultative.
- **Graphiques** (`components/charts.tsx`) : aire lissée (tendance mensuelle), mini-courbe (14 jours), anneau (répartition par moyen de paiement) et barre de progression. Chacun a un résumé `aria-label` et des info-bulles `<title>`.
- **Barre supérieure** (`components/Topbar.tsx`) :
  - recherche rapide `Ctrl+K` (pages et actions) ;
  - apparence : thème (Ciel, Améthyste, Lavande) et mode Automatique, Clair ou Sombre ;
  - notifications (factures en retard, stock bas) ;
  - avatar animé (anneau conique qui tourne, pastille « en ligne » qui pulse) et son menu de compte.
- **Menu latéral** : élément actif sous forme de pastille en dégradé bleu ombrée. Le menu se replie en icônes seules et la préférence est mémorisée.
- **Téléphone** : barre d'onglets en bas (4 écrans selon le rôle + Menu) et tiroir pour le reste.

## Indicateurs (KPI)

`.kpi-tile` : 4 dégradés — `kpi-blue` (ventes), `kpi-green` (encaissé), `kpi-amber` (créances), `kpi-violet` (volumes). Texte blanc : libellés en haut à gauche (partie sombre du dégradé, ≥ 4,5:1), chiffre en grand (≥ 3:1). Chiffre animé (`CountUp`), mini-courbe blanche facultative, reflet au survol.

## Mouvement

Règles issues de ui-ux-pro-max (catégorie Animation) : le mouvement exprime une cause et un effet, il n'est jamais seulement décoratif.

**Jetons** (`styles.css`), à utiliser partout, sans durée en dur :

| Jeton | Valeur | Usage |
|---|---|---|
| `--t-fast` | 0,15 s | Survol, appui, couleur |
| `--t-med` | 0,25 s | Entrée d'une fenêtre, d'un menu, glissement d'un indicateur |
| `--t-slow` | 0,4 s | Entrée d'une page, graphiques |
| `--t-exit` | 0,16 s | Toute sortie : environ 65 % de l'entrée |
| `--ease-out` | décélération | Ce qui arrive |
| `--ease-in` | accélération | Ce qui part |
| `--ease-spring` | rebond | Confirmation, valeur qui change |
| `--stagger` | 40 ms | Décalage entre éléments d'une cascade |

**Dans l'application**

- **Appui :** tout ce qui se clique réagit tout de suite (`scale(.98)` sur les boutons, `.94` sur les boutons-icônes).
- **Fenêtres** (`Modal`) : entrée par le bas ; sortie plus courte (fond qui s'efface, carte qui redescend) à la fermeture par Échap, la croix ou le fond.
- **Notifications** (`Toaster`) : icône dont le trait se dessine (la coche confirme l'enregistrement), sortie vers la droite.
- **Onglets** (`Tabs`) : l'indicateur glisse vers l'onglet choisi (continuité), à la teinte de la section.
- **Menu :** l'élément actif « se pose ».
- **Chargement** (`Loading`) : silhouettes du contenu à venir, en cascade.
- **Valeur qui change :** classe `.bump` avec une `key` égale à la valeur (total « À payer » de la caisse).
- **Tableau de bord :** entrée en cascade des cartes (une seule fois), graphiques qui se dessinent, anneau et barres qui se remplissent, compteurs.
- **Décoratif :** limité au personnage d'accueil (salut, clignement d'yeux, pièces qui flottent) et à l'avatar.

**Acte 3 (v0.6.2), à la demande de l'éditeur : application très animée.** Section « Mouvement, acte 3 » de `styles.css` et `components/fx.ts`.

- **Avatar** (`UserAvatar`) : dégradé propre à chaque personne (8 teintes sombres, initiales blanches ≥ 4,5:1), anneau tissé qui tourne avec halo, étincelle en orbite, reflet périodique, rebond au survol ; anneau figé et terni hors connexion.
- **Pointeur** (souris seulement) : halo qui suit le pointeur sur les cartes (`installSpotlight`), boutons principaux aimantés (`installMagnet`).
- **Défilement :** les blocs situés sous l'écran montent en fondu en y entrant (`installReveal`) ; barre d'avancement sous la barre supérieure.
- **Entrées :** barre supérieure, sections du menu, titre et actions du bandeau, lignes de tableau, entrées de menu, tuiles de caisse en cascade ; fenêtres, menus et notifications avec rebond ; page qui arrive avec un léger flou.
- **Continu, discret :** fond vivant derrière les pages, logo qui respire, cloche qui sonne s'il y a des notifications, icônes des indicateurs qui flottent.
- **Garde-fous inchangés :** `transform` et `opacity` uniquement, rien ne bloque la saisie, tout est coupé avec « réduire les animations » (règle CSS et gardes de `fx.ts`).

**Effets visibles** (`components/fx.ts`)

- **Menu :** une pastille unique glisse vers l'entrée active (`useNavIndicator`), l'icône rebondit.
- **Onde d'appui** (`installRipple`) sur les boutons, onglets, entrées de menu et tuiles.
- **Thème :** le nouveau thème se dévoile en cercle depuis le bouton (`themeReveal`, API View Transitions ; simple bascule ailleurs).
- **Confettis** (`celebrate`) : réservés aux moments qui comptent : vente encaissée, facture validée, règlement reçu, licence activée.
- **Tuiles d'indicateurs :** inclinaison vers le pointeur (`installTilt`) et reflet qui traverse.
- **Entrée d'une page :** ses blocs montent l'un après l'autre (60 ms d'écart, 5 au plus).
- **Écran de connexion :** fond vivant (halos qui dérivent lentement).

**Garde-fous**

- Uniquement `transform` et `opacity` (exception assumée : la largeur de l'indicateur d'onglets, élément isolé sans enfant).
- Une ou deux animations clés par écran ; pas de parallaxe sur du texte.
- Interruptible : l'état final est fixé par le code (minuteur de `--t-exit`), jamais par un événement `animationend`.
- **`prefers-reduced-motion`** coupe tout, **délais compris** : le contenu s'affiche immédiatement. Une animation avec délai et `fill-mode: both` laisse sinon le contenu invisible pendant le délai.

## À ne pas faire

- Ne pas créer de classe portant le nom d'un composant existant (exemple vécu : `.pos` servait déjà au point de vente).
- Pas de couleur en dur dans les composants, pas d'émojis en guise d'icônes.
- Pas de titres en MAJUSCULES espacées.
- Un tableau large défile dans sa carte, jamais la page entière.
