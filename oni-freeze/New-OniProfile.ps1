<#
.SYNOPSIS
  Freeze the currently installed Oxygen Not Included build plus the currently enabled mods into a named profile.

.DESCRIPTION
  - Turns Documents\Klei\OxygenNotIncluded into a junction (first run only); the real Steam-managed folder
    becomes OxygenNotIncluded.live.
  - Copies the Steam game folder to <GameRoot>\<Name> and drops a steam_appid.txt there so launching the
    copy directly does not bounce back to the Steam-managed install.
  - Records the depot/manifest IDs of this build so the exact same files can be re-downloaded later.
  - Copies the live user folder to OxygenNotIncluded.<Name> (cloud saves are merged into local save_files).
  - Copies every enabled Workshop mod into that profile's mods\local folder and rewrites mods.json so the
    local copies are enabled and the Workshop originals are disabled. Load order is preserved.

.PARAMETER Name
  Profile name. Defaults to the Steam build id of the installed game.
.PARAMETER GameRoot
  Folder that receives the frozen game copies. Defaults to <drive of the Steam library>\ONI-Frozen.
.PARAMETER SkipGameCopy
  Only create the user profile; reuse an existing game copy at <GameRoot>\<Name>.
#>
[CmdletBinding()]
param(
    [string]$Name,
    [string]$GameRoot,
    [switch]$SkipGameCopy
)
. (Join-Path $PSScriptRoot 'OniFreeze.Common.ps1')
trap { Write-Host "ERROR at:`n$($_.ScriptStackTrace)" -ForegroundColor Red; break }

if (Test-OniRunning) { Write-Warning 'ONI is running: the snapshot is taken anyway, but the junction setup at the end will be deferred until it is closed.' }
$steamApps = Get-OniLibrary
$manifest  = Read-AppManifest $steamApps
if (-not $Name)     { $Name = "$($manifest.buildId)" }
if (-not $GameRoot) { $GameRoot = Join-Path (Split-Path -Qualifier $steamApps) 'ONI-Frozen' }
if ($Name -match '[\\/:*?"<>|]') { throw "Profile name '$Name' contains characters that are not valid in a folder name" }

$gameTarget  = Join-Path $GameRoot $Name
$profileDir  = Join-Path $KleiRoot "OxygenNotIncluded.$Name"
$recordFile  = Join-Path $FreezeRoot "$Name.json"
if (Test-Path $recordFile)  { throw "Profile '$Name' already exists ($recordFile)" }
if (Test-Path $profileDir)  { throw "Profile folder $profileDir already exists" }

Write-Host "Freezing ONI build $($manifest.buildId) as profile '$Name'"
Write-Host "  game copy : $gameTarget"
Write-Host "  user data : $profileDir"

$liveSource = Get-LiveSource

# 1. Game copy.
if (-not $SkipGameCopy) {
    Write-Host "Copying game folder from $($manifest.gameDir) (this takes a few minutes)..."
    New-Item -ItemType Directory -Force $gameTarget | Out-Null
    robocopy $manifest.gameDir $gameTarget /E /XD CurrentVersionBackup /XF *.dmp debug.log /R:2 /W:2 /NFL /NDL /NJH /NP | Out-Host
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }
} elseif (-not (Test-Path (Join-Path $gameTarget 'OxygenNotIncluded.exe'))) {
    throw "-SkipGameCopy given but $gameTarget has no OxygenNotIncluded.exe"
}
Set-Content -Path (Join-Path $gameTarget 'steam_appid.txt') -Value "$OniAppId" -NoNewline -Encoding ascii
$manifest | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $gameTarget 'build-manifest.json') -Encoding utf8
@"
This folder is a frozen copy of Oxygen Not Included, Steam build $($manifest.buildId).
Launch it with Start-Oni.ps1 -Profile $Name (never through Steam). Steam must be running.

To rebuild this exact version from Steam later, download every depot in build-manifest.json at the
recorded manifest id, e.g. with DepotDownloader (https://github.com/SteamRE/DepotDownloader):

  DepotDownloader -app $OniAppId -depot <depot> -manifest <manifest> -username <steam user> -dir .

then put steam_appid.txt (containing $OniAppId) next to OxygenNotIncluded.exe.
"@ | Set-Content (Join-Path $gameTarget 'README-frozen.txt') -Encoding utf8

# 2. User profile copy (everything except Steam cloud saves, which are merged into save_files instead).
Write-Host "Copying user data from $liveSource ..."
New-Item -ItemType Directory -Force $profileDir | Out-Null
robocopy $liveSource $profileDir /E /XD cloud_save_files /R:2 /W:2 /NFL /NDL /NJH /NP | Out-Host
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }
$cloudRoot = Join-Path $liveSource 'cloud_save_files'
if (Test-Path $cloudRoot) {
    foreach ($acct in Get-ChildItem $cloudRoot -Directory) {
        foreach ($colony in Get-ChildItem $acct.FullName -Directory) {
            $dest = Join-Path $profileDir "save_files\$($colony.Name)"
            robocopy $colony.FullName $dest /E /XC /XN /XO /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
        }
    }
    Write-Host "Merged cloud saves into $profileDir\save_files (local-only in this profile)"
}

