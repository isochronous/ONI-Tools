# ONI Loops

A small web app for [Oxygen Not Included](https://www.klei.com/games/oxygen-not-included): pick a resource you want more of, answer a few questions about what your colony has access to (DLCs, critters, buildings), and get the ways to get more of it, ranked with resource-positive loops first.

Live: https://isochronous.github.io/oni-loops/

## Layout

- `app/`: the site (Vue 3, TypeScript, Vite). `npm install && npm run dev` to work on it.
- `tools/OniDataDump/`: a local-only game mod that writes `oni-data-dump.json` (every material conversion the game defines, with DLC restrictions) when the main menu opens. Built like the other isochronous mods via the `common/` submodule.
- `data/`: the dumped JSON the app ships with, one file per game build.

The game data is read from the running game rather than from the source, because many conversions (critter diets, geysers, worldgen) only exist once the game has built them, and that is also where the DLC gating is authoritative.
