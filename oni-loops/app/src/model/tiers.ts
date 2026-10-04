import type { ClusterData, GameData, WorldData } from '../data/types'
import { destinationDlc, type Graph, type Process } from './graph'
import type { Colony } from './search'
import { isAvailable } from './search'

/**
 * How reachable a resource is for a colony, best first. Decides how much an external
 * input of a loop really costs: Sand is nothing, Isoresin is a rocket programme.
 */
export type Tier = 'renewable' | 'local' | 'off-world' | 'space' | 'none'

export const TIER_ORDER: Record<Tier, number> = {
  renewable: 0,
  local: 1,
  'off-world': 2,
  space: 3,
  none: 4,
}

export const TIER_LABEL: Record<Tier, string> = {
  renewable: 'renewable',
  local: 'finite, on your asteroid',
  'off-world': 'on another planetoid',
  space: 'space material',
  none: 'no source',
}

export interface Tiers {
  of(tag: string): Tier
  /** Why a tag got its tier, for tooltips. */
  reason(tag: string): string
}

/** Geysers a cluster's worlds are guaranteed, by geyser type id ("molten_iron"), with how many. */
export function guaranteedGeysers(
  d: GameData,
  cluster: ClusterData | null,
): Map<string, { min: number; max: number; worlds: string[] }> {
  const out = new Map<string, { min: number; max: number; worlds: string[] }>()
  if (!cluster) return out
  for (const world of worldsOf(d, cluster)) {
    for (const rule of world.geyserRules) {
      if (!rule.listRule.startsWith('Guarantee')) continue
      const types = new Set<string>()
      for (const t of rule.templates)
        for (const g of t.geysers)
          if (g.startsWith('GeyserGeneric_')) types.add(g.slice('GeyserGeneric_'.length))
      if (types.size !== 1) continue // mixed templates: the type is a coin flip; leave to the player
      const type = [...types][0]!
      const [min, max] = ruleCount(
        rule.listRule,
        rule.someCount,
        rule.moreCount,
        rule.rangeMin,
        rule.rangeMax,
        rule.times,
        rule.templates.length,
      )
      const entry = out.get(type) ?? { min: 0, max: 0, worlds: [] }
      entry.min += min
      entry.max += max
      if (!entry.worlds.includes(world.name)) entry.worlds.push(world.name)
      out.set(type, entry)
    }
  }
  return out
}

/** How many seed-random generic geysers each world of the cluster rolls. */
export function randomGeyserSlots(
  d: GameData,
  cluster: ClusterData | null,
): { world: string; count: number }[] {
  if (!cluster) return []
  const out: { world: string; count: number }[] = []
  for (const world of worldsOf(d, cluster)) {
    let count = 0
    for (const rule of world.geyserRules)
      if (rule.templates.some((t) => t.geysers.includes('GeyserGeneric')))
        count += rule.listRule.startsWith('Try') ? rule.times : rule.someCount + rule.moreCount
    if (count) out.push({ world: world.name, count })
  }
  return out
}

function ruleCount(
  rule: string,
  some: number,
  more: number,
  rangeMin: number,
  rangeMax: number,
  times: number,
  templates: number,
): [number, number] {
  switch (rule) {
    case 'GuaranteeOne':
      return [1, 1]
    case 'GuaranteeAll':
      return [templates, templates]
    case 'GuaranteeSome':
      return [some, some]
    case 'GuaranteeSomeTryMore':
      return [some, some + more]
    case 'GuaranteeRange':
      return [rangeMin, rangeMax]
    default:
      return [0, times || 1]
  }
}

export function worldsOf(d: GameData, cluster: ClusterData): WorldData[] {
  const byId = new Map(d.worldgen.map((w) => [w.world, w]))
  return cluster.worlds.map((id) => byId.get(id)).filter((w): w is WorldData => !!w)
}

export function startWorld(d: GameData, cluster: ClusterData | null): WorldData | null {
  if (!cluster) return null
  const id = cluster.worlds[cluster.startWorldIndex] ?? cluster.worlds[0]
  return d.worldgen.find((w) => w.world === id) ?? null
}

/**
 * Computes every tag's tier for a colony. Base sources set the floor: geysers the colony
 * has are renewable, the start world's terrain is local, other planetoids' terrain is
 * off-world, the cluster's space POIs are space. Then processes propagate: a process the
 * colony can run gives its outputs a tier no better than its worst input (wild crops, eggs,
 * shears, and drops take no inputs, so their outputs are renewable), and every tag keeps
 * the best tier any route offers. This is a fixed point over an ordered scale, so it settles.
 */
