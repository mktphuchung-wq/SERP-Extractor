# =============================================================================
#  AUTO SERP RESEARCH COLLECTOR - INSTALLER MOT DONG LENH
# =============================================================================
#
#  Cai tren MAY TRANG (chua co Git, chua co Node) - dan mot dong vao PowerShell:
#
#    Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/mktphuchung-wq/SERP-Extractor/main/install.ps1 | iex
#
#  Khong can cai truoc bat cu thu gi. Installer tu lo:
#    - Ma nguon : tai ZIP bang PowerShell co san cua Windows (khong can Git).
#                 May nao co Git san thi clone, vi sau nay "git pull" re hon.
#    - Node.js  : ban portable -> runtime\node\   (doi chieu SHA256)
#    - Chrome   : Chrome for Testing -> runtime\chrome\
#    - Extension: da nam san trong vendor\extensions\
#
#  Repo private thi them token:
#
#    $env:SERP_TOKEN='<github token>'; Set-ExecutionPolicy Bypass -Scope Process -Force; irm -Headers @{Authorization="Bearer $env:SERP_TOKEN"} https://raw.githubusercontent.com/mktphuchung-wq/SERP-Extractor/main/install.ps1 | iex
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
# Chay lenh ngoai (git, tar, node) mot cach an toan
# -----------------------------------------------------------------------------
# Windows PowerShell 5.1 bien MOI dong stderr cua lenh native thanh ErrorRecord.
# Voi $ErrorActionPreference='Stop' o dau file, do la loi DUNG HAN - ngay ca khi
# lenh tra ve exit code 0. Ma git ghi tien trinh binh thuong ra stderr:
#
#   git : From https://github.com/<owner>/<repo>
#   + git pull --ff-only 2>&1 | Out-Null
#   + FullyQualifiedErrorId : NativeCommandError
#
# tuc la mot lan "git pull" thanh cong van lam sap ca installer.
#
# Vi vay: khong bat exception quanh lenh native, ma ha $ErrorActionPreference
# xuong 'Continue' trong luc chay roi xet $LASTEXITCODE - do moi la nguon su that
# duy nhat ve viec lenh do thanh cong hay khong.
function Invoke-Native([scriptblock]$Command) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Command } finally { $ErrorActionPreference = $prev }
}

# Nhu tren nhung NUOT toan bo dau ra va tra ve duoi dang chuoi, de goi y in lai
# khi that bai. Dung cho git/tar - nhung lenh ghi tien trinh ra stderr.
#
# Ly do gop "2>&1" voi EAP='Continue': khi stdout cua PowerShell bi redirect
# (chay tu script khac, tu CI, tu INSTALL.bat co pipe), stderr cua lenh native
# hien thanh khoi chu do "FullyQualifiedErrorId : NativeCommandError" ngay ca luc
# lenh chay dung. Doi chung thanh du lieu trong pipeline thi man hinh sach, va
# ta chu dong in lai khi $LASTEXITCODE khac 0.
function Invoke-NativeQuiet([scriptblock]$Command) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Command 2>&1 | ForEach-Object { $_.ToString() } }
  finally { $ErrorActionPreference = $prev }
}

function Write-NativeLog($lines) {
  foreach ($line in @($lines)) {
    if ($line -and $line.Trim()) { Write-Host "       $line" -ForegroundColor DarkGray }
  }
}

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
# Thu muc do repo quan ly. Cap nhat bang ZIP se XOA roi chep lai nhung thu muc nay
# de file da bi go tren repo khong con sot lai. Moi thu khac (runtime, node_modules,
# output, logs, config\local.yaml) khong dong toi.
$SourceDirs = @('src', 'scripts', 'tools', 'config', 'vendor', 'tests')

function Expand-Zip($zipPath, $destDir) {
  New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  # tar.exe co san tu Windows 10 1803 va nhanh hon Expand-Archive nhieu lan.
  $tar = Get-Command tar -ErrorAction SilentlyContinue
  if ($tar) {
    Invoke-NativeQuiet { & tar -xf $zipPath -C $destDir } | Out-Null
    if ($LASTEXITCODE -eq 0) { return }
    Write-Warn2 'tar giai nen khong duoc - dung Expand-Archive.'
  }
  Expand-Archive -LiteralPath $zipPath -DestinationPath $destDir -Force
}

