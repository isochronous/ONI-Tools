# ONI Loops

A small web app for [Oxygen Not Included](https://www.klei.com/games/oxygen-not-included): pick a resource you want more of, say what your colony has (DLCs, which asteroid, which geysers and critters, which critters), and get every way to get more of it: loops that bring it back to itself first (net-positive, then "top-up" loops above a floor you set), then every process that makes it, with each input rated renewable / finite on your asteroid / on another planetoid / space material / no source. Loops where the target only rides along a machine that mostly eats something else are marked side-stream and listed last.

Live: https://isochronous.github.io/oni-loops/

## Layout

- `app/`: the site (Vue 3, TypeScript, Vite). `npm install && npm run dev` to work on it.
- `tools/OniDataDump/`: a local-only game mod that writes `oni-data-dump.json` (every material conversion the game defines, with DLC restrictions) when the main menu opens. Built like the other isochronous mods via the `common/` submodule.
- `data/`: the dumped JSON the app ships with, one file per game build and DLC set (`<build>-all-dlcs.json` with Spaced Out!, `<build>-no-spaced-out.json` without; the content packs only add things and are filtered in the app). Import a fresh dump with `python tools/import-dump.py`. Note that the game enables mods per DLC mode, so the dump mod has to be enabled once in the Mods menu after switching Spaced Out! on or off.

The game data is read from the running game rather than from the source, because many conversions (critter diets, geysers, worldgen) only exist once the game has built them, and that is also where the DLC gating is authoritative.
