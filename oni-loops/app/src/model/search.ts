import type { Flow, Graph, Process } from './graph'

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
}

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
export function findLoops(graph: Graph, target: string, colony: Colony, maxSteps = 6, maxLoops = 50): Loop[] {
  const loops: Loop[] = []
  const seen = new Set<string>()

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
          loops.push(summarise([...steps, step], ratio * r, target, colony))
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

/** Net-positive before top-up; within a tier, self-contained first, then by return, then shorter. */
export function compareLoops(a: Loop, b: Loop): number {
  const tier = Number(isPositive(b)) - Number(isPositive(a))
  return tier || a.externals.length - b.externals.length || b.ratio - a.ratio || a.steps.length - b.steps.length
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
function summarise(steps: Step[], ratio: number, target: string, colony: Colony): Loop {
  const net = new Map<string, number>()
  let carried = 1 // units of the current step's `from` per unit of target
  for (const s of steps) {
    const input = s.process.inputs.find((f) => f.tag === s.from)
    const runs = input && input.amount > 0 ? carried / input.amount : 0
    const scale = !colony.domesticated && s.process.wildFactor ? s.process.wildFactor : 1
    for (const f of s.process.inputs) net.set(f.tag, (net.get(f.tag) ?? 0) - f.amount * runs)
    for (const f of s.process.outputs) net.set(f.tag, (net.get(f.tag) ?? 0) + f.amount * runs * scale)
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
  return { steps, ratio, externals, byproducts }
}

export function answer(graph: Graph, target: string, colony: Colony): Answer {
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
  const cycles = findLoops(graph, target, colony, 6, 200)
  const loops = cycles.filter((l) => l.ratio >= colony.loopFloor)
  return { target, loops, hiddenCycles: cycles.length - loops.length, producers, locked }
}
