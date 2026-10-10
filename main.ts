// ÉCRIRE EN BRANCHES — le point d'entrée du plugin.
//
// Une note qui porte `branch-writing: true` dans son en-tête s'ouvre en
// colonnes de cartes. Un bouton rebascule vers le fichier, un autre ouvre le
// fichier à droite : les deux vues se suivent en direct.

import { Extension } from '@codemirror/state'
import {
	App, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, WorkspaceLeaf, normalizePath,
} from 'obsidian'
import { analyser, aDesMarqueurs, convertir, numeroter, retirerMarqueurs, serialiser, textePropre } from './src/format'
import { confirmer } from './src/confirmer'
import { masquerMarqueurs } from './src/masque'
import { TYPE_VUE, VueBranches, estNoteEnBranches } from './src/vue'

interface Reglages {
	largeurColonne: number
	afficherNumeros: boolean
	masquerMarqueurs: boolean
	ouvertureAuto: boolean
	modeTactile: 'auto' | 'toujours' | 'jamais'
}

const DEFAUT: Reglages = {
	largeurColonne: 340,
	afficherNumeros: false,
	masquerMarqueurs: true,
	ouvertureAuto: true,
	modeTactile: 'auto',
}

export default class EcrireEnBranches extends Plugin {
	reglages: Reglages = { ...DEFAUT }
	/**
	 * Les onglets où l'on a choisi de voir le FICHIER : l'ouverture automatique
	 * ne les rebascule pas en cartes dans notre dos.
	 */
	private enFichier = new WeakMap<WorkspaceLeaf, string>()
	private boutons = new WeakSet<MarkdownView>()
	private extensions: Extension[] = []

