// UNE INSTANCE D'OBSIDIAN ISOLÉE, pour les scénarios.
//
// Son propre dossier de configuration, son propre profil, un vault jetable,
// un écran virtuel s'il n'y en a pas, un port de débogage choisi par le
// système. ⛔ Rien n'est partagé avec un Obsidian en service.

import { spawn } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setTimeout as attendre } from 'timers/promises'
import { chromium } from 'playwright-core'

export const OBSIDIAN = ['/usr/bin/obsidian', '/opt/Obsidian/obsidian'].find(existsSync)

/**
 * @param plugin dossier contenant main.js, manifest.json, styles.css
 * @param notes  { 'Nom.md': 'contenu' }
 * @param reglages data.json du plugin, si besoin
 */
export async function lancer(plugin, notes, reglages = null) {
	const racine = mkdtempSync(join(tmpdir(), 'eeb-obsidian-'))
	const coffre = join(racine, 'coffre')
	const config = join(racine, 'config')
	const dossierPlugin = join(coffre, '.obsidian', 'plugins', 'ecrire-en-branches')
	mkdirSync(dossierPlugin, { recursive: true })
	mkdirSync(join(config, 'obsidian'), { recursive: true })
	for (const f of ['main.js', 'manifest.json', 'styles.css']) copyFileSync(join(plugin, f), join(dossierPlugin, f))
	if (reglages) writeFileSync(join(dossierPlugin, 'data.json'), JSON.stringify(reglages))
	writeFileSync(join(coffre, '.obsidian', 'community-plugins.json'), '["ecrire-en-branches"]')
	for (const [nom, contenu] of Object.entries(notes)) writeFileSync(join(coffre, nom), contenu)
	writeFileSync(join(config, 'obsidian', 'obsidian.json'),
		JSON.stringify({ vaults: { eeb0000000000001: { path: coffre, ts: Date.now(), open: true } } }))

	const avecEcran = Boolean(process.env.DISPLAY)
	const instance = spawn(avecEcran ? OBSIDIAN : 'xvfb-run', [
		...(avecEcran ? [] : ['-a', '-s', '-screen 0 1400x1000x24', OBSIDIAN]),
		'--no-sandbox', `--user-data-dir=${join(config, 'obsidian')}`, '--remote-debugging-port=0',
	], { env: { ...process.env, XDG_CONFIG_HOME: config, HOME: racine }, detached: true, stdio: 'ignore' })

	const fichierPort = join(config, 'obsidian', 'DevToolsActivePort')
	for (let i = 0; i < 60 && !existsSync(fichierPort); i++) await attendre(500)
	const port = readFileSync(fichierPort, 'utf8').split('\n')[0]
	const navigateur = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)

	const trouverPage = async () => {
		for (let i = 0; i < 60; i++) {
			for (const p of navigateur.contexts().flatMap((c) => c.pages())) {
				if (await p.evaluate(() => Boolean(window.app?.workspace?.layoutReady)).catch(() => false)) return p
			}
			await attendre(500)
		}
		throw new Error('Obsidian ne répond pas')
	}

	let page = await trouverPage()
	await page.getByText('Trust author and enable plugins').click({ timeout: 5000 }).catch(() => {})
	await page.waitForFunction(() => Boolean(window.app.plugins.plugins['ecrire-en-branches']), null, { timeout: 15000 })
	// ⚠️ Au premier lancement, Obsidian (1.13) ouvre ses réglages dans une
	// FENÊTRE SÉPARÉE, invisible ici. Elle devient le document actif, et toute
	// fenêtre de dialogue (une confirmation) s'ouvre dedans — hors de la page
	// pilotée. On la ferme, et on rend la main à la fenêtre principale.
	await page.evaluate(() => app.setting?.close?.()).catch(() => {})
	for (const autre of navigateur.contexts().flatMap((c) => c.pages())) {
		if (autre !== page) await autre.close().catch(() => {})
	}
	await page.waitForFunction(() => activeDocument === document, null, { timeout: 5000 }).catch(() => {})

	return {
		coffre,
		page,
		trouverPage,
		lire: (nom) => readFileSync(join(coffre, nom), 'utf8'),
		async fermer() {
			await navigateur.close().catch(() => {})
			// On tue le groupe de processus lancé ici, et rien d'autre.
			try { process.kill(-instance.pid, 'SIGTERM') } catch {}
			await attendre(1000)
			try { process.kill(-instance.pid, 'SIGKILL') } catch {}
			rmSync(racine, { recursive: true, force: true })
		},
	}
}

/** Un compteur de vérifications qui dit ce qu'il voit. */
export function verificateur() {
	const echecs = []
	const verifier = (condition, message) => {
		console.log(`${condition ? '  ok ' : '  ÉCHEC'} ${message}`)
		if (!condition) echecs.push(message)
	}
	const bilan = () => {
		console.log(echecs.length ? `\n${echecs.length} échec(s)` : '\nTout est vert.')
		return echecs.length ? 1 : 0
	}
	return { verifier, bilan, echecs }
}
