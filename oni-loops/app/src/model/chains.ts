import type { Flow, Graph, Process } from './graph'
import { stepLabel } from './graph'
import { TIER_ORDER, type Tier, type Tiers } from './tiers'

/** What the player's colony has access to. Changing any of it changes the answers. */
export interface Colony {
  dlcs: Set<string>
  /** Critter ids the player can ranch; `null` means "assume any". */
  critters: Set<string> | null
  /** Cluster id the colony plays on, or null when unknown. */
  cluster: string | null
  /** Geyser type ids ("molten_iron") the colony has access to. */
  geysers: Set<string>
  /** How many Duplicants the colony has: the one thing a chain cannot build more of. */
  duplicants: number
}

export const DEFAULT_DUPLICANTS = 8

/**
 * One input of a node: made by a sub-chain, fed back from the chain's own product, or taken
 * from outside. Amounts are per unit of target the chain nets.
 */
export interface Input {
  /** What is consumed: for an any-of input, the option the chain chose. */
  tag: string
  amount: number
  anyOfName?: string
  role?: Flow['role']
  /** The sub-chain that makes it. */
  node?: Node
  /** True when this is the chain's own product fed back in. */
  feedback?: boolean
  /** How reachable the colony finds it; for an input made by a sub-chain, that chain's worst. */
  tier: Tier
}

/** A process in a chain, making `output` for its parent (or the target, at the root). */
export interface Node {
  process: Process
  output: string
  /** Units of `output` per unit of target the chain nets. */
  amount: number
  /** Runs of the process per unit of target the chain nets. */
  runs: number
  inputs: Input[]
  /** Worst tier in this subtree. */
  tier: Tier
  /** Processes in this subtree. */
  size: number
  /** Other processes that make the same output from the same inputs in the same proportions. */
  alternatives?: Process[]
}

/**
 * A way to make the target: a tree of processes ending at it, with every leaf either a
 * source (a geyser, terrain, a wild plant) or something the colony brings from outside.
 */
export interface Chain {
  target: string
  root: Node
  /** The hardest-to-reach leaf; what the chain costs the colony. */
  worstTier: Tier
  size: number
  /** Share of each unit made that goes back in as an input; 0 when the chain feeds itself nothing. */
  feedback: number
  /** What the chain takes from outside, per unit netted: inputs nothing in it makes. */
  needs: Input[]
  /** What the chain makes besides the target, per unit netted. */
  makes: Flow[]
  /** Most target per cycle the colony's Duplicants allow (a toilet visit is once a cycle each). */
  ceiling?: number
  ceilingNode?: Node
  /** True when `ceiling` is below what the player asked for. */
  capped?: boolean
  /**
   * How far the biggest step overshoots what a colony would build, at the asked rate: 1 is
   * the allowance (50 plants, 30 critters, 10 buildings, 2 geysers), 10 is ten times it.
   */
  strain: number
  strainNode?: Node
  /** How many instances `strainNode` needs at the asked rate. */
  strainCount?: number
  /** True when a step heats past 500 °C or cools below -50 °C in-world. */
  impractical: boolean
  /** True when a step is a building giving the material off while doing something else. */
  incidental: boolean
}

export interface Answer {
  target: string
  /** Every way to make the target the colony can run, best first. */
  chains: Chain[]
  /** Producers that are one DLC or critter away. */
  locked: { process: Process; reason: string }[]
}

export function isAvailable(p: Process, colony: Colony): string | null {
  for (const id of p.dlc.requires) if (!colony.dlcs.has(id)) return 'needs ' + dlcLabel(id)
  for (const id of p.dlc.forbids) if (colony.dlcs.has(id)) return 'not with ' + dlcLabel(id)
  if (p.needs.critter && colony.critters && !colony.critters.has(p.needs.critter))
    return 'needs ' + p.via
  return null
}

let dlcNames: Record<string, string> = {}
export function setDlcNames(names: Record<string, string>) {
  dlcNames = names
}
function dlcLabel(id: string) {
  return dlcNames[id] ?? id
}

const MAX_DEPTH = 8

