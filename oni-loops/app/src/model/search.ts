import type { Flow, Graph, Process } from './graph'
import { inputFor, stepLabel } from './graph'
import { TIER_ORDER, type Tier, type Tiers } from './tiers'

/** What the player's colony has access to. */
export interface Colony {
  dlcs: Set<string>
  /** Critter ids the player can ranch; `null` means "assume any". */
  critters: Set<string> | null
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
  /** The return a loop should be driven to when an intermediate can be topped up (1 = just closed). */
  topUpRatio: number
}

export const DEFAULT_TOP_UP_RATIO = 1

export const DEFAULT_PRIMARY_SHARE = 0.5

export interface Step {
  process: Process
  /** The tag this step takes from the previous step (or the target, for the first step). */
  from: string
  /** The tag this step hands to the next step. */
  to: string
  /** Units of `to` per unit of `from` through this step. */
  ratio: number
  /** Other ways to do this same step (another machine, critter, or in-world phase change). */
  alternatives?: string[]
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
  /**
   * For a loop that returns less than 1: an intermediate the colony can supply from outside
   * (renewable, or finite on the asteroid) so the chain can be run harder and return exactly 1.
   * `amount` is the extra per unit of target, fed to step `step`. When set, `externals` and
   * `byproducts` describe the loop run that way.
   */
  topUp?: { tag: string; amount: number; tier: Tier; step: number; ratio: number }
}

/** What the loop returns per unit of target once any top-up is applied. */
export function effectiveRatio(loop: Loop): number {
  return loop.topUp ? loop.topUp.ratio : loop.ratio
}

