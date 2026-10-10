// LE FORMAT DU FICHIER — lire une note en cartes, et la réécrire.
//
// Une carte commence par un marqueur seul sur sa ligne :
//
//     <!--section: 1.2-->
//     Le texte de la carte, sur autant de lignes qu'on veut.
//
// Le numéro dit la place dans l'arbre : `1.2` est la deuxième fille de `1`.
// C'est le format de Lineage, repris tel quel par Branch Writing : une note
// écrite par l'un s'ouvre dans l'autre.
//
// ⛔ La règle qui tient tout le reste : une note lue puis réécrite SANS
// modification ressort identique, octet pour octet. Chaque carte garde donc la
// ligne exacte de son marqueur et les blancs qui entourent son texte ; on ne
// fabrique un marqueur neuf que si le numéro a changé.

export interface Carte {
	id: number
	/** Ligne d'origine du marqueur, fin de ligne comprise. Null pour une carte neuve. */
	marqueur: string | null
	/** Numéro lu dans le fichier (ou calculé à l'écriture pour une carte neuve). */
	numero: string
	/** Lignes vides avant le texte. */
	avant: string
	texte: string
	/** Blancs après le texte, retours à la ligne compris. */
	apres: string
	enfants: Carte[]
}

export interface Document {
	/** Tout ce qui précède la première carte : l'en-tête YAML, et rien d'autre en principe. */
	entete: string
	racines: Carte[]
	/** Fin de ligne du fichier, pour que les lignes neuves ressemblent aux anciennes. */
	eol: string
}

const MARQUEUR = /^[ \t]*<!--\s*section:\s*(\d+(?:\.\d+)*)[\w\s]*-->[ \t]*\r?\n?$/
const ENTETE_YAML = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/

let prochainId = 1
export const nouvelId = () => prochainId++

export function carteNeuve(texte = ''): Carte {
	return { id: nouvelId(), marqueur: null, numero: '', avant: '', texte, apres: '', enfants: [] }
}