/** A chain's structure before amounts are known; shared between chains through the memo. */
interface Shape {
  process: Process
  output: string
  inputs: ShapeInput[]
  /** The process's own cost when it is a source (a geyser the colony lacks is 'none'). */
  ownTier: Tier
  /** Worst of `ownTier` and every input. */
  tier: Tier
  size: number
  /** Some step in the subtree needs an extreme in-world temperature. */
  impractical: boolean
  /** Some step in the subtree is a building's incidental output. */
  incidental: boolean
  /**
   * The subtree's biggest step at the asked rate, as instances over what a colony would build
   * of that kind: a Gnit every 4.5 cycles strains a ranch less than a Puft every 45.
   */
  strain: number
  /** Units of target fed back per unit of this shape's output. */
  feedback: number
  alternatives: Process[]
}

interface ShapeInput {
  flow: Flow
  tag: string
  shape?: Shape
  feedback?: boolean
  tier: Tier
}

/**
 * True when `output` is a minor share of what the process puts out by mass (the Polymer
 * Press's wisp of steam, the Water Sieve's polluted dirt): the step is run for something
 * else, and this is what comes off the side.
 */
const MINOR_SHARE = 0.25
function minorOutput(graph: Graph, p: Process, output: string): boolean {
  const mass = p.outputs.filter((f) => graph.elements.has(f.tag))
  if (!graph.elements.has(output) || mass.length < 2) return false
  const total = mass.reduce((sum, f) => sum + f.amount, 0)
  const own = mass.find((f) => f.tag === output)?.amount ?? 0
  return total > 0 && own / total < MINOR_SHARE
}

function worse(a: Tier, b: Tier): Tier {
  return TIER_ORDER[a] >= TIER_ORDER[b] ? a : b
}

/**
 * Of two shapes making the same thing, the one to prefer: one that does not feed on the
 * target (loops are found on purpose by the forward search; as a default input choice the
 * target fed back tends to make a chain eat more than it makes), then one a colony would
 * build (within the allowance at the asked rate), then the easier tier, then fewer
 * processes, then less scale (a Gnit every 4.5 cycles over a Puft every 45), then one that
 * pipes its product out, then a building over an in-world phase change (a Kiln leads, "or
 * heated in-world" follows), then fewer DLCs.
 */
function compareShapes(a: Shape, b: Shape): number {
  return (
    Number(a.impractical) - Number(b.impractical) ||
    Number(a.incidental) - Number(b.incidental) ||
    Number(a.feedback > 0) - Number(b.feedback > 0) ||
    Number(a.strain > 1) - Number(b.strain > 1) ||
    TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
    a.size - b.size ||
    strainBucket(a.strain) - strainBucket(b.strain) ||
    Number(a.process.pipedOutput === false) - Number(b.process.pipedOutput === false) ||
    Number(a.process.kind === 'transition') - Number(b.process.kind === 'transition') ||
    a.process.dlc.requires.length - b.process.dlc.requires.length
  )
}

/** Strain compared coarsely, so a route three times bigger loses but a few percent is a tie. */
function strainBucket(strain: number): number {
  return strain <= 0 ? -99 : Math.round(Math.log10(strain) * 2)
}

/** What a process with no inputs costs the colony: a geyser it has, its own terrain, a rocket trip, or a critter or plant. */
function sourceTier(p: Process, colony: Colony, tiers: Tiers): Tier | null {
  switch (p.kind) {
    case 'geyser':
      return colony.geysers.has(p.viaId) ? 'renewable' : 'none'
    case 'worldgen':
      return tiers.worldTier(p.viaId) // null when the world is not in the colony's cluster
    case 'starmap':
      return 'space'
    default:
      return 'renewable'
  }
}

/**
 * Every way the colony can make `target`, searched backward: for each producer of the
 * target, each input is met by the best way to make it, found the same way, down to
 * sources. The target itself may appear as an input (a chain feeding on its own product),
 * which is recorded as feedback; any other repeat is cut, so the search ends.
 */
