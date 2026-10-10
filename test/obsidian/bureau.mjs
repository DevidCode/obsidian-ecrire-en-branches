// AU CLAVIER ET À LA SOURIS, SUR ORDINATEUR — dans un vrai Obsidian.
//
//   npm run test:bureau
//
// Les gestes de la 0.1.0, rejoués à chaque version : ils ne doivent pas
// régresser quand on ajoute le tactile. Vraies frappes, vrais clics.

import { resolve } from 'path'
import { writeFileSync } from 'fs'
import { join } from 'path'
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
### Safe to Rearrange
<!--section: 1.1-->
### Outcome
<!--section: 1.1.1-->
This keeps me moving.
<!--section: 1.2-->
### Method
<!--section: 1.2.1-->
Drag and drop.
<!--section: 1.2.2-->
Or shortcuts.
<!--section: 2-->
Everything in one place.
`

const { verifier, bilan } = verificateur()
const o = await lancer(plugin, { 'Démo.md': NOTE })
const { page } = o
const erreurs = []
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()) })
page.on('pageerror', (e) => erreurs.push(e.message))

try {
	await page.setViewportSize({ width: 1400, height: 900 })
	await page.evaluate(async () => {
		await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('Démo.md'))
		await new Promise((r) => setTimeout(r, 1200))
	})
	const k = page.keyboard
	const actif = () => page.evaluate(() => document.querySelector('.eeb-active')?.innerText.trim())
	const fichier = () => page.evaluate(() => app.workspace.getLeavesOfType('ecrire-en-branches')[0].view.getViewData())
	const carte = (t) => page.locator('.eeb-carte', { hasText: t }).first()

	verifier(await page.evaluate(() => app.workspace.getMostRecentLeaf().view.getViewType()) === 'ecrire-en-branches', 'la note marquée s\'ouvre en cartes')

	// Clavier : circuler, créer, écrire, déplacer, annuler.
	// Aucun clic avant : le clavier doit aller aux cartes dès l'ouverture.
	await k.press('ArrowRight'); await k.press('ArrowDown'); await k.press('ArrowRight')
	verifier(await actif() === 'Drag and drop.', 'dès l\'ouverture, sans clic, les flèches circulent : → ↓ → mène à « Drag and drop. »')
	await k.press('Control+ArrowDown')
	await k.type('Nouvelle idée.')
	await k.press('Escape')
	verifier(/1\.2\.2-->\nNouvelle idée\./.test(await fichier()), 'Ctrl + ↓ crée dessous, on écrit, Échap sort')
	await k.press('Control+Alt+ArrowUp')
	verifier(/1\.2\.1-->\nNouvelle idée\.[\s\S]*1\.2\.2-->\nDrag and drop\./.test(await fichier()), 'Ctrl + Alt + ↑ déplace la carte')
	await k.press('Control+z'); await k.press('Control+z'); await k.press('Control+z')
	verifier(!(await fichier()).includes('Nouvelle idée'), 'trois annulations défont le déplacement, la frappe et la création')

	// Souris : double-clic pour écrire, glisser-déposer.
	await carte('Everything in one place').dblclick()
	await k.press('End'); await k.type(' (souris)'); await k.press('Escape')
	verifier((await fichier()).includes('Everything in one place. (souris)'), 'le double-clic ouvre l\'écriture de la bonne carte')
	await carte('Method').dragTo(carte('Outcome'), { targetPosition: { x: 40, y: 5 } })
	verifier(/1\.1-->\n### Method[\s\S]*1\.2-->\n### Outcome/.test(await fichier()), 'glisser « Method » sur le haut de « Outcome » le place avant, avec sa branche')

	// Supprimer une branche au clavier : la fenêtre d'Obsidian demande confirmation.
	await carte('Method').click()
	await page.waitForTimeout(500)
	await k.press('Delete')
	await page.waitForTimeout(300)
	verifier(/2 carte\(s\) en dessous/.test(await page.locator('.modal').innerText().catch(() => '')), 'Suppr sur une carte qui a des filles demande confirmation')
	await page.locator('.modal button.mod-warning').click()
	await page.waitForTimeout(300)
	verifier(!(await fichier()).includes('Method'), 'confirmer supprime la branche')
	await page.click('.eeb-ecran', { position: { x: 30, y: 30 } })
	await k.press('Control+z')
	verifier((await fichier()).includes('### Method'), 'Ctrl + Z la rend')

	// Écrire pendant qu'un autre appareil modifie la note : les deux restent.
	await page.waitForTimeout(2600)
	await carte('This keeps me moving').dblclick()
	await k.press('End'); await k.type(' [ici]')
	writeFileSync(join(o.coffre, 'Démo.md'), o.lire('Démo.md').replace('Or shortcuts.', 'Or shortcuts. [ailleurs]'))
	// On attend qu'Obsidian ait VU la modification, pas un temps fixe.
	await page.waitForFunction(() => app.workspace.getLeavesOfType('ecrire-en-branches')[0].view.getViewData().includes('[ailleurs]'), null, { timeout: 10000 }).catch(() => {})
	await k.type(' [suite]'); await k.press('Escape')
	await page.waitForTimeout(2600)
	const disque = o.lire('Démo.md')
	verifier(disque.includes('This keeps me moving. [ici] [suite]') && disque.includes('Or shortcuts. [ailleurs]'), 'une modification venue d\'ailleurs pendant l\'écriture est recousue, rien n\'est écrasé'
		+ (disque.includes('[ailleurs]') && disque.includes('[ici] [suite]') ? '' : ` — sur le disque : ${JSON.stringify(disque.split('\n').filter((l) => /keeps|shortcuts/.test(l)))}`))

	const barre = await page.evaluate(() => getComputedStyle(document.querySelector('.eeb-barre')).display)
	verifier(barre === 'none', 'pas de barre tactile à la souris')
	const duPlugin = erreurs.filter((t) => /ecrire-en-branches|plugin:ecrire/.test(t))
	verifier(duPlugin.length === 0, `aucune erreur du plugin${duPlugin.length ? ' — ' + duPlugin[0] : ''}`)
} catch (err) {
	verifier(false, err.message)
} finally {
	await o.fermer()
}

process.exit(bilan())
