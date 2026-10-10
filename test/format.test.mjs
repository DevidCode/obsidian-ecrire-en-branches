// Ce qui casserait EN SILENCE, et abîmerait une note :
//
//   1. une note relue puis réécrite sans retouche qui ne ressort pas identique —
//      chaque ouverture laisserait une trace dans git et dans la synchro ;
//   2. une carte dont le parent manque, rattachée à rien : elle disparaîtrait ;
//   3. un marqueur collé à la fin d'un texte sans retour à la ligne — il ne
//      serait plus reconnu, et toute la suite changerait de carte ;
//   4. un bloc de code coupé en deux à la conversion, sur une ligne vide ;
//   5. une note ordinaire ouverte en cartes qui perdrait son en-tête YAML.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	analyser, serialiser, convertir, textePropre, retirerMarqueurs, aDesMarqueurs, aplatir,
} from '../.epreuves/format.mjs'

const LINEAGE = `---
branch-writing: true
---

<!--section: 1-->
### Safe to Rearrange

<!--section: 1.1-->
### Outcome

<!--section: 1.1.1-->
This keeps me moving while writing.

<!--section: 1.2-->
### Method

<!--section: 1.2.1-->
I can drag and drop ideas to move them around.
<!--section: 1.2.2-->
Or I can use shortcuts.

<!--section: 2-->
Everything lives in one place.
`

test('une note relue puis réécrite ressort identique, octet pour octet', () => {
	for (const texte of [
		LINEAGE,
		LINEAGE.replace(/\n/g, '\r\n'),
		LINEAGE.trimEnd(), // pas de retour final
		'<!--section: 1-->\nseule',
		'<!--section: 1-->\n\n\n  texte indenté  \n\n\n<!--section: 2-->\n',
		'<!-- section: 1 -->\nespaces autour du numéro\n',
		'Préambule hors carte\n<!--section: 1-->\nA\n',
		'<!--section: 1-->\n<!--section: 1.1-->\n<!--section: 2-->\n',
	]) {
		assert.equal(serialiser(analyser(texte)), texte, JSON.stringify(texte))
	}
})

test('l\'arbre se lit dans les numéros', () => {
	const doc = analyser(LINEAGE)
	assert.equal(doc.entete, '---\nbranch-writing: true\n---\n\n')
	assert.equal(doc.racines.length, 2)
	const [un, deux] = doc.racines
	assert.equal(un.texte, '### Safe to Rearrange')
	assert.deepEqual(un.enfants.map((c) => c.texte), ['### Outcome', '### Method'])
	assert.equal(un.enfants[1].enfants.length, 2)
	assert.equal(deux.texte, 'Everything lives in one place.')
})

test('un parent manquant fait monter la carte, il ne la perd pas', () => {
	const doc = analyser('<!--section: 1-->\nA\n<!--section: 1.4.2-->\nperdue ?\n<!--section: 7-->\nB\n')
	assert.deepEqual(aplatir(doc.racines).map((c) => c.texte), ['A', 'perdue ?', 'B'])
	assert.equal(doc.racines[0].enfants[0].texte, 'perdue ?')
	// Réécrite, elle prend un numéro canonique.
	assert.match(serialiser(doc), /<!--section: 1\.1-->\nperdue \?/)
	assert.match(serialiser(doc), /<!--section: 2-->\nB/)
})

test('un texte modifié change sa carte, et seulement elle', () => {
	const doc = analyser(LINEAGE)
	doc.racines[1].texte = 'Tout vit au même endroit.'
	assert.equal(serialiser(doc), LINEAGE.replace('Everything lives in one place.', 'Tout vit au même endroit.'))
})

test('une carte qui perd sa place de dernière garde son marqueur sur sa ligne', () => {
	const doc = analyser('<!--section: 1-->\nA\n<!--section: 2-->\nB')
	doc.racines.reverse()
	assert.equal(serialiser(doc), '<!--section: 1-->\nB\n<!--section: 2-->\nA\n')
})

test('une note sans marqueur garde son en-tête et devient une seule carte', () => {
	const doc = analyser('---\ntags: [x]\n---\nPremier paragraphe.\n\nSecond.\n')
	assert.equal(doc.entete, '---\ntags: [x]\n---\n')
	assert.equal(doc.racines.length, 1)
	assert.equal(doc.racines[0].texte, 'Premier paragraphe.\n\nSecond.')
	assert.equal(serialiser(doc), '---\ntags: [x]\n---\n<!--section: 1-->\nPremier paragraphe.\n\nSecond.\n')
})

test('la conversion suit les titres, et ne coupe jamais un bloc de code', () => {
	const racines = convertir(
		'Intro libre.\n\n# Partie\nSon paragraphe collé.\n\n## Sous-partie\nA\n\n```js\nun()\n\ndeux()\n```\n\n# Autre\nB\n',
	)
	assert.deepEqual(racines.map((c) => c.texte), ['Intro libre.', '# Partie', '# Autre'])
	const partie = racines[1]
	assert.deepEqual(partie.enfants.map((c) => c.texte), ['Son paragraphe collé.', '## Sous-partie'])
	assert.deepEqual(partie.enfants[1].enfants.map((c) => c.texte), ['A', '```js\nun()\n\ndeux()\n```'])
	assert.deepEqual(racines[2].enfants.map((c) => c.texte), ['B'])
})

test('texte propre et retour à une note ordinaire', () => {
	const doc = analyser(LINEAGE)
	assert.ok(textePropre(doc).startsWith('### Safe to Rearrange\n\n### Outcome\n\nThis keeps'))
	assert.ok(!textePropre(doc).includes('section'))
	const ordinaire = retirerMarqueurs(LINEAGE)
	assert.ok(!aDesMarqueurs(ordinaire))
	assert.ok(ordinaire.includes('I can drag and drop ideas to move them around.\nOr I can use shortcuts.'))
	assert.ok(aDesMarqueurs(LINEAGE))
})

test('un marqueur au milieu d\'une phrase n\'est pas un marqueur', () => {
	const doc = analyser('<!--section: 1-->\nJ\'écris <!--section: 2--> dans le texte.\n')
	assert.equal(doc.racines.length, 1)
})

test('une note changée ailleurs pendant l\'écriture garde les deux modifications', async () => {
	const { reprendreEdition } = await import('../.epreuves/format.mjs')
	const source = '<!--section: 1-->\nA\n<!--section: 2-->\nB\n'
	// Ailleurs, quelqu'un a modifié B ; ici on écrivait dans A.
	const ailleurs = analyser(source.replace('B', 'B modifiée ailleurs'))
	const carte = reprendreEdition(ailleurs, '1', 'A', 'A tapée ici')
	assert.equal(carte.texte, 'A tapée ici')
	assert.equal(serialiser(ailleurs), '<!--section: 1-->\nA tapée ici\n<!--section: 2-->\nB modifiée ailleurs\n')
	// Conflit : la même carte modifiée des deux côtés → null, rien n'est écrasé.
	const conflit = analyser(source.replace('A', 'A modifiée ailleurs'))
	assert.equal(reprendreEdition(conflit, '1', 'A', 'A tapée ici'), null)
	assert.equal(conflit.racines[0].texte, 'A modifiée ailleurs')
	// La carte a disparu ailleurs → null aussi.
	assert.equal(reprendreEdition(analyser('<!--section: 1-->\nB\n'), '2', 'B', 'x'), null)
})