export function findChains(
  graph: Graph,
  target: string,
  colony: Colony,
  tiers: Tiers,
  perCycle: number,
): Chain[] {
  // Memo per tag and coarse rate (powers of three), since scale depends on how much is needed.
  const memo = new Map<string, { shape: Shape | null; depth: number }>()
  const rateKey = (tag: string, need: number) =>
    `${tag}@${Math.round(Math.log(Math.max(need, 1e-9)) / Math.log(3))}`
  const stack = new Set<string>([target])

  /** A shape from its process and resolved inputs; tier, size, and feedback follow from them. */
  /** `need`: units of `output` per cycle this shape must make, which sets its scale. */
  function assemble(
    p: Process,
    output: string,
    ownTier: Tier,
    inputs: ShapeInput[],
    need: number,
  ): Shape {
    const out = p.outputs.find((f) => f.tag === output)!
    let tier = ownTier
    let size = 1
    let feedback = 0
    let impractical = p.extremeTemperature === true
    let incidental = p.incidental === true || minorOutput(graph, p, output)
    const runs = need / out.amount // process runs per cycle at this scale
    const t = p.throughput
    let strain = t ? runs / t.runsPerCycle / allowance(t.instance) : 0
    for (const i of inputs) {
      tier = worse(tier, i.tier)
      if (i.shape) {
        size += i.shape.size
        feedback += (i.shape.feedback * i.flow.amount) / out.amount
        impractical ||= i.shape.impractical
        incidental ||= i.shape.incidental
        strain = Math.max(strain, i.shape.strain)
      } else if (i.feedback) feedback += i.flow.amount / out.amount
      else if (graph.hotOnly.has(i.tag)) impractical = true // an outside supply of Molten Steel is no plan
    }
    return {
      process: p,
      output,
      inputs,
      ownTier,
      tier,
      size,
      feedback,
      impractical,
      incidental,
      strain,
      alternatives: [],
    }
  }

  /**
   * `fed`: an input already decided (the previous step of a loop followed forward), given as
   * the tag it supplies and the shape making it, or feedback of the target itself.
   */
  function expand(
    p: Process,
    output: string,
    depth: number,
    need: number,
    fed?: { tag: string; shape?: Shape },
  ): Shape | null {
    const out = p.outputs.find((f) => f.tag === output)
    if (!out || out.amount <= 0) return null
    const ownTier = sourceTier(p, colony, tiers)
    if (ownTier === null) return null // terrain of a world outside the colony's cluster
    const inputs: ShapeInput[] = []
    for (const f of p.inputs) {
      if (fed && (f.tag === fed.tag || f.anyOf?.includes(fed.tag))) {
        inputs.push(
          fed.shape
            ? { flow: f, tag: fed.tag, shape: fed.shape, tier: fed.shape.tier }
            : { flow: f, tag: fed.tag, feedback: true, tier: 'renewable' },
        )
        continue
      }
      // Any one of an any-of input's options will do: take the best-placed one.
      let chosen: ShapeInput | null = null
      for (const tag of f.anyOf ?? [f.tag]) {
        let candidate: ShapeInput
        if (tag === target) candidate = { flow: f, tag, feedback: true, tier: 'renewable' }
        else if (stack.has(tag)) continue
        else {
          const shape = best(tag, depth + 1, (f.amount * need) / out.amount)
          // An input nothing here can make is only as good as what sources give directly;
          // crediting it with a route this chain cut would be circular. Past the depth limit
          // nothing was looked at, so nothing is credited.
          candidate = shape
            ? { flow: f, tag, shape, tier: shape.tier }
            : { flow: f, tag, tier: depth + 1 > MAX_DEPTH ? 'none' : tiers.direct(tag) }
        }
        if (!chosen || betterInput(candidate, chosen)) chosen = candidate
      }
      if (!chosen) return null // every option is something this chain is already making
      inputs.push(chosen)
    }
    return assemble(p, output, ownTier, inputs, need)
  }

  function betterInput(a: ShapeInput, b: ShapeInput): boolean {
    const d =
      Number(!!a.feedback || (a.shape?.feedback ?? 0) > 0) -
        Number(!!b.feedback || (b.shape?.feedback ?? 0) > 0) ||
      Number((a.shape?.strain ?? 0) > 1) - Number((b.shape?.strain ?? 0) > 1) ||
      TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
      (a.shape?.size ?? 0) - (b.shape?.size ?? 0) ||
      strainBucket(a.shape?.strain ?? 0) - strainBucket(b.shape?.strain ?? 0)
    return d < 0
  }

  /** What a colony would build of each kind of thing for one product; Duplicants are what it has. */
  function allowance(instance: NonNullable<Process['throughput']>['instance']): number {
    return instance === 'duplicant' ? colony.duplicants : ALLOWANCE[instance]
  }

  /** Every distinct way to make `tag`, one shape per set of inputs, best first. */
  function ways(tag: string, depth: number, need: number): Shape[] {
    if (depth > MAX_DEPTH) return []
    const groups = new Map<string, Shape>()
    for (const p of graph.byOutput.get(tag) ?? []) {
      if (isAvailable(p, colony)) continue
      const shape = expand(p, tag, depth, need)
      if (!shape) continue
      // Ways that take the same inputs in the same proportions are one way with alternatives
      // (a Steam Turbine, or steam cooled in-world); a different ratio is a different way.
      const out = p.outputs.find((f) => f.tag === tag)!
      const key = [
        shape.tier,
        ...shape.inputs
          .map((i) => `${i.tag}:${(i.flow.amount / out.amount).toPrecision(4)}`)
          .sort(),
      ].join('|')
      const existing = groups.get(key)
      const named = (list: Process[], q: Process) => list.some((x) => stepLabel(x) === stepLabel(q))
      if (!existing) groups.set(key, shape)
      else if (compareShapes(shape, existing) < 0) {
        shape.alternatives = [existing.process, ...existing.alternatives].filter(
          (x, k, all) => stepLabel(x) !== stepLabel(p) && !named(all.slice(0, k), x),
        )
        groups.set(key, shape)
      } else if (!named([existing.process, ...existing.alternatives], p))
        existing.alternatives.push(p)
    }
    return [...groups.values()].sort(compareShapes)
  }

  /** The best way to make `tag`, remembered; null when nothing the colony can run makes it. */
  function best(tag: string, depth: number, need: number): Shape | null {
    // A result found with more depth to spare is at least as complete as one found with less.
    const key = rateKey(tag, need)
    const hit = memo.get(key)
    if (hit && hit.depth <= depth) return hit.shape
    stack.add(tag)
    const found = ways(tag, depth, need)[0] ?? null
    stack.delete(tag)
    memo.set(key, { shape: found, depth })
    return found
  }

  /**
   * The tree of materials and ratios, ignoring which process does each step: two chains with
   * the same key are one way done with different machines, and fold into one with alternatives.
   */
  function materialKey(shape: Shape): string {
    const out = shape.process.outputs.find((f) => f.tag === shape.output)!
    return (
      shape.output +
      '(' +
      shape.inputs
        .map(
          (i) =>
            `${i.tag}:${(i.flow.amount / out.amount).toPrecision(4)}${i.shape ? '=' + materialKey(i.shape) : ''}`,
        )
        .sort()
        .join(',') +
      ')'
    )
  }

  /** Adds `other`'s way of doing each step to `best`, where the two chains use different processes for the same step. */
  function foldInto(best: Shape, other: Shape) {
    if (
      stepLabel(other.process) !== stepLabel(best.process) &&
      !best.alternatives.some((p) => stepLabel(p) === stepLabel(other.process))
    )
      best.alternatives.push(other.process)
    for (const alt of other.alternatives)
      if (
        stepLabel(alt) !== stepLabel(best.process) &&
        !best.alternatives.some((p) => stepLabel(p) === stepLabel(alt))
      )
        best.alternatives.push(alt)
    for (const i of best.inputs) {
      const match = other.inputs.find((j) => j.tag === i.tag && !!j.shape === !!i.shape)
      if (i.shape && match?.shape) foldInto(i.shape, match.shape)
    }
  }

  /** The tree of process ids, to tell two ways apart. */
  function signature(shape: Shape): string {
    return (
      shape.process.id +
      '(' +
      shape.inputs.map((i) => (i.shape ? signature(i.shape) : i.tag)).join(',') +
      ')'
    )
  }

  /**
   * The chain as found, plus one variant per other good way of making each of the root's
   * direct inputs (a Volcano's magma as well as melted rock), so the list is not only the
   * single best route into every input.
   */
  function variants(shape: Shape): Shape[] {
    const out = [shape]
    shape.inputs.forEach((input, index) => {
      if (!input.shape) return
      stack.add(input.tag)
      const made = shape.process.outputs.find((f) => f.tag === shape.output)!
      const others = ways(input.tag, 1, (input.flow.amount * perCycle) / made.amount).slice(0, 3)
      stack.delete(input.tag)
      for (const alt of others) {
        if (signature(alt) === signature(input.shape)) continue
        const inputs = shape.inputs.map((i, k) =>
          k === index ? { flow: i.flow, tag: i.tag, shape: alt, tier: alt.tier } : i,
        )
        out.push({
          ...assemble(shape.process, shape.output, shape.ownTier, inputs, perCycle),
          alternatives: shape.alternatives,
        })
      }
    })
    return out
  }

  /**
   * Loops followed forward from the target: a process that consumes it, then one that
   * consumes what that made, and so on until one makes the target again. The backward search
   * only ever picks each input's best route, which hides a loop whose point is its return
   * (1 kg of Diamond into an Ancient Specimen comes back as 38 kg), so these are found on
   * their own and each turned into a chain whose first step is fed the target itself.
   */
  function forwardLoops(): Shape[] {
    const found: Shape[] = []
    const MAX_LOOPS = 60
    let limit = 2
    const walk = (
      current: string,
      path: { p: Process; from: string; to: string }[],
      visited: Set<string>,
    ) => {
      if (found.length >= MAX_LOOPS) return
      for (const p of graph.byInput.get(current) ?? []) {
        if (isAvailable(p, colony)) continue
        if (p.kind === 'worldgen' || p.kind === 'geyser' || p.kind === 'starmap') continue
        for (const o of p.outputs) {
          if (o.amount <= 0) continue
          const step = { p, from: current, to: o.tag }
          if (o.tag === target) {
            // Only loops of exactly the current length, so shorter ones come first.
            if (path.length + 1 !== limit) continue
            const shape = loopShape([...path, step])
            if (shape) found.push(shape)
            continue
          }
          if (path.length + 1 >= limit || visited.has(o.tag)) continue
          walk(o.tag, [...path, step], new Set([...visited, o.tag]))
        }
      }
    }
    for (limit = 2; limit <= MAX_DEPTH && found.length < MAX_LOOPS; limit++)
      walk(target, [], new Set([target]))
    return found
  }

  /** The chain for a forward path, built from its first step (fed the target) to its last (making it). */
  function loopShape(path: { p: Process; from: string; to: string }[]): Shape | null {
    // Amounts flow forward from one unit of target in; the chain is then scaled to the rate.
    let need = perCycle
    const needs: number[] = []
    for (const step of path) {
      const input = step.p.inputs.find((f) => f.tag === step.from || f.anyOf?.includes(step.from))
      const out = step.p.outputs.find((f) => f.tag === step.to)
      if (!input || !out) return null
      needs.push(need)
      need = (need / input.amount) * out.amount
    }
    // Build from the end: each step needs as much as the loop's output rate demands of it.
    const scale = perCycle / need // so the last step makes perCycle
    let fed: { tag: string; shape?: Shape } = { tag: target }
    let shape: Shape | null = null
    for (const [i, step] of path.entries()) {
      stack.add(step.to)
      shape = expand(step.p, step.to, path.length - 1 - i, needs[i]! * scale, fed)
      stack.delete(step.to)
      if (!shape) return null
      fed = { tag: step.to, shape }
    }
    return shape
  }

  // One chain per way through the materials; the same way done with other machines folds in.
  const byMaterials = new Map<string, Shape>()
  for (const shape of [...ways(target, 0, perCycle).flatMap(variants), ...forwardLoops()]) {
    if (shape.feedback >= 1 - 1e-9) continue // feeds itself everything it makes
    // A step run for something else, with the target coming off the side (a Polymer Press's
    // wisp of steam), is not a way to make it at any rate: the ratio never changes.
    if (shape.incidental) continue
    // "Dig it up" is not a way to make something; the tier line already says it is in the terrain.
    if (shape.process.kind === 'worldgen') continue
    const key = materialKey(shape)
    const existing = byMaterials.get(key)
    if (!existing) byMaterials.set(key, shape)
    else if (compareShapes(shape, existing) < 0) {
      foldInto(shape, existing)
      byMaterials.set(key, shape)
    } else foldInto(existing, shape)
  }

  const chains: Chain[] = []
  for (const shape of byMaterials.values()) {
    const net = 1 / (1 - shape.feedback)
    const root = materialise(shape, net)
    const chain: Chain = {
      target,
      root,
      worstTier: shape.tier,
      size: shape.size,
      feedback: shape.feedback,
      needs: [],
      makes: [],
      impractical: shape.impractical,
      incidental: shape.incidental,
      strain: 0,
    }
    summarise(chain, colony, perCycle)
    chain.capped = chain.ceiling !== undefined && chain.ceiling < perCycle - 1e-9
    chains.push(chain)
  }
  return chains.sort(compareChains)
}

