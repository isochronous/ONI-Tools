import type { DlcRestriction, GameData, PlantMutationData } from '../data/types'
import { label, unnamed } from '../data/load'

/**
 * Every way the game turns things into other things, flattened into one shape. A process
 * consumes `inputs` and yields `outputs` per run; each tag is measured in its own unit (kg
 * for elements and most resources, pieces for items, eggs, critters), which is also how the
 * game's own recipes mix them ("1 Pinpoki -> 100 kg Diamond"). Chains therefore multiply
 * per-step ratios in a consistent way as long as a chain enters and leaves each tag in that
 * tag's unit, which it always does.
 */
export type ProcessKind =
  | 'recipe' // fabricator recipe
  | 'converter' // building that converts continuously (rates per second)
  | 'diet' // critter eats one thing and excretes another
  | 'drop' // critter death drop
  | 'egg' // critter lays an egg
  | 'beckon' // a Moo calls a Moo Comet down from space, which leaves a new Moo
  | 'grow' // baby critter drops something on growing up
  | 'shear' // critter sheds an item when groomed/sheared
  | 'milk' // critter is milked at a Milking Station
  | 'crop' // plant harvest
  | 'graze' // critter eats the living plant: its growth, or what it holds
  | 'seed' // plant produces seeds
  | 'harvest-bonus' // extra item on a skilled harvest
  | 'transition' // element freezes/melts/boils/condenses
  | 'sublimate' // element or item off-gasses
  | 'geyser' // vent/geyser output
  | 'worldgen' // found in an asteroid's terrain
  | 'starmap' // brought back by a base-game rocket from a Starmap destination
  | 'rot' // food spoils into a rot pile; a rot pile decomposes into polluted dirt
  | 'hatch' // an egg hatches and the baby grows into the adult critter

export interface Flow {
  tag: string
  amount: number
  /**
   * Alternative inputs, any one of which satisfies this flow (a Pacu eats any seed). The
   * step then consumes whichever one the chain arrives with; `tag` is the first of them.
   */
  anyOf?: string[]
  /** What the alternatives have in common, for display ("compostable item"); kinds otherwise. */
  anyOfName?: string
  /** For a plant's input: what the plant does with it, so a step can read "used to irrigate"; tending is Farmer's Touch from a Farm Station. */
  role?: 'irrigation' | 'fertilizer' | 'prey' | 'tending' | 'atmosphere'
}

export interface Needs {
  critter?: string
  plant?: string
  building?: string
  /** A terrain feature the building has to sit on (an Oil Reservoir under an Oil Well), by prefab id. */
  feature?: string
  /** e.g. radbolts, power, a specific atmosphere */
  extras?: string[]
}

/**
 * How fast one instance of what does a process can run it, so a chain can say how many
 * sieves, hatches, plants, or Duplicants a rate needs. Buildings, critters, and plants can
 * be multiplied; Duplicants are what the colony has.
 */
export interface Throughput {
  /** Runs of the process one instance completes per cycle at full uptime. */
  runsPerCycle: number
  /** What one instance is; a feature is a terrain feature the colony has found (an Oil Reservoir). */
  instance: 'building' | 'critter' | 'plant' | 'duplicant' | 'geyser' | 'feature'
  /** A Duplicant stands at the building for the whole run (a Rock Crusher), so its time is spent too. */
  operated?: boolean
}

export interface Process {
  id: string
  kind: ProcessKind
  /** Display name of the thing doing the work (building, critter, plant, world). */
  via: string
  viaId: string
  inputs: Flow[]
  outputs: Flow[]
  dlc: DlcRestriction
  needs: Needs
  /** Throughput of the wild variant relative to the tame one (notes only; kg-per-kg ratios do not change). */
  wildFactor?: number
  /** Human-readable qualifiers shown next to the step. */
  notes: string[]
  /**
   * Consumed per run but not sourced by the search: a Critter Fountain's drink, which the
   * player runs or not. Shown with the step and summed for the chain, never a chain input.
   */
  upkeep?: Flow[]
  /** True when a building sends its product down a pipe rather than dropping it in the world. */
  pipedOutput?: boolean
  /** Rate per instance, when the mechanism has one (phase changes and off-gassing have none). */
  throughput?: Throughput
  /**
   * An in-world phase change past 500 °C or below -50 °C: reachable only with a volcano, a
   * magma pool, or serious engineering, so such a route is listed after every other.
   */
  extremeTemperature?: boolean
  /**
   * A building that gives this off while doing something else (a Smoker's carbon dioxide):
   * not a plan for making it, so such a route is listed after the deliberate ones.
   */
  incidental?: boolean
  /** Time one run takes, in seconds, when known. */
  seconds?: number
  /** The output the mechanism is for even when a by-product outweighs it (a fissure's gas beside its sulfur). */
  primaryOutput?: string
}

export interface Graph {
  processes: Process[]
  byOutput: Map<string, Process[]>
  byInput: Map<string, Process[]>
  critters: Map<string, { name: string; dlc: DlcRestriction }>
  /** Ids of elements that exist in play; their amounts are kilograms. */
  elements: Set<string>
  /** Item id -> kind (seed, food, egg, critter, plant, item). */
  kinds: Map<string, string>
  /** Elements that only exist above 500 °C (Molten Steel, Magma): bringing one from outside is not a plan. */
  hotOnly: Set<string>
  /** Elements some world, geyser, space rock, or process provides; the rest are debug-only. */
  obtainable: Set<string>
}

/** The input flow of `p` that `tag` satisfies, if any. */
export function inputFor(p: Process, tag: string): Flow | undefined {
  return p.inputs.find((f) => f.tag === tag || f.anyOf?.includes(tag))
}

const NONE: DlcRestriction = { requires: [], forbids: [] }

function elementDlc(dlc: string): DlcRestriction {
  return dlc ? { requires: [dlc], forbids: [] } : NONE
}

/** Content-pack destinations are only in the Db when their pack is on; the id says which. */
export function destinationDlc(id: string): DlcRestriction {
  const m = /^DLC(\d)/.exec(id)
  // Rockets only fly the Starmap without Spaced Out.
  return { requires: m ? [`DLC${m[1]}_ID`] : [], forbids: ['EXPANSION1_ID'] }
}

/** How a loop step reads: what does the work, and the game mechanism behind it. */
export function stepLabel(p: Process): string {
  switch (p.kind) {
    case 'transition':
      return p.notes[0] ?? 'phase change'
    case 'sublimate':
      return p.via + ' off-gasses'
    case 'diet':
      return 'fed to ' + p.via
    case 'drop':
      return p.via + ' dies'
    case 'crop':
      return p.via + ' harvest'
    case 'graze':
      return p.via + ' grazed'
    case 'rot':
      return p.viaId === 'RotPile' ? p.via + ' decomposes' : p.via + ' spoils'
    case 'egg':
      return p.via + ' lays an egg'
    case 'beckon':
      return p.via + ' beckons a Moo Comet'
    case 'hatch':
      return p.via + ' hatches and grows up'
    case 'grow':
      return p.via + ' grows up'
    case 'shear':
      return p.via + ' sheared'
    case 'milk':
      return p.via + ' milked'
    case 'seed':
      return p.via + ' drops a seed'
    case 'harvest-bonus':
      return p.via + ' skilled harvest'
    case 'worldgen':
      return `dug from ${p.via}'s terrain`
    case 'starmap':
      return `brought back from ${p.via}`
    default:
      return p.via
  }
}