/** Découpe en lignes en gardant chaque fin de ligne : les recoller rend le texte exact. */
export function lignes(texte: string): string[] {
	return texte.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

/** Sépare un contenu en blancs d'avant, texte, blancs d'après. */
function decouper(contenu: string): Pick<Carte, 'avant' | 'texte' | 'apres'> {
	if (contenu.trim() === '') return { avant: '', texte: '', apres: contenu }
	const avant = contenu.match(/^(?:[ \t]*\r?\n)*/)![0]
	const reste = contenu.slice(avant.length)
	const apres = reste.match(/\s*$/)![0]
	return { avant, texte: reste.slice(0, reste.length - apres.length), apres }
}

export function estMarqueur(ligne: string): string | null {
	const m = MARQUEUR.exec(ligne)
	return m ? m[1] : null
}

export function aDesMarqueurs(texte: string): boolean {
	return lignes(texte).some((l) => estMarqueur(l) !== null)
}

export function analyser(texte: string): Document {
	const eol = texte.includes('\r\n') ? '\r\n' : '\n'
	const toutes = lignes(texte)
	const premier = toutes.findIndex((l) => estMarqueur(l) !== null)

	// Pas encore de marqueur : l'en-tête reste à part, le reste devient une seule
	// carte. Rien ne se perd, rien n'est réinterprété sans qu'on l'ait demandé.
	if (premier === -1) {
		const yaml = texte.match(ENTETE_YAML)?.[0] ?? ''
		const corps = texte.slice(yaml.length)
		const doc: Document = { entete: yaml, racines: [], eol }
		if (corps.trim() !== '') doc.racines.push({ ...carteNeuve(), ...decouper(corps) })
		return doc
	}

	const doc: Document = { entete: toutes.slice(0, premier).join(''), racines: [], eol }
	const parNumero = new Map<string, Carte>()
	let courante: Carte | null = null
	let contenu: string[] = []

	const clore = () => {
		if (!courante) return
		Object.assign(courante, decouper(contenu.join('')))
		contenu = []
	}

	for (const ligne of toutes.slice(premier)) {
		const numero = estMarqueur(ligne)
		if (numero === null) {
			contenu.push(ligne)
			continue
		}
		clore()
		const carte: Carte = { ...carteNeuve(), marqueur: ligne, numero }
		// Le parent est le numéro sans son dernier segment. S'il manque (un
		// fichier retouché à la main), on remonte jusqu'au premier ancêtre qui
		// existe : une carte n'est jamais perdue, au pire elle monte d'un étage.
		let parent: Carte | undefined
		const segments = numero.split('.')
		while (!parent && segments.length > 1) {
			segments.pop()
			parent = parNumero.get(segments.join('.'))
		}
		;(parent ? parent.enfants : doc.racines).push(carte)
		if (!parNumero.has(numero)) parNumero.set(numero, carte)
		courante = carte
	}
	clore()
	return doc
}

/** Renumérote l'arbre dans l'ordre où il se lit : 1, 1.1, 1.2, 2… */
export function numeroter(doc: Document): void {
	const parcourir = (cartes: Carte[], prefixe: string) =>
		cartes.forEach((c, i) => {
			c.numero = prefixe ? `${prefixe}.${i + 1}` : `${i + 1}`
			parcourir(c.enfants, c.numero)
		})
	parcourir(doc.racines, '')
}

export function aplatir(cartes: Carte[]): Carte[] {
	return cartes.flatMap((c) => [c, ...aplatir(c.enfants)])
}

export function serialiser(doc: Document): string {
	const eol = doc.eol
	const sorties: string[] = []
	const parcourir = (cartes: Carte[], prefixe: string) =>
		cartes.forEach((c, i) => {
			const numero = prefixe ? `${prefixe}.${i + 1}` : `${i + 1}`
			const ligne =
				c.marqueur !== null && estMarqueur(c.marqueur) === numero
					? c.marqueur
					: `<!--section: ${numero}-->${eol}`
			sorties.push(ligne, c.avant + c.texte + c.apres)
			parcourir(c.enfants, numero)
		})
	parcourir(doc.racines, '')

	let resultat = doc.entete
	for (let i = 0; i < sorties.length; i++) {
		// Un marqueur doit commencer une ligne : si le morceau d'avant ne finit
		// pas par un retour (dernière carte d'origine, ou en-tête sans retour),
		// on en ajoute un. C'est la seule retouche que l'écriture se permet.
		if (i % 2 === 0 && resultat !== '' && !resultat.endsWith('\n')) resultat += eol
		resultat += sorties[i]
	}
	return resultat
}

/**
 * La note a changé ailleurs (l'autre volet, la synchronisation) pendant qu'on
 * écrivait dans une carte. On garde le changement extérieur ET la frappe en
 * cours : la carte est retrouvée par son numéro dans la nouvelle version, et
 * reçoit le texte tapé — à condition que personne d'autre n'y ait touché.
 * Rend la carte recousue, ou null en cas de conflit (carte disparue, ou
 * modifiée des deux côtés) : c'est alors à l'appelant de sauver la frappe.
 */
export function reprendreEdition(nouveau: Document, numero: string, texteAvant: string, texteEnCours: string): Carte | null {
	numeroter(nouveau)
	const carte = aplatir(nouveau.racines).find((c) => c.numero === numero)
	if (!carte) return null
	if (carte.texte === texteEnCours) return carte
	if (carte.texte !== texteAvant) return null
	carte.texte = texteEnCours
	return carte
}

/** Le texte seul, sans en-tête ni marqueurs : ce qu'on publie ou qu'on colle ailleurs. */
export function textePropre(doc: Document): string {
	return aplatir(doc.racines)
		.map((c) => c.texte)
		.filter((t) => t.trim() !== '')
		.join('\n\n')
}

// ── CONVERTIR UNE NOTE ORDINAIRE ────────────────────────────────────────────
// Les titres donnent l'arbre, les paragraphes deviennent les filles du titre
// qui les précède — exactement la forme de la démonstration de Branch Writing
// (« ### Method » puis ses phrases). Un bloc de code n'est jamais coupé, même
// s'il contient des lignes vides.

export function convertir(corps: string): Carte[] {
	const blocs: string[] = []
	let courant: string[] = []
	let dansCode = false
	const pousser = () => {
		const t = courant.join('').replace(/\s+$/, '')
		if (t.trim() !== '') blocs.push(t)
		courant = []
	}
	for (const ligne of lignes(corps)) {
		if (/^\s*(```|~~~)/.test(ligne)) dansCode = !dansCode
		if (!dansCode && ligne.trim() === '') {
			pousser()
			continue
		}
		// Un titre forme toujours sa propre carte, même collé à son paragraphe.
		if (!dansCode && /^#{1,6}\s/.test(ligne)) {
			pousser()
			courant.push(ligne)
			pousser()
			continue
		}
		courant.push(ligne)
	}
	pousser()

	const racines: Carte[] = []
	const pile: { niveau: number; carte: Carte }[] = []
	for (const bloc of blocs) {
		const carte = carteNeuve(bloc)
		carte.apres = '\n\n'
		const titre = /^(#{1,6})\s/.exec(bloc)
		if (titre) {
			const niveau = titre[1].length
			while (pile.length && pile[pile.length - 1].niveau >= niveau) pile.pop()
			;(pile.length ? pile[pile.length - 1].carte.enfants : racines).push(carte)
			pile.push({ niveau, carte })
		} else {
			;(pile.length ? pile[pile.length - 1].carte.enfants : racines).push(carte)
		}
	}
	// La dernière carte finit le fichier : un seul retour, pas une ligne vide.
	const toutes = aplatir(racines)
	if (toutes.length) toutes[toutes.length - 1].apres = '\n'
	return racines
}

/** Retire les marqueurs : la note redevient une note ordinaire, texte intact. */
export function retirerMarqueurs(texte: string): string {
	return lignes(texte)
		.filter((l) => estMarqueur(l) === null)
		.join('')
}
