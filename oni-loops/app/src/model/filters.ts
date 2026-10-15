import { label } from '../data/load'
import { isCookedFood, type Graph, type Process } from './graph'
import { nodesOf, type Answer, type Chain } from './chains'

/**
 * Filters hide answers that depend on something the player does not have or does not want
 * to use. The hidden keys also go into the search as `Colony.excluded`, so hiding the best
 * way to make something (Kilns, Hatches) lets the search find the next ways rather than
 * only taking rows off the list; the row filter still applies to whatever comes back.
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
  return isCookedFood(graph, tag) ? 'food' : 'material'
}

/**
 * A whole group switched off ("no critters at all") is one key, `critter:*`, which the search
 * understands as a rule rather than a list: no critter step can come back through a route
 * the list did not know about yet.
 */
export function groupRule(group: FacetGroup): string {
  return `${group}:*`
}

export function groupOf(key: string): FacetGroup {
  return key.slice(0, key.indexOf(':')) as FacetGroup
}

/** True when the key is switched off, by itself or by its group's rule. */
export function isHidden(key: string, hidden: Set<string>): boolean {
  return hidden.has(key) || hidden.has(groupRule(groupOf(key)))
}

export interface Facet {
  /** Group-prefixed id, which is what the player's hidden set stores ("machine:Kiln"). */
  key: string
  group: FacetGroup
  /** The game's tag or prefab id. */
  id: string
  name: string
  /** How many of the chains shown now depend on it. */
  uses: number
  /** How many chains depend on it with nothing switched off. */
  possible: number
  /**
   * `on`: in use. `off`: switched off by the player. `blocked`: switched on, but no chain
   * shown uses it, because everything that would also needs something switched off.
   */
  state: 'on' | 'off' | 'blocked'
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

/** How many of an answer's chains and sources depend on each key. */
function usesIn(graph: Graph, answer: Answer): Map<string, number> {
  const uses = new Map<string, number>()
  const count = (keys: string[]) => {
    for (const k of keys) uses.set(k, (uses.get(k) ?? 0) + 1)
  }
  for (const c of answer.chains) count(chainKeys(graph, c))
  for (const { process } of answer.locked) count(processKeys(graph, process, answer.target))
  return uses
}

/**
 * Everything the answer can depend on, grouped and counted, for the filter bar. The list is
 * the union of what the unfiltered answer uses (`all`), what the answer shown now uses
 * (`shown`, which may route around hidden things through other steps), the hidden keys, and
 * `keep`, keys listed earlier for this target: a chip never vanishes because the chains that
 * used it went away, it only changes state. Switched-off chips keep their unfiltered count,
 * so the player can see what turning one back on would bring.
 */
export function facetsOf(
  graph: Graph,
  all: Answer,
  shown: Answer,
  hidden: Set<string>,
  keep: Iterable<string> = [],
): Facet[] {
  const possible = usesIn(graph, all)
  const uses = all === shown ? possible : usesIn(graph, shown)
  // With nothing switched off there is nothing to be blocked by: the list is what is used.
  const keys = new Set<string>([
    ...possible.keys(),
    ...uses.keys(),
    ...hidden,
    ...(hidden.size ? keep : []),
  ])
  const facets: Facet[] = []
  for (const k of keys) {
    const group = groupOf(k)
    const id = k.slice(k.indexOf(':') + 1)
    if (id === '*') continue // a group's rule is not a chip
    const n = uses.get(k) ?? 0
    facets.push({
      key: k,
      group,
      id,
      name: label(id),
      uses: n,
      possible: possible.get(k) ?? 0,
      state: isHidden(k, hidden) ? 'off' : n > 0 ? 'on' : 'blocked',
    })
  }
  return facets.sort((a, b) => a.name.localeCompare(b.name))
}

/** True when nothing the keys name is hidden, by itself or by a group's rule. */
export function passes(keys: string[], hidden: Set<string>): boolean {
  return !keys.some((k) => isHidden(k, hidden))
}
