/**
 * Reading a map seed: the game's coordinate ("V-SNDST-C-42-0-4A-MUWF1") run through a
 * reimplementation of the game's worldgen (@onimaxxing/worldgen, WASM) to find the asteroid
 * and the geysers and terrain features each of its worlds places. The engine is 11 MB, so it
 * loads on demand in a web worker and the page never waits on it; the result is a small summary
 * the colony store keeps.
 *
 * The engine is not the game: it is verified against captured maps by its author, but any
 * mismatch would be invisible here, so the counts it fills in stay editable and are labelled
 * as read from the seed.
 */

/** One world of the generated cluster, with what it places by the app's ids. */
export interface SeedWorld {
  /** The world id as the data set has it: "worlds/SandstoneDefault", "expansion1::worlds/TundraMoonlet". */
  id: string
  /** The world the colony starts on. */
  start: boolean
  /** Geysers by type id ("steam", "molten_iron"), with how many. */
  geysers: Record<string, number>
  /** Terrain features by prefab id ("OilWell"), with how many. */
  features: Record<string, number>
}

export interface SeedResult {
  /** The coordinate as read, upper-cased and trimmed. */
  coordinate: string
  /** The cluster id as the data set has it: "clusters/SandstoneDefault", "dlc2::clusters/CeresClassicCluster". */
  clusterId: string
  /** The game build the engine was baselined on, e.g. "737195". */
  engineBuild: string
  worlds: SeedWorld[]
}

/** What the page sends the worker. */
export interface SeedRequest {
  coordinate: string
  /** Prefab ids of the terrain features to count among the spawned entities. */
  featureIds: string[]
}

export type SeedReply = { ok: true; result: SeedResult } | { ok: false; error: string }

/**
 * Loosely the game's coordinate: a prefix of letters, digits and dashes, then the seed and
 * the three trailing fields. The engine checks it properly; this only stops obvious typos
 * from spinning the engine up.
 */
export function looksLikeCoordinate(text: string): boolean {
  return /^[A-Z0-9]+(-[A-Z0-9]+)*-\d+-\d+-[A-Z0-9]+-[A-Z0-9]+$/i.test(text.trim())
}

let worker: Worker | null = null
let next = 0
const pending = new Map<number, { resolve: (r: SeedResult) => void; reject: (e: Error) => void }>()

function engine(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<{ id: number } & SeedReply>) => {
    const call = pending.get(e.data.id)
    if (!call) return
    pending.delete(e.data.id)
    if (e.data.ok) call.resolve(e.data.result)
    else call.reject(new Error(e.data.error))
  }
  worker.onerror = (e) => {
    // The engine failed to load at all: fail every waiting call and start fresh next time.
    for (const call of pending.values())
      call.reject(new Error(e.message || 'worldgen engine failed'))
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

/** Generates the cluster for a coordinate and summarises what each world places. */
export function readSeed(coordinate: string, featureIds: string[]): Promise<SeedResult> {
  const request: SeedRequest = { coordinate: coordinate.trim().toUpperCase(), featureIds }
  return new Promise((resolve, reject) => {
    const id = ++next
    pending.set(id, { resolve, reject })
    engine().postMessage({ id, ...request })
  })
}
