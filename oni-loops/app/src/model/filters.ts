import { label } from '../data/load'
import type { Graph, Process } from './graph'
import type { Answer, Loop } from './search'

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
  /** How many of the current loops and sources depend on it. */
  uses: number
}

function key(group: FacetGroup, id: string): string {
  return `${group}:${id}`
}

/** What a single process depends on: what runs it, and what it is fed (not the alternatives of an any-of input). */
export function processKeys(graph: Graph, p: Process, target: string): string[] {
  const keys: string[] = []
  if (p.needs.building) keys.push(key('machine', p.needs.building))
  if (p.needs.critter) keys.push(key('critter', p.needs.critter))
  if (p.needs.plant) keys.push(key('plant', p.needs.plant))
  for (const f of p.inputs)
    if (!f.anyOf && f.tag !== target) keys.push(key(materialGroup(graph, f.tag), f.tag))
  return keys
}

/** What a loop depends on: every step's machine, critter, or plant, every intermediate, and every outside input. */
export function loopKeys(graph: Graph, loop: Loop, target: string): string[] {
  const keys = new Set<string>()
  for (const s of loop.steps) {
    const p = s.process
    if (p.needs.building) keys.add(key('machine', p.needs.building))
    if (p.needs.critter) keys.add(key('critter', p.needs.critter))
    if (p.needs.plant) keys.add(key('plant', p.needs.plant))
    if (s.from !== target) keys.add(key(materialGroup(graph, s.from), s.from))
  }
  for (const f of loop.externals) keys.add(key(materialGroup(graph, f.tag), f.tag))
  return [...keys]
}

/** Everything the current answer depends on, grouped and counted, for the filter bar. */
export function facetsOf(graph: Graph, answer: Answer): Facet[] {
  const uses = new Map<string, number>()
  const count = (keys: string[]) => {
    for (const k of keys) uses.set(k, (uses.get(k) ?? 0) + 1)
  }
  for (const l of answer.loops) count(loopKeys(graph, l, answer.target))
  for (const p of answer.producers) count(processKeys(graph, p, answer.target))
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
