# IAM Technology — récupère sur ce poste les archives chiffrées du serveur (bases et clés des logiciels).
# Lancé chaque jour par la tâche planifiée « IAM - Dépôt des sauvegardes » (voir LISEZMOI.md).
# Les archives restent chiffrées : seule la clé privée de ce poste (.iam-sauvegardes\depot.key) les ouvre.
param(
  [string]$Dossier = (Join-Path $env:USERPROFILE 'IAM-Sauvegardes'),
  [string]$Hote = 'root@145.223.34.191',
  [string]$CleSsh = (Join-Path $env:USERPROFILE '.ssh\iam_vps'),
  [int]$Garder = 60
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Dossier | Out-Null
$journal = Join-Path $Dossier 'journal.txt'
function Note([string]$texte) { Add-Content -Path $journal -Value ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $texte) -Encoding utf8 }

try {
  $ssh = @('-i', $CleSsh, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=30')
  $liste = & ssh @ssh $Hote "ls -1 /opt/iam-sauvegardes/" | Where-Object { $_ -match '^iam-[0-9_-]+\.tar\.cms$' }
  if ($LASTEXITCODE -ne 0) { throw "Connexion au serveur impossible (code $LASTEXITCODE)." }
  if (-not $liste) { throw 'Aucune archive sur le serveur : la sauvegarde de nuit ne tourne pas.' }

  $nouvelles = 0
  foreach ($nom in $liste) {
    $cible = Join-Path $Dossier $nom
    if (Test-Path $cible) { continue }
    $partiel = "$cible.partiel"
    & scp @ssh "${Hote}:/opt/iam-sauvegardes/$nom" $partiel
    if ($LASTEXITCODE -ne 0) { throw "Téléchargement de $nom échoué." }
    $attendu = ((& ssh @ssh $Hote "cat /opt/iam-sauvegardes/$nom.sha256") -split '\s+')[0]
    $obtenu = (Get-FileHash -Algorithm SHA256 -Path $partiel).Hash.ToLower()
    if ($attendu -ne $obtenu) { Remove-Item $partiel -Force; throw "Empreinte de $nom différente de celle du serveur : archive rejetée." }
    Move-Item $partiel $cible
    $nouvelles++
    Note "Reçue : $nom ($([math]::Round((Get-Item $cible).Length / 1MB, 1)) Mo)"
  }

  # Alerte si la plus récente a plus de deux jours
  $derniere = Get-ChildItem $Dossier -Filter 'iam-*.tar.cms' | Sort-Object Name -Descending | Select-Object -First 1
  if ($derniere -and $derniere.LastWriteTime -lt (Get-Date).AddDays(-2)) { Note "ATTENTION : la dernière archive date du $($derniere.LastWriteTime.ToString('yyyy-MM-dd'))." }

  Get-ChildItem $Dossier -Filter 'iam-*.tar.cms' | Sort-Object Name -Descending | Select-Object -Skip $Garder | Remove-Item -Force
  if ($nouvelles -eq 0) { Note 'Rien de nouveau.' }
  Write-Output "$nouvelles archive(s) reçue(s) dans $Dossier"
} catch {
  Note "ÉCHEC : $($_.Exception.Message)"
  Write-Error $_
  exit 1
}
