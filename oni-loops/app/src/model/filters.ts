import { label } from '../data/load'
import type { Graph, Process } from './graph'
import { nodesOf, type Answer, type Chain } from './chains'

/**
 * Filters hide answers that depend on something the player does not have or does not want
 * to use. They never change what is computed, only what is shown, so the search and the
 * ordering stay the same while the player narrows the list.
 */
export type FacetGroup = 'machine' | 'critter' | 'plant' | 'food' | 'material'

export const FACET_GROUPS: { id: FacetGroup; title: string }[] = [
  { id: 'machine', title: 'Machines' },
  { id: 'critter', title: 'Critters' },
  { id: 'plant', title: 'Plants' },
  { id: 'food', title: 'Cooked foods' },
  { id: 'material', title: 'Materials' },
]

/** Food that comes out of a fabricator (a Gas Range, a Dehydrator) is its own group; raw crops and drops stay materials. */
function materialGroup(graph: Graph, tag: string): FacetGroup {
  const cooked =
    graph.kinds.get(tag) === 'food' &&
    (graph.byOutput.get(tag) ?? []).some((p) => p.kind === 'recipe')
  return cooked ? 'food' : 'material'
}

export interface Facet {
  /** Group-prefixed id, which is what the player's hidden set stores ("machine:Kiln"). */
  key: string
  group: FacetGroup
  /** The game's tag or prefab id. */
  id: string
  name: string
  /** How many of the current chains depend on it. */
  uses: number
}

function key(group: FacetGroup, id: string): string {
  return `${group}:${id}`
}

/** Eggs follow from which critters are in play, so they are no filter of their own; critters stay, so a chain that uses one can be hidden without changing the colony. */
function isMaterialFacet(graph: Graph, tag: string): boolean {
  return graph.kinds.get(tag) !== 'egg'
}

function doerKeys(p: Process, keys: Set<string>) {
  if (p.needs.building) keys.add(key('machine', p.needs.building))
  if (p.needs.critter) keys.add(key('critter', p.needs.critter))
  if (p.needs.plant) keys.add(key('plant', p.needs.plant))
}

/** What a single process depends on: what runs it, and what it is fed (not the alternatives of an any-of input). */
export function processKeys(graph: Graph, p: Process, target: string): string[] {
  const keys = new Set<string>()
  doerKeys(p, keys)
  for (const f of p.inputs)
    if (!f.anyOf && f.tag !== target && isMaterialFacet(graph, f.tag))
      keys.add(key(materialGroup(graph, f.tag), f.tag))
  return [...keys]
}

/** What a chain depends on: every node's machine, critter, or plant, every intermediate, and every outside input. */
export function chainKeys(graph: Graph, chain: Chain): string[] {
  const keys = new Set<string>()
  for (const n of nodesOf(chain)) {
    doerKeys(n.process, keys)
    if (n.output !== chain.target && isMaterialFacet(graph, n.output))
      keys.add(key(materialGroup(graph, n.output), n.output))
    for (const i of n.inputs)
      if (!i.node && !i.feedback && isMaterialFacet(graph, i.tag))
        keys.add(key(materialGroup(graph, i.tag), i.tag))
  }
  return [...keys]
}

/** Everything the current answer depends on, grouped and counted, for the filter bar. */
export function facetsOf(graph: Graph, answer: Answer): Facet[] {
  const uses = new Map<string, number>()
  const count = (keys: string[]) => {
    for (const k of keys) uses.set(k, (uses.get(k) ?? 0) + 1)
  }
  for (const c of answer.chains) count(chainKeys(graph, c))
  for (const { process } of answer.locked) count(processKeys(graph, process, answer.target))
  const facets: Facet[] = []
  for (const [k, n] of uses) {
    const i = k.indexOf(':')
    const group = k.slice(0, i) as FacetGroup
    const id = k.slice(i + 1)
    facets.push({ key: k, group, id, name: label(id), uses: n })
  }
  return facets.sort((a, b) => a.name.localeCompare(b.name))
}

/** True when nothing the keys name is hidden. */
export function passes(keys: string[], hidden: Set<string>): boolean {
  return !keys.some((k) => hidden.has(k))
}
