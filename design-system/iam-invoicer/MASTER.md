# IAM INVOICER — système de design (référence)

Source de vérité pour toute nouvelle page. Les jetons sont dans `src/renderer/src/styles.css` (`:root` et thème sombre).

## Direction

Le modèle est celui d'une interface d'administration : menu vertical semi-sombre, contenu clair, barre supérieure flottante et cartes ombrées sans bordure. Il est inspiré des grands thèmes d'administration (type Vuexy), sans en reprendre le code ni les images.

Profil ui-ux-pro-max : **Invoice & Billing Tool**, avec une grille modulaire (bento) sur 12 colonnes pour le tableau de bord.

Signature IAM : la bande tissée Faso Dan Fani (`.weave`), l'or de l'étoile pour le focus, et le personnage d'accueil animé (`components/Mascot.tsx`), une illustration originale.

## Couleurs

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
  - thème Automatique, Clair ou Sombre ;
  - notifications (factures en retard, stock bas) ;
  - avatar animé (anneau conique qui tourne, pastille « en ligne » qui pulse) et son menu de compte.
- **Menu latéral** : élément actif sous forme de pastille en dégradé bleu ombrée. Le menu se replie en icônes seules et la préférence est mémorisée.
- **Téléphone** : barre d'onglets en bas (4 écrans selon le rôle + Menu) et tiroir pour le reste.

## Indicateurs (KPI)

`.kpi-tile` : 4 dégradés — `kpi-blue` (ventes), `kpi-green` (encaissé), `kpi-amber` (créances), `kpi-violet` (volumes). Texte blanc : libellés en haut à gauche (partie sombre du dégradé, ≥ 4,5:1), chiffre en grand (≥ 3:1). Chiffre animé (`CountUp`), mini-courbe blanche facultative, reflet au survol.

## Mouvement

- **Animations décoratives :** limitées au personnage d'accueil (salut, clignement d'yeux, pièces qui flottent) et à l'avatar.
- **Animations d'interface :** ouverture des menus (0,18 s), des fenêtres et du tiroir (0,25 s).
- **Effets du tableau de bord :** entrée en cascade des cartes (une seule fois), graphiques qui se dessinent, anneau et barres qui se remplissent, fondu entre les pages et les onglets, squelette de chargement.
- **`prefers-reduced-motion`** coupe tout, **délais compris** : le contenu s'affiche immédiatement. Une animation avec délai et `fill-mode: both` laisse sinon le contenu invisible pendant le délai.

## À ne pas faire

- Ne pas créer de classe portant le nom d'un composant existant (exemple vécu : `.pos` servait déjà au point de vente).
- Pas de couleur en dur dans les composants, pas d'émojis en guise d'icônes.
- Pas de titres en MAJUSCULES espacées.
- Un tableau large défile dans sa carte, jamais la page entière.
