// Ce qui casserait EN SILENCE :
//
//   1. une branche déposée dans sa propre descendance — elle sortirait de
//      l'arbre et disparaîtrait du fichier à l'enregistrement ;
//   2. un déplacement qui laisse les filles derrière la mère ;
//   3. la navigation qui s'arrête au bord d'un groupe au lieu de parcourir la
//      colonne entière.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyser, serialiser } from '../.epreuves/format.mjs'
import {
	ajouter, supprimer, deplacer, deposer, fusionnerDessous, colonnes, voisine, ancetres, trouver,
} from '../.epreuves/arbre.mjs'

const SOURCE = `<!--section: 1-->
A
<!--section: 1.1-->
A1
<!--section: 1.2-->
A2
<!--section: 1.2.1-->
A2a
<!--section: 2-->
B
<!--section: 2.1-->
B1
`

const parTexte = (doc, texte) => {
	const pile = [...doc.racines]
	while (pile.length) {
		const c = pile.shift()
		if (c.texte === texte) return c.id
		pile.push(...c.enfants)
	}
	throw new Error(texte)
}
const forme = (doc) => serialiser(doc).replace(/<!--section: ([\d.]+)-->\n/g, '$1 ').trim()

test('créer dessous, dessus, en fille', () => {
	const doc = analyser(SOURCE)
	const a1 = parTexte(doc, 'A1')
	const id = ajouter(doc, a1, 'dessous')
	trouver(doc, id).carte.texte = 'neuve'
	assert.match(forme(doc), /1\.1 A1\n1\.2 neuve/)
	ajouter(doc, a1, 'enfant')
	assert.equal(trouver(doc, a1).carte.enfants.length, 1)
	ajouter(doc, null, 'dessous')
	assert.equal(doc.racines.length, 3)
})

test('déplacer emporte toute la branche', () => {
	const doc = analyser(SOURCE)
	const a2 = parTexte(doc, 'A2')
	assert.ok(deplacer(doc, a2, 'haut'))
	assert.equal(forme(doc), '1 A\n1.1 A2\n1.1.1 A2a\n1.2 A1\n2 B\n2.1 B1')
	assert.ok(!deplacer(doc, parTexte(doc, 'A'), 'haut'), 'déjà tout en haut')
	assert.ok(deplacer(doc, parTexte(doc, 'A'), 'bas'))
	assert.equal(forme(doc), '1 B\n1.1 B1\n2 A\n2.1 A2\n2.1.1 A2a\n2.2 A1')
})

test('au bord du groupe, haut/bas passent dans le groupe voisin', () => {
	const doc = analyser(SOURCE)
	assert.ok(deplacer(doc, parTexte(doc, 'B1'), 'haut'))
	assert.equal(forme(doc), '1 A\n1.1 A1\n1.2 A2\n1.2.1 A2a\n1.3 B1\n2 B')
	assert.ok(deplacer(doc, parTexte(doc, 'B1'), 'bas'))
	assert.equal(forme(doc), serialiser(analyser(SOURCE)).replace(/<!--section: ([\d.]+)-->\n/g, '$1 ').trim())
})

test('gauche et droite changent d\'étage', () => {
	const doc = analyser(SOURCE)
	assert.ok(deplacer(doc, parTexte(doc, 'A2'), 'gauche'))
	assert.equal(forme(doc), '1 A\n1.1 A1\n2 A2\n2.1 A2a\n3 B\n3.1 B1')
	assert.ok(deplacer(doc, parTexte(doc, 'A2'), 'droite'))
	assert.equal(forme(doc), '1 A\n1.1 A1\n1.2 A2\n1.2.1 A2a\n2 B\n2.1 B1')
	assert.ok(!deplacer(doc, parTexte(doc, 'A'), 'droite'), 'pas de sœur au-dessus')
	assert.ok(!deplacer(doc, parTexte(doc, 'A'), 'gauche'), 'déjà à la racine')
})

test('on ne dépose jamais une branche dans elle-même', () => {
	const doc = analyser(SOURCE)
	const avant = serialiser(doc)
	assert.ok(!deposer(doc, parTexte(doc, 'A'), parTexte(doc, 'A2a'), 'enfant'))
	assert.equal(serialiser(doc), avant)
	assert.ok(deposer(doc, parTexte(doc, 'B1'), parTexte(doc, 'A1'), 'avant'))
	assert.equal(forme(doc), '1 A\n1.1 B1\n1.2 A1\n1.3 A2\n1.3.1 A2a\n2 B')
	assert.ok(deposer(doc, parTexte(doc, 'A1'), parTexte(doc, 'B'), 'enfant'))
	assert.match(forme(doc), /2 B\n2\.1 A1$/)
})

test('supprimer rend une voisine où poser la sélection', () => {
	const doc = analyser(SOURCE)
	const suivante = supprimer(doc, parTexte(doc, 'A1'))
	assert.equal(trouver(doc, suivante).carte.texte, 'A2')
	const parent = supprimer(doc, parTexte(doc, 'B1'))
	assert.equal(trouver(doc, parent).carte.texte, 'B')
})

test('fusionner réunit textes et filles', () => {
	const doc = analyser(SOURCE)
	assert.ok(fusionnerDessous(doc, parTexte(doc, 'A1')))
	const a1 = trouver(doc, parTexte(doc, 'A1\n\nA2')).carte
	assert.equal(a1.enfants[0].texte, 'A2a')
})

test('colonnes, navigation et lignée', () => {
	const doc = analyser(SOURCE)
	const cols = colonnes(doc)
	assert.equal(cols.length, 3)
	assert.deepEqual(cols[1].map((g) => g.cartes.map((c) => c.texte)), [['A1', 'A2'], ['B1']])
	// La flèche du bas traverse les groupes.
	assert.equal(trouver(doc, voisine(doc, parTexte(doc, 'A2'), 'bas')).carte.texte, 'B1')
	assert.equal(trouver(doc, voisine(doc, parTexte(doc, 'A2'), 'droite')).carte.texte, 'A2a')
	assert.equal(voisine(doc, parTexte(doc, 'B1'), 'bas'), null)
	assert.deepEqual(ancetres(doc, parTexte(doc, 'A2a')).map((c) => c.texte), ['A', 'A2'])
})