# Tai ma nguon dang ZIP. Day la duong KHONG CAN GIT: chi dung Invoke-WebRequest va
# tar/Expand-Archive - ca hai deu co san tren Windows 10/11 sach.
function Get-SourceZip($dir, [switch]$IsUpdate) {
  $zip = Join-Path $env:TEMP "serp-extractor-$Branch-$([Guid]::NewGuid().ToString('N')).zip"
  $tmp = "$zip.dir"

  if ($Token) {
    # Repo private: bat buoc di qua API kem token.
    Write-Step "Tai ma nguon (ZIP qua GitHub API, repo $Repo, nhanh $Branch)..."
    Invoke-WebRequest -Uri "https://api.github.com/repos/$Repo/zipball/$Branch" `
      -Headers @{ Authorization = "Bearer $Token"; 'User-Agent' = 'serp-installer' } `
      -OutFile $zip -UseBasicParsing
  } else {
    # Repo public: khong can token, khong can Git, khong can gi ca.
    Write-Step "Tai ma nguon (ZIP, repo $Repo, nhanh $Branch)..."
    try {
      Invoke-WebRequest -Uri "https://codeload.github.com/$Repo/zip/refs/heads/$Branch" `
        -OutFile $zip -UseBasicParsing
    } catch {
      throw @"
Khong tai duoc ma nguon tu https://github.com/$Repo (nhanh $Branch).
Neu repo la private, dat token truoc roi chay lai:
  `$env:SERP_TOKEN='<github token>'
Chi tiet: $($_.Exception.Message)
"@
    }
  }

  try {
    Expand-Zip $zip $tmp
    # GitHub goi toan bo repo trong mot thu muc con dang OWNER-REPO-<ref>.
    $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
    if (-not $inner) { throw 'File ZIP tai ve khong dung dinh dang cua GitHub.' }

    New-Item -ItemType Directory -Force -Path $dir | Out-Null

    if ($IsUpdate) {
      # Giu lai cau hinh rieng cua nguoi dung truoc khi thay thu muc config.
      $localCfg = Join-Path $dir 'config\local.yaml'
      $keepCfg = if (Test-Path $localCfg) { Get-Content $localCfg -Raw } else { $null }

      foreach ($sub in $SourceDirs) {
        $target = Join-Path $dir $sub
        if (Test-Path $target) { Remove-Item $target -Recurse -Force }
      }
      Copy-Item (Join-Path $inner.FullName '*') $dir -Recurse -Force

      if ($null -ne $keepCfg) { Set-Content -LiteralPath $localCfg -Value $keepCfg -Encoding UTF8 }
      Write-Ok "Da cap nhat ma nguon tai $dir"
    } else {
      Copy-Item (Join-Path $inner.FullName '*') $dir -Recurse -Force
      Write-Ok "Da tai ma nguon ve $dir"
    }
  } finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
  }
}

function Get-Source($dir) {
  if ($Repo -like '*<OWNER>*') {
    throw "Chua cau hinh repo. Sua bien `$DefaultRepo trong install.ps1, hoac dat `$env:SERP_REPO='owner/repo'."
  }

  $hasSource = Test-Path (Join-Path $dir 'package.json')
  $isGitRepo = Test-Path (Join-Path $dir '.git')
  $git = Get-Command git -ErrorAction SilentlyContinue

  # --- Da co ban cai san: cap nhat tai cho ---------------------------------
  if ($hasSource) {
    Write-Ok "Da co ma nguon tai $dir"
    if ($isGitRepo -and $git) {
      Write-Step 'Cap nhat tu GitHub (git pull)...'
      Push-Location $dir
      try {
        # Khong redirect stderr cua git (xem ghi chu o Invoke-Native): de no in
        # thang ra man hinh, va chi xet $LASTEXITCODE.
        $log = Invoke-NativeQuiet { git pull --ff-only }
        if ($LASTEXITCODE -eq 0) {
          Write-Ok 'Da cap nhat.'
        } else {
          Write-Warn2 "Khong pull duoc (git exit $LASTEXITCODE) - dung ban dang co."
          Write-NativeLog $log
        }
      } finally { Pop-Location }
      return
    }
    if ($isGitRepo) {
      Write-Warn2 'Thu muc la git repo nhung may khong co Git - bo qua buoc cap nhat.'
      return
    }
    # Cai lan dau bang ZIP thi cap nhat cung bang ZIP (khoang 1,5 MB).
    Get-SourceZip $dir -IsUpdate
    return
  }

  # --- Cai moi -------------------------------------------------------------
  # Co Git thi clone, vi sau nay cap nhat bang git pull re hon (vai KB).
  if ($git) {
    Write-Step "git clone https://github.com/$Repo (nhanh $Branch)..."
    $url = "https://github.com/$Repo.git"
    if ($Token) { $url = "https://x-access-token:$Token@github.com/$Repo.git" }

    # Clone ra thu muc TAM roi moi chep vao. Clone thang vao $dir se hong khi thu
    # muc do da ton tai va khong rong ("destination path already exists and is not
    # an empty directory") - hay gap khi lan cai truoc dut giua chung va da de lai
    # runtime\ nang 230 MB. Chep vao thi giu nguyen nhung gi da tai.
    $tmpClone = Join-Path $env:TEMP "serp-clone-$([Guid]::NewGuid().ToString('N'))"
    $log = Invoke-NativeQuiet { git clone --depth 1 --branch $Branch $url $tmpClone }

    if ($LASTEXITCODE -eq 0) {
      try {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        # -Force de lay ca muc an, nhat la thu muc .git
        Get-ChildItem -LiteralPath $tmpClone -Force | Copy-Item -Destination $dir -Recurse -Force
      } finally {
        Remove-Item $tmpClone -Recurse -Force -ErrorAction SilentlyContinue
      }
      Write-Ok "Da tai ma nguon ve $dir"
      return
    }

    Remove-Item $tmpClone -Recurse -Force -ErrorAction SilentlyContinue
    Write-Warn2 "git clone that bai (exit $LASTEXITCODE) - chuyen sang tai ZIP."
    Write-NativeLog $log
  }

  # May trang chua cai Git: van chay duoc, chi can PowerShell co san cua Windows.
  Get-SourceZip $dir
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
    $have = (Invoke-NativeQuiet { & $nodeExe -v } | Select-Object -First 1).TrimStart('v')
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
  Expand-Zip $zipPath $tmp
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
  Invoke-Native { & $nodeExe 'scripts\bootstrap.mjs' }
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
