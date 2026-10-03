import type { Flow, Graph, Process } from './graph'
import { TIER_ORDER, type Tier, type Tiers } from './tiers'

/** What the player's colony has access to. */
export interface Colony {
  dlcs: Set<string>
  /** Critter ids the player can ranch; `null` means "assume any". */
  critters: Set<string> | null
  /** Plants are tended (domesticated) rather than wild. */
  domesticated: boolean
  /**
   * Smallest return (target out per target in) a cycle may have and still be listed.
   * 1 shows only net-positive loops; lower values admit "top-up" loops whose shortfall is
   * cheap to cover from another source.
   */
  loopFloor: number
  /** Cluster id the colony plays on, or null when unknown. */
  cluster: string | null
  /** Geyser type ids ("molten_iron") the colony has access to. */
  geysers: Set<string>
  /**
   * Smallest share of a process's input mass the carried resource may have at any step for
   * the loop to count as primary (the target is what the loop is about). Below it the loop
   * is a side-stream: the target rides along a process that mostly eats something else.
   */
  primaryShare: number
}

export const DEFAULT_PRIMARY_SHARE = 0.8

export interface Step {
  process: Process
  /** The tag this step takes from the previous step (or the target, for the first step). */
  from: string
  /** The tag this step hands to the next step. */
  to: string
  /** Units of `to` per unit of `from` through this step. */
  ratio: number
}

export interface Loop {
  steps: Step[]
  /** Units of the target produced per unit consumed, over the whole cycle. */
  ratio: number
  /**
   * Inputs the chain needs besides what it carries, per unit of target put in, and which
   * are not made by any step of the chain. A loop with none is self-contained.
   */
  externals: Flow[]
  /** Useful things the chain makes besides the target, per unit of target put in. */
  byproducts: Flow[]
  /**
   * True when, at every step, the carried resource is at least PRIMARY_SHARE of the mass the
   * process consumes. Otherwise the target only rides along a process that mostly eats
   * something else (steam into an oil refinery), and the loop is a side-stream.
   */
  primary: boolean
  /** Lowest share seen along the chain. */
  minShare: number
  /** The hardest-to-get external input's tier; 'renewable' when there are none. */
  worstTier: Tier
  /** Other processes that do the same step (another fabricator, another kiln). */
  alternatives: string[]
}

export interface Answer {
  target: string
  /** Cycles back to the target at or above the colony's loop floor: net-positive ones first, then top-up loops by return. */
  loops: Loop[]
  /** Cycles found below the floor; counted, not shown. */
  hiddenCycles: number
  /** Everything that produces the target, by kind, with its availability. */
  producers: Process[]
  /** Producers that are one DLC or critter away. */
  locked: { process: Process; reason: string }[]
}

export function isAvailable(p: Process, colony: Colony): string | null {
  for (const id of p.dlc.requires) if (!colony.dlcs.has(id)) return 'needs ' + dlcLabel(id)
  for (const id of p.dlc.forbids) if (colony.dlcs.has(id)) return 'not with ' + dlcLabel(id)
  if (p.needs.critter && colony.critters && !colony.critters.has(p.needs.critter)) return 'needs ' + p.via
  return null
}

let dlcNames: Record<string, string> = {}
export function setDlcNames(names: Record<string, string>) {
  dlcNames = names
}
function dlcLabel(id: string) {
  return dlcNames[id] ?? id
}

/** Ratio of `to` out per unit of `from` in, for a given process and the colony's wild/domestic choice. */
function stepRatio(p: Process, from: string, to: string, colony: Colony): number {
  const input = p.inputs.find((f) => f.tag === from)
  const output = p.outputs.find((f) => f.tag === to)
  if (!output || !input || input.amount <= 0) return 0
  const scale = !colony.domesticated && p.wildFactor ? p.wildFactor : 1
  return (output.amount * scale) / input.amount
}

/**
 * Finds cycles through `target`: a chain of processes where each consumes what the
 * previous one made, starting and ending at the target. Depth-first, bounded, over
 * processes the colony can run. Only mass-carrying edges are followed (a process with no
 * inputs cannot sit inside a loop; it is a source instead).
 */
