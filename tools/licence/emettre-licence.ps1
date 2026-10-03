# Émission d'une licence IAM INVOICER, question par question (réservé à l'éditeur).
# Lancement : double-clic sur « Emettre une licence.cmd » dans ce dossier.

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $repo

Write-Host ''
Write-Host '  IAM INVOICER — émission d''une licence' -ForegroundColor Cyan
Write-Host '  ------------------------------------' -ForegroundColor Cyan
Write-Host ''

$client = Read-Host '  Raison sociale du client (exactement comme dans ses paramètres)'
if (-not $client) { Write-Host '  Raison sociale obligatoire.' -ForegroundColor Red; Read-Host '  Entrée pour fermer'; exit 1 }
$ifu = Read-Host '  Identifiant fiscal du client (facultatif, Entrée pour passer)'

Write-Host ''
Write-Host '  Offres : 1 = Essentiel   2 = Pro   3 = Entreprise   4 = Sur mesure'
$choice = Read-Host '  Votre choix [2]'
$tier = switch ($choice) { '1' { 'essentiel' } '3' { 'entreprise' } '4' { 'sur-mesure' } default { 'pro' } }

$nodeArgs = @('tools/licence/issue.mjs', '--client', $client, '--tier', $tier)
if ($ifu) { $nodeArgs += @('--ifu', $ifu) }

if ($tier -eq 'sur-mesure') {
  Write-Host '  Modules : sales, clients, products, stock, payments, cash, reports, purchases, suppliers,'
  Write-Host '            accounting, messages, hr, crm, projects, assets, budget'
  $modules = Read-Host '  Modules séparés par des virgules'
  $nodeArgs += @('--modules', $modules)
}

$users = Read-Host '  Nombre d''utilisateurs (Entrée = celui de l''offre, 0 = illimité)'
if ($users) { $nodeArgs += @('--users', $users) }

Write-Host ''
Write-Host '  Durée : 1 = 12 mois   2 = 24 mois   3 = perpétuelle   4 = date précise'
$d = Read-Host '  Votre choix [1]'
switch ($d) {
  '2' { $nodeArgs += @('--months', '24') }
  '3' { $nodeArgs += '--perpetual' }
  '4' { $until = Read-Host '  Date de fin (AAAA-MM-JJ)'; $nodeArgs += @('--until', $until) }
  default { $nodeArgs += @('--months', '12') }
}
$wl = Read-Host '  Application au nom et au logo du client (marque blanche) ? o/N'
if ($wl -match '^[oOyY]') { $nodeArgs += '--white-label' }

Write-Host ''
& node --no-warnings @nodeArgs
if ($LASTEXITCODE -eq 0) {
  # Copie de la dernière clé dans le presse-papiers
  $last = (Get-Content (Join-Path $HOME '.iam-invoicer\licences.csv') -Encoding UTF8 | Select-Object -Last 1).Split(';')[-1]
  if ($last) { Set-Clipboard -Value $last; Write-Host '  La clé est copiée dans le presse-papiers : collez-la dans un e-mail ou un message au client.' -ForegroundColor Green }
}
Write-Host ''
Read-Host '  Entrée pour fermer'
