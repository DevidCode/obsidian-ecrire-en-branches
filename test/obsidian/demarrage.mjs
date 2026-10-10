// LE DÉMARRAGE AVEC DES ONGLETS RESTAURÉS — dans un vrai Obsidian.
//
//   npm run test:obsidian            (le main.js du dépôt)
//   node test/obsidian/demarrage.mjs <dossier contenant main.js, manifest.json, styles.css>
//
// Ce qui a cassé la 0.1.0 chez l'utilisateur, invisible aux épreuves logiques :
// au démarrage, Obsidian (1.7 et après) restaure les onglets en VUES DIFFÉRÉES.
// Seul l'onglet actif est vraiment ouvert ; les autres ont le type « markdown »
// mais pas de vue fichier derrière — pas d'`addAction`, pas de `file`. Le
// plugin les traitait comme des vues fichier : « vue.addAction is not a
// function », et le chargement du plugin échouait.
//
// Le scénario : une instance d'Obsidian ISOLÉE (son propre dossier de
// configuration, son propre profil, un vault jetable, un écran virtuel s'il
// n'y en a pas), trois onglets ouverts, un rechargement — puis on vérifie :
//   1. aucune « Plugin failure » au chargement ;
//   2. au démarrage, il y avait bien des onglets différés (sinon le scénario
//      ne prouverait rien) ;
//   3. un onglet différé d'une note en branches s'ouvre en cartes quand on l'active ;
//   4. un onglet différé d'une note ordinaire reçoit son bouton une fois ouvert.
//
// ⛔ Ne touche à aucun Obsidian en service : rien n'est partagé avec lui.

import { spawn, execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setTimeout as attendre } from 'timers/promises'
import { chromium } from 'playwright-core'

const plugin = resolve(process.argv[2] ?? '.')
const obsidian = ['/usr/bin/obsidian', '/opt/Obsidian/obsidian'].find(existsSync)
if (!obsidian) {
	console.log('Obsidian introuvable sur cette machine : scénario sauté.')
	process.exit(0)
}

const racine = mkdtempSync(join(tmpdir(), 'eeb-demarrage-'))
const coffre = join(racine, 'coffre')
const config = join(racine, 'config')
const dossierPlugin = join(coffre, '.obsidian', 'plugins', 'ecrire-en-branches')
mkdirSync(dossierPlugin, { recursive: true })
mkdirSync(join(config, 'obsidian'), { recursive: true })
for (const f of ['main.js', 'manifest.json', 'styles.css']) copyFileSync(join(plugin, f), join(dossierPlugin, f))
writeFileSync(join(coffre, '.obsidian', 'community-plugins.json'), '["ecrire-en-branches"]')
writeFileSync(join(coffre, 'Ordinaire A.md'), '# A\nUne note ordinaire.\n')
writeFileSync(join(coffre, 'Ordinaire B.md'), '# B\nUne autre.\n')
writeFileSync(join(coffre, 'En branches.md'), '---\nbranch-writing: true\n---\n<!--section: 1-->\nRacine\n<!--section: 1.1-->\nFille\n')
writeFileSync(join(config, 'obsidian', 'obsidian.json'),
	JSON.stringify({ vaults: { eeb0000000000001: { path: coffre, ts: Date.now(), open: true } } }))

const avecEcran = Boolean(process.env.DISPLAY)
const commande = avecEcran ? obsidian : 'xvfb-run'
const args = [
	...(avecEcran ? [] : ['-a', '-s', '-screen 0 1400x900x24', obsidian]),
	'--no-sandbox', `--user-data-dir=${join(config, 'obsidian')}`, '--remote-debugging-port=0',
]
const instance = spawn(commande, args, {
	env: { ...process.env, XDG_CONFIG_HOME: config, HOME: racine },
	detached: true,
	stdio: 'ignore',
})

const echecs = []
const verifier = (condition, message) => {
	console.log(`${condition ? '  ok ' : '  ÉCHEC'} ${message}`)
	if (!condition) echecs.push(message)
}