export function findLoops(graph: Graph, target: string, colony: Colony, tiers: Tiers, maxSteps = 6, maxLoops = 50): Loop[] {
  const loops: Loop[] = []
  const seen = new Set<string>()
  // One loop per sequence of resources; variants that only swap the machine or critter
  // doing a step are folded into `alternatives` of the best-returning one.
  const byPath = new Map<string, Loop>()

  function walk(current: string, steps: Step[], ratio: number, visited: Set<string>) {
    if (loops.length >= maxLoops) return
    for (const p of graph.byInput.get(current) ?? []) {
      if (isAvailable(p, colony)) continue
      if (p.kind === 'worldgen' || p.kind === 'geyser') continue
      for (const out of p.outputs) {
        const r = stepRatio(p, current, out.tag, colony)
        if (r <= 0) continue
        const step: Step = { process: p, from: current, to: out.tag, ratio: r }
        if (out.tag === target) {
          if (steps.length === 0 && p.inputs.length === 1 && p.inputs[0]?.tag === target) continue // X -> X
          const key = [...steps, step].map((s) => s.process.id).join('>')
          if (seen.has(key)) continue
          seen.add(key)
          const loop = summarise(graph, [...steps, step], ratio * r, target, colony, tiers)
          const path = loop.steps.map((s) => s.to).join('>')
          const existing = byPath.get(path)
          if (!existing) {
            byPath.set(path, loop)
            loops.push(loop)
          } else {
            const [best, other] = existing.ratio >= loop.ratio ? [existing, loop] : [loop, existing]
            for (let i = 0; i < best.steps.length; i++) {
              const a = best.steps[i]!.process.via
              const b = other.steps[i]!.process.via
              if (a !== b && !best.alternatives.includes(b)) best.alternatives.push(b)
            }
            if (best !== existing) {
              best.alternatives.push(...existing.alternatives.filter((x) => !best.alternatives.includes(x)))
              byPath.set(path, best)
              loops[loops.indexOf(existing)] = best
            }
          }
          continue
        }
        if (steps.length + 1 >= maxSteps || visited.has(out.tag)) continue
        const next = new Set(visited)
        next.add(out.tag)
        walk(out.tag, [...steps, step], ratio * r, next)
      }
    }
  }

  walk(target, [], 1, new Set([target]))
  return loops.sort(compareLoops)
}

/**
 * Easiest externals first (a loop needing only Sand beats one needing Isoresin), then
 * net-positive before top-up, primary before side-stream, then by return, then shorter.
 */
export function compareLoops(a: Loop, b: Loop): number {
  return (
    TIER_ORDER[a.worstTier] - TIER_ORDER[b.worstTier] ||
    Number(isPositive(b)) - Number(isPositive(a)) ||
    Number(b.primary) - Number(a.primary) ||
    b.ratio - a.ratio ||
    a.steps.length - b.steps.length
  )
}

/** True when the chain nets more target than it consumes. */
export function isPositive(loop: Loop): boolean {
  return loop.ratio > 1.0001
}

/**
 * Scales every step to one unit of target entering the loop, then nets each tag over the
 * chain: what the chain consumes but never makes is an external input; what it makes but
 * never consumes (other than the target) is a byproduct.
 */
function summarise(graph: Graph, steps: Step[], ratio: number, target: string, colony: Colony, tiers: Tiers): Loop {
  const net = new Map<string, number>()
  let carried = 1 // units of the current step's `from` per unit of target
  let minShare = 1
  for (const s of steps) {
    const input = s.process.inputs.find((f) => f.tag === s.from)
    const runs = input && input.amount > 0 ? carried / input.amount : 0
    const scale = !colony.domesticated && s.process.wildFactor ? s.process.wildFactor : 1
    for (const f of s.process.inputs) net.set(f.tag, (net.get(f.tag) ?? 0) - f.amount * runs)
    for (const f of s.process.outputs) net.set(f.tag, (net.get(f.tag) ?? 0) + f.amount * runs * scale)
    // Mass share of the carried input, when every input is an element (so kg compares to kg).
    if (input && s.process.inputs.every((f) => graph.elements.has(f.tag))) {
      const total = s.process.inputs.reduce((sum, f) => sum + f.amount, 0)
      if (total > 0) minShare = Math.min(minShare, input.amount / total)
    }
    carried *= s.ratio
  }
  const externals: Flow[] = []
  const byproducts: Flow[] = []
  for (const [tag, amount] of net) {
    if (tag === target || Math.abs(amount) < 1e-9) continue
    if (amount < 0) externals.push({ tag, amount: -amount })
    else byproducts.push({ tag, amount })
  }
  externals.sort((a, b) => b.amount - a.amount)
  byproducts.sort((a, b) => b.amount - a.amount)
  let worstTier: Tier = 'renewable'
  for (const f of externals) {
    const tier = tiers.of(f.tag)
    if (TIER_ORDER[tier] > TIER_ORDER[worstTier]) worstTier = tier
  }
  return { steps, ratio, externals, byproducts, primary: minShare >= colony.primaryShare, minShare, worstTier, alternatives: [] }
}

export function answer(graph: Graph, target: string, colony: Colony, tiers: Tiers): Answer {
  const all = graph.byOutput.get(target) ?? []
  const producers: Process[] = []
  const locked: { process: Process; reason: string }[] = []
  for (const p of all) {
    const reason = isAvailable(p, colony)
    if (reason) locked.push({ process: p, reason })
    else producers.push(p)
  }
  const order: Record<string, number> = { recipe: 0, converter: 1, diet: 2, crop: 3, shear: 4, egg: 5, grow: 6, drop: 7, seed: 8, 'harvest-bonus': 9, transition: 10, sublimate: 11, geyser: 12, worldgen: 13 }
  producers.sort((a, b) => (order[a.kind] ?? 99) - (order[b.kind] ?? 99) || a.via.localeCompare(b.via))
  const cycles = findLoops(graph, target, colony, tiers, 6, 200)
  const loops = cycles.filter((l) => l.ratio >= colony.loopFloor)
  return { target, loops, hiddenCycles: cycles.length - loops.length, producers, locked }
}