/** Net-positive, or closable to exactly 1 with a cheap top-up of an intermediate. */
export function isClosed(loop: Loop): boolean {
  return isPositive(loop) || loop.topUp !== undefined
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

/** Ratio of `to` out per unit of `from` in, for a given process. */
function stepRatio(p: Process, from: string, to: string): number {
  const input = inputFor(p, from)
  const output = p.outputs.find((f) => f.tag === to)
  if (!output || !input || input.amount <= 0) return 0
  return output.amount / input.amount
}

/**
 * A step's resource for the loop-folding key. When the next step takes it as one of several
 * interchangeable inputs (any seed into a Pacu), the key names the kind of thing instead, so
 * loops that differ only in which seed is fed fold into one.
 */
function pathTag(graph: Graph, s: Step, next: Step): string {
  const flow = inputFor(next.process, s.to)
  return flow?.anyOf ? 'any ' + (graph.kinds.get(s.to) ?? 'item') : s.to
}

/**
 * Of two loops over the same resources, the one to show. Higher return wins; on a tie the one
 * with fewer in-world phase changes, so a Kiln is the headline and "or heated in-world" the
 * alternative when both convert at the same rate.
 */
function preferred(a: Loop, b: Loop): Loop {
  if (Math.abs(a.ratio - b.ratio) > 1e-9) return a.ratio > b.ratio ? a : b
  const transitions = (l: Loop) => l.steps.filter((s) => s.process.kind === 'transition').length
  return transitions(b) < transitions(a) ? b : a
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
  // One loop per sequence of resources (and primary/side-stream); variants that only swap the
  // machine or critter doing a step are folded into that step's `alternatives` on the
  // best-returning one.
  const byPath = new Map<string, Loop>()

  // Iterative deepening: all 2-step loops before any 3-step one, so the cap on loops never
  // hides a short loop behind hundreds of long ones.
  let depth = 2

  function walk(current: string, steps: Step[], ratio: number, visited: Set<string>) {
    if (loops.length >= maxLoops) return
    for (const p of graph.byInput.get(current) ?? []) {
      if (isAvailable(p, colony)) continue
      if (p.kind === 'worldgen' || p.kind === 'geyser' || p.kind === 'starmap') continue
      for (const out of p.outputs) {
        const r = stepRatio(p, current, out.tag)
        if (r <= 0) continue
        const step: Step = { process: p, from: current, to: out.tag, ratio: r }
        if (out.tag === target) {
          if (steps.length + 1 !== depth) continue
          if (steps.length === 0 && p.inputs.length === 1 && p.inputs[0]?.tag === target) continue // X -> X
          const key = [...steps, step].map((s) => s.process.id).join('>')
          if (seen.has(key)) continue
          seen.add(key)
          const loop = closeWithTopUp(graph, summarise(graph, [...steps, step], ratio * r, target, colony, tiers), target, colony, tiers)
          // Primary and side-stream variants of one path are different answers (a Lavatory plus a
          // Steam Turbine vs steam riding through a refinery), and so are variants whose extra
          // inputs sit on different tiers, so those never fold together.
          const path = loop.steps.map((s, i) => pathTag(graph, s, loop.steps[i + 1] ?? loop.steps[0]!)).join('>') + (loop.primary ? '|P' : '|S') + '|' + loop.worstTier
          const existing = byPath.get(path)
          if (!existing) {
            byPath.set(path, loop)
            loops.push(loop)
          } else {
            const best = preferred(existing, loop)
            const other = best === existing ? loop : existing
            for (let i = 0; i < best.steps.length; i++) {
              // Step objects are shared between loops, so a step gains alternatives by copy.
              const mine = best.steps[i]!
              const theirs = other.steps[i]!
              const names = [stepLabel(theirs.process), ...(theirs.alternatives ?? [])].filter((n) => n !== stepLabel(mine.process) && !mine.alternatives?.includes(n))
              if (names.length) best.steps[i] = { ...mine, alternatives: [...(mine.alternatives ?? []), ...names] }
            }
            if (best !== existing) {
              byPath.set(path, best)
              loops[loops.indexOf(existing)] = best
            }
          }
          continue
        }
        if (steps.length + 1 >= depth || visited.has(out.tag)) continue
        const next = new Set(visited)
        next.add(out.tag)
        walk(out.tag, [...steps, step], ratio * r, next)
      }
    }
  }

  for (depth = 2; depth <= maxSteps && loops.length < maxLoops; depth++) walk(target, [], 1, new Set([target]))
  return loops.sort(compareLoops)
}

/**
 * Easiest externals first (a loop needing only Sand beats one needing Isoresin, and a
 * top-up counts as an external), then primary before side-stream, then loops that pay back
 * (on their own or topped up) before those that do not, self-sufficient before topped-up,
 * then by what they return, then the cheaper in outside inputs, then shorter.
 */
export function compareLoops(a: Loop, b: Loop): number {
  return (
    TIER_ORDER[a.worstTier] - TIER_ORDER[b.worstTier] ||
    Number(b.primary) - Number(a.primary) ||
    Number(isClosed(b)) - Number(isClosed(a)) ||
    Number(isPositive(b)) - Number(isPositive(a)) ||
    effectiveRatio(b) - effectiveRatio(a) ||
    externalCost(a) - externalCost(b) ||
    a.steps.length - b.steps.length
  )
}

/** Outside input per unit of target, as a rough single number (kg and item counts added as-is). */
function externalCost(loop: Loop): number {
  let total = 0
  for (const f of loop.externals) total += f.amount
  return total
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
/**
 * A loop short of 1 is not necessarily limited: if an intermediate is something the colony
 * can add from outside (polluted water from a geyser), the steps after it can be run harder
 * until the loop returns what the colony asks for (1, or more). The best-placed such intermediate (by tier, then an element
 * over an item, then the earliest) becomes the loop's top-up, and the flows are recomputed for
 * that run.
 */
function closeWithTopUp(graph: Graph, loop: Loop, target: string, colony: Colony, tiers: Tiers): Loop {
  const want = Math.max(1, colony.topUpRatio)
  if (loop.ratio >= want || loop.ratio <= 0 || loop.steps.length < 2) return loop
  const scale = want / loop.ratio
  let best: Loop['topUp'] | undefined
  let before = 1
  for (let i = 0; i < loop.steps.length - 1; i++) {
    before *= loop.steps[i]!.ratio
    const tag = loop.steps[i]!.to
    const tier = tiers.of(tag)
    if (tag === target || TIER_ORDER[tier] > TIER_ORDER.local) continue
    const amount = before * (scale - 1)
    // Prefer a bulk element (polluted water) over an item (figs), then the earliest point in
    // the chain, so the whole chain downstream is what gets run harder.
    const better = !best || TIER_ORDER[tier] < TIER_ORDER[best.tier] || (tier === best.tier && graph.elements.has(tag) && !graph.elements.has(best.tag))
    if (better) best = { tag, amount, tier, step: i + 1, ratio: want }
  }
  if (!best) return loop
  const closed = summarise(graph, loop.steps, loop.ratio, target, colony, tiers, { from: best.step, scale })
  return { ...loop, externals: closed.externals, byproducts: closed.byproducts, worstTier: closed.worstTier, topUp: best }
}

function summarise(graph: Graph, steps: Step[], ratio: number, target: string, colony: Colony, tiers: Tiers, boost?: { from: number; scale: number }): Loop {
  const net = new Map<string, number>()
  let carried = 1 // units of the current step's `from` per unit of target
  let minShare = 1
  for (const [i, s] of steps.entries()) {
    if (boost && i === boost.from) carried *= boost.scale // run the rest of the chain harder on the top-up
    const input = inputFor(s.process, s.from)
    const runs = input && input.amount > 0 ? carried / input.amount : 0
    // An any-of input is consumed as whatever the chain arrived with.
    const consumed = (f: Flow) => (f === input ? s.from : f.tag)
    for (const f of s.process.inputs) net.set(consumed(f), (net.get(consumed(f)) ?? 0) - f.amount * runs)
    for (const f of s.process.outputs) net.set(f.tag, (net.get(f.tag) ?? 0) + f.amount * runs)
    // Mass share of the carried input, when every input is an element (so kg compares to kg).
    if (input && s.process.inputs.every((f) => graph.elements.has(consumed(f)))) {
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
  return { steps, ratio, externals, byproducts, primary: minShare >= colony.primaryShare, minShare, worstTier }
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
  const order: Record<string, number> = { recipe: 0, converter: 1, diet: 2, crop: 3, shear: 4, egg: 5, grow: 6, drop: 7, seed: 8, 'harvest-bonus': 9, transition: 10, sublimate: 11, rot: 11, geyser: 12, worldgen: 13, starmap: 14 }
  producers.sort((a, b) => (order[a.kind] ?? 99) - (order[b.kind] ?? 99) || a.via.localeCompare(b.via))
  const cycles = findLoops(graph, target, colony, tiers, 6, 200)
  const loops = cycles.filter((l) => effectiveRatio(l) >= colony.loopFloor)
  return { target, loops, hiddenCycles: cycles.length - loops.length, producers, locked }
}
