// MASQUER LES MARQUEURS DANS L'ÉDITEUR — l'amélioration sur Branch Writing.
//
// Dans sa démonstration, les `<!--section: 1.2-->` restent visibles entre
// chaque paragraphe tant qu'on n'est pas en mode lecture. Ici, en mode source
// comme en aperçu en direct, chaque marqueur est remplacé à l'AFFICHAGE par une
// petite pastille discrète. Le fichier, lui, n'est pas touché.
//
// La pastille est « atomique » : le curseur la saute d'un bloc, on ne peut pas
// l'abîmer en tapant dedans par mégarde. Pour la modifier à la main, il suffit
// de couper le masquage dans les réglages.

import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view'
import { estMarqueur } from './format'

class Pastille extends WidgetType {
	constructor(private numero: string) { super() }
	eq(autre: Pastille) { return autre.numero === this.numero }
	toDOM() {
		const el = document.createElement('span')
		el.className = 'eeb-pastille'
		el.textContent = `§ ${this.numero}`
		el.setAttribute('aria-label', `Carte ${this.numero}`)
		return el
	}
	ignoreEvent() { return false }
}

function decorer(vue: EditorView): DecorationSet {
	const constructeur = new RangeSetBuilder<Decoration>()
	for (const { from, to } of vue.visibleRanges) {
		let pos = from
		while (pos <= to) {
			const ligne = vue.state.doc.lineAt(pos)
			const numero = estMarqueur(ligne.text)
			if (numero !== null && ligne.length > 0) {
				constructeur.add(ligne.from, ligne.to, Decoration.replace({ widget: new Pastille(numero) }))
			}
			pos = ligne.to + 1
		}
	}
	return constructeur.finish()
}

export const masquerMarqueurs = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet
		constructor(vue: EditorView) { this.decorations = decorer(vue) }
		update(u: ViewUpdate) {
			if (u.docChanged || u.viewportChanged) this.decorations = decorer(u.view)
		}
	},
	{
		decorations: (v) => v.decorations,
		provide: (p) => EditorView.atomicRanges.of((vue) => vue.plugin(p)?.decorations ?? Decoration.none),
	},
)
