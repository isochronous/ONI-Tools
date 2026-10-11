<#
.SYNOPSIS
  Re-dump the game data in both modes (Spaced Out on, then off) with the OniDataDump mod, via ModTest.
  Build the mod first (dotnet build tools/OniDataDump -c Release), then run this and import with
  tools/import-dump.py. Launches the game twice; kplayerprefs.yaml is restored afterwards.
#>
$ErrorActionPreference = 'Stop'
$klei = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Klei\OxygenNotIncluded'
$prefs = Join-Path $klei 'kplayerprefs.yaml'
$modtest = 'C:\dev\ONI-Mods\oni-mods-common\tools\ModTest\Test-OniMods.ps1'
$orig = Get-Content $prefs -Raw
function Set-Mode([int]$on) {
    $t = Get-Content $prefs -Raw
    $t = [regex]::Replace($t, '(?m)^(\s*EXPANSION1_ID\.ENABLED:\s*)\d+', ('${1}' + $on))
    [IO.File]::WriteAllText($prefs, $t)
}
try {
  foreach ($mode in @(@{on=1; flavour='all-dlcs'}, @{on=0; flavour='no-spaced-out'})) {
    $out = Join-Path $klei ("oni-data-dump." + $mode.flavour + ".json")
    if (Test-Path $out) { Remove-Item $out -Force }
    Set-Mode $mode.on
    "[$(Get-Date -Format HH:mm:ss)] mode EXPANSION1=$($mode.on) -> expecting $out"
    $job = Start-Job -ScriptBlock { param($mt) & pwsh -NoProfile -ExecutionPolicy Bypass -File $mt -Only OniDataDump -KeepDumps 2>&1 } -ArgumentList $modtest
    $deadline = (Get-Date).AddMinutes(8)
    $seen = $false
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 5
        if ((Test-Path $out) -and ((Get-Item $out).Length -gt 100000)) {
            $log = Join-Path $env:USERPROFILE 'AppData\LocalLow\Klei\Oxygen Not Included\Player.log'
            if ((Test-Path $log) -and (Select-String -Path $log -Pattern 'OniDataDump\] Wrote icons' -Quiet)) { $seen = $true; break }
        }
        if ($job.State -ne 'Running') { "modtest job ended early"; break }
    }
    "[$(Get-Date -Format HH:mm:ss)] dump seen=$seen size=$(if (Test-Path $out) { (Get-Item $out).Length } else { 0 })"
    Get-Process OxygenNotIncluded -ErrorAction SilentlyContinue | Stop-Process -Force
    Wait-Job $job -Timeout 120 | Out-Null
    Receive-Job $job | ForEach-Object { "  modtest: $_" }
    Remove-Job $job -Force
  }
}
finally {
  [IO.File]::WriteAllText($prefs, $orig)
  "[$(Get-Date -Format HH:mm:ss)] prefs restored"
}
Get-ChildItem $klei -Filter 'oni-data-dump.*.json' | ForEach-Object { "$($_.Name) $($_.Length) $($_.LastWriteTime)" }
