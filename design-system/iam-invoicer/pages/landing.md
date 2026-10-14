# Landing Page Overrides

> **PROJECT:** IAM INVOICER
> **Generated:** 2026-10-11 06:33:54
> **Page Type:** Checkout / Payment

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Page-Specific Rules

### Layout Overrides

- **Max Width:** 1400px or full-width
- **Grid:** 12-column grid for data flexibility

### Spacing Overrides

- **Content Density:** High — optimize for information display

### Typography Overrides

- No overrides — use Master typography

### Color Overrides

- No overrides — use Master colors

### Component Overrides

- No overrides — use Master component specs

---

## Page-Specific Components

- No unique components for this page

---

## Recommendations

- Effects: Subtle hover (200-250ms), smooth transitions, sharp shadows if any, clear type hierarchy, fast loading

## Décisions appliquées à `site/index.html` (2026-10-11)

Le profil ui-ux-pro-max ci-dessus est adapté à la marque IAM :

- **Couleurs** : marine `#0b2f63` et bleu `#1d5fc4` de la marque à la place du marine générique ; le vert d'action est `#047857` (texte blanc à 5,5:1, le `#059669` proposé n'atteint pas 4,5:1 avec du blanc). Le vert ne sert qu'aux boutons d'action.
- **Typographie** : Plus Jakarta Sans sur la page d'accueil uniquement (l'application garde Public Sans).
- **Signature** : bande tissée Faso Dan Fani sous le héros, le bandeau de téléchargement et l'appel final.
- **Structure** (« Trust & Authority + Conversion ») : héros → preuves (chiffres, conformité) → avant / avec → fonctionnalités en grille modulaire → aperçu → mise en route → offres → téléchargements → vos données → éditeur → questions → appel final.
- **Preuves** : uniquement des faits vérifiables (modules, pays, conformité). Aucun témoignage ni logo client tant qu'il n'y en a pas de réels.
- **Mouvement** : apparition en cascade (0,45 s, décalage 60 ms), une seule fois ; coupée par `prefers-reduced-motion`.
- **Téléphone** : barre d'action fixe en bas (Se connecter / Essai gratuit), cibles tactiles de 44 px au moins.

### Mouvement de la page d'accueil

