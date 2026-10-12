/// <reference lib="webworker" />
/**
 * The worldgen engine, off the main thread. Only the serial WASM build is used: the parallel
 * one needs cross-origin isolation headers a static host does not send, and generating a
 * cluster takes well under a second either way. The glue is imported straight from the
 * package's serial build rather than its façade, which would also pull in the parallel build
 * and a YAML parser the page has no use for.
 */
import init, { game_version, generate_map_data } from '@onimaxxing/worldgen/serial/oni_wasm.js'
import wasmUrl from '@onimaxxing/worldgen/serial/oni_wasm_bg.wasm?url'
import type { SeedReply, SeedRequest, SeedResult, SeedWorld } from './seed'

/** The parts of the engine's MapData this worker reads; see the package's index.d.ts. */
interface MapData {
  cluster_id: string
  worlds: {
    name: string
    is_starting: boolean
    geysers: { type: string }[]
    other_entities?: { tag: string }[]
    buildings?: { tag: string }[]
  }[]
  failure: { message?: string } | string | null
}

let ready: Promise<void> | null = null

function load(): Promise<void> {
  ready ??= init({ module_or_path: wasmUrl }).then(() => undefined)
  return ready
}

function count(into: Record<string, number>, key: string) {
  into[key] = (into[key] ?? 0) + 1
}

function summarise(map: MapData, request: SeedRequest): SeedResult {
  const featureIds = new Set(request.featureIds)
  const worlds: SeedWorld[] = map.worlds.map((w) => {
    const geysers: Record<string, number> = {}
    for (const g of w.geysers) count(geysers, g.type)
    const features: Record<string, number> = {}
    // Terrain features are template-placed entities: Oil Reservoirs and the fissures sit
    // among the other entities, by prefab tag.
    for (const e of [...(w.other_entities ?? []), ...(w.buildings ?? [])])
      if (featureIds.has(e.tag)) count(features, e.tag)
    return { id: w.name, start: w.is_starting, geysers, features }
  })
  return {
    coordinate: request.coordinate,
    clusterId: map.cluster_id,
    engineBuild: game_version(),
    worlds,
  }
}

self.onmessage = async (e: MessageEvent<{ id: number } & SeedRequest>) => {
  const { id, ...request } = e.data
  let reply: SeedReply
  try {
    await load()
    const map = generate_map_data(request.coordinate) as MapData
    if (map.failure) {
      const f = map.failure
      throw new Error(typeof f === 'string' ? f : (f.message ?? 'worldgen failed'))
    }
    reply = { ok: true, result: summarise(map, request) }
  } catch (err) {
    reply = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  self.postMessage({ id, ...reply })
}
