// Paquet serveur autonome : IAM-INVOICER-Serveur-<version>.zip
// Contenu : serveur (out/server), application web (out/web), site (out/site) et dépendances
// d'exécution (node_modules, JavaScript et WebAssembly uniquement : le même zip sert sur
// Windows Server, Linux et macOS). Il suffit de Node.js 20 ou plus pour le lancer.
// Utilisé par deploy/windows/installer.ps1 et publié avec chaque version (build.yml).
// Usage : npm run build:all-server && node tools/server/bundle.mjs [dossier-de-sortie]
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, execSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const outDir = resolve(process.argv[2] ?? 'dist')
const name = `IAM-INVOICER-Serveur-${pkg.version}`
const stage = resolve('out', 'bundle', name)
for (const d of ['out/server/server.cjs', 'out/web/index.html', 'out/site/index.html'])
  if (!existsSync(d)) throw new Error(`${d} absent : lancez d'abord « npm run build:all-server »`)

rmSync(resolve('out', 'bundle'), { recursive: true, force: true })
mkdirSync(join(stage, 'out'), { recursive: true })
for (const d of ['server', 'web', 'site']) cpSync(join('out', d), join(stage, 'out', d), { recursive: true })

// package.json réduit aux dépendances d'exécution, avec le verrou complet pour des versions identiques
writeFileSync(join(stage, 'package.json'), JSON.stringify({
  name: 'iam-invoicer-serveur', version: pkg.version, private: true, description: pkg.description,
  scripts: { start: 'node out/server/server.cjs' }, engines: { node: '>=20' }, dependencies: pkg.dependencies
}, null, 2))
cpSync('package-lock.json', join(stage, 'package-lock.json'))
execSync('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', { cwd: stage, stdio: 'inherit' })
writeFileSync(join(stage, 'LISEZMOI.txt'), [
  `IAM INVOICER ${pkg.version} — paquet serveur`,
  '',
  'Windows Server ou Windows 10/11 : utilisez plutôt le script d\'installation (service, pare-feu, sauvegardes) :',
  '  irm https://raw.githubusercontent.com/tenak27/iam_invoicer/main/deploy/windows/installer.ps1 | iex',
  '',
  'Lancement manuel (Node.js 20 ou plus) :',
  '  PORT=8080 DATA_DIR=./data node out/server/server.cjs',
  '  (avec PostgreSQL : DATABASE_URL=postgres://utilisateur:motdepasse@hote:5432/base)',
  'Puis ouvrez http://adresse-du-serveur:8080/app/ depuis les postes du réseau.',
  ''
].join('\r\n'))

mkdirSync(outDir, { recursive: true })
const zip = join(outDir, `${name}.zip`)
rmSync(zip, { force: true })
// Windows : le tar du système (bsdtar) sait écrire un .zip ; celui de Git (GNU tar) non
if (process.platform === 'win32') execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', zip, name], { cwd: resolve('out', 'bundle'), stdio: 'inherit' })
else execFileSync('zip', ['-qr', zip, name], { cwd: resolve('out', 'bundle'), stdio: 'inherit' })
console.log(`Paquet serveur : ${zip}`)
