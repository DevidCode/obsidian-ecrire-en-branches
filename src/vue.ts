// L'ÉCRAN EN COLONNES.
//
// Une vue de fichier texte d'Obsidian (TextFileView) : Obsidian lit le fichier
// et nous le donne (setViewData), puis nous le redemande pour l'enregistrer
// (getViewData). Entre les deux, tout passe par le document en mémoire —
// l'écran est entièrement redessiné à partir de lui après chaque geste.

import { MarkdownRenderer, Notice, Scope, TextFileView, TFile, WorkspaceLeaf, moment } from 'obsidian'
import { Carte, Document, analyser, aplatir, numeroter, reprendreEdition, serialiser } from './format'
import {
	Depot, OuCreer, Sens, ajouter, ancetres, colonnes, deplacer, deposer, descendants, fusionnerDessous,
	supprimer, trouver, voisine,
} from './arbre'
import type EcrireEnBranches from '../main'

export const TYPE_VUE = 'ecrire-en-branches'
const TYPE_GLISSE = 'application/x-ecrire-en-branches'

export class VueBranches extends TextFileView {
	private doc: Document = analyser('')
	private actif: number | null = null
	private edition: number | null = null
	private annuler: string[] = []
	private refaire: string[] = []
	/** Rendu Markdown déjà fait, par carte : on ne refait que ce qui a changé. */
	private rendus = new Map<number, { texte: string; el: HTMLElement }>()
	private ecran!: HTMLElement
	private fil!: HTMLElement

	constructor(leaf: WorkspaceLeaf, private plugin: EcrireEnBranches) {
		super(leaf)
		this.scope = new Scope(this.app.scope)
		this.raccourcis()
	}

	getViewType() { return TYPE_VUE }
	getIcon() { return 'git-branch' }
	getDisplayText() { return this.file?.basename ?? 'Écrire en branches' }

	async onOpen() {
		this.contentEl.empty()
		this.contentEl.addClass('eeb-vue')
		this.fil = this.contentEl.createDiv({ cls: 'eeb-fil' })
		this.ecran = this.contentEl.createDiv({ cls: 'eeb-ecran' })
		this.ecran.tabIndex = 0
		this.addAction('file-text', 'Voir le fichier', () => this.plugin.basculer(this.leaf))
		this.addAction('panel-right', 'Ouvrir le fichier à droite', () => this.plugin.ouvrirADroite(this))
		// Cliquer dans le vide garde le clavier sur l'écran, sans rien sélectionner.
		this.ecran.addEventListener('mousedown', (e) => {
			if (e.target === this.ecran || (e.target as HTMLElement).hasClass('eeb-colonne')) this.ecran.focus()
		})
	}

	// ── LE LIEN AVEC LE FICHIER ─────────────────────────────────────────────

	getViewData(): string {
		return serialiser(this.doc)
	}

	setViewData(data: string, clear: boolean): void {
		// Obsidian rappelle cette fonction de lui-même quand le fichier change
		// sur le disque (« modified externally, merging changes automatically »).
		// En pleine écriture, on recoud au lieu de tout remettre à zéro.
		if (!clear && this.edition !== null) {
			this.recoudre(data)
			return
		}
		// On retient la place de la carte active par son numéro : les
		// identifiants sont refaits à chaque lecture.
		const numero = this.actif !== null ? this.numeroDe(this.actif) : null
		this.doc = analyser(data)
		numeroter(this.doc)
		this.rendus.clear()
		if (clear) {
			this.annuler = []
			this.refaire = []
		}
		const cartes = aplatir(this.doc.racines)
		this.actif = (numero && cartes.find((c) => c.numero === numero)?.id) || cartes[0]?.id || null
		this.edition = null
		// Une note neuve (une seule carte, vide) s'ouvre prête à écrire.
		if (clear && cartes.length === 1 && cartes[0].texte === '') {
			this.edition = cartes[0].id
			this.texteAvantEdition = ''
		}
		this.dessiner()
	}

