<#
  IAM INVOICER - installation du serveur sur Windows Server (2016, 2019, 2022, 2025)
  ou sur un poste Windows 10/11 qui sert de serveur au bureau.

  En une commande, dans PowerShell ouvert « en tant qu'administrateur » :
    irm https://raw.githubusercontent.com/tenak27/iam_invoicer/main/deploy/windows/installer.ps1 | iex

  Avec des options (port, base PostgreSQL, copie en ligne) :
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/tenak27/iam_invoicer/main/deploy/windows/installer.ps1))) -Port 8080
  ou, le fichier téléchargé :
    powershell -ExecutionPolicy Bypass -File installer.ps1 -Port 8080 -DatabaseUrl postgres://iam:motdepasse@localhost:5432/iam_invoicer

  Ce que fait le script :
    - installe Node.js LTS si besoin (empreinte SHA-256 vérifiée) ;
    - télécharge le paquet serveur de la dernière version publiée (empreinte vérifiée) ;
    - installe le serveur comme tâche système qui démarre avec Windows, sans session ouverte,
      et redémarre seule en cas d'arrêt ;
    - ouvre le port dans le pare-feu (réseaux privé et domaine uniquement) ;
    - base intégrée : sauvegarde chaque nuit à 2 h 30, 14 jours conservés.
  Relancer le script met à jour le serveur sans toucher aux données ni aux réglages.
  Désinstaller : installer.ps1 -Uninstall (les données restent, sauf avec -Purge).
