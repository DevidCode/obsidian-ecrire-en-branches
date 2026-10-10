// L'ÉCRAN EN COLONNES.
//
// Une vue de fichier texte d'Obsidian (TextFileView) : Obsidian lit le fichier
// et nous le donne (setViewData), puis nous le redemande pour l'enregistrer
// (getViewData). Entre les deux, tout passe par le document en mémoire —
// l'écran est entièrement redessiné à partir de lui après chaque geste.

import { MarkdownRenderer, Notice, Platform, Scope, TextFileView, TFile, WorkspaceLeaf, moment, setIcon } from 'obsidian'
import { confirmer } from './confirmer'
import { Carte, Document, analyser, aplatir, numeroter, reprendreEdition, serialiser } from './format'
import {
	Depot, OuCreer, Sens, ajouter, ancetres, colonnes, deplacer, deposer, descendants, fusionnerDessous,
	supprimer, trouver, voisine,
} from './arbre'
import type EcrireEnBranches from '../main'

export const TYPE_VUE = 'ecrire-en-branches'
const TYPE_GLISSE = 'application/x-ecrire-en-branches'
/** En dessous de cette largeur de vue, une colonne à la fois. */
const LARGEUR_ETROITE = 640

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
	private barre!: HTMLElement
	/** La barre d'outils tactile est en mode « Déplacer » : quatre flèches. */
	private modeDeplacer = false
	private etroit = false

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
		this.barre = this.contentEl.createDiv({ cls: 'eeb-barre' })
		// La largeur de la VUE décide, pas celle de l'écran : un volet serré sur
		// un grand écran a les mêmes besoins qu'un téléphone.
		const observateur = new ResizeObserver(() => {
			const etroit = this.contentEl.clientWidth > 0 && this.contentEl.clientWidth < LARGEUR_ETROITE
			if (etroit === this.etroit) return
			this.etroit = etroit
			this.dessiner()
		})
		observateur.observe(this.contentEl)
		this.register(() => observateur.disconnect())
		this.registerDomEvent(window, 'resize', () => this.caserBarre())

		// ⛔ Obsidian n'active les raccourcis d'une vue (`this.scope`) que
		// lorsque son onglet DEVIENT actif. La bascule automatique remplace la
		// vue fichier par les cartes dans le MÊME onglet, déjà actif : aucun
		// changement, raccourcis jamais branchés — les flèches ne faisaient
		// rien (présent dès la 0.1.0, vu en pilotant une instance neuve). On
		// les branche donc nous-mêmes quand le focus entre dans la vue.
		this.registerDomEvent(this.contentEl, 'focusin', () => this.brancherRaccourcis())
		this.registerDomEvent(this.contentEl, 'focusout', (e) => {
			if (!this.contentEl.contains(e.relatedTarget as Node | null)) this.debrancherRaccourcis()
		})
		this.addAction('file-text', 'Voir le fichier', () => this.plugin.basculer(this.leaf))
		this.addAction('panel-right', 'Ouvrir le fichier à droite', () => this.plugin.ouvrirADroite(this))
		// Cliquer dans le vide garde le clavier sur l'écran, sans rien sélectionner.
		this.ecran.addEventListener('mousedown', (e) => {
			if (e.target === this.ecran || (e.target as HTMLElement).hasClass('eeb-colonne')) this.ecran.focus()
		})
	}

	private raccourcisBranches = false

	private brancherRaccourcis() {
		if (!this.scope || this.raccourcisBranches) return
		this.app.keymap.pushScope(this.scope)
		this.raccourcisBranches = true
	}

	private debrancherRaccourcis() {
		if (!this.scope || !this.raccourcisBranches) return
		this.app.keymap.popScope(this.scope)
		this.raccourcisBranches = false
	}

	async onClose() {
		this.debrancherRaccourcis()
	}

	/**
	 * Le mode tactile : barre d'outils, toucher pour écrire, pas de glisser.
	 * « auto » = l'application mobile, ou un écran dont le pointeur principal
	 * est le doigt (tablette, écran tactile).
	 */
	tactile(): boolean {
		const r = this.plugin.reglages.modeTactile
		if (r === 'toujours') return true
		if (r === 'jamais') return false
		return Platform.isMobile || window.matchMedia('(pointer: coarse)').matches
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
		// À l'ouverture, le clavier va aux cartes : sans ça, les flèches ne
		// faisaient rien avant un premier clic.
		if (clear && this.app.workspace.getActiveViewOfType(VueBranches) === this) {
			window.setTimeout(() => { if (this.edition === null) this.ecran?.focus() }, 0)
		}
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

	private async effacer() {
		if (this.actif === null) return
		this.finirEdition()
		const id = this.actif
		const place = trouver(this.doc, id)
		if (!place) return
		const n = descendants(place.carte).length
		if (n > 0 && !(await confirmer(this.app, `Supprimer cette carte et ses ${n} carte(s) en dessous ?`))) return
		if (this.actif !== id) return // la sélection a bougé pendant la question
		this.memoriser()
		this.actif = supprimer(this.doc, this.actif)
		this.modifie()
		this.dessiner()
		// La fenêtre de confirmation a pris le focus : on le rend à l'écran.
		this.ecran.focus()
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
		s.register([], 'Delete', horsEdition(() => void this.effacer()))
		s.register(['Mod'], 'Backspace', horsEdition(() => void this.effacer()))
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
		// Le focus tout de suite, pas à l'image suivante : une frappe rapide
		// juste après Ctrl + ↓ partait ailleurs (vu en pilotant). La zone est
		// déjà dans la page à ce moment.
		zone.focus()
		zone.setSelectionRange(zone.value.length, zone.value.length)
		window.requestAnimationFrame(ajuster)
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
		this.contentEl.toggleClass('eeb-tactile', this.tactile())
		this.contentEl.toggleClass('eeb-etroit', this.etroit)
		this.dessinerBarre()
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
			invite.setText(this.tactile()
				? 'Note vide — touchez « Dessous » pour écrire la première carte.'
				: 'Note vide — Entrée pour écrire la première carte.')
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
			if (colActive && this.etroit) {
				// Une colonne à la fois : on amène la colonne active au bord gauche,
				// même après un toucher — sur un téléphone, la carte touchée dans le
				// bout de colonne qui dépasse doit venir sous les yeux.
				this.ecran.scrollTo({ left: colActive.offsetLeft, behavior: 'smooth' })
			} else if (colActive && figee === null) {
				const gauche = colActive.offsetLeft - this.ecran.clientWidth / 2 + colActive.offsetWidth / 2
				this.ecran.scrollTo({ left: Math.max(0, gauche), behavior: 'smooth' })
			}
		})
	}

	// ── LA BARRE D'OUTILS TACTILE ───────────────────────────────────────────
	// En bas de la vue, sous le pouce. Des boutons de 48 px (le minimum que
	// recommandent Apple et Google pour une cible au doigt), une icône ET un
	// mot : un symbole seul ne se devine pas. Trois états :
	//   - choisir : créer dessus / dessous / fille, écrire, déplacer, supprimer, annuler ;
	//   - écrire  : terminé, et enchaîner une carte dessous ou fille sans quitter le clavier ;
	//   - déplacer : monter, descendre, sortir d'un étage, rentrer sous la sœur, fini.

	private dessinerBarre() {
		if (!this.barre) return
		this.barre.empty()
		this.barre.toggle(this.tactile())
		window.requestAnimationFrame(() => this.caserBarre())
		if (!this.tactile()) return
		const bouton = (icone: string, mot: string, geste: () => void, actif = true, cls = '') => {
			const b = this.barre.createEl('button', { cls: `eeb-bouton ${cls}`, attr: { 'aria-label': mot } })
			setIcon(b.createSpan({ cls: 'eeb-bouton-icone' }), icone)
			b.createSpan({ cls: 'eeb-bouton-mot', text: mot })
			b.disabled = !actif
			// Le bouton ne prend pas le focus : pendant l'écriture, le clavier du
			// téléphone reste ouvert d'une carte à la suivante.
			b.addEventListener('pointerdown', (e) => e.preventDefault())
			b.addEventListener('mousedown', (e) => e.preventDefault())
			b.addEventListener('click', (e) => {
				e.preventDefault()
				geste()
			})
		}
		const place = this.actif !== null ? trouver(this.doc, this.actif) : null
		const choisie = place !== null

		if (this.edition !== null) {
			this.barre.dataset.etat = 'ecrire'
			bouton('check', 'Terminé', () => this.finirEdition(), true, 'eeb-bouton-fort')
			bouton('arrow-down-to-line', 'Dessous', () => this.creer('dessous'))
			bouton('corner-down-right', 'Fille', () => this.creer('enfant'))
			return
		}

		if (this.modeDeplacer && choisie) {
			this.barre.dataset.etat = 'deplacer'
			const { index, freres, parent } = place!
			bouton('arrow-up', 'Monter', () => this.bouger('haut'), index > 0 || parent !== null)
			bouton('arrow-down', 'Descendre', () => this.bouger('bas'), index < freres.length - 1 || parent !== null)
			bouton('arrow-left', 'Sortir', () => this.bouger('gauche'), parent !== null)
			bouton('arrow-right', 'Rentrer', () => this.bouger('droite'), index > 0)
			bouton('check', 'Fini', () => { this.modeDeplacer = false; this.dessiner() }, true, 'eeb-bouton-fort')
			return
		}

		this.modeDeplacer = false
		this.barre.dataset.etat = 'choisir'
		bouton('arrow-up-to-line', 'Dessus', () => this.creer('dessus'), choisie)
		bouton('arrow-down-to-line', 'Dessous', () => this.creer('dessous'))
		bouton('corner-down-right', 'Fille', () => this.creer('enfant'), choisie)
		bouton('pencil', 'Écrire', () => this.actif !== null && this.editer(this.actif, false), choisie, 'eeb-bouton-fort')
		bouton('move', 'Déplacer', () => { this.modeDeplacer = true; this.dessiner() }, choisie)
		bouton('trash-2', 'Suppr.', () => void this.effacer(), choisie)
		bouton('undo-2', 'Annuler', () => this.retablir(this.annuler, this.refaire), this.annuler.length > 0)
	}

	/**
	 * Sur téléphone, la barre de navigation d'Obsidian (`.mobile-navbar`) FLOTTE
	 * au-dessus du bas de l'écran, et recouvrait notre barre d'outils (vu en
	 * émulant un téléphone). On mesure ce qu'elle recouvre et on remonte la
	 * nôtre d'autant — mesuré à chaque fois, pas figé : elle peut changer de
	 * taille, ou disparaître quand le clavier s'ouvre.
	 */
	private caserBarre() {
		if (!this.barre) return
		this.barre.style.marginBottom = ''
		if (!this.tactile()) return
		const nav = document.querySelector<HTMLElement>('.mobile-navbar')
		if (!nav) return
		const style = getComputedStyle(nav)
		if (style.display === 'none' || style.visibility === 'hidden') return
		const n = nav.getBoundingClientRect()
		const v = this.contentEl.getBoundingClientRect()
		if (n.height === 0 || n.right <= v.left || n.left >= v.right) return
		const recouvre = v.bottom - n.top
		if (recouvre > 0) this.barre.style.marginBottom = `${Math.ceil(recouvre) + 6}px`
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
			// Au doigt, glisser une carte se confondrait avec faire défiler : on
			// déplace par la barre d'outils.
			el.draggable = !this.tactile()
		}
		el.createDiv({ cls: 'eeb-numero', text: carte.numero })

		el.addEventListener('click', (e) => {
			if (carte.id === this.edition) return
			// Un lien cliqué dans la carte s'ouvre ; il ne sélectionne pas.
			if ((e.target as HTMLElement).closest('a')) return
			// Le double-clic se reconnaît ici, par carte : l'écran est redessiné
			// entre les deux clics, l'événement natif ne retrouverait pas sa cible.
			const maintenant = Date.now()
			// Au doigt, le double-toucher est peu fiable : toucher la carte DÉJÀ
			// active ouvre l'écriture. Le premier toucher ne fait que choisir.
			if (this.tactile() && carte.id === this.actif && !this.modeDeplacer) {
				this.editer(carte.id)
				return
			}
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
