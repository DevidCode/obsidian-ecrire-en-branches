// AU DOIGT, SUR UN TÉLÉPHONE — dans un vrai Obsidian, en interface mobile.
//
//   npm run test:tactile
//   node test/obsidian/tactile.mjs <dossier contenant main.js, manifest.json, styles.css>
//
// L'instance isolée est passée en interface de téléphone (`app.emulateMobile`),
// sur un écran de 390 × 844, toucher émulé. Chaque geste est un VRAI toucher
// (Input.dispatchTouchEvent) ou un vrai glissement au doigt
// (appui, mouvements, relâchement) — jamais un clic de souris déguisé.
//
// ⚠️ Ce que l'émulation ne montre pas : le clavier virtuel. Sa façon de
// pousser (ou non) la vue vers le haut dépend du téléphone ; elle se vérifie
// sur l'appareil.

import { resolve } from 'path'
import { lancer, verificateur, OBSIDIAN } from './instance.mjs'

const plugin = resolve(process.argv[2] ?? '.')
if (!OBSIDIAN) {
	console.log('Obsidian introuvable sur cette machine : scénario sauté.')
	process.exit(0)
}

const NOTE = `---
branch-writing: true
---
<!--section: 1-->
Idée
<!--section: 1.1-->
Méthode
<!--section: 1.1.1-->
Détail A
<!--section: 1.2-->
Résultat
<!--section: 2-->
Conclusion
`

const { verifier, bilan } = verificateur()
const o = await lancer(plugin, { 'Récit.md': NOTE })
let page = o.page