/** Display names for inputs the game names by tag rather than by thing. */
const CLASS_NAMES: Record<string, string> = {
  Compostable: 'compostable item',
  Filter: 'filtration medium',
  BuildingWood: 'wood',
  CombustibleLiquid: 'combustible liquid',
  PlastifiableLiquid: 'plastifiable liquid',
}

/** In-world temperatures beyond these take a volcano, a magma pool, or serious engineering. */
const EXTREME_HOT_K = 773.15
const EXTREME_COLD_K = 223.15

/** RotPile.States: a pile converts to Polluted Dirt once its decomposition amount reaches 600 s. */
const ROT_PILE_SECONDS = 600

/** What the player can tell the model beyond the game data. */
/** Food that comes out of a fabricator (a Gas Range, a Dehydrator); raw crops and drops are materials. */
export function isCookedFood(graph: Graph, tag: string): boolean {
  return (
    graph.kinds.get(tag) === 'food' &&
    (graph.byOutput.get(tag) ?? []).some((p) => p.kind === 'recipe')
  )
}

export interface GraphOptions {
  /** A tame critter's happiness, by critter id; tame and groomed is 4 (groomed +5, tame -1). */
  happiness?: (critterId: string) => number
  /** What tame critters drink at a Critter Fountain, per critter per cycle, when the colony runs one. */
  drink?: { tag: string; kgPerCycle: number }
  /** The mutation a plant's seeds carry, by plant id; undefined for the plain plant. */
  mutation?: (plantId: string) => string | undefined
  /** Farmer's Touch from a Farm Station: which plants get it, by plant id, and the Botanist attribute of the Duplicant applying it. */
  farmTinker?: { applied: (plantId: string) => boolean; botanist: number }
}

/** True when a mutation can occur on a plant (the game rolls only among these). */
export function mutationFits(m: PlantMutationData, plantId: string): boolean {
  return !m.notFor?.includes(plantId) && (!m.onlyFor?.length || m.onlyFor.includes(plantId))
}

/** Happiness of a tame, groomed critter: the +5 of grooming less the -1 of being tame. */
export const DEFAULT_HAPPINESS = 4

/**
 * HappinessMonitor's bands: happy from 1 up, glum at -1 and below, miserable at -10 and
 * below. A glum or miserable tame critter's metabolism drops by 80 %; a miserable one's
 * fertility is cancelled outright.
 */
export const GLUM_HAPPINESS = -1
export const MISERABLE_HAPPINESS = -10
const GLUM_METABOLISM = 0.2

/** Egg rate relative to the base rate: 1 + 2.25 × happiness while above 0, none when miserable. */
function fertilityFactor(d: GameData, happiness: number): number {
  if (happiness <= MISERABLE_HAPPINESS) return 0
  return 1 + (d.tuning.fertilityPerHappiness ?? 2.25) * Math.max(0, happiness)
}

/** How fast a tame critter eats, and so excretes, relative to a content one. */
function metabolismFactor(happiness: number): number {
  return happiness <= GLUM_HAPPINESS ? GLUM_METABOLISM : 1
}

