import type { GameData } from './types'

/**
 * One data file per game build and DLC set. Spaced Out changes the game's systems (clusters
 * and rocket POIs instead of one asteroid and the Starmap), so it gets its own dump; the
 * content packs only add things and are filtered inside a data set.
 */
export interface DataSet {
  id: string
  /** Shown next to the build number. */
  name: string
  spacedOut: boolean
  load: () => Promise<{ default: unknown }>
}

export const DATASETS: DataSet[] = [
  { id: 'all-dlcs', name: 'Spaced Out! + all content packs', spacedOut: true, load: () => import('../../../data/U59-744825-all-dlcs.json') },
  { id: 'no-spaced-out', name: 'base game + all content packs', spacedOut: false, load: () => import('../../../data/U59-744825-no-spaced-out.json') },
]

export const SPACED_OUT = 'EXPANSION1_ID'
const DATASET_KEY = 'oni-loops.dataset'

/** Remember which data set to load next time (the colony store reloads the page after this). */
export function chooseDataSet(spacedOut: boolean) {
  try {
    localStorage.setItem(DATASET_KEY, spacedOut ? 'all-dlcs' : 'no-spaced-out')
  } catch {
    /* storage may be unavailable */
  }
}

function chosenId(): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.ONI_LOOPS_DATASET
  if (env) return env
  try {
    return localStorage.getItem(DATASET_KEY) ?? 'all-dlcs'
  } catch {
    return 'all-dlcs'
  }
}

export const dataSet: DataSet = DATASETS.find((s) => s.id === chosenId()) ?? DATASETS[0]!

/** The game data for the chosen data set, loaded once per page load. */
export const gameData: GameData = (await dataSet.load()).default as GameData

const missing = new Set<string>()

/**
 * The game's display name for a tag. The UI must never show an internal id, so an
 * unknown tag is reported once in development and shown de-camel-cased as a last resort.
 */
export function label(tag: string): string {
  const name = gameData.names[tag]
  if (name) return name
  if (import.meta.env?.DEV && !missing.has(tag)) {
    missing.add(tag)
    console.warn(`[oni-loops] no display name for tag ${tag}`)
  }
  return tag.replace(/([a-z])([A-Z])/g, '$1 $2')
}