# 3. Freeze enabled Workshop mods as local mods.
$modsDir   = Join-Path $profileDir 'mods'
$localDir  = Join-Path $modsDir 'local'
$modsJson  = Join-Path $modsDir 'mods.json'
New-Item -ItemType Directory -Force $localDir | Out-Null
$data = Get-Content $modsJson -Raw -Encoding utf8 | ConvertFrom-Json
$existingLocal = @{}
foreach ($m in $data.mods) { if ($m.label.distribution_platform -eq 0) { $existingLocal[$m.staticID] = $m.label.id } }
$invalid = [regex]::Escape(-join [IO.Path]::GetInvalidFileNameChars())

$newList = New-Object System.Collections.ArrayList
$frozen = 0; $skipped = @()
foreach ($m in $data.mods) {
    [void]$newList.Add($m)
    if ($m.label.distribution_platform -ne 1 -or -not $m.enabledForDlc -or $m.enabledForDlc.Count -eq 0) { continue }
    $id = $m.label.id
    if ($existingLocal.ContainsKey($m.staticID)) {
        Write-Host "  skip  $($m.label.title): local mod '$($existingLocal[$m.staticID])' already provides staticID $($m.staticID)"
        $m.enabledForDlc = @()
        continue
    }
    $src = Join-Path $modsDir "Steam\$id"
    if (-not (Test-Path $src)) {
        $srcLive = Join-Path $liveSource "mods\Steam\$id"
        if (Test-Path $srcLive) { $src = $srcLive }
    }
    if (-not (Test-Path $src)) {
        Write-Warning "  $($m.label.title) ($id): no installed copy under mods\Steam; left as Workshop mod"
        $skipped += $m.label.title
        continue
    }
    $folder = ($m.label.title -replace "[$invalid]", '' -replace '\s+', ' ').Trim().TrimEnd('.')
    if (-not $folder) { $folder = "workshop_$id" }
    if (Test-Path -LiteralPath (Join-Path $localDir $folder)) { $folder = "$folder [$id]" }
    $dest = Join-Path $localDir $folder
    robocopy $src $dest /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed copying mod $id" }
    $yaml = Join-Path $dest 'mod.yaml'
    if (-not (Test-Path -LiteralPath $yaml)) {
        $t = $m.label.title -replace '"', '\"'
        "title: `"$t`"`ndescription: `"Frozen copy of Workshop item $id`"`nstaticID: $($m.staticID)`n" | Set-Content -LiteralPath $yaml -Encoding utf8
    }
    $entry = [ordered]@{
        label = [ordered]@{
            distribution_platform = 0
            id      = $folder
            title   = $m.label.title
            version = Get-DotNetStringHash $folder
        }
        status         = 1
        enabled        = $false
        enabledForDlc  = @($m.enabledForDlc)
        crash_count    = 0
        reinstall_path = $null
        staticID       = $m.staticID
    }
    $m.enabledForDlc = @()
    [void]$newList.Add([pscustomobject]$entry)
    $frozen++
}
$data.mods = $newList.ToArray()
Copy-Item $modsJson "$modsJson.before-freeze"
$json = $data | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText($modsJson, $json, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Froze $frozen Workshop mods into $localDir"
if ($skipped) { Write-Warning "Not frozen (still Workshop-sourced): $($skipped -join ', ')" }

# 4. Record the profile.
New-Item -ItemType Directory -Force $FreezeRoot | Out-Null
[ordered]@{
    name       = $Name
    buildId    = $manifest.buildId
    gameDir    = $gameTarget
    profileDir = $profileDir
    created    = (Get-Date).ToString('s')
    frozenMods = $frozen
} | ConvertTo-Json | Set-Content $recordFile -Encoding utf8

# 5. Make the Klei folder a junction we control (first run only), pointing at the live profile.
try {
    Initialize-ProfileLink
    Set-ProfileLink $LiveProfile
} catch {
    Write-Warning $_.Exception.Message
    Write-Warning "The profile is complete; only the junction setup is pending. Start-Oni.ps1 will retry it."
}
Write-Host ""
Write-Host "Done. Launch with:  pwsh $PSScriptRoot\Start-Oni.ps1 -Profile $Name"
Write-Host "Launch the normal Steam version with:  pwsh $PSScriptRoot\Start-Oni.ps1 -Live   (or just via Steam)"