export function buildGraph(d: GameData, options: GraphOptions = {}): Graph {
  const processes: Process[] = []
  const elementIds = new Set(d.elements.filter((e) => !e.disabled).map((e) => e.id))
  const byId = new Map(d.elements.map((e) => [e.id, e]))
  // The sim changes phase only once the temperature is `buffer` kelvin past the nominal
  // point (Water freezes at -3 °C, not 0 °C), so the thresholds shown are the in-game ones.
  const buffer = d.tuning.stateTransitionBufferK ?? 0
  const itemIds = new Set(d.items.map((it) => it.id))
  const add = (p: Omit<Process, 'id'> & { id?: string }) => {
    if (p.outputs.length === 0) return
    processes.push({ ...p, id: p.id ?? `${p.kind}:${p.viaId}:${processes.length}` })
  }

  // Elements: phase changes and off-gassing.
  for (const e of d.elements) {
    if (e.disabled) continue
    const dlc = elementDlc(e.dlc)
    const transitions: [
      string,
      { id: string; massFraction: number } | undefined,
      string,
      boolean,
      number,
      1 | -1,
    ][] = [
      [
        e.highTempTarget,
        e.highTempOre,
        `heated in-world past ${celsius(e.highTemp + buffer)} °C`,
        e.highTemp + buffer > EXTREME_HOT_K,
        e.highTemp + buffer,
        1,
      ],
      [
        e.lowTempTarget,
        e.lowTempOre,
        `cooled in-world below ${celsius(e.lowTemp - buffer)} °C`,
        e.lowTemp - buffer < EXTREME_COLD_K,
        e.lowTemp - buffer,
        -1,
      ],
    ]
    for (const [target, ore, note, extreme, at, direction] of transitions) {
      if (!target || target === 'Vacuum' || target === 'Void' || !elementIds.has(target)) continue
      const outputs: Flow[] = []
      if (ore && ore.massFraction > 0 && elementIds.has(ore.id)) {
        outputs.push({ tag: ore.id, amount: ore.massFraction })
        outputs.push({ tag: target, amount: 1 - ore.massFraction })
      } else {
        outputs.push({ tag: target, amount: 1 })
      }
      // What comes out is at the temperature of the change, and keeps changing phase until it
      // is stable there: Bleach Stone melts at 672 °C into chlorine, which boils at -34 °C, so
      // what you actually get is chlorine gas.
      settle(outputs, at, direction)
      add({
        kind: 'transition',
        via: label(e.id),
        viaId: e.id,
        inputs: [{ tag: e.id, amount: 1 }],
        outputs,
        dlc,
        needs: {},
        notes: [note],
        extremeTemperature: extreme || undefined,
      })
    }
    if (e.sublimate && elementIds.has(e.sublimate.id)) {
      add({
        kind: 'sublimate',
        via: label(e.id),
        viaId: e.id,
        inputs: [{ tag: e.id, amount: 1 }],
        outputs: [{ tag: e.sublimate.id, amount: e.sublimate.efficiency || 1 }],
        dlc,
        needs: {},
        // Debris off-gasses slowly per pile, so the trick is many small piles, each under a
        // film of liquid so none of them is ever over-pressured.
        notes: e.sublimate.debris
          ? [
              'off-gasses as debris: slow per pile, so spread it over many tiles under a little liquid',
            ]
          : ['off-gasses when exposed'],
      })
    }
  }

  /**
   * Replaces each output element by what it becomes at temperature `at` (heating when
   * `direction` is 1, cooling when -1), following the element table until the product is
   * stable, with each step's ore split applied.
   */
  function settle(outputs: Flow[], at: number, direction: 1 | -1) {
    for (let guard = 0; guard < 6; guard++) {
      let changed = false
      for (const f of [...outputs]) {
        const el = byId.get(f.tag)
        if (!el) continue
        const next =
          direction === 1 && el.highTemp + buffer <= at
            ? { target: el.highTempTarget, ore: el.highTempOre }
            : direction === -1 && el.lowTemp - buffer >= at
              ? { target: el.lowTempTarget, ore: el.lowTempOre }
              : null
        if (!next || !next.target || !elementIds.has(next.target) || next.target === f.tag) continue
        outputs.splice(outputs.indexOf(f), 1)
        const fraction =
          next.ore && next.ore.massFraction > 0 && elementIds.has(next.ore.id)
            ? next.ore.massFraction
            : 0
        if (fraction > 0) merge(outputs, next.ore!.id, f.amount * fraction)
        merge(outputs, next.target, f.amount * (1 - fraction))
        changed = true
      }
      if (!changed) return
    }
  }
  function merge(outputs: Flow[], tag: string, amount: number) {
    const found = outputs.find((f) => f.tag === tag)
    if (found) found.amount += amount
    else outputs.push({ tag, amount })
  }

  // Food left out spoils into a Rot Pile of the same mass, and a Rot Pile decomposes into
  // Polluted Dirt of the same mass one cycle after it forms.
  if (itemIds.has('RotPile')) {
    for (const it of d.items) {
      if (it.kind !== 'food' || !it.spoilSeconds) continue
      add({
        kind: 'rot',
        via: it.name,
        viaId: it.id,
        inputs: [{ tag: it.id, amount: 1 }],
        outputs: [{ tag: 'RotPile', amount: 1 }],
        dlc: it.dlc,
        needs: {},
        notes: [`after ${fmt(it.spoilSeconds / d.tuning.secondsPerCycle)} cycles unrefrigerated`],
        seconds: it.spoilSeconds,
      })
    }
    if (elementIds.has('ToxicSand')) {
      add({
        kind: 'rot',
        via: label('RotPile'),
        viaId: 'RotPile',
        inputs: [{ tag: 'RotPile', amount: 1 }],
        outputs: [{ tag: 'ToxicSand', amount: 1 }],
        dlc: NONE,
        needs: {},
        notes: [`${fmt(ROT_PILE_SECONDS / d.tuning.secondsPerCycle)} cycle after it forms`],
        seconds: ROT_PILE_SECONDS,
      })
    }
  }

  // Items that off-gas (slime, polluted dirt...).
  for (const it of d.items) {
    if (it.sublimates && elementIds.has(it.sublimates.element)) {
      add({
        kind: 'sublimate',
        via: it.name,
        viaId: it.id,
        inputs: [{ tag: it.id, amount: 1 }],
        outputs: [{ tag: it.sublimates.element, amount: 1 }],
        dlc: it.dlc,
        needs: {},
        notes: ['off-gasses over time'],
      })
    }
  }

  // Inputs named by a tag rather than a thing ("Compostable", "Filter") take any element or
  // item carrying that tag. The Composter's compostables are copies of the real items (the
  // "CompostX" prefabs a Duplicant marks for compost), so they are mapped back to the items.
  const classes = new Map<string, string[]>()
  const members = (tag: string): string[] => {
    let list = classes.get(tag)
    if (list) return list
    list = []
    for (const e of d.elements) if (!e.disabled && e.tags.includes(tag)) list.push(e.id)
    for (const it of d.items) {
      if (!it.tags.includes(tag)) continue
      const base =
        it.id.startsWith('Compost') && itemIds.has(it.id.slice(7)) ? it.id.slice(7) : it.id
      if (!list.includes(base)) list.push(base)
    }
    classes.set(tag, list)
    return list
  }
  const classInput = (tag: string, amount: number): Flow => {
    if (elementIds.has(tag) || itemIds.has(tag)) return { tag, amount }
    const list = members(tag)
    if (list.length === 0) return { tag, amount }
    return {
      tag: list[0]!,
      amount,
      anyOf: list.length > 1 ? list : undefined,
      anyOfName: CLASS_NAMES[tag] ?? tag.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(),
    }
  }

  // Fabricator recipes. Alternative ingredients become separate processes so a chain can
  // name the one it uses. A "doNotConsume" ingredient is not a catalyst: the fabricator
  // transfers its mass into the product (the Dehydrator's food becomes the dried food),
  // so it is an input like any other.
  const buildingDlc = new Map(d.buildings.map((b) => [b.id, b.dlc]))
  const operated = new Map((d.fabricators ?? []).map((f) => [f.id, f.duplicantOperated]))
  const cycle = d.tuning.secondsPerCycle
  for (const r of d.recipes) {
    const combos = cartesian(r.ingredients.map((i) => i.options))
    for (const fab of r.fabricators) {
      if (unnamed(d.names[fab] ?? '')) continue
      for (const combo of combos) {
        const extras: string[] = []
        if (r.radboltsIn) extras.push(`${r.radboltsIn} radbolts`)
        add({
          kind: 'recipe',
          via: label(fab),
          viaId: fab,
          inputs: combo.map((o) => classInput(o.tag, o.amount)),
          outputs: r.results.map((x) => ({ tag: x.tag, amount: x.amount })),
          dlc: buildingDlc.get(fab) ?? NONE,
          needs: { building: fab, extras: extras.length ? extras : undefined },
          notes: [],
          seconds: r.time,
          throughput:
            r.time > 0
              ? {
                  runsPerCycle: cycle / r.time,
                  instance: 'building',
                  operated: operated.get(fab) ?? true,
                }
              : undefined,
        })
      }
    }
  }

  // Continuous converters: rates per second on both sides, normalised to per second. A
  // building the game has no name for is not in the build menu, so it cannot be used.
  const featureIds = new Set((d.features ?? []).map((f) => f.id))
  for (const b of d.buildings) {
    if (unnamed(b.name)) continue
    const inputs = b.inputs.map((f) => classInput(f.tag, f.rate ?? f.amountPerUse ?? 0))
    const outputs = b.outputs
      .map((f) => ({ tag: f.tag, amount: f.rate ?? f.amountPerUse ?? 0 }))
      .filter((f) => f.amount > 0 && (elementIds.has(f.tag) || d.names[f.tag]))
    if (outputs.length === 0) continue
    const perUse = b.outputs.some((f) => f.amountPerUse !== undefined)
    // A per-use building (toilet, shower) is used once a cycle by each Duplicant, as fast as
    // a bladder fills its 100 points; a continuous one runs its per-second amounts 600 times
    // a cycle.
    const usesPerCycle = ((d.tuning.bladderPerSecond ?? 100 / cycle) * cycle) / 100
    // A building on a terrain feature (an Oil Well on an Oil Reservoir) is one per feature
    // found, not one of as many as the colony cares to build.
    const feature = b.attachesTo && featureIds.has(b.attachesTo) ? b.attachesTo : undefined
    const throughput: Throughput = perUse
      ? { runsPerCycle: usesPerCycle, instance: 'duplicant' }
      : { runsPerCycle: cycle, instance: feature ? 'feature' : 'building' }
    // An input the building only accepts hot enough (the Steam Turbine's 125 C steam): steam
    // straight off boiling water sits at the boiling point and has to be heated further.
    const extras = b.inputs
      .filter((f) => f.minTemperatureK !== undefined)
      .map((f) => `${label(f.tag)} at ${celsius(f.minTemperatureK!)} °C or hotter`)
    // An Oil Well stores the gas it gives off until a Duplicant lets it out, then stalls.
    if (b.outputs.some((f) => f.via === 'OilWellCap'))
      extras.push('a Duplicant lets its gas out now and then')
    add({
      kind: 'converter',
      via: b.name,
      viaId: b.id,
      inputs: inputs.filter((f) => f.amount > 0),
      outputs,
      dlc: b.dlc,
      needs: { building: b.id, feature, extras: extras.length ? extras : undefined },
      pipedOutput: b.outputConduit !== undefined,
      incidental: inputs.length === 0 || undefined,
      throughput,
      notes: perUse ? ['per use'] : ['per second while running'],
      seconds: perUse ? undefined : 1,
    })
  }

  // Critters.
  const critters = new Map<string, { name: string; dlc: DlcRestriction }>()
  /** Adults that lay eggs or eat: what a ranch can breed, as opposed to a robot or a one-off. */
  const ranchable = new Set(
    d.critters.filter((c) => !c.adult && (c.egg || c.diet?.length)).map((c) => c.id),
  )
  // A diet of a living plant is priced per unit of growth, except a Bonbon Tree's, drunk by
  // the kilogram.
  const plantsById = new Map(d.plants.map((p) => [p.id, p]))
  const growthUnits = (tag: string): boolean => {
    const grazing = plantsById.get(tag)?.grazing
    return !!grazing?.length && !grazing.some((g) => g.kind === 'storage')
  }
  for (const c of d.critters) {
    critters.set(c.id, { name: c.name, dlc: c.dlc })
    // Babies eat and die like their adults; only the adult is listed (and ranched).
    if (!c.adult) {
      // One process per (output, rate): a Pacu that eats thirty seeds alike is one step with
      // thirty alternative inputs, not thirty steps.
      const groups = new Map<
        string,
        { produces: string; rate: number; caloriesPerKg: number; foods: string[] }
      >()
      for (const diet of c.diet ?? []) {
        if (!diet.produces || diet.produces === 'Vacuum' || diet.produces === 'Void') continue
        const key = `${diet.produces}|${diet.producedPerKgEaten}|${diet.caloriesPerKg}`
        const g = groups.get(key) ?? {
          produces: diet.produces,
          rate: diet.producedPerKgEaten,
          caloriesPerKg: diet.caloriesPerKg,
          foods: [],
        }
        for (const food of diet.eats) if (!g.foods.includes(food)) g.foods.push(food)
        groups.set(key, g)
      }
      for (const g of groups.values()) {
        // A fed stable breeds, and every critter born ends as one death drop, as a surplus
        // hatchling put down or as old age, so what the critter drops comes with its diet: per
        // kilogram eaten, the eggs laid in the time that kilogram feeds (or, for a critter that
        // lays none, the share of a lifetime it is).
        const happiness = options.happiness?.(c.id) ?? DEFAULT_HAPPINESS
        const kgPerCycle = c.caloriesBurnedPerCycle
          ? (c.caloriesBurnedPerCycle * metabolismFactor(happiness)) / g.caloriesPerKg
          : 0
        const bornPerCycle = c.cyclesPerEgg
          ? fertilityFactor(d, happiness) / c.cyclesPerEgg
          : c.lifespanCycles
            ? 1 / c.lifespanCycles
            : 0
        const drops: Flow[] =
          kgPerCycle > 0 && bornPerCycle > 0
            ? (c.deathDrops ?? []).map((x) => ({
                tag: x.tag,
                amount: (x.count * bornPerCycle) / kgPerCycle,
              }))
            : []
        add({
          kind: 'diet',
          via: c.name,
          viaId: c.id,
          inputs: [
            { tag: g.foods[0]!, amount: 1, anyOf: g.foods.length > 1 ? g.foods : undefined },
          ],
          outputs: [{ tag: g.produces, amount: g.rate }, ...drops],
          dlc: c.dlc,
          needs: { critter: c.id },
          throughput:
            kgPerCycle > 0 ? { runsPerCycle: kgPerCycle, instance: 'critter' } : undefined,
          wildFactor: d.tuning.wildCritterCalorieBurnRatio,
          notes: c.caloriesBurnedPerCycle
            ? [
                `eats ${fmt(c.caloriesBurnedPerCycle / g.caloriesPerKg)} ${growthUnits(g.foods[0]!) ? 'units of growth' : 'kg'} a cycle when tame, ${fmt((c.caloriesBurnedPerCycle * d.tuning.wildCritterCalorieBurnRatio) / g.caloriesPerKg)} wild`,
              ]
            : [],
        })
      }
    }
    for (const drop of c.adult ? [] : (c.deathDrops ?? [])) {
      add({
        kind: 'drop',
        via: c.name,
        viaId: c.id,
        inputs: [{ tag: c.id, amount: 1 }],
        outputs: [{ tag: drop.tag, amount: drop.count }],
        dlc: c.dlc,
        needs: { critter: c.id },
        throughput: c.lifespanCycles
          ? { runsPerCycle: 1 / c.lifespanCycles, instance: 'critter' }
          : undefined,
        notes: c.lifespanCycles
          ? [`on death, after ${fmt(c.lifespanCycles)} cycles of old age`]
          : ['on death'],
      })
    }
    const eggHappiness = options.happiness?.(c.id) ?? DEFAULT_HAPPINESS
    if (c.egg && c.cyclesPerEgg && fertilityFactor(d, eggHappiness) > 0) {
      // Normal ranching: a tame, fed adult lays an egg every so many cycles, faster the happier
      // it is (none at all when miserable), so an egg costs what the adult eats in that time,
      // plus what it drinks at a fountain if the colony runs one. The diet with the most foods
      // stands for its menu.
      const happiness = eggHappiness
      const cyclesPerEgg = c.cyclesPerEgg / fertilityFactor(d, happiness)
      const diet = (c.diet ?? [])
        .filter((x) => x.caloriesPerKg > 0 && x.eats.length)
        .sort((a, b) => b.eats.length - a.eats.length)[0]
      const eats =
        diet && c.caloriesBurnedPerCycle
          ? (c.caloriesBurnedPerCycle * metabolismFactor(happiness) * cyclesPerEgg) /
            diet.caloriesPerKg
          : 0
      const drink = options.drink
      const inputs: Flow[] =
        eats > 0 && diet
          ? [
              {
                tag: diet.eats[0]!,
                amount: eats,
                anyOf: diet.eats.length > 1 ? diet.eats : undefined,
              },
            ]
          : []
      add({
        kind: 'egg',
        via: c.name,
        viaId: c.id,
        inputs,
        outputs: [{ tag: c.egg, amount: 1 }],
        dlc: c.dlc,
        needs: { critter: c.id },
        throughput: { runsPerCycle: 1 / cyclesPerEgg, instance: 'critter' },
        upkeep: drink ? [{ tag: drink.tag, amount: drink.kgPerCycle * cyclesPerEgg }] : undefined,
        notes: [
          `one every ${fmt(cyclesPerEgg)} cycles when tame and fed, at happiness ${fmt(happiness)}`,
          ...(drink
            ? [
                `drinks ${fmt(drink.kgPerCycle)} kg of ${label(drink.tag)} a cycle at a Critter Fountain`,
              ]
            : []),
        ],
        wildFactor: d.tuning.wildCritterGrowthModifier,
      })
    }
    // A Moo lays no egg: kept well fed, its beckoning meter fills over so many cycles, then
    // it calls a Moo Comet down from space, which leaves a new Moo (a Husky Moo now and
    // then). What it eats in that time is the cost, as with an egg; a wild Moo beckons too,
    // but a wild one is not fed, so this is the tame rate.
    if (c.beckons && c.beckons.spawns.length) {
      const diet = (c.diet ?? [])
        .filter((x) => x.caloriesPerKg > 0 && x.eats.length)
        .sort((a, b) => b.eats.length - a.eats.length)[0]
      const eats =
        diet && c.caloriesBurnedPerCycle
          ? (c.caloriesBurnedPerCycle * c.beckons.cyclesPerBeckon) / diet.caloriesPerKg
          : 0
      const spawns = c.beckons.spawns.filter((x) => d.critters.some((k) => k.id === x.critter))
      const main = spawns.reduce((a, b) => (b.weight > a.weight ? b : a), spawns[0]!)
      add({
        kind: 'beckon',
        via: c.name,
        viaId: c.id,
        inputs:
          eats > 0 && diet
            ? [
                {
                  tag: diet.eats[0]!,
                  amount: eats,
                  anyOf: diet.eats.length > 1 ? diet.eats : undefined,
                },
              ]
            : [],
        outputs: spawns.map((x) => ({ tag: x.critter, amount: x.weight })),
        dlc: c.dlc,
        needs: { critter: c.id },
        throughput: { runsPerCycle: 1 / c.beckons.cyclesPerBeckon, instance: 'critter' },
        primaryOutput: main.critter,
        notes: [
          `one Moo Comet every ${fmt(c.beckons.cyclesPerBeckon)} cycles while well fed, carrying ${spawns
            .map((x) => `a ${label(x.critter)} ${fmt(x.weight * 100)}% of the time`)
            .join(' or ')}`,
        ],
      })
    }
    if (c.egg && !c.adult && d.names[c.egg]) {
      // The egg becomes the adult: one critter per egg, after incubation and growing up.
      add({
        kind: 'hatch',
        via: label(c.egg),
        viaId: c.egg,
        inputs: [{ tag: c.egg, amount: 1 }],
        outputs: [{ tag: c.id, amount: 1 }],
        dlc: c.dlc,
        needs: { critter: c.id },
        notes: ['incubated, then raised to an adult'],
      })
    }
    // One per baby that grows up, so one per egg the parent lays; none when the parent is miserable.
    const parent = c.adult ? d.critters.find((a) => a.id === c.adult) : undefined
    const parentFertility = parent?.cyclesPerEgg
      ? fertilityFactor(d, options.happiness?.(parent.id) ?? DEFAULT_HAPPINESS)
      : 1
    if (c.growDrop && parentFertility > 0) {
      add({
        kind: 'grow',
        via: c.name,
        viaId: c.id,
        inputs: [],
        outputs: [{ tag: c.growDrop, amount: 1 }],
        dlc: c.dlc,
        needs: { critter: c.id },
        throughput: parent?.cyclesPerEgg
          ? { runsPerCycle: parentFertility / parent.cyclesPerEgg, instance: 'critter' }
          : undefined,
        notes: ['when it grows up'],
      })
    }
    if (c.shear && !c.adult) {
      const mass = c.shear.mass ?? 1
      add({
        kind: 'shear',
        via: c.name,
        viaId: c.id,
        inputs: [],
        outputs: [{ tag: c.shear.item, amount: mass }],
        dlc: c.dlc,
        needs: { critter: c.id, extras: ['in ' + label(c.shear.atmosphere)] },
        throughput: c.shear.seconds
          ? { runsPerCycle: cycle / c.shear.seconds, instance: 'critter' }
          : undefined,
        notes: c.shear.seconds
          ? [`${fmt(mass)} kg every ${fmt(c.shear.seconds / cycle)} cycles when tame`]
          : ['grows scales to shear'],
      })
    }
    // What a fed adult eats over some cycles, for products that come from being fed: the
    // diet with the most foods stands for its menu, as for eggs. Empty when nothing is known.
    const fedInputs = (cycles: number, onlyFood?: string | null): Flow[] => {
      const diets = (c.diet ?? []).filter((x) => x.caloriesPerKg > 0 && x.eats.length)
      const diet = (onlyFood ? diets.filter((x) => x.eats.includes(onlyFood)) : diets).sort(
        (a, b) => b.eats.length - a.eats.length,
      )[0]
      if (!diet || !c.caloriesBurnedPerCycle) return []
      const eats = onlyFood ? [onlyFood] : diet.eats
      return [
        {
          tag: eats[0]!,
          amount: (c.caloriesBurnedPerCycle * cycles) / diet.caloriesPerKg,
          anyOf: eats.length > 1 ? eats : undefined,
        },
      ]
    }
    const station = (id: string) => 'at ' + (d.names[id] ?? id)
    const aquatic = c.id === 'Squid' || c.id === 'SeaHorse'
    if (c.milk && !c.adult && c.milk.ratePercentPerSecond > 0) {
      // The well-fed effect lasts as long as the critter keeps eating, so a fed adult fills up
      // in 100 / (rate × 600) cycles and is milked for its whole capacity each time.
      const cyclesPerMilking = 100 / (c.milk.ratePercentPerSecond * cycle)
      add({
        kind: 'milk',
        via: c.name,
        viaId: c.id,
        inputs: fedInputs(cyclesPerMilking),
        outputs: [{ tag: c.milk.element, amount: c.milk.capacity }],
        dlc: c.dlc,
        needs: {
          critter: c.id,
          extras: [station(aquatic ? 'UnderwaterMilkingStation' : 'MilkingStation')],
        },
        throughput: { runsPerCycle: 1 / cyclesPerMilking, instance: 'critter' },
        pipedOutput: true,
        notes: [
          `${fmt(c.milk.capacity)} kg every ${fmt(cyclesPerMilking)} cycles when tame and fed`,
        ],
      })
    }
    const milkHappiness = options.happiness?.(c.id) ?? DEFAULT_HAPPINESS
    if (
      c.fertilityMilk &&
      !c.adult &&
      c.cyclesPerEgg &&
      fertilityFactor(d, milkHappiness) > 0 &&
      !(c.fertilityMilk.requiresHappy && milkHappiness < 1)
    ) {
      // Milking spends part of the fertility bar, so each milking costs that fraction of an
      // egg's wait (faster when happier, like laying) and the eggs it would have become. Some
      // critters give milk only while happy, and a miserable one has no fertility to spend.
      const happiness = milkHappiness
      const cyclesPerEgg = c.cyclesPerEgg / fertilityFactor(d, happiness)
      const cyclesPerMilking = cyclesPerEgg * c.fertilityMilk.fertilityConsumed
      add({
        kind: 'milk',
        via: c.name,
        viaId: c.id,
        inputs: fedInputs(cyclesPerMilking),
        outputs: [{ tag: c.fertilityMilk.element, amount: c.fertilityMilk.mass }],
        dlc: c.dlc,
        needs: {
          critter: c.id,
          extras: [station(aquatic ? 'UnderwaterMilkingStation' : 'MilkingStation')],
        },
        throughput: { runsPerCycle: 1 / cyclesPerMilking, instance: 'critter' },
        pipedOutput: true,
        notes: [
          `${fmt(c.fertilityMilk.mass)} kg every ${fmt(cyclesPerMilking)} cycles at happiness ${fmt(happiness)}; each milking spends ${fmt(c.fertilityMilk.fertilityConsumed * 100)}% of an egg${c.fertilityMilk.requiresHappy ? ', only when happy' : ''}`,
        ],
      })
    }
    if (c.wellFedShear && !c.adult && c.wellFedShear.growthCycles > 0) {
      const w = c.wellFedShear
      const only = w.requiredDiet ?? undefined
      add({
        kind: 'shear',
        via: c.name,
        viaId: c.id,
        inputs: fedInputs(w.growthCycles, only),
        outputs: [{ tag: w.item, amount: w.mass }],
        dlc: c.dlc,
        needs: { critter: c.id, extras: only ? ['fed ' + label(only)] : undefined },
        throughput: { runsPerCycle: 1 / w.growthCycles, instance: 'critter' },
        notes: [
          `${fmt(w.mass)} kg every ${fmt(w.growthCycles)} cycles when tame and fed${only ? ' ' + label(only) : ''}`,
        ],
      })
    }
  }

  // Plants.
  const mutations = new Map((d.plantMutations ?? []).map((m) => [m.id, m]))
  // Critters that tend crops (a Mimika pollinating, a Sweetle or Grubgrub tending), each with
  // its growth bonus, how long a visit lasts, and how many plants a cycle it gets round. An
  // older dump has only the Mimika's numbers, under tuning.
  const tenders = d.critters
    .filter((c) => c.tends)
    .map((c) => ({ id: c.id, name: c.name, ...c.tends! }))
    .sort((a, b) => b.growthBonus - a.growthBonus)
  if (!tenders.length && d.tuning.pollination) {
    const m = d.tuning.pollination
    tenders.push({
      id: 'Butterfly',
      name: d.critters.find((c) => c.id === 'Butterfly')?.name ?? 'Mimika',
      effect: 'ButterflyPollinated',
      growthBonus: m.growthBonus,
      effectSeconds: m.effectSeconds,
      plantsPerCycle: d.tuning.secondsPerCycle / m.searchCooldownSeconds,
    })
  }
  // A tree with harvestable branches besides its trunk (a Bonbon Tree: nectar from the trunk,
  // wood from the branches) is two harvests on one plant; the branch harvest gets a plant entry
  // of its own here, under the tree's name, with the tree's inputs and nothing else of its own.
  const cropPlants: (typeof d.plants)[number][] = d.plants.flatMap((p) =>
    p.branchCrop
      ? [
          p,
          {
            ...p,
            name: `${p.name} branches`,
            crop: p.branchCrop,
            branchCrop: undefined,
            seed: undefined,
            skilledHarvestBonus: undefined,
            grazing: undefined,
            prey: undefined,
          },
        ]
      : [p],
  )
  for (const p of cropPlants) {
    if (p.crop) {
      // A mutated seed scales the plant's yield, growth time, and water or fertilizer use,
      // may add a bonus crop, and needs radiation to stay viable.
      const mutationId = options.mutation?.(p.id)
      const mutation = mutationId ? mutations.get(mutationId) : undefined
      const mutated = mutation && mutationFits(mutation, p.id) ? mutation : undefined
      const yieldScale = 1 + (mutated?.yield ?? 0)
      const growthScale = 1 + (mutated?.growth ?? 0)
      const usageScale = 1 + (mutated?.usage ?? 0)
      const duration = p.crop.durationSeconds * growthScale
      // Farmer's Touch from a Farm Station: a Duplicant turns Fertilizer into a tool and applies
      // it to the plant, which grows 1 + growthBonus times as fast while the effect lasts (the
      // mutation scales the growth needed, the touch the rate, so the two multiply). Kept up,
      // each harvest costs its share of the applications; the plant's own irrigation and
      // fertilizer run by the second, so a quicker harvest takes less of them. A Farm room is
      // needed, so a wild plant, and a grazed one in a stable, go without.
      const tinker = d.tuning.farmTinker
      const touched = tinker && options.farmTinker?.applied(p.id) ? tinker : undefined
      const touchSeconds = tinker
        ? tinker.effectSeconds * (1 + tinker.botanistBonus * (options.farmTinker?.botanist ?? 0))
        : 0
      const touchCycles = touchSeconds / d.tuning.secondsPerCycle
      const tended = touched ? duration / (1 + touched.growthBonus) : duration
      const cycles = tended / d.tuning.secondsPerCycle
      const inputs: Flow[] = []
      for (const f of p.irrigation ?? [])
        inputs.push({ tag: f.tag, amount: f.rate * tended * usageScale, role: 'irrigation' })
      for (const f of p.fertilizer ?? [])
        inputs.push({ tag: f.tag, amount: f.rate * tended * usageScale, role: 'fertilizer' })
      // A gas the plant breathes from the air around it, by the second while it grows.
      for (const f of p.consumes ?? [])
        inputs.push({ tag: f.tag, amount: f.rate * tended, role: 'atmosphere' })
      if (touched) {
        // A plant fertilized with the station's own material takes more of the same input.
        const kg = (touched.fertilizerKg * tended) / touchSeconds
        const own = inputs.find((f) => f.tag === touched.material)
        if (own) own.amount += kg
        else inputs.push({ tag: touched.material, amount: kg, role: 'tending' })
      }
      // A bonus crop of the plant's own kind (Bonus Lice on a Mealwood) is simply more of it.
      const bonusCrop = mutated?.bonusCrop
      const extraOwn = bonusCrop && bonusCrop.tag === p.crop.item ? bonusCrop.amount : 0
      const bonus: Flow[] =
        bonusCrop && bonusCrop.tag !== p.crop.item
          ? [{ tag: bonusCrop.tag, amount: bonusCrop.amount }]
          : []
      const count = p.crop.count * yieldScale + extraOwn
      const mutationName = mutated ? ` (${mutated.name})` : ''
      // A flytrap eats one grown critter of the kinds it accepts before each harvest.
      const prey = (p.prey ?? []).filter((id) => ranchable.has(id))
      if (prey.length)
        inputs.push({
          tag: prey[0]!,
          amount: 1,
          anyOf: prey.length > 1 ? prey : undefined,
          anyOfName: 'critter it can catch',
          role: 'prey',
        })
      const extras: string[] = []
      if (p.branches) extras.push(`from up to ${p.branches} branches or vines of one plant`)
      if (p.needsPollination) extras.push('needs pollination (Mimika, Sweetle, or Grubgrub)')
      if (mutated?.minRadiation) extras.push(`needs ${fmt(mutated.minRadiation)} rads of radiation`)
      if (mutated?.minLux) extras.push(`needs ${fmt(mutated.minLux)} lux of light`)
      // A tending critter's visit speeds growth for a while; one keeps a handful of plants
      // going. The Mimika leaves the plant it comes from alone.
      const boost = tenders
        .filter((t) => t.id !== 'Butterfly' || p.crop!.item !== 'Butterfly')
        .map((t) => {
          const plants = Math.floor(t.effectSeconds / (d.tuning.secondsPerCycle / t.plantsPerCycle))
          const verb = t.id === 'Butterfly' ? 'pollinates' : 'tends'
          const first = !t.prefers?.length
            ? ''
            : t.prefers.includes(p.id)
              ? ', this plant first'
              : `, ${t.prefers.map((id) => 'a ' + label(id)).join(' or ')} first`
          return `+${fmt(t.growthBonus * 100)}% growth while a ${t.name} ${verb} it (one ${t.name} keeps up to ${plants} plants going${first})`
        })
      // The trade-off of Farmer's Touch: what it costs a plant each cycle against what it adds.
      const touch: string[] = []
      if (tinker && touchSeconds > 0) {
        const extra = (count * tinker.growthBonus) / (duration / d.tuning.secondsPerCycle)
        const cost = `${fmt(tinker.fertilizerKg)} kg ${label(tinker.material)} every ${fmt(touchCycles)} cycles per plant at Botanist ${fmt(options.farmTinker?.botanist ?? 0)}`
        const gain = `${fmt(extra)}${elementIds.has(p.crop.item) ? ' kg' : ''} more ${label(p.crop.item)} a cycle from each plant`
        touch.push(
          touched
            ? `under Farmer's Touch from a Farm Station: ${cost}, for +${fmt(tinker.growthBonus * 100)}% growth and ${gain}`
            : `Farmer's Touch from a Farm Station adds +${fmt(tinker.growthBonus * 100)}% growth for ${cost}: ${gain}`,
        )
      }
      // The farm's own conditions: the wild plant and the grazed one share the rest.
      const farmExtras = touched
        ? [
            ...extras,
            `kept under Farmer's Touch from a Farm Station: a Duplicant with the Farmer skill makes each ${fmt(touched.fertilizerKg)} kg of ${label(touched.material)} into ${label(touched.tool)} (${fmt(touched.toolSeconds)} s) and applies it (${fmt(touched.workSeconds)} s)`,
          ]
        : extras
      add({
        kind: 'crop',
        via: p.name + mutationName,
        viaId: p.id,
        inputs,
        outputs: [{ tag: p.crop.item, amount: count }, ...bonus],
        dlc: p.dlc,
        needs: { plant: p.id, extras: farmExtras.length ? farmExtras : undefined },
        throughput: { runsPerCycle: 1 / cycles, instance: 'plant' },
        notes: [
          `every ${fmt(cycles)} cycles when tended${touched ? " under Farmer's Touch" : ''}`,
          ...touch,
          ...boost,
        ],
        seconds: tended,
      })
      // Wild (pip-planted) plants need no irrigation or fertilizer and grow at a fraction of the rate.
      const wild = d.tuning.wildPlantGrowthModifier
      const wildCycles = duration / d.tuning.secondsPerCycle / wild
      // A wild plant still breathes, at its wild rate, for the whole longer growth.
      const breathes = (seconds: number): Flow[] =>
        (p.consumes ?? []).map((f) => ({
          tag: f.tag,
          amount: f.wildRate * seconds,
          role: 'atmosphere',
        }))
      add({
        kind: 'crop',
        via: `${p.name} (wild)` + mutationName,
        viaId: p.id,
        inputs: breathes(duration / wild),
        outputs: [{ tag: p.crop.item, amount: count }, ...bonus],
        dlc: p.dlc,
        needs: { plant: p.id, extras: extras.length ? extras : undefined },
        wildFactor: wild,
        throughput: { runsPerCycle: 1 / wildCycles, instance: 'plant' },
        notes: [
          `every ${fmt(wildCycles)} cycles when wild-planted; needs nothing${p.consumes?.length ? ' but the gas it breathes' : ''}`,
          ...boost,
        ],
        seconds: duration / wild,
      })
      // A critter that eats the plant itself (a Drecko at a Mealwood, a Glo Squid at a Tublia)
      // takes its growth instead of its harvest. Diets price that per unit, one unit being a
      // cycle of a tended plant's growth, so a plant yields its units per cycle for the same
      // irrigation and fertilizer a cycle of growing costs; a mutant growing slower holds more
      // maturity per unit and yields fewer. A Bonbon Tree is drunk from: kilograms it holds.
      for (const g of p.grazing ?? []) {
        const perCycle = g.kind === 'storage' ? g.unitsPerCycle : g.unitsPerCycle / growthScale
        const what =
          g.kind === 'storage'
            ? `${fmt(perCycle)} kg of ${label(g.tag!)} a cycle`
            : g.kind === 'branches'
              ? `${fmt(perCycle)} units of growth a cycle across its ${g.branches} branches`
              : `${fmt(perCycle)} units of growth a cycle`
        const perCycleInputs: Flow[] = []
        for (const f of p.irrigation ?? [])
          perCycleInputs.push({
            tag: f.tag,
            amount: f.rate * cycle * usageScale,
            role: 'irrigation',
          })
        for (const f of p.fertilizer ?? [])
          perCycleInputs.push({
            tag: f.tag,
            amount: f.rate * cycle * usageScale,
            role: 'fertilizer',
          })
        for (const f of p.consumes ?? [])
          perCycleInputs.push({ tag: f.tag, amount: f.rate * cycle, role: 'atmosphere' })
        add({
          kind: 'graze',
          via: p.name + mutationName,
          viaId: p.id,
          inputs: perCycleInputs,
          outputs: [{ tag: p.id, amount: perCycle }],
          dlc: p.dlc,
          needs: { plant: p.id, extras: extras.length ? extras : undefined },
          throughput: { runsPerCycle: 1, instance: 'plant' },
          notes: [`${what} when tended and eaten in place; a grazed plant is not harvested`],
        })
        if (g.wildUnitsPerCycle) {
          const wildPerCycle = g.wildUnitsPerCycle / growthScale
          add({
            kind: 'graze',
            via: `${p.name} (wild)` + mutationName,
            viaId: p.id,
            inputs: (p.consumes ?? []).map((f) => ({
              tag: f.tag,
              amount: f.wildRate * cycle,
              role: 'atmosphere' as const,
            })),
            outputs: [{ tag: p.id, amount: wildPerCycle }],
            dlc: p.dlc,
            needs: { plant: p.id, extras: extras.length ? extras : undefined },
            wildFactor: wild,
            throughput: { runsPerCycle: 1, instance: 'plant' },
            notes: [
              `${fmt(wildPerCycle)} units of growth a cycle when wild-planted; needs nothing`,
            ],
          })
        }
      }
      if (p.skilledHarvestBonus) {
        add({
          kind: 'harvest-bonus',
          via: p.name,
          viaId: p.id,
          inputs: [],
          outputs: [{ tag: p.skilledHarvestBonus.tag, amount: p.skilledHarvestBonus.amount }],
          dlc: p.dlc,
          needs: { plant: p.id },
          notes: ['when harvested by a skilled Duplicant'],
        })
      }
    }
    // A seed that is the crop (Sleet Wheat Grain, Nosh Bean: productionType Crop) is already the
    // harvest above; listing it again would be a free, input-less second source of the same thing.
    // A plant that converts one element into another all the while it lives (the Oxyfern:
    // carbon dioxide to oxygen), priced per cycle of one plant with its irrigation and
    // fertilizer for that cycle; wild, it runs at a fraction of the rate and needs nothing. The
    // converter's output multiplier is left out: the game's own figures, and the wiki's, are
    // the bare rates (an Oxyfern's 31 g/s of oxygen).
    if (p.converts) {
      const perCycleInputs: Flow[] = []
      for (const f of p.irrigation ?? [])
        perCycleInputs.push({ tag: f.tag, amount: f.rate * cycle, role: 'irrigation' })
      for (const f of p.fertilizer ?? [])
        perCycleInputs.push({ tag: f.tag, amount: f.rate * cycle, role: 'fertilizer' })
      for (const f of p.converts.inputs)
        perCycleInputs.push({ tag: f.tag, amount: f.rate * cycle, role: 'atmosphere' })
      const outputs = p.converts.outputs.map((f) => ({ tag: f.tag, amount: f.rate * cycle }))
      add({
        kind: 'converter',
        via: p.name,
        viaId: p.id,
        inputs: perCycleInputs,
        outputs,
        dlc: p.dlc,
        needs: { plant: p.id },
        throughput: { runsPerCycle: 1, instance: 'plant' },
        notes: ['per cycle while it lives, tended'],
        seconds: cycle,
      })
      const wildFactor = p.converts.wildFactor
      add({
        kind: 'converter',
        via: `${p.name} (wild)`,
        viaId: p.id,
        inputs: p.converts.inputs.map((f) => ({
          tag: f.tag,
          amount: f.rate * cycle * wildFactor,
          role: 'atmosphere' as const,
        })),
        outputs: outputs.map((f) => ({ tag: f.tag, amount: f.amount * wildFactor })),
        dlc: p.dlc,
        needs: { plant: p.id },
        wildFactor,
        throughput: { runsPerCycle: 1, instance: 'plant' },
        notes: [`per cycle while it lives, wild-planted; needs nothing but the gas it breathes`],
        seconds: cycle,
      })
    }
    if (p.seed && p.seed.count > 0 && p.seed.productionType !== 'Crop') {
      add({
        kind: 'seed',
        via: p.name,
        viaId: p.id,
        inputs: [],
        outputs: [{ tag: p.seed.item, amount: p.seed.count }],
        dlc: p.dlc,
        needs: { plant: p.id },
        notes: [p.seed.productionType.toLowerCase()],
      })
    }
  }

  // Sources.
  for (const g of d.geysers) {
    if (!elementIds.has(g.element)) continue
    add({
      kind: 'geyser',
      via: d.names['GeyserGeneric_' + g.id] ?? d.names[g.id] ?? label(g.element) + ' geyser',
      viaId: g.id,
      inputs: [],
      // One geyser yields its average per cycle; the amount below is that average.
      throughput: { runsPerCycle: 1, instance: 'geyser' },
      outputs: [{ tag: g.element, amount: (g.minRatePerCycle + g.maxRatePerCycle) / 2 }],
      dlc: g.dlc,
      needs: {},
      notes: [`${fmt(g.minRatePerCycle)}–${fmt(g.maxRatePerCycle)} kg/cycle average`],
    })
  }
  // A fissure bubbles gas while it builds up, then blocks until its drill clears it, which
  // drops a solid: one run is a build-up and a drilling, with the gas as its point.
  for (const f of d.features ?? []) {
    const v = f.vent
    if (!v || !elementIds.has(v.bubbleElement)) continue
    const seconds = v.buildUpSeconds + v.drill.seconds
    add({
      kind: 'converter',
      via: d.names[v.drill.building] ?? f.name,
      viaId: v.drill.building,
      inputs: [{ tag: v.drill.input, amount: v.drill.ratePerSecond * v.drill.seconds }],
      outputs: [
        { tag: v.bubbleElement, amount: v.bubbleRatePerSecond * v.buildUpSeconds },
        { tag: v.solidElement, amount: v.solidMass },
      ],
      dlc: f.dlc,
      needs: { building: v.drill.building, feature: f.id },
      throughput: { runsPerCycle: cycle / seconds, instance: 'feature' },
      primaryOutput: v.bubbleElement,
      notes: [`per eruption: ${fmt(v.buildUpSeconds / cycle)} cycles of gas, then drilled clear`],
      seconds,
    })
  }
  for (const w of d.worldgen) {
    for (const el of w.elements) {
      if (!elementIds.has(el)) continue
      add({
        kind: 'worldgen',
        via: worldName(w.name),
        viaId: w.world,
        inputs: [],
        outputs: [{ tag: el, amount: 1 }],
        dlc: w.dlc,
        needs: {},
        notes: ['in the terrain'],
      })
    }
  }
  // Base game only: the Starmap's destinations. Cargo is split between a destination's
  // elements by weights rolled once per destination, so each is roughly an equal share.
  for (const s of d.spaceDestinations ?? []) {
    if (!s.visitable) continue
    const dlc = destinationDlc(s.id)
    const elements = Object.keys(s.elements).filter((el) => elementIds.has(el))
    const share = elements.length ? `about 1/${elements.length} of each cargo load` : ''
    const recharge = s.cyclesToRecover
      ? `${fmt(s.massToRecover)} kg restored over ${s.cyclesToRecover} cycles`
      : ''
    const notes = [share, recharge].filter(Boolean)
    for (const el of elements)
      add({
        kind: 'starmap',
        via: s.name,
        viaId: s.id,
        inputs: [],
        outputs: [{ tag: el, amount: 1 }],
        dlc,
        needs: {},
        notes,
      })
    for (const [tag, count] of Object.entries(s.entities))
      add({
        kind: 'starmap',
        via: s.name,
        viaId: s.id,
        inputs: [],
        outputs: [{ tag, amount: count }],
        dlc,
        needs: {},
        notes: [`${count} per trip`],
      })
  }

  // An element no world holds, no geyser or space rock gives, and no process makes is not a
  // choice for an input, and a process that needs it can never run. That covers debug-only
  // elements (Pyrite, Radium) and Corium, which only a Research Reactor meltdown produces:
  // nothing a colony plans around, and nothing the dump records as a conversion.
  const obtainable = new Set<string>()
  for (const w of d.worldgen) for (const el of w.elements) obtainable.add(el)
  for (const g of d.geysers) obtainable.add(g.element)
  for (const poi of d.spacePois) for (const el of Object.keys(poi.elements)) obtainable.add(el)
  for (const s of d.spaceDestinations ?? [])
    for (const el of Object.keys(s.elements)) obtainable.add(el)
  for (const p of processes) for (const o of p.outputs) obtainable.add(o.tag)
  const exists = (tag: string) => !elementIds.has(tag) || obtainable.has(tag)
  const runnable: Process[] = []
  for (const p of processes) {
    let possible = true
    const inputs: Flow[] = []
    for (const f of p.inputs) {
      if (!f.anyOf) {
        if (!exists(f.tag)) possible = false
        inputs.push(f)
        continue
      }
      const options = f.anyOf.filter(exists)
      if (options.length === 0) possible = false
      else inputs.push({ ...f, tag: options[0]!, anyOf: options.length > 1 ? options : undefined })
    }
    if (possible) runnable.push(inputs === p.inputs ? p : { ...p, inputs })
  }
  processes.length = 0
  processes.push(...runnable)

  const byOutput = new Map<string, Process[]>()
  const byInput = new Map<string, Process[]>()
  for (const p of processes) {
    for (const o of p.outputs) push(byOutput, o.tag, p)
    for (const i of p.inputs) for (const tag of i.anyOf ?? [i.tag]) push(byInput, tag, p)
  }
  const kinds = new Map(d.items.map((it) => [it.id, it.kind]))
  const hotOnly = new Set(
    d.elements.filter((e) => !e.disabled && (e.lowTemp ?? 0) > EXTREME_HOT_K).map((e) => e.id),
  )
  return {
    processes,
    byOutput,
    byInput,
    critters,
    elements: elementIds,
    kinds,
    hotOnly,
    obtainable,
  }
}

function push(map: Map<string, Process[]>, key: string, p: Process) {
  const list = map.get(key)
  if (list) list.push(p)
  else map.set(key, [p])
}

function cartesian<T>(lists: T[][]): T[][] {
  return lists.reduce<T[][]>(
    (acc, list) => acc.flatMap((prefix) => list.map((x) => [...prefix, x])),
    [[]],
  )
}

/** Until a dump resolves them, some world names arrive as string keys ("STRINGS.WORLDS.MINIBASE.NAME"). */
function worldName(name: string): string {
  const m = /^STRINGS\.WORLDS\.(\w+)\.NAME$/.exec(name)
  if (!m || !m[1]) return name
  return m[1]
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function celsius(kelvin: number): string {
  return fmt(Math.round((kelvin - 273.15) * 10) / 10)
}

export function fmt(n: number): string {
  if (!isFinite(n)) return '∞'
  const abs = Math.abs(n)
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}