	clear(): void {
		this.doc = analyser('')
		this.actif = null
		this.edition = null
		this.rendus.clear()
	}

	/**
	 * Relit le fichier quand il a changé ailleurs : la vue fichier ouverte à
	 * droite, ou la synchronisation qui ramène une modification de la tablette.
	 *
	 * ⛔ Ne JAMAIS ignorer ce changement, même en pleine écriture : la sortie de
	 * la carte réenregistrerait alors l'ancienne version PAR-DESSUS, et le
	 * changement venu d'ailleurs serait effacé sans un mot (vu en pilotant).
	 */
	recharger(contenu: string) {
		if (contenu === this.getViewData()) return // notre propre enregistrement
		this.data = contenu
		this.setViewData(contenu, false)
	}

	private recoudre(contenu: string) {
		const place = this.edition !== null ? trouver(this.doc, this.edition) : null
		const numero = place?.carte.numero ?? ''
		const enCours = place?.carte.texte ?? ''
		const nouveau = analyser(contenu)
		const recousue = reprendreEdition(nouveau, numero, this.texteAvantEdition, enCours)
		this.doc = nouveau
		this.rendus.clear()
		if (recousue) {
			this.actif = recousue.id
			this.edition = recousue.id
		} else {
			// Conflit : la version d'ailleurs gagne, la frappe n'est pas perdue pour autant.
			this.edition = null
			this.actif = aplatir(nouveau.racines).find((c) => c.numero === numero)?.id ?? nouveau.racines[0]?.id ?? null
			void navigator.clipboard.writeText(enCours)
			new Notice('La note a changé ailleurs pendant que tu écrivais dans cette carte. Ton texte est copié dans le presse-papiers.', 10000)
		}
		this.data = this.getViewData()
		if (this.data !== contenu) this.requestSave()
		this.dessiner(recousue ? trouver(this.doc, recousue.id)?.profondeur ?? null : null)
	}

	private numeroDe(id: number): string | null {
		numeroter(this.doc)
		return trouver(this.doc, id)?.carte.numero ?? null
	}

	/** À appeler AVANT chaque geste qui change l'arbre : c'est ce qui rend « annuler » possible. */
	private memoriser() {
		this.annuler.push(this.getViewData())
		if (this.annuler.length > 200) this.annuler.shift()
		this.refaire = []
	}

	private modifie() {
		numeroter(this.doc)
		this.data = this.getViewData()
		this.requestSave()
	}

	private retablir(depuis: string[], vers: string[]) {
		const etat = depuis.pop()
		if (etat === undefined) return
		vers.push(this.getViewData())
		const numero = this.actif !== null ? this.numeroDe(this.actif) : null
		this.doc = analyser(etat)
		numeroter(this.doc)
		this.rendus.clear()
		this.actif = aplatir(this.doc.racines).find((c) => c.numero === numero)?.id ?? this.doc.racines[0]?.id ?? null
		this.modifie()
		this.dessiner()
	}

	// ── LES GESTES ──────────────────────────────────────────────────────────

	private creer(ou: OuCreer) {
		this.finirEdition()
		this.memoriser()
		this.actif = ajouter(this.doc, this.actif, ou)
		this.modifie()
		// Une carte neuve peut naître hors de l'écran : là, on recentre.
		this.editer(this.actif, false)
	}

	private bouger(sens: Sens) {
		if (this.actif === null) return
		this.finirEdition()
		const avant = this.getViewData()
		if (!deplacer(this.doc, this.actif, sens)) return
		this.annuler.push(avant)
		this.refaire = []
		this.modifie()
		this.dessiner()
	}

	private naviguer(sens: Sens) {
		if (this.actif === null) {
			this.actif = this.doc.racines[0]?.id ?? null
		} else {
			const id = voisine(this.doc, this.actif, sens)
			if (id === null) return
			this.actif = id
		}
		this.dessiner()
	}