	async onload() {
		this.reglages = { ...DEFAUT, ...(await this.loadData()) }
		this.registerView(TYPE_VUE, (leaf) => new VueBranches(leaf, this))
		this.addSettingTab(new OngletReglages(this.app, this))

		this.appliquerMasque()
		this.registerEditorExtension(this.extensions)

		this.addRibbonIcon('git-branch', 'Nouvelle note en branches', () => this.nouvelleNote())
		this.commandes()

		// Ouvrir en cartes une note marquée, et poser le bouton de retour sur sa vue fichier.
		this.registerEvent(this.app.workspace.on('file-open', (file) => this.surOuverture(file)))
		this.registerEvent(this.app.workspace.on('layout-change', () => this.poserBoutons()))
		// Un onglet restauré au démarrage n'est ouvert qu'à sa première
		// activation : c'est là qu'il reçoit son bouton, et qu'une note en
		// branches passe en cartes.
		this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
			this.poserBoutons()
			if (leaf?.view instanceof MarkdownView) this.surOuverture(leaf.view.file)
		}))
		// L'en-tête n'est pas encore lu à l'ouverture d'une note fraîchement synchronisée :
		// on réessaie quand Obsidian a fini de l'analyser.
		this.registerEvent(this.app.metadataCache.on('changed', (file) => {
			if (file === this.app.workspace.getActiveFile()) this.surOuverture(file)
		}))

		// La vue fichier modifiée à droite → les cartes suivent.
		this.registerEvent(this.app.vault.on('modify', async (file) => {
			if (!(file instanceof TFile)) return
			const vues = this.app.workspace.getLeavesOfType(TYPE_VUE)
				.map((l) => l.view)
				.filter((v): v is VueBranches => v instanceof VueBranches && v.file === file)
			if (!vues.length) return
			const contenu = await this.app.vault.read(file)
			vues.forEach((v) => v.recharger(contenu))
		}))

		this.app.workspace.onLayoutReady(() => {
			this.poserBoutons()
			// Au démarrage, Obsidian restaure les onglets sans émettre d'ouverture :
			// une note en branches restée en vue fichier ne basculerait jamais.
			if (!this.reglages.ouvertureAuto) return
			this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
				// Un onglet encore différé n'a pas de fichier : il basculera à sa première activation.
				if (!(leaf.view instanceof MarkdownView)) return
				const file = leaf.view.file
				if (file && estNoteEnBranches(this.app, file)) void this.ouvrirEnCartes(leaf, file)
			})
		})
	}

	async sauver() {
		await this.saveData(this.reglages)
		this.appliquerMasque()
		this.app.workspace.updateOptions()
		this.app.workspace.getLeavesOfType(TYPE_VUE).forEach((l) => {
			if (l.view instanceof VueBranches) l.view.redessiner()
		})
	}

	private appliquerMasque() {
		this.extensions.length = 0
		if (this.reglages.masquerMarqueurs) this.extensions.push(masquerMarqueurs)
	}

	// ── BASCULER ENTRE CARTES ET FICHIER ────────────────────────────────────

	private surOuverture(file: TFile | null) {
		if (!this.reglages.ouvertureAuto || !file || !estNoteEnBranches(this.app, file)) return
		const vue = this.app.workspace.getActiveViewOfType(MarkdownView)
		if (!vue || vue.file !== file) return
		const leaf = vue.leaf
		// ⚠️ Pas tout de suite : quand l'onglet affichait déjà des cartes,
		// Obsidian annonce l'ouverture AVANT d'avoir fini d'y poser la vue
		// fichier, et l'écrase ensuite par-dessus notre bascule (vu en pilotant).
		// On attend que l'onglet soit stable, et on revérifie un peu plus tard.
		const essayer = () => {
			const v = leaf.view
			if (!(v instanceof MarkdownView) || v.file !== file) return
			if (this.enFichier.get(leaf) === file.path) return
			void this.ouvrirEnCartes(leaf, file)
		}
		window.setTimeout(essayer, 0)
		window.setTimeout(essayer, 400)
	}

	async ouvrirEnCartes(leaf: WorkspaceLeaf, file: TFile) {
		this.enFichier.delete(leaf)
		await leaf.setViewState({ type: TYPE_VUE, state: { file: file.path }, active: true })
	}

	async ouvrirEnFichier(leaf: WorkspaceLeaf, file: TFile) {
		this.enFichier.set(leaf, file.path)
		await leaf.setViewState({ type: 'markdown', state: { file: file.path, mode: 'source' }, active: true })
	}

	async basculer(leaf: WorkspaceLeaf) {
		const vue = leaf.view
		if (vue instanceof VueBranches && vue.file) {
			await vue.save()
			await this.ouvrirEnFichier(leaf, vue.file)
		} else if (vue instanceof MarkdownView && vue.file) {
			await this.ouvrirEnCartes(leaf, vue.file)
		}
	}

	async ouvrirADroite(vue: VueBranches) {
		if (!vue.file) return
		await vue.save()
		const droite = this.app.workspace.getLeaf('split', 'vertical')
		this.enFichier.set(droite, vue.file.path)
		await droite.setViewState({ type: 'markdown', state: { file: vue.file.path, mode: 'source' } })
		this.app.workspace.setActiveLeaf(vue.leaf, { focus: true })
	}

	/**
	 * Sur la vue fichier d'une note en branches : un bouton pour revenir aux cartes.
	 *
	 * ⛔ `getLeavesOfType('markdown')` rend aussi les onglets DIFFÉRÉS : au
	 * démarrage, Obsidian (1.7 et après) ne les ouvre qu'à leur première
	 * activation, et leur vue n'est qu'une coquille — ni `addAction`, ni `file`.
	 * Les traiter comme des vues fichier faisait échouer le chargement du
	 * plugin (0.1.0). On les saute : ils sont repris à leur activation.
	 */
	private poserBoutons() {
		this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
			const vue = leaf.view
			if (!(vue instanceof MarkdownView) || this.boutons.has(vue)) return
			this.boutons.add(vue)
			const bouton = vue.addAction('git-branch', 'Voir en branches', () => this.basculer(leaf))
			const afficher = () => bouton.toggle(estNoteEnBranches(this.app, vue.file))
			afficher()
			this.registerEvent(this.app.workspace.on('file-open', afficher))
			this.registerEvent(this.app.metadataCache.on('changed', afficher))
		})
	}

	// ── LES COMMANDES ───────────────────────────────────────────────────────

	private commandes() {
		this.addCommand({
			id: 'nouvelle-note',
			name: 'Nouvelle note en branches',
			callback: () => this.nouvelleNote(),
		})

		this.addCommand({
			id: 'basculer',
			name: 'Basculer entre cartes et fichier',
			checkCallback: (verifier) => {
				const leaf = this.app.workspace.getMostRecentLeaf()
				const vue = leaf?.view
				const possible = vue instanceof VueBranches || (vue instanceof MarkdownView && estNoteEnBranches(this.app, vue.file))
				if (verifier) return possible
				if (leaf && possible) void this.basculer(leaf)
			},
		})

		this.addCommand({
			id: 'ouvrir-a-droite',
			name: 'Ouvrir le fichier à droite',
			checkCallback: (verifier) => {
				const vue = this.app.workspace.getActiveViewOfType(VueBranches)
				if (verifier) return !!vue
				if (vue) void this.ouvrirADroite(vue)
			},
		})

		this.addCommand({
			id: 'convertir',
			name: 'Convertir la note en branches (les titres donnent l\'arbre)',
			checkCallback: (verifier) => {
				const vue = this.app.workspace.getActiveViewOfType(MarkdownView)
				const possible = !!vue?.file && !estNoteEnBranches(this.app, vue.file)
				if (verifier) return possible
				if (vue?.file && possible) void this.convertir(vue.leaf, vue.file)
			},
		})

		this.addCommand({
			id: 'copier-texte',
			name: 'Copier le texte sans marqueurs',
			checkCallback: (verifier) => {
				const file = this.app.workspace.getActiveFile()
				const possible = !!file && estNoteEnBranches(this.app, file)
				if (verifier) return possible
				if (file && possible) void this.copierTexte(file)
			},
		})

		this.addCommand({
			id: 'retirer',
			name: 'Revenir à une note ordinaire (retire les marqueurs)',
			checkCallback: (verifier) => {
				const file = this.app.workspace.getActiveFile()
				const possible = !!file && estNoteEnBranches(this.app, file)
				if (verifier) return possible
				if (file && possible) void this.retirer(file)
			},
		})
	}

	async nouvelleNote() {
		const parent = this.app.fileManager.getNewFileParent(this.app.workspace.getActiveFile()?.path ?? '')
		const dossier = parent instanceof TFolder ? parent.path : ''
		let chemin = normalizePath(`${dossier}/Sans titre en branches.md`)
		for (let i = 1; this.app.vault.getAbstractFileByPath(chemin); i++) {
			chemin = normalizePath(`${dossier}/Sans titre en branches ${i}.md`)
		}
		const fichier = await this.app.vault.create(chemin, '---\nbranch-writing: true\n---\n<!--section: 1-->\n')
		await this.ouvrirEnCartes(this.app.workspace.getLeaf(false), fichier)
	}

	private async convertir(leaf: WorkspaceLeaf, file: TFile) {
		await this.app.vault.process(file, (texte) => {
			if (aDesMarqueurs(texte)) return texte // déjà découpée : on n'y touche pas
			const doc = analyser('')
			const yaml = texte.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/)?.[0] ?? ''
			doc.entete = yaml
			doc.racines = convertir(texte.slice(yaml.length))
			numeroter(doc)
			return serialiser(doc)
		})
		await this.app.fileManager.processFrontMatter(file, (fm) => { fm['branch-writing'] = true })
		new Notice('Note découpée en cartes. Le texte n\'a pas changé, seuls des marqueurs ont été ajoutés.')
		await this.ouvrirEnCartes(leaf, file)
	}

	private async copierTexte(file: TFile) {
		const doc = analyser(await this.app.vault.read(file))
		await navigator.clipboard.writeText(textePropre(doc))
		new Notice('Texte copié, sans les marqueurs.')
	}

	private async retirer(file: TFile) {
		if (!(await confirmer(this.app, 'Retirer les marqueurs de cette note ? Le texte reste, la structure en cartes est perdue.', 'Retirer'))) return
		for (const leaf of this.app.workspace.getLeavesOfType(TYPE_VUE)) {
			if (leaf.view instanceof VueBranches && leaf.view.file === file) await this.ouvrirEnFichier(leaf, file)
		}
		await this.app.vault.process(file, retirerMarqueurs)
		await this.app.fileManager.processFrontMatter(file, (fm) => { delete fm['branch-writing'] })
		new Notice('La note est redevenue une note ordinaire.')
	}
}

