# IAM Technology — ouvre une archive chiffrée, contrôle son contenu, puis efface la copie en clair.
#   .\verifier.ps1                       contrôle la dernière archive reçue
#   .\verifier.ps1 -Archive <fichier>    contrôle celle-là
#   .\verifier.ps1 -Garder <dossier>     laisse le contenu en clair dans ce dossier (pour restaurer) — à effacer ensuite
param(
  [string]$Archive,
  [string]$Dossier = (Join-Path $env:USERPROFILE 'IAM-Sauvegardes'),
  [string]$Cle = (Join-Path $env:USERPROFILE '.iam-sauvegardes\depot.key'),
  [string]$Garder
)
$ErrorActionPreference = 'Stop'
$openssl = 'C:\Program Files\Git\usr\bin\openssl.exe'
if (-not (Test-Path $openssl)) { $openssl = (Get-Command openssl).Source }
if (-not $Archive) { $Archive = (Get-ChildItem $Dossier -Filter 'iam-*.tar.cms' | Sort-Object Name -Descending | Select-Object -First 1).FullName }
if (-not $Archive -or -not (Test-Path $Archive)) { throw 'Aucune archive à contrôler.' }
if (-not (Test-Path $Cle)) { throw "Clé privée absente : $Cle" }

$clair = if ($Garder) { New-Item -ItemType Directory -Force -Path $Garder | Select-Object -ExpandProperty FullName } else { Join-Path $env:TEMP ("iam-controle-" + [guid]::NewGuid().ToString('N')) }
New-Item -ItemType Directory -Force -Path $clair | Out-Null
$tar = Join-Path $clair 'archive.tar'
try {
  & $openssl cms -decrypt -binary -inform DER -in $Archive -inkey $Cle -out $tar
  if ($LASTEXITCODE -ne 0) { throw 'Déchiffrement impossible : mauvaise clé ou archive abîmée.' }
  & "$env:SystemRoot\System32\tar.exe" -xf $tar -C $clair
  if ($LASTEXITCODE -ne 0) { throw 'Archive illisible.' }
  Remove-Item $tar -Force

  $defauts = 0
  foreach ($ligne in Get-Content (Join-Path $clair 'SHA256SUMS')) {
    $attendu, $chemin = $ligne -split '\s+', 2
    $fichier = Join-Path $clair ($chemin.TrimStart('*').TrimStart('.', '/'))
    if (-not (Test-Path $fichier) -or (Get-FileHash -Algorithm SHA256 $fichier).Hash.ToLower() -ne $attendu) { Write-Warning "Fichier abîmé ou absent : $chemin"; $defauts++ }
  }
  Write-Output ("Archive : {0}" -f (Split-Path $Archive -Leaf))
  foreach ($logiciel in Get-ChildItem $clair -Directory | Sort-Object Name) {
    $bases = @(Get-ChildItem (Join-Path $logiciel.FullName 'bases') -Filter '*.dump' -ErrorAction SilentlyContinue)
    foreach ($b in $bases) {
      # Un export pg_dump au format « custom » commence par PGDMP
      $tete = New-Object byte[] 5; $flux = [IO.File]::OpenRead($b.FullName); [void]$flux.Read($tete, 0, 5); $flux.Close()
      if ([Text.Encoding]::ASCII.GetString($tete) -ne 'PGDMP') { Write-Warning "$($logiciel.Name) : $($b.Name) n'est pas un export PostgreSQL"; $defauts++ }
    }
    $cles = @(Get-ChildItem (Join-Path $logiciel.FullName 'cles') -File -ErrorAction SilentlyContinue)
    $taille = [math]::Round((($bases | Measure-Object Length -Sum).Sum) / 1MB, 2)
    Write-Output ("  {0,-16} {1,3} base(s), {2,8} Mo, {3} fichier(s) de clés" -f $logiciel.Name, $bases.Count, $taille, $cles.Count)
    if ($cles.Count -eq 0) { Write-Warning "$($logiciel.Name) : aucune clé dans l'archive" }
  }
  if ($defauts -gt 0) { throw "$defauts défaut(s) dans l'archive." }
  Write-Output 'Contrôle réussi : empreintes exactes, exports lisibles.'
} finally {
  if (-not $Garder) { Remove-Item $clair -Recurse -Force -ErrorAction SilentlyContinue }
  else { Write-Warning "Contenu en clair laissé dans $clair : effacez-le après la restauration." }
}