#>
param(
  [int]$Port = 0,
  [string]$Dir = "$env:ProgramData\IAM-INVOICER",
  [string]$Version = 'latest',
  [string]$Zip = '',
  [string]$DatabaseUrl = '',
  [string]$CloudUrl = '',
  [string]$CloudKey = '',
  [int]$CloudMinutes = 0,
  [switch]$NoService,
  [switch]$Uninstall,
  [switch]$Purge
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest est très lent avec la barre de progression
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Repo = 'tenak27/iam_invoicer'
$TaskName = 'IAM INVOICER - Serveur'
$BackupTask = 'IAM INVOICER - Sauvegarde'
$FirewallGroup = 'IAM INVOICER'

function Say([string]$m) { Write-Host "`n> $m" -ForegroundColor Cyan }
function Warn([string]$m) { Write-Host "  ! $m" -ForegroundColor Yellow }
function Die([string]$m) { Write-Host "`nX $m" -ForegroundColor Red; throw $m }

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Arrête le serveur : la tâche, puis le processus Node qui exécute ce serveur (et lui seul)
function Stop-IamServer {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
  $server = Join-Path $Dir 'app\out\server\server.cjs'
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($server) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

# Dossier réservé au système et aux administrateurs (SID : indépendant de la langue de Windows)
function Protect-Folder([string]$path) {
  & icacls.exe $path /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
}

function Get-NodeExe {
  $candidates = @("$env:ProgramFiles\nodejs\node.exe")
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { $candidates = @($cmd.Source) + $candidates }
  foreach ($c in $candidates) {
    if (Test-Path $c) {
      $v = (& $c -v) -replace '^v', ''
      if ([int]($v.Split('.')[0]) -ge 22) { return $c }   # --env-file et version maintenue
    }
  }
  return $null
}

function Install-Node {
  Say 'Installation de Node.js LTS'
  $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
  $lts = $index | Where-Object { $_.lts -and ([int]($_.version.TrimStart('v').Split('.')[0]) -ge 22) } | Select-Object -First 1
  if (-not $lts) { Die 'Version LTS de Node.js introuvable sur nodejs.org.' }
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $msi = "node-$($lts.version)-$arch.msi"
  $base = "https://nodejs.org/dist/$($lts.version)"
  $tmp = Join-Path $env:TEMP $msi
  Invoke-WebRequest -Uri "$base/$msi" -OutFile $tmp -UseBasicParsing
  $sums = (Invoke-WebRequest -Uri "$base/SHASUMS256.txt" -UseBasicParsing).Content
  $expected = ($sums -split "`n" | Where-Object { $_ -match [regex]::Escape($msi) } | Select-Object -First 1) -replace '\s.*$', ''
  $actual = (Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower()
  if (-not $expected -or $actual -ne $expected.ToLower()) { Die "Empreinte de $msi incorrecte : téléchargement corrompu, relancez le script." }
  $p = Start-Process msiexec.exe -ArgumentList "/i `"$tmp`" /qn /norestart" -Wait -PassThru
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { Die "L'installation de Node.js a échoué (code $($p.ExitCode))." }
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  Write-Host "  Node.js $($lts.version) installé."
}

# Paquet serveur de la version demandée, depuis les publications GitHub
function Get-ServerPackage {
  $api = if ($Version -eq 'latest') { "https://api.github.com/repos/$Repo/releases/latest" } else { "https://api.github.com/repos/$Repo/releases/tags/v$($Version.TrimStart('v'))" }
  $rel = Invoke-RestMethod -Uri $api -Headers @{ 'User-Agent' = 'iam-invoicer-installer' } -UseBasicParsing
  $asset = $rel.assets | Where-Object { $_.name -match '^IAM-INVOICER-Serveur-.*\.zip$' } | Select-Object -First 1
  if (-not $asset) { Die "La publication $($rel.tag_name) ne contient pas encore de paquet serveur (IAM-INVOICER-Serveur-*.zip). Indiquez une version plus récente avec -Version, ou un fichier avec -Zip." }
  $out = Join-Path $env:TEMP $asset.name
  Write-Host "  $($asset.name) ($([math]::Round($asset.size / 1MB, 1)) Mo)"
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $out -UseBasicParsing
  $sumsAsset = $rel.assets | Where-Object { $_.name -eq 'SHA256SUMS.txt' } | Select-Object -First 1
  if ($sumsAsset) {
    $sums = (Invoke-WebRequest -Uri $sumsAsset.browser_download_url -UseBasicParsing).Content
    if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
    $expected = ($sums -split "`n" | Where-Object { $_ -match [regex]::Escape($asset.name) } | Select-Object -First 1) -replace '\s.*$', ''
    $actual = (Get-FileHash $out -Algorithm SHA256).Hash.ToLower()
    if (-not $expected -or $actual -ne $expected.ToLower()) { Die 'Empreinte du paquet serveur incorrecte : téléchargement corrompu, relancez le script.' }
    Write-Host '  Empreinte SHA-256 vérifiée.'
  } else { Warn 'Pas de fichier d''empreintes dans cette publication : vérification impossible.' }
  return $out
}

function New-Secret { $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); return (($b | ForEach-Object { $_.ToString('x2') }) -join '') }

# ------------------------------- Désinstallation -------------------------------
if ($Uninstall) {
  if (-not (Test-Admin)) { Die 'Lancez PowerShell « en tant qu''administrateur ».' }
  Say 'Désinstallation du serveur IAM INVOICER'
  Stop-IamServer
  foreach ($t in @($TaskName, $BackupTask)) { if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $t -Confirm:$false } }
  Get-NetFirewallRule -Group $FirewallGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  Remove-Item (Join-Path $Dir 'app') -Recurse -Force -ErrorAction SilentlyContinue
  if ($Purge) { Remove-Item $Dir -Recurse -Force -ErrorAction SilentlyContinue; Write-Host '  Données supprimées.' }
  else { Write-Host "  Données conservées dans $Dir (données, sauvegardes, réglages)." }
  return
}

# ------------------------------- Installation -------------------------------
Write-Host 'IAM INVOICER - serveur pour Windows' -ForegroundColor White
if (-not $NoService -and -not (Test-Admin)) { Die 'Lancez PowerShell « en tant qu''administrateur » (clic droit sur PowerShell -> Exécuter en tant qu''administrateur).' }

foreach ($d in @('', 'data', 'config', 'sauvegardes', 'journal', 'telechargements')) { New-Item -ItemType Directory -Force -Path (Join-Path $Dir $d) | Out-Null }
$configDir = Join-Path $Dir 'config'
if (-not $NoService) { Protect-Folder $configDir }

