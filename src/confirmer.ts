// UNE QUESTION OUI / NON — dans la fenêtre d'Obsidian, pas celle du navigateur.
//
// `confirm()` bloque la page et son comportement sur Obsidian mobile n'est pas
// garanti ; la fenêtre d'Obsidian marche partout, au doigt comme au clavier.

import { App, Modal } from 'obsidian'

export function confirmer(app: App, question: string, oui = 'Supprimer'): Promise<boolean> {
	return new Promise((resoudre) => {
		let reponse = false
		const fenetre = new (class extends Modal {
			onOpen() {
				this.contentEl.createEl('p', { text: question })
				const boutons = this.contentEl.createDiv({ cls: 'modal-button-container' })
				boutons.createEl('button', { text: 'Annuler' }).addEventListener('click', () => this.close())
				const ok = boutons.createEl('button', { text: oui, cls: 'mod-warning' })
				ok.addEventListener('click', () => { reponse = true; this.close() })
			}
			onClose() { resoudre(reponse) }
		})(app)
		fenetre.open()
	})
}