let navigateur
try {
	// Le port de débogage est choisi par le système et écrit dans le profil.
	const fichierPort = join(config, 'obsidian', 'DevToolsActivePort')
	for (let i = 0; i < 60 && !existsSync(fichierPort); i++) await attendre(500)
	const port = readFileSync(fichierPort, 'utf8').split('\n')[0]
	navigateur = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)

	const trouverPage = async () => {
		for (let i = 0; i < 60; i++) {
			for (const p of navigateur.contexts().flatMap((c) => c.pages())) {
				if (await p.evaluate(() => Boolean(window.app?.workspace?.layoutReady)).catch(() => false)) return p
			}
			await attendre(500)
		}
		throw new Error('Obsidian ne répond pas')
	}

	// Premier lancement : accepter le vault, ouvrir trois onglets, l'actif en premier.
	let page = await trouverPage()
	await page.getByText('Trust author and enable plugins').click({ timeout: 5000 }).catch(() => {})
	await page.waitForFunction(() => Boolean(window.app.plugins.plugins['ecrire-en-branches']), null, { timeout: 15000 })
	await page.evaluate(async () => {
		for (const nom of ['En branches.md', 'Ordinaire B.md', 'Ordinaire A.md']) {
			await app.workspace.getLeaf('tab').openFile(app.vault.getAbstractFileByPath(nom))
		}
		app.workspace.requestSaveLayout()
		await new Promise((r) => setTimeout(r, 2500)) // l'enregistrement de la disposition est différé
	})

	// Le rechargement : Obsidian restaure les onglets, en vues différées.
	await page.evaluate(() => app.commands.executeCommandById('app:reload')).catch(() => {})
	await attendre(1500)
	page = await trouverPage()
	const erreurs = []
	page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()) })
	page.on('pageerror', (e) => erreurs.push(e.message))
	await page.waitForTimeout(2500)

	const etat = await page.evaluate(() => ({
		charge: Boolean(app.plugins.plugins['ecrire-en-branches']),
		differes: app.workspace.getLeavesOfType('markdown').filter((l) => l.isDeferred).map((l) => l.getViewState().state?.file),
		notices: [...document.querySelectorAll('.notice')].map((n) => n.innerText.trim()),
	}))
	const echecChargement = [...erreurs, ...etat.notices].filter((t) => /ecrire-en-branches/.test(t) && /fail|Failed/i.test(t))
	verifier(echecChargement.length === 0, `aucune erreur au chargement${echecChargement.length ? ' — ' + echecChargement[0] : ''}`)
	verifier(etat.charge, 'le plugin est chargé')
	verifier(etat.differes.length >= 1, `des onglets différés au démarrage (${etat.differes.join(', ') || 'aucun'}) — sans eux le scénario ne prouverait rien`)

	// Le chemin de l'utilisateur : BRAT active le plugin alors que la disposition
	// est déjà prête — onLayoutReady s'exécute PENDANT le chargement, avec des
	// onglets encore différés.
	const parBrat = await page.evaluate(async () => {
		await app.plugins.disablePluginAndSave('ecrire-en-branches')
		document.querySelectorAll('.notice').forEach((n) => n.remove())
		const differes = app.workspace.getLeavesOfType('markdown').filter((l) => l.isDeferred).length
		await app.plugins.enablePluginAndSave('ecrire-en-branches')
		await new Promise((r) => setTimeout(r, 800))
		return { differes, notices: [...document.querySelectorAll('.notice')].map((n) => n.innerText.trim()) }
	})
	const echecBrat = [...erreurs, ...parBrat.notices].filter((t) => /ecrire-en-branches/.test(t) && /fail|Failed/i.test(t))
	verifier(parBrat.differes >= 1 && echecBrat.length === 0,
		`réactivé comme BRAT avec ${parBrat.differes} onglet(s) différé(s), sans échec${echecBrat.length ? ' — ' + echecBrat[0] : ''}`)

	// Activer l'onglet différé de la note en branches : il doit passer en cartes.
	const typeBranches = await page.evaluate(async () => {
		const leaf = app.workspace.getLeavesOfType('markdown').concat(app.workspace.getLeavesOfType('ecrire-en-branches'))
			.find((l) => l.getViewState().state?.file === 'En branches.md')
		app.workspace.setActiveLeaf(leaf, { focus: true })
		await leaf.loadIfDeferred?.()
		await new Promise((r) => setTimeout(r, 1200))
		return leaf.view.getViewType()
	})
	verifier(typeBranches === 'ecrire-en-branches', `l'onglet différé d'une note en branches s'ouvre en cartes (vu : ${typeBranches})`)

	// Activer l'onglet différé d'une note ordinaire : le bouton est posé, et caché.
	const bouton = await page.evaluate(async () => {
		const leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.getViewState().state?.file === 'Ordinaire B.md')
		app.workspace.setActiveLeaf(leaf, { focus: true })
		await leaf.loadIfDeferred?.()
		await new Promise((r) => setTimeout(r, 800))
		const el = leaf.view.containerEl.querySelector('.view-action[aria-label="Voir en branches"]')
		return { pose: Boolean(el), cache: el ? getComputedStyle(el).display === 'none' : null, nombre: leaf.view.containerEl.querySelectorAll('.view-action[aria-label="Voir en branches"]').length }
	})
	verifier(bouton.pose && bouton.nombre === 1, `l'onglet ordinaire, une fois ouvert, porte UN bouton « Voir en branches » (${bouton.nombre})`)
	verifier(bouton.cache === true, 'ce bouton est caché : la note n\'est pas en branches')

	// Le fichier ouvert à droite doit RESTER en vue fichier quand on y clique :
	// la bascule à l'activation d'un onglet ne doit pas le repasser en cartes.
	const droite = await page.evaluate(async () => {
		const cartes = app.workspace.getLeavesOfType('ecrire-en-branches').find((l) => l.view.file?.path === 'En branches.md')
		app.workspace.setActiveLeaf(cartes, { focus: true })
		app.commands.executeCommandById('ecrire-en-branches:ouvrir-a-droite')
		await new Promise((r) => setTimeout(r, 1200))
		const fichier = app.workspace.getLeavesOfType('markdown').find((l) => l.view.file?.path === 'En branches.md')
		if (!fichier) return 'pas de volet fichier'
		app.workspace.setActiveLeaf(fichier, { focus: true })
		await new Promise((r) => setTimeout(r, 1000))
		return fichier.view.getViewType()
	})
	verifier(droite === 'markdown', `le fichier ouvert à droite reste en vue fichier quand on l'active (vu : ${droite})`)

	const tardives = erreurs.filter((t) => /ecrire-en-branches|plugin:ecrire/.test(t))
	verifier(tardives.length === 0, `aucune erreur du plugin pendant le scénario${tardives.length ? ' — ' + tardives[0] : ''}`)
} catch (e) {
	echecs.push(e.message)
	console.log('  ÉCHEC', e.message)
} finally {
	await navigateur?.close().catch(() => {})
	// On tue le groupe de processus lancé ici, et rien d'autre.
	try { process.kill(-instance.pid, 'SIGTERM') } catch {}
	await attendre(1000)
	try { process.kill(-instance.pid, 'SIGKILL') } catch {}
	rmSync(racine, { recursive: true, force: true })
}

console.log(echecs.length ? `\n${echecs.length} échec(s)` : '\nTout est vert.')
process.exit(echecs.length ? 1 : 0)