# Réglages : ceux de l'installation précédente, sauf ce qui est donné en paramètre
$settingsFile = Join-Path $configDir 'parametres.json'
$prev = $null
if (Test-Path $settingsFile) { $prev = Get-Content $settingsFile -Raw | ConvertFrom-Json }
function Pick($given, $old, $default) { if ($given) { return $given } elseif ($old) { return $old } else { return $default } }
$Port = [int](Pick $Port $(if ($prev) { $prev.Port }) 8080)
$DatabaseUrl = Pick $DatabaseUrl $(if ($prev) { $prev.DatabaseUrl }) ''
$CloudUrl = Pick $CloudUrl $(if ($prev) { $prev.CloudUrl }) ''
$CloudKey = Pick $CloudKey $(if ($prev) { $prev.CloudKey }) ''
$CloudMinutes = [int](Pick $CloudMinutes $(if ($prev) { $prev.CloudMinutes }) 15)
if ($Port -lt 1024 -or $Port -gt 65535) { Die "Port invalide : $Port (entre 1024 et 65535)." }
[pscustomobject]@{ Port = $Port; DatabaseUrl = $DatabaseUrl; CloudUrl = $CloudUrl; CloudKey = $CloudKey; CloudMinutes = $CloudMinutes } | ConvertTo-Json | Set-Content -Path $settingsFile -Encoding UTF8

Say 'Node.js'
$node = Get-NodeExe
if (-not $node) {
  if ($NoService) { Die 'Node.js 22 ou plus est requis.' }
  Install-Node
  $node = Get-NodeExe
  if (-not $node) { Die 'Node.js est installé mais introuvable : ouvrez une nouvelle fenêtre PowerShell et relancez le script.' }
}
Write-Host "  $node ($(& $node -v))"

Say 'Paquet serveur'
$package = if ($Zip) { (Resolve-Path $Zip).Path } else { Get-ServerPackage }
# Décompression sur le même disque que la destination (Move-Item ne déplace pas un dossier d'un disque à l'autre)
$unpack = Join-Path $Dir ('installation-' + [guid]::NewGuid().ToString('N'))
Expand-Archive -Path $package -DestinationPath $unpack -Force
$root = Get-ChildItem $unpack -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'out\server\server.cjs') } | Select-Object -First 1
if (-not $root) { Die 'Paquet serveur invalide (out\server\server.cjs absent).' }
$newVersion = (Get-Content (Join-Path $root.FullName 'package.json') -Raw | ConvertFrom-Json).version

Stop-IamServer
$app = Join-Path $Dir 'app'
Remove-Item $app -Recurse -Force -ErrorAction SilentlyContinue
Move-Item $root.FullName $app
Remove-Item $unpack -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "  Version $newVersion installée dans $app"

# Clé de chiffrement des secrets (messagerie, SMS…) : créée une fois, jamais remplacée
$keyFile = Join-Path $configDir 'cle-secrets.txt'
if (-not (Test-Path $keyFile)) { Set-Content -Path $keyFile -Value (New-Secret) -NoNewline -Encoding ASCII }

# Variables d'environnement lues par Node (--env-file) ; le dossier config est réservé aux administrateurs
$envLines = @(
  "PORT=$Port",
  'HOST=0.0.0.0',
  'TRUST_PROXY=0',
  "DATA_DIR=$(Join-Path $Dir 'data')",
  "DOWNLOADS_DIR=$(Join-Path $Dir 'telechargements')",
  "SECRETS_KEY_FILE=$keyFile"
)
if ($DatabaseUrl) { $envLines += "DATABASE_URL=$DatabaseUrl" }
if ($CloudUrl -and $CloudKey) { $envLines += @("CLOUD_MIRROR_URL=$CloudUrl", "CLOUD_MIRROR_KEY=$CloudKey", "CLOUD_MIRROR_MINUTES=$CloudMinutes") }
$envFile = Join-Path $configDir 'serveur.env'
[IO.File]::WriteAllLines($envFile, $envLines)

# Lanceur : redémarre Node s'il s'arrête, journal dans journal\serveur.log (vidé s'il dépasse 20 Mo)
$log = Join-Path $Dir 'journal\serveur.log'
# Chemin absolu : Stop-IamServer reconnaît le processus à sa ligne de commande
$serverJs = Join-Path $app 'out\server\server.cjs'
$launcher = Join-Path $configDir 'lancer.cmd'
@(
  '@echo off',
  'rem Serveur IAM INVOICER - lancé par la tâche planifiée « IAM INVOICER - Serveur »',
  "cd /d `"$app`"",
  ':boucle',
  "for %%F in (`"$log`") do if %%~zF GTR 20000000 move /y `"$log`" `"$log.1`" >nul",
  "`"$node`" --env-file=`"$envFile`" `"$serverJs`" >> `"$log`" 2>&1",
  'timeout /t 5 /nobreak >nul',
  'goto boucle'
) | Set-Content -Path $launcher -Encoding ASCII

