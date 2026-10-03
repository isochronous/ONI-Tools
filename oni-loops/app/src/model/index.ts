import { gameData, label } from '../data/load'
import { buildGraph, type Graph } from './graph'
import { setDlcNames } from './search'

let graph: Graph | undefined

/** The conversion graph, built once from the bundled data. */
export function useGraph(): Graph {
  if (!graph) {
    setDlcNames(Object.fromEntries(gameData.dlcs.map((d) => [d.id, d.name])))
    graph = buildGraph(gameData)
  }
  return graph
}

export interface Target {
  tag: string
  name: string
  kind: string
}

let targets: Target[] | undefined

/** Everything a player might want more of: elements that exist in play, and items. */
export function allTargets(): Target[] {
  if (!targets) {
    const g = useGraph()
    const list: Target[] = []
    for (const e of gameData.elements) {
      if (e.disabled || e.id === 'Vacuum' || e.id === 'Void' || e.id === 'Unobtanium') continue
      list.push({ tag: e.id, name: e.name, kind: e.state })
    }
    for (const it of gameData.items) {
      if (it.kind === 'critter' || it.kind === 'plant') continue
      // Only things something produces or consumes; decorative one-offs are noise.
      if (!g.byOutput.has(it.id) && !g.byInput.has(it.id)) continue
      list.push({ tag: it.id, name: it.name, kind: it.kind })
    }
    targets = list.sort((a, b) => a.name.localeCompare(b.name))
  }
  return targets
}

export { label }
