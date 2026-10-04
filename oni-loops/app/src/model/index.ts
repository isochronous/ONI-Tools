import icons from '../../../data/icons.json'
import { gameData, label, unnamed } from '../data/load'
import { buildGraph, fmt, type Graph } from './graph'
import { setDlcNames } from './chains'

const iconTags = new Set<string>(icons as string[])

/** The game's own icon for a tag or prefab id, as a URL, when the dump exported one. */
export function iconOf(tag: string): string | undefined {
  return iconTags.has(tag) ? `${import.meta.env.BASE_URL}icons/${tag}.png` : undefined
}

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
      if (unnamed(it.name)) continue
      list.push({ tag: it.id, name: it.name, kind: it.kind })
    }
    targets = list.sort((a, b) => a.name.localeCompare(b.name))
  }
  return targets
}

/** "12 kg Water" for an element, "3 Ovagro Fig" for an item. */
export function qty(amount: number, tag: string): string {
  return useGraph().elements.has(tag)
    ? `${fmt(amount)} kg ${label(tag)}`
    : `${fmt(amount)} ${label(tag)}`
}

/** The unit word alone: "kg" for an element, nothing for an item. */
export function unitOf(tag: string): string {
  return useGraph().elements.has(tag) ? ' kg' : ''
}

export { label }
