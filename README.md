# obsidian-ecrire-en-branches

Écrire en petites cartes rangées en colonnes, à l'intérieur d'une note Markdown
ordinaire. Reproduction personnelle de **Branch Writing** (Santi Younger), avec
le même format de fichier que **Lineage** — une note écrite par l'un s'ouvre
dans l'autre.

## À quoi ça sert

On ne pense pas en paragraphes : une idée en appelle une autre, qui se
ramifie. Écrire en cartes permet de **voir** cette structure pendant qu'on
écrit, et de déplacer une idée — avec tout ce qui en dépend — sans couper ni
coller. Quand c'est fini, la note est déjà un document normal : titres et
paragraphes dans l'ordre, prêts à copier ou publier.

## Usage

- **Nouvelle note** : icône de branche dans le ruban, ou commande « Nouvelle
  note en branches ». Elle s'ouvre prête à écrire dans sa première carte.
- **Convertir une note existante** : commande « Convertir la note en
  branches ». Les titres donnent l'arbre, les paragraphes deviennent les
  filles du titre qui les précède. Le texte ne bouge pas, seuls des marqueurs
  s'ajoutent.
- Une note qui porte `branch-writing: true` dans son en-tête **s'ouvre
  directement en cartes**.
- Deux boutons en haut de la vue : **voir le fichier**, et **ouvrir le
  fichier à droite** — les deux vues se suivent en direct.

| Geste | Effet |
|---|---|
| Flèches | Passer d'une carte à l'autre (haut/bas traversent toute la colonne) |
| Entrée · double-clic | Écrire dans la carte |
| Échap · Ctrl + Entrée | Sortir de la carte |
| Ctrl + ↓ / ↑ | Nouvelle carte dessous / dessus |
| Ctrl + → | Nouvelle carte fille |
| Ctrl + Alt + flèche | Déplacer la carte **avec sa branche** |
| Suppr · Ctrl + Retour arrière | Supprimer la carte (confirmation si elle a des filles) |
| Ctrl + Maj + J | Fusionner avec la carte du dessous |
| Ctrl + Z / Ctrl + Maj + Z | Annuler / rétablir |
| Glisser une carte | Moitié haute de la cible = avant, moitié basse = après, bord droit = dedans |
| Coller ou déposer une image | Rangée comme Obsidian le ferait, liée sur sa propre ligne |

Autres commandes : « Copier le texte sans marqueurs », « Revenir à une note
ordinaire ». Réglages : largeur des colonnes, numéros de carte, masquage des
marqueurs, ouverture automatique.

```bash
npm test      # le format et les gestes, sur le code réellement livré
npm run build # main.js
```

## Comment ça marche

Chaque carte commence par un marqueur seul sur sa ligne, `<!--section: 1.2-->` :
le numéro dit la place dans l'arbre. C'est un commentaire HTML, donc invisible
en mode lecture et à l'export.

- `src/format.ts` — lire une note en cartes et la réécrire. **Une note relue
  puis réécrite sans retouche ressort identique, octet pour octet** : chaque
  carte garde la ligne exacte de son marqueur et les blancs autour de son
  texte. Une carte dont le parent manque monte d'un étage, elle n'est jamais
  perdue.
- `src/arbre.ts` — les gestes (créer, déplacer, déposer, fusionner, naviguer),
  sans rien connaître d'Obsidian.
- `src/vue.ts` — l'écran en colonnes, une vue de fichier texte d'Obsidian.
- `src/masque.ts` — **l'amélioration sur Branch Writing** : en mode source et
  en aperçu en direct, chaque marqueur devient une pastille discrète `§ 1.2`.
  Dans sa démonstration, ils restent visibles entre chaque paragraphe.

Trois choses valent d'être sues avant de toucher au code :

- **Ne jamais ignorer un changement venu d'ailleurs.** Si la note change sur le
  disque (l'autre volet, la synchronisation) pendant qu'on écrit dans une
  carte, on recoud : le changement extérieur est pris, la frappe en cours est
  remise dans sa carte. Conflit sur la même carte : la version extérieure
  gagne, la frappe part dans le presse-papiers avec un message. L'ignorer
  faisait réécrire l'ancienne version **par-dessus**, sans un mot. ⚠️ Obsidian
  recharge lui-même la vue quand le fichier change (« merging changes
  automatically ») : ce chemin-là passe aussi par le recousage.
- **Redessiner l'écran remet tous les défilements à zéro.** On les note avant,
  on les remet après les cartes — sinon chaque clic ramenait l'écran à gauche
  et le second clic d'un double-clic tombait sur une autre carte.
- **La bascule automatique vers les cartes se fait après coup.** Obsidian
  annonce l'ouverture d'une note avant d'avoir fini d'y poser sa vue fichier,
  et l'écrase ensuite par-dessus une bascule immédiate.

## État

Version 0.1.0, ordinateur d'abord — la tablette (toucher, appui long) viendra
ensuite. Vérifié dans un **vrai Obsidian piloté**, instance isolée sur un écran
virtuel : navigation et création au clavier, déplacement de branche,
annulation, glisser-déposer, double vue synchronisée dans les deux sens,
conversion d'une note, image collée, nouvelle note, écriture pendant un
changement venu du disque (sans conflit et avec conflit).

⚠️ Un marqueur écrit à l'intérieur d'un bloc de code est lu comme un vrai
marqueur.

## Lien

Note du vault : à créer.
