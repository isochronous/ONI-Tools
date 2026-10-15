<#
.SYNOPSIS
  Launch Oxygen Not Included on a frozen profile (or the live Steam install), swapping the user-data junction.

.PARAMETER Profile
  Name of a profile created by New-OniProfile.ps1.
.PARAMETER Live
  Point the user-data junction at the live profile and launch through Steam.
.PARAMETER List
  Show the known profiles and which one the junction currently points at.
#>
[CmdletBinding(DefaultParameterSetName = 'Profile')]
param(
    [Parameter(ParameterSetName = 'Profile', Position = 0, Mandatory)][string]$Profile,
    [Parameter(ParameterSetName = 'Live')][switch]$Live,
    [Parameter(ParameterSetName = 'List')][switch]$List
)
. (Join-Path $PSScriptRoot 'OniFreeze.Common.ps1')

if ($List) {
    $current = Get-JunctionTarget $ProfileLink
    Write-Host "Junction $ProfileLink -> $current"
    Get-ChildItem $FreezeRoot -Filter *.json -ErrorAction SilentlyContinue | ForEach-Object {
        $r = Get-Content $_.FullName -Raw | ConvertFrom-Json
        $mark = if ($current -and ($current.TrimEnd('\') -ieq $r.profileDir.TrimEnd('\'))) { '*' } else { ' ' }
        "{0} {1,-20} build {2}  {3}" -f $mark, $r.name, $r.buildId, $r.gameDir
    }
    return
}

Assert-OniNotRunning
Initialize-ProfileLink   # no-op once the junction exists

if ($Live) {
    Set-ProfileLink $LiveProfile
    Write-Host "Junction -> live profile. Launching through Steam."
    Start-Process "steam://rungameid/$OniAppId"
    return
}

$record = Get-ProfileRecord $Profile
$exe = Join-Path $record.gameDir 'OxygenNotIncluded.exe'
if (-not (Test-Path $exe)) { throw "Frozen game copy missing: $exe" }

if (-not (Get-Process -Name steam -ErrorAction SilentlyContinue)) {
    Write-Host 'Steam is not running; starting it (the game refuses to run without it)...'
    Start-Process 'steam://open/main'
    $deadline = (Get-Date).AddSeconds(90)
    while (-not (Get-Process -Name steam -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep 2 }
    Start-Sleep 10
}

Set-ProfileLink $record.profileDir
Write-Host "Junction -> $($record.profileDir)"
Write-Host "Launching $exe (build $($record.buildId))"
try {
    Start-Process -FilePath $exe -WorkingDirectory $record.gameDir | Out-Null
    # The game may relaunch itself through Restarter.exe after mod changes; wait until it has been gone for a while.
    Start-Sleep 15
    $quietSince = $null
    while ($true) {
        if (Test-OniRunning) { $quietSince = $null }
        elseif ($null -eq $quietSince) { $quietSince = Get-Date }
        elseif (((Get-Date) - $quietSince).TotalSeconds -ge 20) { break }
        Start-Sleep 3
    }
}
finally {
    Set-ProfileLink $LiveProfile
    Write-Host 'Game closed. Junction -> live profile.'
}
