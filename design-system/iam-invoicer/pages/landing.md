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
- GSAP n'est pas chargé : les presets du profil (cascade, apparition au défilement, parallaxe) sont reproduits en CSS et en JavaScript natif pour garder la page légère.

- Contrôles faits : 375, 820, 1366 px, thèmes clair et sombre, aucun défilement horizontal, un seul `h1`, images avec `alt`.