- **Héros** : entrée en cascade (étiquette, titre, texte, boutons, 90 ms d'écart), l'écran monte, le téléphone suit, les deux étiquettes se posent avec un rebond puis flottent doucement ; le trait du mot-clé se dessine.
- **Défilement** : barre de progression de lecture, en-tête qui prend une ombre, parallaxe de 8 % sur l'écran du héros (grand écran seulement), barre d'action mobile qui arrive quand les boutons du héros quittent l'écran. Une seule lecture de la position par image (`requestAnimationFrame`).
- **Sens** : « avant / avec » (le problème s'estompe, la coche de la solution apparaît), fil qui relie les quatre étapes, halo qui suit le pointeur sur les fonctionnalités, reflet sur le bouton d'action.
- **Repli** : sans JavaScript, tout le contenu est visible (les états masqués sont sous `.js`) ; avec `prefers-reduced-motion`, état final immédiat et pas de barre de progression.
- **Acte 2 (page « vivante »)** : halos qui dérivent dans le héros et l'appel final ; mot du titre qui change (gestion, facturation, caisse, comptabilité, paie) ; écran incliné en 3D qui suit le pointeur ; fil d'activité qui déroule les effets d'une vente ; bandeau défilant (en pause au survol et au focus) ; section « Tout est relié » où une facture validée allume le stock, la comptabilité, le compte du client et la TVA ; titres dévoilés mot à mot ; galerie en lecture automatique avec bouton pause (arrêt dès que le visiteur choisit un onglet) ; liseré lumineux sur l'offre mise en avant ; boutons d'action attirés par le pointeur.
- Accessibilité de l'acte 2 : le titre garde son texte complet en `aria-label`, la section « Tout est relié » a une description textuelle, les copies du bandeau sont masquées aux lecteurs d'écran.
- GSAP n'est pas chargé : les presets du profil (cascade, apparition au défilement, parallaxe) sont reproduits en CSS et en JavaScript natif pour garder la page légère.

- Contrôles faits : 375, 820, 1366 px, thèmes clair et sombre, aucun défilement horizontal, un seul `h1`, images avec `alt`.

## Refonte « Ciel » (v0.14) : la page reprend le dessin de l'application

Les sections plus haut décrivent les versions précédentes ; ce qui suit fait foi.

- **Mêmes thèmes que l'application** : jetons `--p`, `--grad`, `--sky-*`, `--sc-*` dans `:root` (Ciel) et sous `html[data-palette='amethyste' | 'lavande']`. Aucune couleur de marque en dur ailleurs : utiliser `var(--p)`, `rgba(var(--p-rgb), …)`, `rgba(var(--shadow-rgb), …)`, `var(--grad-cta)`, `var(--grad-deep)`, `var(--grad-soft)`, `var(--soft)`.
- **Section « Apparence »** (`#themes`) : trois cartes ; le choix recolore toute la page (fondu « View Transitions ») et s'enregistre sous `iam.palette`, la clé de l'application : sur le même domaine, l'application s'ouvre dans le thème choisi sur le site.
- **Accueil** : ciel clair, texte sombre, paysage de l'application (collines, baobabs, soleil, nuages qui dérivent, léger glissement au défilement). La maquette reproduit le tableau de bord réel : menu clair, carte d'accueil avec Awa qui salue, quatre indicateurs à carré pastel, courbe et anneau.
- **Typographie** : Plus Jakarta Sans, désormais aussi pour les titres de l'application.
- **Écrans** : la galerie vient de `docs/formation/captures` ; après tout changement visuel de l'application, relancer `node tools/docs/captures.mjs <serveur de démonstration>` puis `npm run build:site`.

## Refonte « Voyage » (2026-10-14) : fait foi à la place de la refonte « Ciel » pour le site

- Mise en page d'après un modèle de site de voyage fourni par l'éditeur : panneau d'accueil bleu nuit et or séparés par une déchirure (Awa, avion en papier, sceau « 30 jours » qui tourne, barre d'informations), trois étapes numérotées et bandeau or, sections à bords déchirés et à vague, offres à image sur le paysage, collage d'écrans et chiffre vertical, carte bleu nuit « Pourquoi IAM INVOICER », grand mot détouré « QUESTIONS », bloc contact image + formulaire, bande d'écrans, bandeau or, pied bleu nuit avec le tissage.
- **Couleurs d'IAM Technology, fixes** : bleu nuit `#0b3a66`, bleu IAM `#1d6fd6`, or `#f2b01e` (texte or sur blanc : `#a96f00`), vert d'action `#1a7f45` (texte blanc à 5:1). Le site ne suit plus le thème choisi : la section « Thèmes » enregistre seulement le choix pour l'application (`iam.palette`).
- **Typographie** : Plus Jakarta Sans, mots d'accent en Kaushan Script (classe `.script`).
- Pas de faux témoignages : l'emplacement « témoignages » du modèle accueille la FAQ.
- **Hors connexion** (2026-10-14) : ordinateur, base en ligne et téléphone dessinés ; à la coupure, les câbles se rompent avec une étincelle et les saisies s'empilent « en attente » avec un compteur ; au retour du réseau, chacune s'envole vers la base (barre d'avancement). Sur panneau étroit (requête de conteneur), les deux appareils passent au-dessus de la base.
- **Galerie « Le logiciel tel qu'il est »** : capture ordinateur et capture téléphone du même écran (`docs/formation/captures/mobile-<écran>.jpg`, produites par `tools/docs/captures.mjs`). Les adresses des images portent `?v=<version>` (`__VERSION__` remplacé par `tools/site/build.mjs`) : le serveur les met en cache un an, sans ce numéro les visiteurs garderaient les anciennes.
