# IAM INVOICER — système de design (référence)

Source de vérité pour toute nouvelle page. Les jetons sont dans `src/renderer/src/styles.css` (`:root` et thème sombre).

## Profil produit

Base ui-ux-pro-max, profil **Invoice & Billing Tool** : style minimaliste et suisse, aplats, tableau de bord financier. Palette « bleu marine professionnel + vert payé + rouge en retard + gris neutre ».

Identité propre : le **Faso Dan Fani**. Indigo pour la structure, bleu IAM pour l'action, or de l'étoile comme seul accent. La bande tissée `.weave` est le seul ornement.

## Jetons

| Rôle | Clair | Sombre |
|---|---|---|
| Fond | `#eef1f5` | `#0d1526` |
| Surface | `#ffffff` | `#152038` |
| Texte | `#16202f` | `#e6ebf3` |
| Texte secondaire (`--muted`) | `#5b6677` (5,1:1) | `#9aa8bd` (6,7:1) |
| Action (`--blue`) | `#0b4f8a`, texte blanc | `#4d8fd6`, texte `#07111f` |
| Payé (`--green`) | `#0f6e42` | `#5fd39a` |
| Partiel / attention (`--amber`) | `#8a5208` | `#f0b85a` |
| Retard / danger (`--red`) | `#b8321f` | `#ff8a7a` |
| Bordure de champ | `#8792a3` (3,2:1) | `#6c7ea3` (≥ 3,9:1) |

Règles :

- Jamais de couleur en dur dans les composants : on utilise un jeton.
- Tout nouveau couple texte/fond est vérifié à 4,5:1, et les bordures de champ à 3:1.

## Typographie

- **Bricolage Grotesque** (variable, opsz) : titres, montants clés, total à payer.
- **Instrument Sans** (variable) : texte et tableaux, avec chiffres tabulaires (`tnum`).
- Échelle : 12 · 13 · 14 · 16 · 19 · 23 · 27 px. Sur écran tactile, les champs sont en 16 px, pour éviter le zoom automatique d'iOS.

## Formes et profondeur

- Arrondis selon la taille de l'objet : `--r-sm` 7 (champs), `--r-md` 10 (boutons, tuiles), `--r-lg` 16 (cartes, fenêtres).
- Ombres : `--lift` (posé) et `--float` (fenêtres, notifications).
- Calques : `--z-sticky` 10, `--z-bar` 20, `--z-drawer` 40, `--z-modal` 50, `--z-toast` 100.

## Navigation

- **Écran large (> 900 px) :** menu latéral avec icône Phosphor (contour, 19 px) et libellé. L'élément actif est marqué par une barre or et une icône or.
- **Téléphone :** barre d'onglets en bas, avec 4 écrans principaux selon le rôle et « Menu ». Le menu ouvre le tiroir de navigation secondaire.
- En paysage, les libellés des onglets sont masqués visuellement mais restent lus par les lecteurs d'écran.
- À chaque changement de page, le focus va au `h1`. Un lien « Aller au contenu » est disponible au clavier.

## Interaction et accessibilité

- Cibles tactiles d'au moins 44 px (`pointer: coarse`), avec `touch-action: manipulation`.
- Focus visible : anneau or `--focus`, jamais supprimé.
- Pastilles d'état : couleur, point et libellé, jamais la couleur seule.
- Toasts dans une région `aria-live="polite"`. Ils ne prennent jamais le focus.
- Le mouvement est limité à l'ouverture des fenêtres et du tiroir, et à l'animation de chargement. `prefers-reduced-motion` est respecté.
- Un tableau large défile dans sa carte, jamais la page entière (sinon le mobile dézoome).
- Hors ligne (mode serveur) : un bandeau d'état s'affiche en haut du contenu.

## À ne pas faire

- Pas de titres en MAJUSCULES espacées, d'émojis en guise d'icônes, ni d'ombre identique sur tout.
- Pas de mode sombre par simple inversion des couleurs : chaque jeton a sa valeur sombre.
- Pas de deuxième accent vif : l'or est réservé à l'état actif, à l'avertissement et à la bande tissée.