	private effacer() {
		if (this.actif === null) return
		const place = trouver(this.doc, this.actif)
		if (!place) return
		const n = descendants(place.carte).length
		if (n > 0 && !confirm(`Supprimer cette carte et ses ${n} carte(s) en dessous ?`)) return
		this.memoriser()
		this.actif = supprimer(this.doc, this.actif)
		this.modifie()
		this.dessiner()
	}

	private fusionner() {
		if (this.actif === null) return
		this.finirEdition()
		const avant = this.getViewData()
		if (!fusionnerDessous(this.doc, this.actif)) return
		this.annuler.push(avant)
		this.refaire = []
		this.rendus.delete(this.actif)
		this.modifie()
		this.dessiner()
	}

	private glisser(id: number, cible: number, ou: Depot) {
		const avant = this.getViewData()
		if (!deposer(this.doc, id, cible, ou)) return
		this.annuler.push(avant)
		this.refaire = []
		this.actif = id
		this.modifie()
		this.dessiner()
	}

	// ── LE CLAVIER ──────────────────────────────────────────────────────────
	// Ctrl (Cmd sur Mac) + flèche : créer.  Ctrl + Alt + flèche : déplacer.
	// Flèches seules : circuler.  Entrée : écrire.  Échap : sortir de la carte.

	private raccourcis() {
		const s = this.scope!
		const horsEdition = (geste: () => void) => () => {
			if (this.edition !== null) return true // la flèche appartient au texte
			geste()
			return false
		}
		const fleches: [string, Sens][] = [['ArrowUp', 'haut'], ['ArrowDown', 'bas'], ['ArrowLeft', 'gauche'], ['ArrowRight', 'droite']]
		for (const [touche, sens] of fleches) {
			s.register([], touche, horsEdition(() => this.naviguer(sens)))
			s.register(['Mod', 'Alt'], touche, () => (this.bouger(sens), false))
		}
		s.register(['Mod'], 'ArrowDown', () => (this.creer('dessous'), false))
		s.register(['Mod'], 'ArrowUp', () => (this.creer('dessus'), false))
		s.register(['Mod'], 'ArrowRight', () => (this.creer('enfant'), false))
		s.register([], 'Enter', horsEdition(() => this.actif !== null ? this.editer(this.actif) : this.creer('dessous')))
		s.register(['Mod'], 'Enter', () => {
			if (this.edition !== null) this.finirEdition()
			else if (this.actif !== null) this.editer(this.actif)
			return false
		})
		s.register([], 'Escape', () => {
			if (this.edition === null) return true
			this.finirEdition()
			return false
		})
		s.register([], 'Delete', horsEdition(() => this.effacer()))
		s.register(['Mod'], 'Backspace', horsEdition(() => this.effacer()))
		s.register(['Mod', 'Shift'], 'J', horsEdition(() => this.fusionner()))
		s.register(['Mod'], 'z', horsEdition(() => this.retablir(this.annuler, this.refaire)))
		s.register(['Mod', 'Shift'], 'z', horsEdition(() => this.retablir(this.refaire, this.annuler)))
		s.register(['Mod'], 'y', horsEdition(() => this.retablir(this.refaire, this.annuler)))
	}

	// ── ÉCRIRE DANS UNE CARTE ───────────────────────────────────────────────

	/** @param figer vrai quand on vient de cliquer la carte : sa colonne ne bouge pas. */
	private editer(id: number, figer = true) {
		this.actif = id
		this.edition = id
		this.texteAvantEdition = trouver(this.doc, id)?.carte.texte ?? ''
		this.dessiner(figer ? trouver(this.doc, id)?.profondeur ?? null : null)
	}

	private texteAvantEdition = ''
	private dernierClic: { id: number | null; quand: number } = { id: null, quand: 0 }

