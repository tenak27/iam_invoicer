// Résumé de l'auto-contrôle en annotations GitHub (une ligne par DMG, plus une par étape en échec :
// GitHub n'affiche que 10 annotations de chaque niveau par étape).
// Usage : node scripts/selftest-report.cjs <selftest.json> <nom>
const r = require(require('node:path').resolve(process.argv[2]))
const name = process.argv[3]
const clean = (s) => String(s ?? '').replace(/\r?\n/g, ' ').replace(/::/g, ': ').slice(0, 600)
const summary = r.steps.map((s) => `${s.ok ? '✓' : '✗'} ${s.step}`).join(' · ')
console.log(`::${r.ok ? 'notice' : 'error'} title=${name} auto-contrôle ${r.ok ? 'RÉUSSI' : 'ÉCHOUÉ'} (${r.arch}, macOS, ${r.ms} ms)::${summary}`)
for (const s of r.steps.filter((x) => !x.ok)) console.log(`::error title=${name} ✗ ${s.step}::${clean(s.detail)}`)
process.exit(r.ok ? 0 : 1)
