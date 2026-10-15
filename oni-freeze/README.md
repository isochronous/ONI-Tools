# oni-freeze

Keep playing a specific Oxygen Not Included build with a specific set of mods, side by side with the
normal auto-updating Steam install.

How it works:

- `Documents\Klei\OxygenNotIncluded` (saves, mods, mods.json, configs) becomes a directory junction.
  The Steam-managed data lives in `OxygenNotIncluded.live`; each frozen profile in `OxygenNotIncluded.<name>`.
  The game hard-codes that path (`Util.RootFolder`), so swapping the junction is the only way to give each
  build its own data.
- Each frozen build is a copy of the game folder outside any Steam library, with a `steam_appid.txt` so the
  game's `SteamAPI.RestartAppIfNecessary` call does not bounce the launch back to the Steam-managed install.
  Steam still has to be running (the game exits if `SteamAPI.Init` fails).
- Enabled Workshop mods are copied into the profile's `mods\local` folder, which the game never updates,
  and the Workshop entries are disabled in that profile's mods.json. Load order is preserved.
- `build-manifest.json` in each frozen copy records the depot/manifest ids so the exact build can be
  re-downloaded with DepotDownloader if the copy is ever lost.

Scripts (run with `pwsh -ExecutionPolicy Bypass -File ...`):

| Script | Purpose |
|---|---|
| `New-OniProfile.ps1 [-Name x] [-GameRoot F:\ONI-Frozen]` | Freeze the installed build + enabled mods as profile `x` (default name = Steam build id). |
| `Start-Oni.ps1 -Profile x` | Swap to profile `x`, run its frozen exe, swap back to live when the game exits. |
| `Start-Oni.ps1 -Live` | Swap to the live profile and launch through Steam. |
| `Start-Oni.ps1 -List` | Show profiles and the junction's current target. |

First run: converting `Documents\Klei\OxygenNotIncluded` into a junction renames the folder, which Windows
refuses while any program has a file or folder inside it open (an editor with a mod config open, an image
viewer on a colony screenshot, an Explorer window). `New-OniProfile.ps1` defers that step with a warning and
`Start-Oni.ps1` retries it; close such programs and the game first. Sysinternals `handle64.exe <path>` lists
the offenders.

Rules:

- Never run the live game while the junction points at a frozen profile. `Start-Oni.ps1` always restores
  the junction on exit; if it crashed mid-game, run `Start-Oni.ps1 -Live` once to reset.
- Saves made in a frozen profile must stay there. Loading them in a newer build upgrades them.
- Keep frozen-profile saves local (not Steam Cloud), or they will show up in the live install.
- Workshop mods still appear in a frozen profile's mod list (subscriptions are account-wide); leave them
  disabled there. The local copies carry the same staticID, so mod configs keep working.
