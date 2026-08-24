# =============================================================================
#  AUTO SERP RESEARCH COLLECTOR - INSTALLER MOT DONG LENH
# =============================================================================
#
#  Cai dat tren may moi:
#
#    $env:SERP_TOKEN='<github token>'; irm -Headers @{Authorization="Bearer $env:SERP_TOKEN"} `
#      https://raw.githubusercontent.com/mktphuchung-wq/SERP-Extractor/main/install.ps1 | iex
#
#  Hoac neu may da co Git va da dang nhap GitHub:
#
#    irm https://raw.githubusercontent.com/mktphuchung-wq/SERP-Extractor/main/install.ps1 | iex
#
#  Hoac chay tu ban da tai ve san (offline / USB):
#
#    .\INSTALL.bat
#
#  Bien moi truong dieu chinh duoc:
#    SERP_REPO    OWNER/REPO tren GitHub          (mac dinh: hang $Repo ben duoi)
#    SERP_BRANCH  nhanh can lay                   (mac dinh: main)
#    SERP_DIR     thu muc cai dat                 (mac dinh: %USERPROFILE%\SERP-Extractor)
#    SERP_TOKEN   GitHub token cho repo private   (khong bat buoc neu dung Git)
#
#  Installer nay chi tai ve va cai dat. No KHONG dang nhap ho ban vao Google
#  hay Ahrefs va khong dong toi Chrome ca nhan cua ban.
# =============================================================================

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# --- Sua hang nay thanh repo cua ban ----------------------------------------
$DefaultRepo = 'mktphuchung-wq/SERP-Extractor'
# ----------------------------------------------------------------------------

$Repo   = if ($env:SERP_REPO)   { $env:SERP_REPO }   else { $DefaultRepo }
$Branch = if ($env:SERP_BRANCH) { $env:SERP_BRANCH } else { 'main' }
$Token  = $env:SERP_TOKEN

function Write-Head($text) {
  Write-Host ''
  Write-Host '============================================================' -ForegroundColor Cyan
  Write-Host "  $text" -ForegroundColor Cyan
  Write-Host '============================================================' -ForegroundColor Cyan
}
function Write-Step($text) { Write-Host "  > $text" -ForegroundColor White }
function Write-Ok($text)   { Write-Host "  [OK] $text" -ForegroundColor Green }
function Write-Warn2($text){ Write-Host "  [!]  $text" -ForegroundColor Yellow }

# -----------------------------------------------------------------------------
# 1. Xac dinh thu muc cai dat
# -----------------------------------------------------------------------------
function Resolve-InstallDir {
  # Truong hop A: file nay dang nam trong mot ban checkout san (chay .\INSTALL.bat)
  if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot 'package.json'))) {
    return (Resolve-Path $PSScriptRoot).Path
  }
  # Truong hop B: chay qua "irm ... | iex" - khong co $PSScriptRoot
  if ($env:SERP_DIR) { return $env:SERP_DIR }
  return (Join-Path $env:USERPROFILE 'SERP-Extractor')
}