/** Builds the tree with amounts, `amount` units of the shape's output per unit of target netted. */
function materialise(shape: Shape, amount: number): Node {
  const out = shape.process.outputs.find((f) => f.tag === shape.output)!
  const runs = amount / out.amount
  const inputs: Input[] = shape.inputs.map((i) => ({
    tag: i.tag,
    amount: i.flow.amount * runs,
    anyOfName: i.flow.anyOf ? i.flow.anyOfName : undefined,
    role: i.flow.role,
    node: i.shape ? materialise(i.shape, i.flow.amount * runs) : undefined,
    feedback: i.feedback,
    tier: i.tier,
  }))
  return {
    process: shape.process,
    output: shape.output,
    amount,
    runs,
    inputs,
    tier: shape.tier,
    size: shape.size,
    alternatives: shape.alternatives.length ? shape.alternatives : undefined,
  }
}

/** Nets what the chain takes from outside and makes besides the target, and finds its Duplicant ceiling. */
/** What a colony would reasonably build of each kind of thing for one product. */
const ALLOWANCE = { building: 10, plant: 50, critter: 30, geyser: 2 } as const

function summarise(chain: Chain, colony: Colony, perCycle: number) {
  const needs = new Map<string, Input>()
  const makes = new Map<string, number>()
  const visit = (n: Node) => {
    for (const f of n.process.outputs) {
      if (f.tag === n.output) continue
      makes.set(f.tag, (makes.get(f.tag) ?? 0) + f.amount * n.runs)
    }
    for (const i of n.inputs) {
      if (i.node) visit(i.node)
      else if (!i.feedback) {
        const seen = needs.get(i.tag)
        if (seen) seen.amount += i.amount
        else needs.set(i.tag, { ...i })
      }
    }
    const t = n.process.throughput
    if (t && t.instance === 'duplicant' && n.runs > 0) {
      const most = (colony.duplicants * t.runsPerCycle) / n.runs
      if (chain.ceiling === undefined || most < chain.ceiling) {
        chain.ceiling = most
        chain.ceilingNode = n
      }
    } else if (t && n.runs > 0) {
      const count = (n.runs / t.runsPerCycle) * perCycle
      const strain = count / ALLOWANCE[t.instance as keyof typeof ALLOWANCE]
      if (strain > chain.strain) {
        chain.strain = strain
        chain.strainNode = n
        chain.strainCount = count
      }
    }
  }
  visit(chain.root)
  chain.needs = [...needs.values()].sort((a, b) => b.amount - a.amount)
  chain.makes = [...makes]
    .filter(([tag]) => tag !== chain.target)
    .map(([tag, amount]) => ({ tag, amount }))
    .sort((a, b) => b.amount - a.amount)
}

