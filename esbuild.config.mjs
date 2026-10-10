import esbuild from 'esbuild'
import process from 'process'
import { builtinModules } from 'module'
import { mkdirSync } from 'fs'

const banner = `/*
CE FICHIER EST CONSTRUIT PAR ESBUILD — ne pas le modifier à la main.
Source : https://github.com/DevidCode/obsidian-ecrire-en-branches
*/`

const mode = process.argv[2]

// ── LES ÉPREUVES ────────────────────────────────────────────────────────────
// Le format et les gestes sont en TypeScript ; `node --test` ne les lit pas.
// On les traduit dans un dossier de passage et les épreuves jouent dessus :
// c'est bien LE code livré qui est éprouvé, pas une copie.
if (mode === 'epreuves') {
	mkdirSync('.epreuves', { recursive: true })
	await esbuild.build({
		entryPoints: ['src/format.ts', 'src/arbre.ts'],
		outdir: '.epreuves',
		outExtension: { '.js': '.mjs' },
		format: 'esm',
		bundle: true,
		splitting: true,
		logLevel: 'warning',
	})
	process.exit(0)
}

const prod = mode === 'production'

const context = await esbuild.context({
	banner: { js: banner },
	entryPoints: ['main.ts'],
	bundle: true,
	external: [
		'obsidian', 'electron',
		'@codemirror/autocomplete', '@codemirror/collab', '@codemirror/commands',
		'@codemirror/language', '@codemirror/lint', '@codemirror/search',
		'@codemirror/state', '@codemirror/view',
		'@lezer/common', '@lezer/highlight', '@lezer/lr',
		...builtinModules, ...builtinModules.map((m) => `node:${m}`),
	],
	format: 'cjs',
	target: 'es2018',
	logLevel: 'info',
	sourcemap: prod ? false : 'inline',
	treeShaking: true,
	outfile: 'main.js',
})

if (prod) {
	await context.rebuild()
	process.exit(0)
} else {
	await context.watch()
}