# -----------------------------------------------------------------------------
# 2. Lay ma nguon
# -----------------------------------------------------------------------------
function Get-Source($dir) {
  if (Test-Path (Join-Path $dir 'package.json')) {
    Write-Ok "Da co ma nguon tai $dir"
    if ((Test-Path (Join-Path $dir '.git')) -and (Get-Command git -ErrorAction SilentlyContinue)) {
      Write-Step 'Cap nhat tu GitHub (git pull)...'
      Push-Location $dir
      try { git pull --ff-only 2>&1 | Out-Null; Write-Ok 'Da cap nhat.' }
      catch { Write-Warn2 'Khong pull duoc - dung ban dang co.' }
      finally { Pop-Location }
    }
    return
  }

  if ($Repo -like '*<OWNER>*') {
    throw "Chua cau hinh repo. Sua bien `$DefaultRepo trong install.ps1, hoac dat `$env:SERP_REPO='owner/repo'."
  }

  $git = Get-Command git -ErrorAction SilentlyContinue
  if ($git) {
    Write-Step "git clone https://github.com/$Repo (nhanh $Branch)..."
    $url = "https://github.com/$Repo.git"
    if ($Token) { $url = "https://x-access-token:$Token@github.com/$Repo.git" }
    git clone --depth 1 --branch $Branch $url $dir
    if ($LASTEXITCODE -ne 0) { throw "git clone that bai. Kiem tra quyen truy cap repo $Repo." }
    Write-Ok "Da tai ma nguon ve $dir"
    return
  }

  if (-not $Token) {
    throw @"
May nay chua cai Git va cung khong co token.
Chon mot trong hai:
  - Cai Git for Windows: https://git-scm.com/download/win  roi chay lai lenh nay
  - Hoac dat token truoc:  `$env:SERP_TOKEN='<github token>'
"@
  }

  Write-Step "Tai ZIP tu GitHub API (repo $Repo, nhanh $Branch)..."
  $zip = Join-Path $env:TEMP "serp-extractor-$Branch.zip"
  Invoke-WebRequest -Uri "https://api.github.com/repos/$Repo/zipball/$Branch" `
    -Headers @{ Authorization = "Bearer $Token"; 'User-Agent' = 'serp-installer' } `
    -OutFile $zip
  $tmp = Join-Path $env:TEMP "serp-extractor-unzip-$([Guid]::NewGuid().ToString('N'))"
  Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
  # GitHub goi zip trong mot thu muc con dang OWNER-REPO-<sha>
  $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Copy-Item (Join-Path $inner.FullName '*') $dir -Recurse -Force
  Remove-Item $tmp -Recurse -Force
  Remove-Item $zip -Force
  Write-Ok "Da tai ma nguon ve $dir"
}

# -----------------------------------------------------------------------------
# 3. Node portable trong runtime\node
# -----------------------------------------------------------------------------
function Install-PortableNode($dir) {
  $runtimeJson = Join-Path $dir 'config\runtime.json'
  $pins = Get-Content $runtimeJson -Raw | ConvertFrom-Json
  $version = $pins.node.version
  $nodeDir = Join-Path $dir 'runtime\node'
  $nodeExe = Join-Path $nodeDir 'node.exe'

  if (Test-Path $nodeExe) {
    $have = (& $nodeExe -v).TrimStart('v')
    if ($have -eq $version) { Write-Ok "Node portable v$version da co."; return $nodeExe }
    Write-Step "Node portable doi phien ban: v$have -> v$version"
    Remove-Item $nodeDir -Recurse -Force
  }

  $pkg = "node-v$version-win-x64"
  $zipUrl = "https://nodejs.org/dist/v$version/$pkg.zip"
  $zipPath = Join-Path $env:TEMP "$pkg.zip"

  Write-Step "Tai Node v$version (khoang 30 MB)..."
  Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing

  Write-Step 'Doi chieu SHA256 voi SHASUMS256.txt cua nodejs.org...'
  $sums = (Invoke-WebRequest -Uri "https://nodejs.org/dist/v$version/SHASUMS256.txt" -UseBasicParsing).Content
  $expected = ($sums -split "`n" | Where-Object { $_ -match [regex]::Escape("$pkg.zip") } | Select-Object -First 1).Split(' ')[0]
  $actual = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLower()
  if (-not $expected) { throw "Khong tim thay hash cua $pkg.zip trong SHASUMS256.txt." }
  if ($actual -ne $expected.ToLower()) {
    Remove-Item $zipPath -Force
    throw "SHA256 cua Node khong khop (cho $expected, nhan $actual). Da xoa file tai ve."
  }
  Write-Ok 'SHA256 khop.'

  $tmp = Join-Path $env:TEMP "node-unzip-$([Guid]::NewGuid().ToString('N'))"
  Expand-Archive -LiteralPath $zipPath -DestinationPath $tmp -Force
  New-Item -ItemType Directory -Force -Path (Split-Path $nodeDir) | Out-Null
  Move-Item (Join-Path $tmp $pkg) $nodeDir
  Remove-Item $tmp -Recurse -Force
  Remove-Item $zipPath -Force

  if (-not (Test-Path $nodeExe)) { throw "Giai nen xong nhung khong thay $nodeExe." }
  Write-Ok "Node portable v$version san sang (khong dung Node he thong)."
  return $nodeExe
}

# -----------------------------------------------------------------------------
# 4. Loi tat ngoai Desktop
# -----------------------------------------------------------------------------
function New-Shortcuts($dir) {
  try {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shell = New-Object -ComObject WScript.Shell
    foreach ($item in @(
      @{ Name = 'SERP Extractor.lnk';        Target = 'RUN.bat' },
      @{ Name = 'SERP Extractor - Chrome.lnk'; Target = 'OPEN_CHROME.bat' }
    )) {
      $lnk = $shell.CreateShortcut((Join-Path $desktop $item.Name))
      $lnk.TargetPath = Join-Path $dir $item.Target
      $lnk.WorkingDirectory = $dir
      $lnk.Save()
    }
    Write-Ok 'Da tao loi tat tren Desktop.'
  } catch {
    Write-Warn2 "Khong tao duoc loi tat Desktop: $($_.Exception.Message)"
  }
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
Write-Head 'AUTO SERP RESEARCH COLLECTOR - CAI DAT'

$dir = Resolve-InstallDir
Write-Host "  Thu muc cai dat: $dir"
Write-Host ''

Get-Source $dir
$nodeExe = Install-PortableNode $dir

Write-Step 'Chay bootstrap (npm install + Chrome for Testing + kiem tra extension)...'
Push-Location $dir
try {
  & $nodeExe 'scripts\bootstrap.mjs'
  if ($LASTEXITCODE -ne 0) { throw "bootstrap that bai (exit $LASTEXITCODE)." }
} finally {
  Pop-Location
}

New-Shortcuts $dir

Write-Head 'XONG'
Write-Host ''
Write-Host "  Thu muc: $dir" -ForegroundColor White
Write-Host ''
Write-Host '  Buoc cuoi, chi lam mot lan tren may nay:' -ForegroundColor Yellow
Write-Host '    1. Chay OPEN_CHROME.bat' -ForegroundColor Yellow
Write-Host '    2. Dang nhap Google va Ahrefs trong cua so do' -ForegroundColor Yellow
Write-Host '    3. Dong cua so lai' -ForegroundColor Yellow
Write-Host ''
Write-Host '  Sau do: chay RUN.bat (hoac loi tat "SERP Extractor" tren Desktop).' -ForegroundColor White
Write-Host ''