	private finirEdition() {
		if (this.edition === null) return
		const place = trouver(this.doc, this.edition)
		// Une seule entrée d'annulation pour toute la frappe dans la carte.
		if (place && place.carte.texte !== this.texteAvantEdition) {
			const carte = place.carte
			const fini = carte.texte
			carte.texte = this.texteAvantEdition
			this.annuler.push(this.getViewData())
			this.refaire = []
			carte.texte = fini
		}
		this.edition = null
		this.modifie()
		this.dessiner()
		this.ecran.focus()
	}

	private zoneDeTexte(carte: Carte, el: HTMLElement) {
		const zone = el.createEl('textarea', { cls: 'eeb-saisie' })
		zone.value = carte.texte
		const ajuster = () => {
			zone.style.height = 'auto'
			zone.style.height = `${zone.scrollHeight}px`
		}
		zone.addEventListener('input', () => {
			carte.texte = zone.value
			ajuster()
			this.data = this.getViewData()
			this.requestSave()
		})
		zone.addEventListener('blur', () => {
			// Un clic ailleurs dans Obsidian termine l'écriture, comme Échap.
			window.setTimeout(() => {
				if (this.edition === carte.id && document.activeElement !== zone) this.finirEdition()
			}, 0)
		})
		zone.addEventListener('paste', (e) => this.collerImages(e, e.clipboardData?.files, zone, carte))
		zone.addEventListener('drop', (e) => this.collerImages(e, e.dataTransfer?.files, zone, carte))
		window.requestAnimationFrame(() => {
			ajuster()
			zone.focus()
			zone.setSelectionRange(zone.value.length, zone.value.length)
		})
	}

	/** Une image collée ou déposée est rangée comme Obsidian le ferait, puis liée dans la carte. */
	private async collerImages(e: Event, fichiers: FileList | undefined | null, zone: HTMLTextAreaElement, carte: Carte) {
		const images = Array.from(fichiers ?? []).filter((f) => f.type.startsWith('image/'))
		if (!images.length || !this.file) return
		e.preventDefault()
		for (const image of images) {
			const ext = image.name.split('.').pop() || image.type.split('/')[1] || 'png'
			const nom = image.name && image.name !== 'image.png'
				? image.name
				: `Pasted image ${moment().format('YYYYMMDDHHmmss')}.${ext}`
			const chemin = await this.app.fileManager.getAvailablePathForAttachment(nom, this.file.path)
			const fichier = await this.app.vault.createBinary(chemin, await image.arrayBuffer())
			const lien = this.app.fileManager.generateMarkdownLink(fichier, this.file.path)
			const debut = zone.selectionStart
			// L'image va sur sa propre ligne, jamais collée au bout d'une phrase.
			const avant = zone.value.slice(0, debut)
			const retour = avant === '' || avant.endsWith('\n') ? '' : '\n'
			zone.setRangeText(`${retour}!${lien.replace(/^!/, '')}`, debut, zone.selectionEnd, 'end')
			zone.dispatchEvent(new Event('input'))
		}
		new Notice(images.length > 1 ? `${images.length} images ajoutées` : 'Image ajoutée')
	}

	// ── LE DESSIN ───────────────────────────────────────────────────────────

	/** Après un changement de réglage. */
	redessiner() {
		this.rendus.clear()
		this.dessiner()
	}