try {
	// ── Sur ordinateur, sans écran tactile : pas de barre ───────────────────
	await page.evaluate(async () => {
		await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('Récit.md'))
		await new Promise((r) => setTimeout(r, 1200))
	})
	const bureau = await page.evaluate(() => ({
		tactile: document.querySelector('.eeb-vue')?.classList.contains('eeb-tactile'),
		barre: getComputedStyle(document.querySelector('.eeb-barre')).display,
	}))
	verifier(bureau.tactile === false && bureau.barre === 'none', `sur ordinateur à la souris, pas de barre tactile (${bureau.barre})`)

	// ── Passage en téléphone ────────────────────────────────────────────────
	let cdp = await page.context().newCDPSession(page)
	await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
	await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
	await page.evaluate(() => app.emulateMobile(true))
	await page.waitForTimeout(3000)
	page = await o.trouverPage()
	cdp = await page.context().newCDPSession(page)
	await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
	const erreurs = []
	page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()) })
	page.on('pageerror', (e) => erreurs.push(e.message))
	await page.evaluate(async () => {
		await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('Récit.md'))
		await new Promise((r) => setTimeout(r, 1500))
	})

	// Les gestes au doigt.
	const toucherEn = async (x, y) => {
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
		await page.waitForTimeout(350)
	}
	const toucher = async (locator) => {
		const b = await locator.boundingBox()
		if (!b) throw new Error('rien à toucher : ' + locator)
		await toucherEn(b.x + Math.min(b.width / 2, 40), b.y + b.height / 2)
	}
	const carte = (texte) => page.locator('.eeb-carte', { hasText: texte }).first()
	const bouton = (mot) => page.locator(`.eeb-barre .eeb-bouton[aria-label="${mot}"]`)
	// Un glissement = appui, dix mouvements, relâchement. ⚠️ Pas de
	// `Input.synthesizeScrollGesture` : dans cet environnement il ne fait
	// défiler RIEN, pas même une note ordinaire d'Obsidian (vérifié).
	const glisser = async (x, y, dx, dy) => {
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
		for (let i = 1; i <= 10; i++) {
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 10, y: y + (dy * i) / 10 }] })
			await page.waitForTimeout(16)
		}
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
		await page.waitForTimeout(900)
	}
	const etat = () => page.evaluate(() => {
		const v = app.workspace.getLeavesOfType('ecrire-en-branches')[0].view
		const e = document.querySelector('.eeb-ecran')
		const cols = [...document.querySelectorAll('.eeb-colonne')]
		return {
			actif: document.querySelector('.eeb-active')?.innerText.trim() ?? null,
			saisie: document.querySelector('.eeb-saisie')?.value ?? null,
			barre: document.querySelector('.eeb-barre')?.dataset.etat,
			gauche: Math.round(e.scrollLeft),
			debutsColonnes: cols.map((c) => c.offsetLeft),
			fichier: v.getViewData(),
		}
	})
	const enregistre = async () => { await page.waitForTimeout(2600); return o.lire('Récit.md') }

	// ── 1. La mise en page sur téléphone ────────────────────────────────────
	const mise = await page.evaluate(() => {
		const vue = document.querySelector('.eeb-vue')
		const barre = document.querySelector('.eeb-barre').getBoundingClientRect()
		const nav = document.querySelector('.mobile-navbar')?.getBoundingClientRect()
		const cols = [...document.querySelectorAll('.eeb-colonne')].map((c) => c.getBoundingClientRect())
		return {
			classes: vue.className,
			boutons: [...document.querySelectorAll('.eeb-bouton')].map((b) => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height) }),
			barreBas: Math.round(barre.bottom), navHaut: nav ? Math.round(nav.top) : null,
			largeurEcran: innerWidth, col0: cols[0] && Math.round(cols[0].width), col1Gauche: cols[1] && Math.round(cols[1].left),
		}
	})
	verifier(/eeb-tactile/.test(mise.classes) && /eeb-etroit/.test(mise.classes), 'mode tactile et écran étroit reconnus d\'eux-mêmes (réglage « Automatique »)')
	verifier(mise.boutons.length === 7 && mise.boutons.every((t) => t >= 48), `7 boutons d'au moins 48 px (${mise.boutons.map(Math.round).join(', ')})`)
	verifier(mise.navHaut === null || mise.barreBas <= mise.navHaut, `la barre n'est pas recouverte par la navigation d'Obsidian (barre jusqu'à ${mise.barreBas}, navigation dès ${mise.navHaut})`)
	verifier(mise.col0 >= 300 && mise.col1Gauche < mise.largeurEcran && mise.col1Gauche > mise.largeurEcran - 60,
		`une colonne à la fois (${mise.col0} px), le bout de la suivante dépasse (à ${mise.col1Gauche} px sur ${mise.largeurEcran})`)
	await page.screenshot({ path: 'tactile-1-mise-en-page.png' }).catch(() => {})

	// ── 2. Entrer et sortir de l'écriture ───────────────────────────────────
	await toucher(carte('Conclusion'))
	let e = await etat()
	verifier(e.actif === 'Conclusion' && e.saisie === null, 'un premier toucher choisit la carte, sans ouvrir l\'écriture')
	await toucher(carte('Conclusion'))
	e = await etat()
	verifier(e.saisie === 'Conclusion' && e.barre === 'ecrire', 'toucher la carte choisie ouvre l\'écriture, la barre passe en mode écriture')
	await page.keyboard.type(' finale')
	await toucher(bouton('Terminé'))
	e = await etat()
	verifier(e.saisie === null && e.barre === 'choisir', '« Terminé » ferme l\'écriture')
	verifier((await enregistre()).includes('<!--section: 2-->\nConclusion finale\n'), 'le texte tapé est enregistré dans le fichier')

	// ── 3. Créer une fille, puis enchaîner une sœur sans quitter le clavier ─
	await toucher(carte('Idée'))
	await toucher(bouton('Fille'))
	await page.waitForTimeout(600)
	e = await etat()
	verifier(e.saisie === '' && e.barre === 'ecrire', '« Fille » crée une carte fille, ouverte en écriture')
	verifier(Math.abs(e.gauche - e.debutsColonnes[1]) <= 4, `l'écran a glissé sur la colonne des filles (défilement ${e.gauche}, colonne à ${e.debutsColonnes[1]})`)
	await page.keyboard.type('Nouvelle fille')
	await toucher(bouton('Dessous'))
	e = await etat()
	verifier(e.saisie === '' && e.barre === 'ecrire', '« Dessous » pendant l\'écriture enchaîne une sœur, toujours en écriture')
	await page.keyboard.type('Sa sœur')
	await toucher(bouton('Terminé'))
	await toucher(bouton('Dessus'))
	await page.keyboard.type('Au-dessus')
	await toucher(bouton('Terminé'))
	e = await etat()
	verifier(/1\.3-->\nNouvelle fille[\s\S]*1\.4-->\nAu-dessus[\s\S]*1\.5-->\nSa sœur/.test(e.fichier),
		'fille, sœur dessous et sœur dessus sont à leur place (1.3, 1.4, 1.5)')
	await page.screenshot({ path: 'tactile-2-creation.png' }).catch(() => {})

	// ── 4. Déplacer une carte avec sa branche ───────────────────────────────
	await toucher(bouton('Déplacer'))
	e = await etat()
	verifier(e.barre === 'deplacer' && e.actif === 'Au-dessus', 'la barre passe en mode « Déplacer » sur la carte choisie')
	await page.screenshot({ path: 'tactile-3-deplacer.png' }).catch(() => {})
	await toucher(bouton('Monter'))
	e = await etat()
	verifier(/1\.3-->\nAu-dessus[\s\S]*1\.4-->\nNouvelle fille/.test(e.fichier), '« Monter » la fait passer avant sa sœur')
	await toucher(bouton('Sortir'))
	e = await etat()
	verifier(/<!--section: 2-->\nAu-dessus/.test(e.fichier) && e.barre === 'deplacer', '« Sortir » la remonte d\'un étage, à côté de son ancien parent ; le mode reste ouvert')
	await toucher(bouton('Rentrer'))
	e = await etat()
	verifier(/1\.5-->\nAu-dessus/.test(e.fichier), '« Rentrer » la replace sous la sœur du dessus')
	// Une branche entière : Méthode emporte Détail A.
	await toucher(bouton('Fini'))
	await toucher(page.locator('.eeb-fil-etape').first()) // remonter à « Idée » par le fil d'Ariane
	e = await etat()
	verifier(e.actif === 'Idée' && e.gauche <= 4, `le fil d'Ariane remonte à « Idée » et ramène l'écran sur sa colonne (défilement ${e.gauche})`)

	// ── 5. Faire défiler et naviguer au doigt ───────────────────────────────
	const vue = await page.locator('.eeb-ecran').boundingBox()
	await glisser(vue.x + vue.width * 0.7, vue.y + vue.height / 2, -260, 0)
	e = await etat()
	verifier(Math.abs(e.gauche - e.debutsColonnes[1]) <= 4, `glisser vers la gauche amène la colonne suivante, aimantée (défilement ${e.gauche}, colonne à ${e.debutsColonnes[1]})`)
	// Le doigt descend : la colonne remonte vers son début. (Vers le bas, elle
	// est souvent déjà au bout : le recentrage y a mis la carte active.)
	const avantVertical = await page.evaluate(() => document.querySelectorAll('.eeb-colonne')[1].scrollTop)
	await glisser(vue.x + vue.width / 2, vue.y + vue.height * 0.3, 0, 180)
	const apresVertical = await page.evaluate(() => document.querySelectorAll('.eeb-colonne')[1].scrollTop)
	verifier(avantVertical - apresVertical > 40, `glisser le doigt vers le bas fait défiler la colonne (${Math.round(avantVertical)} → ${Math.round(apresVertical)})`)
	await toucher(carte('Méthode'))
	e = await etat()
	verifier(e.actif === 'Méthode', 'toucher une carte dans la colonne glissée la choisit')

	// ── 6. Supprimer (avec confirmation), puis annuler ──────────────────────
	await toucher(bouton('Suppr.'))
	const question = await page.locator('.modal').innerText().catch(() => '')
	verifier(/1 carte\(s\) en dessous/.test(question), 'supprimer une carte qui a des filles demande confirmation dans une fenêtre')
	await toucher(page.locator('.modal button.mod-warning'))
	e = await etat()
	verifier(!e.fichier.includes('Méthode') && !e.fichier.includes('Détail A'), 'la carte et sa branche sont supprimées')
	await toucher(bouton('Annuler'))
	e = await etat()
	verifier(e.fichier.includes('Méthode\n') && e.fichier.includes('Détail A'), '« Annuler » les rend')
	await page.screenshot({ path: 'tactile-4-fin.png' }).catch(() => {})

	// ── 7. Le fichier final, relu sur le disque ─────────────────────────────
	const fin = await enregistre()
	verifier(fin === e.fichier, 'le fichier sur le disque est celui de l\'écran')

	// ── 8. Tablette en portrait : plusieurs colonnes, la barre reste ────────
	await cdp.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 1280, deviceScaleFactor: 2, mobile: true })
	await page.waitForTimeout(1200)
	const tablette = await page.evaluate(() => ({
		classes: document.querySelector('.eeb-vue').className,
		// Visible à plus de moitié : la colonne active est centrée, ses voisines dépassent des bords.
		colonnesVisibles: [...document.querySelectorAll('.eeb-colonne')].filter((c) => {
			const r = c.getBoundingClientRect()
			return Math.min(r.right, innerWidth) - Math.max(r.left, 0) > r.width / 2
		}).length,
	}))
	verifier(/eeb-tactile/.test(tablette.classes) && !/eeb-etroit/.test(tablette.classes) && tablette.colonnesVisibles >= 2,
		`tablette en portrait : barre tactile, ${tablette.colonnesVisibles} colonnes visibles (à plus de moitié) côte à côte`)
	await page.screenshot({ path: 'tactile-5-tablette.png' }).catch(() => {})

	const duPlugin = erreurs.filter((t) => /ecrire-en-branches|plugin:ecrire/.test(t))
	verifier(duPlugin.length === 0, `aucune erreur du plugin${duPlugin.length ? ' — ' + duPlugin[0] : ''}`)
} catch (err) {
	verifier(false, err.message)
} finally {
	await o.fermer()
}

process.exit(bilan())
