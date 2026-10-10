// LES GESTES SUR L'ARBRE — créer, déplacer, supprimer, naviguer.
//
// Tout se joue sur le document en mémoire ; l'écran et le fichier ne font que
// le refléter. Aucune fonction ici ne connaît Obsidian : elles s'éprouvent
// toutes seules (test/arbre.test.mjs).

import { Carte, Document, carteNeuve } from './format'

export interface Place {
	carte: Carte
	parent: Carte | null
	/** Le tableau qui contient la carte : les filles du parent, ou les racines. */
	freres: Carte[]
	index: number
	profondeur: number
}

export function trouver(doc: Document, id: number): Place | null {
	const chercher = (freres: Carte[], parent: Carte | null, profondeur: number): Place | null => {
		for (let index = 0; index < freres.length; index++) {
			const carte = freres[index]
			if (carte.id === id) return { carte, parent, freres, index, profondeur }
			const trouve = chercher(carte.enfants, carte, profondeur + 1)
			if (trouve) return trouve
		}
		return null
	}
	return chercher(doc.racines, null, 0)
}

export function ancetres(doc: Document, id: number): Carte[] {
	const chemin: Carte[] = []
	let place = trouver(doc, id)
	while (place?.parent) {
		chemin.unshift(place.parent)
		place = trouver(doc, place.parent.id)
	}
	return chemin
}

export function descendants(carte: Carte): Carte[] {
	return carte.enfants.flatMap((e) => [e, ...descendants(e)])
}

function contient(carte: Carte, id: number): boolean {
	return carte.id === id || carte.enfants.some((e) => contient(e, id))
}

// ── CRÉER ───────────────────────────────────────────────────────────────────

export type OuCreer = 'dessous' | 'dessus' | 'enfant'

/** Crée une carte vide et rend son identifiant. Sans carte active : une racine. */
export function ajouter(doc: Document, id: number | null, ou: OuCreer): number {
	const neuve = carteNeuve()
	neuve.apres = doc.eol + doc.eol
	const place = id === null ? null : trouver(doc, id)
	if (!place) {
		doc.racines.push(neuve)
	} else if (ou === 'enfant') {
		place.carte.enfants.push(neuve)
	} else {
		place.freres.splice(ou === 'dessous' ? place.index + 1 : place.index, 0, neuve)
	}
	return neuve.id
}

// ── SUPPRIMER ───────────────────────────────────────────────────────────────

/** Supprime la carte ET sa branche. Rend la carte où poser la sélection ensuite. */
export function supprimer(doc: Document, id: number): number | null {
	const place = trouver(doc, id)
	if (!place) return null
	place.freres.splice(place.index, 1)
	const voisine = place.freres[place.index] ?? place.freres[place.index - 1]
	return voisine?.id ?? place.parent?.id ?? null
}

// ── DÉPLACER ────────────────────────────────────────────────────────────────

export type Sens = 'haut' | 'bas' | 'gauche' | 'droite'

/**
 * Déplace la carte avec toute sa branche.
 * - haut/bas : échange avec la sœur. Au bord du groupe, elle passe dans le
 *   groupe voisin (la fin du groupe d'au-dessus, le début de celui d'en
 *   dessous) — comme dans Gingko, on traverse la colonne d'un seul geste.
 * - gauche : devient la sœur qui suit son parent.
 * - droite : devient la dernière fille de la sœur d'au-dessus.
 * Rend faux quand le geste est impossible (déjà tout en haut, etc.).
 */
export function deplacer(doc: Document, id: number, sens: Sens): boolean {
	const place = trouver(doc, id)
	if (!place) return false
	const { carte, freres, index, parent } = place

	if (sens === 'haut' || sens === 'bas') {
		const pas = sens === 'haut' ? -1 : 1
		const cible = index + pas
		if (cible >= 0 && cible < freres.length) {
			freres.splice(index, 1)
			freres.splice(cible, 0, carte)
			return true
		}
		// Au bord : chercher le groupe voisin, c.-à-d. les filles de la tante.
		if (!parent) return false
		const placeParent = trouver(doc, parent.id)!
		const tante = placeParent.freres[placeParent.index + pas]
		if (!tante) return false
		freres.splice(index, 1)
		if (sens === 'haut') tante.enfants.push(carte)
		else tante.enfants.unshift(carte)
		return true
	}

	if (sens === 'gauche') {
		if (!parent) return false
		const placeParent = trouver(doc, parent.id)!
		freres.splice(index, 1)
		placeParent.freres.splice(placeParent.index + 1, 0, carte)
		return true
	}

	// droite
	const soeur = freres[index - 1]
	if (!soeur) return false
	freres.splice(index, 1)
	soeur.enfants.push(carte)
	return true
}

export type Depot = 'avant' | 'apres' | 'enfant'

/** Glisser-déposer : pose la carte avant, après ou dans la cible. */
export function deposer(doc: Document, id: number, cibleId: number, ou: Depot): boolean {
	const place = trouver(doc, id)
	if (!place || id === cibleId) return false
	// On ne dépose pas une branche dans elle-même : elle disparaîtrait de l'arbre.
	if (contient(place.carte, cibleId)) return false
	place.freres.splice(place.index, 1)
	const cible = trouver(doc, cibleId)!
	if (ou === 'enfant') cible.carte.enfants.push(place.carte)
	else cible.freres.splice(ou === 'apres' ? cible.index + 1 : cible.index, 0, place.carte)
	return true
}

/** Fusionne la carte avec celle du dessous : textes bout à bout, filles réunies. */
export function fusionnerDessous(doc: Document, id: number): boolean {
	const place = trouver(doc, id)
	if (!place) return false
	const suivante = place.freres[place.index + 1]
	if (!suivante) return false
	const a = place.carte.texte
	const b = suivante.texte
	place.carte.texte = a && b ? `${a}${doc.eol}${doc.eol}${b}` : a || b
	place.carte.enfants.push(...suivante.enfants)
	place.freres.splice(place.index + 1, 1)
	return true
}

// ── LES COLONNES À L'ÉCRAN ──────────────────────────────────────────────────

export interface Groupe {
	parent: Carte | null
	cartes: Carte[]
}

/**
 * Colonne 1 : les racines. Colonne n+1 : les filles de chaque carte de la
 * colonne n, un groupe par mère, dans l'ordre de lecture.
 */
export function colonnes(doc: Document): Groupe[][] {
	const resultat: Groupe[][] = []
	let courante: Groupe[] = doc.racines.length ? [{ parent: null, cartes: doc.racines }] : []
	while (courante.length) {
		resultat.push(courante)
		courante = courante
			.flatMap((g) => g.cartes)
			.filter((c) => c.enfants.length)
			.map((c) => ({ parent: c, cartes: c.enfants }))
	}
	return resultat
}

// ── NAVIGUER ────────────────────────────────────────────────────────────────

/** Haut/bas parcourent toute la colonne, d'un groupe à l'autre. */
export function voisine(doc: Document, id: number, sens: Sens): number | null {
	const place = trouver(doc, id)
	if (!place) return null
	if (sens === 'gauche') return place.parent?.id ?? null
	if (sens === 'droite') return place.carte.enfants[0]?.id ?? null
	const colonne = colonnes(doc)[place.profondeur].flatMap((g) => g.cartes)
	const i = colonne.findIndex((c) => c.id === id)
	return colonne[i + (sens === 'haut' ? -1 : 1)]?.id ?? null
}