class OngletReglages extends PluginSettingTab {
	constructor(app: App, private plugin: EcrireEnBranches) { super(app, plugin) }

	display() {
		const { containerEl } = this
		containerEl.empty()
		const r = this.plugin.reglages

		new Setting(containerEl)
			.setName('Largeur des colonnes')
			.setDesc('En pixels.')
			.addSlider((s) => s.setLimits(220, 600, 20).setValue(r.largeurColonne).setDynamicTooltip()
				.onChange(async (v) => { r.largeurColonne = v; await this.plugin.sauver() }))

		new Setting(containerEl)
			.setName('Afficher les numéros des cartes')
			.setDesc('Le numéro de section (1.2.4) en coin de carte : il permet de retrouver la carte dans le fichier.')
			.addToggle((t) => t.setValue(r.afficherNumeros)
				.onChange(async (v) => { r.afficherNumeros = v; await this.plugin.sauver() }))

		new Setting(containerEl)
			.setName('Masquer les marqueurs dans l\'éditeur')
			.setDesc('En mode source et en aperçu en direct, chaque <!--section--> devient une petite pastille « § 1.2 ». Le fichier n\'est pas modifié.')
			.addToggle((t) => t.setValue(r.masquerMarqueurs)
				.onChange(async (v) => { r.masquerMarqueurs = v; await this.plugin.sauver() }))

		new Setting(containerEl)
			.setName('Ouvrir automatiquement en cartes')
			.setDesc('Une note qui porte « branch-writing: true » s\'ouvre directement en colonnes.')
			.addToggle((t) => t.setValue(r.ouvertureAuto)
				.onChange(async (v) => { r.ouvertureAuto = v; await this.plugin.sauver() }))

		new Setting(containerEl)
			.setName('Mode tactile')
			.setDesc('Une barre d\'outils en bas de la vue, et toucher une carte déjà choisie pour y écrire. « Automatique » l\'active sur téléphone, sur tablette et sur un écran tactile.')
			.addDropdown((d) => d
				.addOption('auto', 'Automatique')
				.addOption('toujours', 'Toujours')
				.addOption('jamais', 'Jamais')
				.setValue(r.modeTactile)
				.onChange(async (v) => { r.modeTactile = v as Reglages['modeTactile']; await this.plugin.sauver() }))

		containerEl.createEl('h3', { text: 'Raccourcis' })
		const liste = containerEl.createEl('ul')
		for (const ligne of [
			'Flèches : passer d\'une carte à l\'autre',
			'Entrée : écrire dans la carte — Échap ou Ctrl + Entrée : en sortir',
			'Ctrl + ↓ / ↑ : nouvelle carte dessous / dessus — Ctrl + → : nouvelle carte fille',
			'Ctrl + Alt + flèche : déplacer la carte avec sa branche',
			'Suppr ou Ctrl + Retour arrière : supprimer la carte',
			'Ctrl + Maj + J : fusionner avec la carte du dessous',
			'Ctrl + Z / Ctrl + Maj + Z : annuler / rétablir',
			'Glisser une carte : moitié haute = avant, moitié basse = après, bord droit = dedans',
		]) liste.createEl('li', { text: ligne })

		containerEl.createEl('h3', { text: 'Au doigt (mode tactile)' })
		const doigt = containerEl.createEl('ul')
		for (const ligne of [
			'Toucher une carte : la choisir — la toucher à nouveau : écrire dedans',
			'Barre du bas : Dessus, Dessous, Fille, Écrire, Déplacer, Suppr., Annuler',
			'Pendant l\'écriture : Terminé, ou enchaîner une carte Dessous ou Fille',
			'Déplacer : Monter, Descendre, Sortir (d\'un étage), Rentrer (sous la sœur du dessus), Fini',
			'Petit écran : une colonne à la fois — glisser vers la gauche pour les filles, le fil d\'Ariane pour remonter',
		]) doigt.createEl('li', { text: ligne })
	}
}