/** Every node of a chain, root first. */
export function nodesOf(chain: Chain): Node[] {
  const out: Node[] = []
  const walk = (n: Node) => {
    out.push(n)
    for (const i of n.inputs) if (i.node) walk(i.node)
  }
  walk(chain.root)
  return out
}

/**
 * Routes needing extreme in-world temperatures last of all, then routes a colony would not
 * build at the asked rate (over fifty plants, thirty critters, or ten buildings at one step);
 * otherwise easiest leaves first (a chain fed by geysers beats one needing a rocket), then chains the
 * colony's Duplicants can run at the asked rate, then shorter, with a loop (a chain that turns
 * some of its own product into more of it) counting as two steps shorter, then needing less
 * from outside.
 */
export function compareChains(a: Chain, b: Chain): number {
  return (
    Number(a.impractical) - Number(b.impractical) ||
    Number(a.strain > 1) - Number(b.strain > 1) ||
    TIER_ORDER[a.worstTier] - TIER_ORDER[b.worstTier] ||
    Number(a.capped ?? false) - Number(b.capped ?? false) ||
    effectiveSize(a) - effectiveSize(b) ||
    cost(a) - cost(b)
  )
}

/** A loop turns some of its product into more of it, which is worth about two steps of brevity. */
const LOOP_CREDIT = 2
function effectiveSize(chain: Chain): number {
  return chain.size - (chain.feedback > 0 ? LOOP_CREDIT : 0)
}

/** Outside input per unit of target, as a rough single number (kg and item counts added as-is). */
function cost(chain: Chain): number {
  let total = 0
  for (const i of chain.needs) total += i.amount
  return total
}

/** `perCycle`: how much of the target the player wants per cycle, which decides which chains are capped by Duplicants. */
export function answer(
  graph: Graph,
  target: string,
  colony: Colony,
  tiers: Tiers,
  perCycle: number,
): Answer {
  const locked: { process: Process; reason: string }[] = []
  for (const p of graph.byOutput.get(target) ?? []) {
    const reason = isAvailable(p, colony)
    if (reason) locked.push({ process: p, reason })
  }
  return { target, chains: findChains(graph, target, colony, tiers, perCycle), locked }
}