	/**
	 * @param figee colonne à NE PAS recentrer : celle qu'on vient de cliquer.
	 * La recentrer ferait glisser la carte sous la souris, et le second clic
	 * d'un double-clic tomberait sur une autre carte (vu en pilotant).
	 */
	private dessiner(figee: number | null = null) {
		if (!this.ecran) return
		const largeur = this.plugin.reglages.largeurColonne
		this.contentEl.style.setProperty('--eeb-largeur', `${largeur}px`)
		this.contentEl.toggleClass('eeb-numeros', this.plugin.reglages.afficherNumeros)
		numeroter(this.doc)

		const actif = this.actif !== null ? trouver(this.doc, this.actif) : null
		const lignee = new Set<number>()
		if (actif) {
			ancetres(this.doc, actif.carte.id).forEach((c) => lignee.add(c.id))
			descendants(actif.carte).forEach((c) => lignee.add(c.id))
		}
		const groupeActif = actif?.parent?.id ?? (actif ? 'racine' : null)

		this.dessinerFil(actif?.carte ?? null)

		// Vider l'écran remet tous les défilements à zéro : on les note avant,
		// on les remet après. Sans ça, chaque clic ramenait l'écran à gauche et
		// le second clic d'un double-clic tombait sur une autre carte.
		const defilements = this.ecran.findAll('.eeb-colonne').map((c) => c.scrollTop)
		const gaucheAvant = this.ecran.scrollLeft
		this.ecran.empty()
		const vides = this.doc.racines.length === 0
		if (vides) {
			const invite = this.ecran.createDiv({ cls: 'eeb-invite' })
			invite.setText('Note vide — Entrée pour écrire la première carte.')
			return
		}

		const reperes: (HTMLElement | null)[] = []
		colonnes(this.doc).forEach((groupes, i) => {
			const col = this.ecran.createDiv({ cls: 'eeb-colonne' })
			let repere: HTMLElement | null = null
			for (const groupe of groupes) {
				const g = col.createDiv({ cls: 'eeb-groupe' })
				const cle = groupe.parent?.id ?? 'racine'
				if (cle === groupeActif) g.addClass('eeb-groupe-actif')
				if (groupe.parent && (lignee.has(groupe.parent.id) || groupe.parent.id === this.actif)) {
					g.addClass('eeb-groupe-lignee')
					// Les filles de la carte active : la colonne se cale sur elles.
					if (groupe.parent.id === this.actif) repere = repere ?? g
				}
				for (const carte of groupe.cartes) {
					const el = this.dessinerCarte(carte, g, lignee)
					if (carte.id === this.actif || lignee.has(carte.id)) {
						if (!repere || carte.id === this.actif) repere = el
					}
				}
			}
			reperes.push(repere)
			// Après les cartes, pas avant : une colonne vide ne défile pas, et
			// la position retomberait à zéro — la carte cliquée sauterait.
			col.scrollTop = defilements[i] ?? 0
		})

		this.ecran.scrollLeft = gaucheAvant

		// Chaque colonne se cale sur la branche active ; l'écran se cale sur la colonne active.
		window.requestAnimationFrame(() => {
			const cols = this.ecran.findAll('.eeb-colonne')
			reperes.forEach((el, i) => {
				if (!el || i === figee) return
				const col = cols[i]
				const haut = el.offsetTop - col.clientHeight / 2 + Math.min(el.offsetHeight, col.clientHeight) / 2
				col.scrollTo({ top: haut, behavior: 'smooth' })
			})
			const colActive = actif ? cols[actif.profondeur] : null
			if (colActive && figee === null) {
				const gauche = colActive.offsetLeft - this.ecran.clientWidth / 2 + colActive.offsetWidth / 2
				this.ecran.scrollTo({ left: Math.max(0, gauche), behavior: 'smooth' })
			}
		})
	}

