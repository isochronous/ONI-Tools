# Shared helpers for the ONI freeze scripts. Dot-source this file.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:OniAppId      = 457140
$script:KleiRoot      = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Klei'
$script:ProfileLink   = Join-Path $KleiRoot 'OxygenNotIncluded'          # what the game reads
$script:LiveProfile   = Join-Path $KleiRoot 'OxygenNotIncluded.live'     # the Steam-managed profile
$script:FreezeRoot    = Join-Path $PSScriptRoot 'profiles'               # per-profile metadata (profile.json)

function Get-SteamRoot {
    $r = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue).SteamPath
    if (-not $r) { $r = 'C:\Program Files (x86)\Steam' }
    return ($r -replace '/', '\')
}

function Get-OniLibrary {
    # Returns the steamapps folder that holds appmanifest_457140.acf
    $vdf = Join-Path (Get-SteamRoot) 'steamapps\libraryfolders.vdf'
    $paths = Select-String -Path $vdf -Pattern '"path"\s+"([^"]+)"' | ForEach-Object { $_.Matches[0].Groups[1].Value -replace '\\{2,}', '\' }
    foreach ($p in $paths) {
        $acf = Join-Path $p "steamapps\appmanifest_$OniAppId.acf"
        if (Test-Path $acf) { return (Join-Path $p 'steamapps') }
    }
    throw "No Steam library contains appmanifest_$OniAppId.acf"
}

function Read-AppManifest {
    param([string]$SteamApps)
    $text = Get-Content (Join-Path $SteamApps "appmanifest_$OniAppId.acf") -Raw
    $build = [regex]::Match($text, '"buildid"\s+"(\d+)"').Groups[1].Value
    $installDir = [regex]::Match($text, '"installdir"\s+"([^"]+)"').Groups[1].Value
    $depots = @()
    foreach ($m in [regex]::Matches($text, '"(\d+)"\s*\{\s*"manifest"\s+"(\d+)"\s*"size"\s+"(\d+)"(?:\s*"dlcappid"\s+"(\d+)")?')) {
        $depots += [ordered]@{
            depot    = [long]$m.Groups[1].Value
            manifest = $m.Groups[2].Value
            size     = [long]$m.Groups[3].Value
            dlcAppId = if ($m.Groups[4].Success) { [long]$m.Groups[4].Value } else { $null }
        }
    }
    return [ordered]@{
        appId      = $OniAppId
        buildId    = [long]$build
        gameDir    = Join-Path $SteamApps "common\$installDir"
        depots     = $depots
    }
}

function Test-OniRunning {
    return [bool](Get-Process -Name 'OxygenNotIncluded', 'Restarter' -ErrorAction SilentlyContinue)
}

function Assert-OniNotRunning {
    if (Test-OniRunning) { throw 'Oxygen Not Included (or its Restarter) is running. Close it first.' }
}

function Get-JunctionTarget {
    param([string]$Path)
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    if ($item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return $item.Target }
    return $null
}

function Initialize-ProfileLink {
    # Converts Documents\Klei\OxygenNotIncluded into a junction -> OxygenNotIncluded.live. Idempotent.
    if (Get-JunctionTarget $ProfileLink) { return }
    Assert-OniNotRunning
    if (-not (Test-Path $ProfileLink)) { throw "No ONI user folder at $ProfileLink" }
    if (Test-Path $LiveProfile) { throw "$LiveProfile already exists but $ProfileLink is a real folder; resolve by hand." }
    Write-Host "Renaming $ProfileLink -> $LiveProfile and replacing it with a junction"
    try {
        Rename-Item -LiteralPath $ProfileLink -NewName (Split-Path $LiveProfile -Leaf)
    } catch {
        throw "Could not rename $ProfileLink. Some program has a file or folder inside it open (editors, image viewers, Explorer windows). Close them and run Start-Oni.ps1 again. Underlying error: $($_.Exception.Message)"
    }
    New-Item -ItemType Junction -Path $ProfileLink -Target $LiveProfile | Out-Null
}

function Get-LiveSource {
    # The live user folder: OxygenNotIncluded.live once the junction exists, else the plain folder.
    if (Get-JunctionTarget $ProfileLink) { return $LiveProfile }
    return $ProfileLink
}

function Set-ProfileLink {
    param([string]$Target)
    if (-not (Test-Path $Target)) { throw "Profile folder $Target does not exist" }
    $current = Get-JunctionTarget $ProfileLink
    if ($null -eq $current) { throw "$ProfileLink is not a junction; run New-OniProfile.ps1 once to set it up." }
    if ($current.TrimEnd('\') -ieq $Target.TrimEnd('\')) { return }
    Assert-OniNotRunning
    (Get-Item -LiteralPath $ProfileLink -Force).Delete()   # removes the junction only, never its contents
    New-Item -ItemType Junction -Path $ProfileLink -Target $Target | Out-Null
}

function Get-DotNetStringHash {
    # Mono/.NET Framework legacy non-randomized string hash; the game uses it as a local mod's label.version.
    param([string]$s)
    [uint64]$mask = 4294967295
    [uint64]$h1 = 5381; [uint64]$h2 = 5381
    $cs = [int[]][char[]]$s + 0 + 0
    $i = 0
    while ($cs[$i] -ne 0) {
        $h1 = ((($h1 -shl 5) + $h1) -bxor [uint64]$cs[$i]) -band $mask
        if ($cs[$i + 1] -eq 0) { break }
        $h2 = ((($h2 -shl 5) + $h2) -bxor [uint64]$cs[$i + 1]) -band $mask
        $i += 2
    }
    [uint64]$r = ($h1 + (($h2 * 1566083941) -band $mask)) -band $mask
    return [BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]$r), 0)
}

function Get-ProfileRecord {
    param([string]$Name)
    $f = Join-Path $FreezeRoot "$Name.json"
    if (-not (Test-Path $f)) { throw "Unknown profile '$Name' (no $f)" }
    return Get-Content $f -Raw | ConvertFrom-Json
}