if ($NoService) {
  # Essai sans service : le serveur tourne tant que cette fenêtre n'est pas fermée
  Say 'Démarrage (sans service, pour essai)'
  $p = Start-Process -FilePath $node -ArgumentList @("--env-file=`"$envFile`"", "`"$serverJs`"") -WorkingDirectory $app -RedirectStandardOutput $log -RedirectStandardError "$log.err" -WindowStyle Hidden -PassThru
  Write-Host "  Processus $($p.Id)"
} else {
  Say 'Service : démarrage avec Windows'
  $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\cmd.exe" -Argument "/c `"$launcher`""
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Serveur IAM INVOICER (application web et API pour les postes du réseau)' -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName

  Say "Pare-feu : port $Port (réseaux privé et domaine)"
  Get-NetFirewallRule -Group $FirewallGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName "IAM INVOICER (TCP $Port)" -Group $FirewallGroup -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Domain, Private | Out-Null

  if (-not $DatabaseUrl) {
    Say 'Sauvegarde chaque nuit à 2 h 30 (14 jours conservés)'
    $backup = Join-Path $configDir 'sauvegarde.ps1'
    @(
      '# Sauvegarde de la base intégrée : arrêt du serveur (quelques secondes), copie compressée, redémarrage.',
      "`$dir = '$Dir'",
      "Stop-ScheduledTask -TaskName '$TaskName'",
      "Get-CimInstance Win32_Process -Filter `"Name = 'node.exe'`" | Where-Object { `$_.CommandLine -and `$_.CommandLine.Contains('$app') } | ForEach-Object { Stop-Process -Id `$_.ProcessId -Force }",
      'Start-Sleep -Seconds 2',
      "try { Compress-Archive -Path (Join-Path `$dir 'data\*') -DestinationPath (Join-Path `$dir ('sauvegardes\iam-invoicer-' + (Get-Date -Format 'yyyy-MM-dd') + '.zip')) -Force }",
      "finally { Start-ScheduledTask -TaskName '$TaskName' }",
      "Get-ChildItem (Join-Path `$dir 'sauvegardes') -Filter 'iam-invoicer-*.zip' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 14 | Remove-Item -Force"
    ) | Set-Content -Path $backup -Encoding UTF8
    $bAction = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$backup`""
    $bTrigger = New-ScheduledTaskTrigger -Daily -At '02:30'
    Register-ScheduledTask -TaskName $BackupTask -Action $bAction -Trigger $bTrigger -Principal $principal -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable) -Description 'Sauvegarde quotidienne de la base IAM INVOICER' -Force | Out-Null
  } else {
    if (Get-ScheduledTask -TaskName $BackupTask -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $BackupTask -Confirm:$false }
    Warn 'Base PostgreSQL : programmez sa sauvegarde (pg_dump) avec vos outils habituels.'
  }
}

Say 'Vérification'
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  try { $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { $ok = $true; break } } catch { }
  Start-Sleep -Seconds 2
}
if (-not $ok) { Die "Le serveur ne répond pas sur le port $Port. Consultez $log" }

$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | Select-Object -ExpandProperty IPAddress
Write-Host "`nIAM INVOICER $newVersion est prêt." -ForegroundColor Green
Write-Host 'Sur les postes, téléphones et navigateurs du réseau, utilisez l''une de ces adresses :'
foreach ($ip in $ips) { Write-Host "    http://${ip}:$Port/app/" -ForegroundColor White }
Write-Host "Application de bureau : écran de connexion -> Base de données … - modifier -> « Serveur en ligne ou de l'entreprise »."
Write-Host "Données : $(Join-Path $Dir 'data')   Sauvegardes : $(Join-Path $Dir 'sauvegardes')   Journal : $log"
if ($CloudUrl -and $CloudKey) { Write-Host "Copie en ligne vers $CloudUrl toutes les $CloudMinutes minutes." }
Write-Host 'Donnez une adresse IP fixe à ce serveur (réservation sur le routeur) et désactivez sa mise en veille.'