	private dessinerFil(carte: Carte | null) {
		this.fil.empty()
		if (!carte) return
		const chemin = [...ancetres(this.doc, carte.id), carte]
		chemin.forEach((c, i) => {
			if (i) this.fil.createSpan({ cls: 'eeb-fil-sep', text: '›' })
			const titre = c.texte.split('\n')[0].replace(/^#+\s*/, '').trim() || '…'
			const lien = this.fil.createSpan({ cls: 'eeb-fil-etape', text: titre.length > 40 ? titre.slice(0, 39) + '…' : titre })
			lien.addEventListener('click', () => {
				this.finirEdition()
				this.actif = c.id
				this.dessiner()
			})
		})
	}

	private dessinerCarte(carte: Carte, groupe: HTMLElement, lignee: Set<number>): HTMLElement {
		const el = groupe.createDiv({ cls: 'eeb-carte' })
		el.dataset.id = String(carte.id)
		if (carte.id === this.actif) el.addClass('eeb-active')
		else if (lignee.has(carte.id)) el.addClass('eeb-lignee')
		if (carte.enfants.length) el.addClass('eeb-a-des-filles')

		if (carte.id === this.edition) {
			el.addClass('eeb-en-edition')
			this.zoneDeTexte(carte, el)
		} else {
			el.appendChild(this.rendu(carte))
			el.draggable = true
		}
		el.createDiv({ cls: 'eeb-numero', text: carte.numero })

		el.addEventListener('click', (e) => {
			if (carte.id === this.edition) return
			// Un lien cliqué dans la carte s'ouvre ; il ne sélectionne pas.
			if ((e.target as HTMLElement).closest('a')) return
			// Le double-clic se reconnaît ici, par carte : l'écran est redessiné
			// entre les deux clics, l'événement natif ne retrouverait pas sa cible.
			const maintenant = Date.now()
			if (this.dernierClic.id === carte.id && maintenant - this.dernierClic.quand < 450) {
				this.dernierClic = { id: null, quand: 0 }
				this.editer(carte.id)
				return
			}
			this.dernierClic = { id: carte.id, quand: maintenant }
			if (this.edition !== null) this.finirEdition()
			this.actif = carte.id
			this.dessiner(trouver(this.doc, carte.id)?.profondeur ?? null)
			this.ecran.focus()
		})
		this.glisserDeposer(el, carte)
		return el
	}

	private rendu(carte: Carte): HTMLElement {
		const deja = this.rendus.get(carte.id)
		if (deja && deja.texte === carte.texte) return deja.el
		const el = createDiv({ cls: 'eeb-contenu markdown-rendered' })
		if (carte.texte.trim() === '') el.createSpan({ cls: 'eeb-vide', text: '…' })
		else MarkdownRenderer.render(this.app, carte.texte, el, this.file?.path ?? '', this)
		this.rendus.set(carte.id, { texte: carte.texte, el })
		return el
	}

	// ── GLISSER-DÉPOSER ─────────────────────────────────────────────────────
	// Sur la moitié haute de la cible : avant elle. Moitié basse : après.
	// Sur son quart droit : dedans, comme une fille.

	private glisserDeposer(el: HTMLElement, carte: Carte) {
		const zoneDe = (e: DragEvent): Depot => {
			const r = el.getBoundingClientRect()
			if (e.clientX > r.left + r.width * 0.75) return 'enfant'
			return e.clientY < r.top + r.height / 2 ? 'avant' : 'apres'
		}
		const nettoyer = () => el.removeClasses(['eeb-cible-avant', 'eeb-cible-apres', 'eeb-cible-enfant'])
		el.addEventListener('dragstart', (e) => {
			e.dataTransfer?.setData(TYPE_GLISSE, String(carte.id))
			if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
			el.addClass('eeb-glissee')
		})
		el.addEventListener('dragend', () => el.removeClass('eeb-glissee'))
		el.addEventListener('dragover', (e) => {
			if (!e.dataTransfer?.types.includes(TYPE_GLISSE)) return
			e.preventDefault()
			nettoyer()
			el.addClass(`eeb-cible-${zoneDe(e)}`)
		})
		el.addEventListener('dragleave', nettoyer)
		el.addEventListener('drop', (e) => {
			const id = Number(e.dataTransfer?.getData(TYPE_GLISSE))
			nettoyer()
			if (!id) return
			e.preventDefault()
			this.glisser(id, carte.id, zoneDe(e))
		})
	}
}

export function estNoteEnBranches(app: { metadataCache: { getFileCache(f: TFile): any } }, file: TFile | null): boolean {
	if (!file || file.extension !== 'md') return false
	return app.metadataCache.getFileCache(file)?.frontmatter?.['branch-writing'] === true
}