export function computeTiers(
  d: GameData,
  graph: Graph,
  colony: Colony,
  cluster: ClusterData | null,
  geysers: Set<string>,
): Tiers {
  const tier = new Map<string, Tier>()
  const reason = new Map<string, string>()
  const set = (tag: string, t: Tier, why: string) => {
    const current = tier.get(tag)
    if (current !== undefined && TIER_ORDER[current] <= TIER_ORDER[t]) return false
    tier.set(tag, t)
    reason.set(tag, why)
    return true
  }

  const geyserTypes = new Map(d.geysers.map((g) => [g.id, g]))
  for (const id of geysers) {
    const g = geyserTypes.get(id)
    if (g) set(g.element, 'renewable', 'from a ' + geyserName(d, g.id))
  }
  const start = startWorld(d, cluster)
  for (const el of start?.elements ?? []) set(el, 'local', `in ${start!.name}'s terrain`)
  if (cluster) {
    for (const w of worldsOf(d, cluster))
      if (w !== start) for (const el of w.elements) set(el, 'off-world', `in ${w.name}'s terrain`)
    const poiById = new Map(d.spacePois.map((p) => [p.id, p]))
    for (const placement of cluster.spacePois)
      for (const id of placement.pois) {
        const poi = poiById.get(id)
        if (poi)
          for (const el of Object.keys(poi.elements))
            set(el, 'space', `from ${label(d, id)} by rocket`)
      }
  }

  // Base game: every Starmap has every destination type somewhere, at some distance.
  for (const s of d.spaceDestinations ?? []) {
    const dlc = destinationDlc(s.id)
    if (
      !s.visitable ||
      dlc.requires.some((id) => !colony.dlcs.has(id)) ||
      dlc.forbids.some((id) => colony.dlcs.has(id))
    )
      continue
    for (const el of Object.keys(s.elements)) set(el, 'space', `from the ${s.name} by rocket`)
    for (const tag of Object.keys(s.entities)) set(tag, 'space', `from the ${s.name} by rocket`)
  }

  const usable = graph.processes.filter(
    (p) =>
      p.kind !== 'worldgen' &&
      p.kind !== 'geyser' &&
      p.kind !== 'starmap' &&
      !isAvailable(p, colony),
  )
  let changed = true
  while (changed) {
    changed = false
    for (const p of usable) {
      let worst: Tier = 'renewable'
      let feasible = true
      for (const i of p.inputs) {
        // Any one of alternative inputs will do, so the best-placed one counts.
        const t = i.anyOf ? bestTier(i.anyOf.map((tag) => tier.get(tag))) : tier.get(i.tag)
        if (t === undefined || t === 'none') {
          feasible = false
          break
        }
        if (TIER_ORDER[t] > TIER_ORDER[worst]) worst = t
      }
      if (!feasible) continue
      for (const o of p.outputs) if (set(o.tag, worst, describe(d, p, worst))) changed = true
    }
  }

  return {
    of: (tag) => tier.get(tag) ?? 'none',
    reason: (tag) => reason.get(tag) ?? 'nothing your colony can reach makes or contains it',
  }
}

function bestTier(tiers: (Tier | undefined)[]): Tier | undefined {
  let best: Tier | undefined
  for (const t of tiers)
    if (t !== undefined && (best === undefined || TIER_ORDER[t] < TIER_ORDER[best])) best = t
  return best
}

function describe(d: GameData, p: Process, worst: Tier): string {
  const from = p.inputs
    .map((i) => (i.anyOf ? `any of ${i.anyOf.length} foods` : label(d, i.tag)))
    .join(' + ')
  const basis = worst === 'renewable' ? 'renewable inputs' : `${from} (${TIER_LABEL[worst]})`
  switch (p.kind) {
    case 'diet':
      return `excreted by ${p.via} fed ${from}`
    case 'egg':
    case 'shear':
    case 'grow':
    case 'drop':
      return `from ${p.via}`
    case 'crop':
    case 'seed':
    case 'harvest-bonus':
      return `grown on ${p.via}`
    case 'transition':
      return `by heating or cooling ${from}${worst === 'renewable' ? '' : ` (${TIER_LABEL[worst]})`}`
    case 'sublimate':
      return `off-gassed by ${from}`
    default:
      return `made by ${p.via} from ${basis}`
  }
}

function geyserName(d: GameData, id: string): string {
  return d.names['GeyserGeneric_' + id] ?? id
}

function label(d: GameData, tag: string): string {
  return d.names[tag] ?? tag
}
