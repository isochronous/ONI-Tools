import type { DlcRestriction, GameData } from '../data/types'
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
  | 'grow' // baby critter drops something on growing up
  | 'shear' // critter sheds an item when groomed/sheared
  | 'crop' // plant harvest
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
}

export interface Needs {
  critter?: string
  plant?: string
  building?: string
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
  /** What one instance is. */
  instance: 'building' | 'critter' | 'plant' | 'duplicant' | 'geyser'
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
    case 'rot':
      return p.viaId === 'RotPile' ? p.via + ' decomposes' : p.via + ' spoils'
    case 'egg':
      return p.via + ' lays an egg'
    case 'hatch':
      return p.via + ' hatches and grows up'
    case 'grow':
      return p.via + ' grows up'
    case 'shear':
      return p.via + ' sheared'
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
export interface GraphOptions {
  /** A tame critter's happiness, by critter id; tame and groomed is 4 (groomed +5, tame -1). */
  happiness?: (critterId: string) => number
}

/** Happiness of a tame, groomed critter: the +5 of grooming less the -1 of being tame. */
export const DEFAULT_HAPPINESS = 4

export function buildGraph(d: GameData, options: GraphOptions = {}): Graph {
  const processes: Process[] = []
  const elementIds = new Set(d.elements.filter((e) => !e.disabled).map((e) => e.id))
  const itemIds = new Set(d.items.map((it) => it.id))
  const add = (p: Omit<Process, 'id'> & { id?: string }) => {
    if (p.outputs.length === 0) return
    processes.push({ ...p, id: p.id ?? `${p.kind}:${p.viaId}:${processes.length}` })
  }

  // Elements: phase changes and off-gassing.
  for (const e of d.elements) {
    if (e.disabled) continue
    const dlc = elementDlc(e.dlc)
    // The sim changes phase only once the temperature is `buffer` kelvin past the nominal
    // point (Water freezes at -3 °C, not 0 °C), so the thresholds shown are the in-game ones.
    const buffer = d.tuning.stateTransitionBufferK ?? 0
    const transitions: [
      string,
      { id: string; massFraction: number } | undefined,
      string,
      boolean,
    ][] = [
      [
        e.highTempTarget,
        e.highTempOre,
        `heated in-world past ${celsius(e.highTemp + buffer)} °C`,
        e.highTemp + buffer > EXTREME_HOT_K,
      ],
      [
        e.lowTempTarget,
        e.lowTempOre,
        `cooled in-world below ${celsius(e.lowTemp - buffer)} °C`,
        e.lowTemp - buffer < EXTREME_COLD_K,
      ],
    ]
    for (const [target, ore, note, extreme] of transitions) {
      if (!target || target === 'Vacuum' || target === 'Void' || !elementIds.has(target)) continue
      const outputs: Flow[] = []
      if (ore && ore.massFraction > 0 && elementIds.has(ore.id)) {
        outputs.push({ tag: ore.id, amount: ore.massFraction })
        outputs.push({ tag: target, amount: 1 - ore.massFraction })
      } else {
        outputs.push({ tag: target, amount: 1 })
      }
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
        notes: ['off-gasses when exposed'],
      })
    }
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
    const throughput: Throughput = perUse
      ? { runsPerCycle: usesPerCycle, instance: 'duplicant' }
      : { runsPerCycle: cycle, instance: 'building' }
    // An input the building only accepts hot enough (the Steam Turbine's 125 C steam): steam
    // straight off boiling water sits at the boiling point and has to be heated further.
    const hot = b.inputs
      .filter((f) => f.minTemperatureK !== undefined)
      .map((f) => `${label(f.tag)} at ${celsius(f.minTemperatureK!)} °C or hotter`)
    add({
      kind: 'converter',
      via: b.name,
      viaId: b.id,
      inputs: inputs.filter((f) => f.amount > 0),
      outputs,
      dlc: b.dlc,
      needs: { building: b.id, extras: hot.length ? hot : undefined },
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
        // A fed population also dies of old age, so what a critter drops on death comes with
        // its diet: per kilogram eaten, the share of a lifetime that kilogram is.
        const kgPerCycle = c.caloriesBurnedPerCycle ? c.caloriesBurnedPerCycle / g.caloriesPerKg : 0
        const drops: Flow[] =
          kgPerCycle > 0 && c.lifespanCycles
            ? (c.deathDrops ?? []).map((x) => ({
                tag: x.tag,
                amount: x.count / (kgPerCycle * c.lifespanCycles!),
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
          throughput: c.caloriesBurnedPerCycle
            ? { runsPerCycle: c.caloriesBurnedPerCycle / g.caloriesPerKg, instance: 'critter' }
            : undefined,
          wildFactor: d.tuning.wildCritterCalorieBurnRatio,
          notes: c.caloriesBurnedPerCycle
            ? [
                `eats ${fmt(c.caloriesBurnedPerCycle / g.caloriesPerKg)} kg/cycle when tame, ${fmt((c.caloriesBurnedPerCycle * d.tuning.wildCritterCalorieBurnRatio) / g.caloriesPerKg)} wild`,
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
    if (c.egg && c.cyclesPerEgg) {
      // Normal ranching: a tame, fed adult lays an egg every so many cycles, faster the happier
      // it is, so an egg costs what the adult eats in that time. The diet with the most foods
      // stands for its menu.
      const happiness = options.happiness?.(c.id) ?? DEFAULT_HAPPINESS
      const cyclesPerEgg =
        c.cyclesPerEgg / (1 + (d.tuning.fertilityPerHappiness ?? 2.25) * Math.max(0, happiness))
      const diet = (c.diet ?? [])
        .filter((x) => x.caloriesPerKg > 0 && x.eats.length)
        .sort((a, b) => b.eats.length - a.eats.length)[0]
      const eats =
        diet && c.caloriesBurnedPerCycle
          ? (c.caloriesBurnedPerCycle * cyclesPerEgg) / diet.caloriesPerKg
          : 0
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
        notes: [
          `one every ${fmt(cyclesPerEgg)} cycles when tame and fed, at happiness ${fmt(happiness)}`,
        ],
        wildFactor: d.tuning.wildCritterGrowthModifier,
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
    if (c.growDrop) {
      // One per baby that grows up, so one per egg the parent lays.
      const parent = c.adult ? d.critters.find((a) => a.id === c.adult) : undefined
      add({
        kind: 'grow',
        via: c.name,
        viaId: c.id,
        inputs: [],
        outputs: [{ tag: c.growDrop, amount: 1 }],
        dlc: c.dlc,
        needs: { critter: c.id },
        throughput: parent?.cyclesPerEgg
          ? {
              runsPerCycle:
                (1 +
                  (d.tuning.fertilityPerHappiness ?? 2.25) *
                    Math.max(0, options.happiness?.(parent.id) ?? DEFAULT_HAPPINESS)) /
                parent.cyclesPerEgg,
              instance: 'critter',
            }
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
  }

  // Plants.
  for (const p of d.plants) {
    if (p.crop) {
      const cycles = p.crop.durationSeconds / d.tuning.secondsPerCycle
      const inputs: Flow[] = []
      for (const f of [...(p.irrigation ?? []), ...(p.fertilizer ?? [])])
        inputs.push({ tag: f.tag, amount: f.rate * p.crop.durationSeconds })
      // A flytrap eats one grown critter of the kinds it accepts before each harvest.
      const prey = (p.prey ?? []).filter((id) => ranchable.has(id))
      if (prey.length)
        inputs.push({
          tag: prey[0]!,
          amount: 1,
          anyOf: prey.length > 1 ? prey : undefined,
          anyOfName: 'critter it can catch',
        })
      const extras: string[] = []
      if (p.branches) extras.push(`across up to ${p.branches} vines on one plant`)
      if (p.needsPollination) extras.push('needs pollination (Mimika, Sweetle, or Grubgrub)')
      // A Mimika's visit speeds growth for a while; one keeps a handful of plants going.
      const pollination = d.tuning.pollination
      const boost =
        pollination && p.crop.item !== 'Butterfly'
          ? [
              `+${fmt(pollination.growthBonus * 100)}% growth while a Mimika pollinates it (one Mimika keeps up to ${Math.floor(pollination.effectSeconds / pollination.searchCooldownSeconds)} plants going)`,
            ]
          : []
      add({
        kind: 'crop',
        via: p.name,
        viaId: p.id,
        inputs,
        outputs: [{ tag: p.crop.item, amount: p.crop.count }],
        dlc: p.dlc,
        needs: { plant: p.id, extras: extras.length ? extras : undefined },
        throughput: { runsPerCycle: 1 / cycles, instance: 'plant' },
        notes: [`every ${fmt(cycles)} cycles when tended`, ...boost],
        seconds: p.crop.durationSeconds,
      })
      // Wild (pip-planted) plants need no irrigation or fertilizer and grow at a fraction of the rate.
      const wild = d.tuning.wildPlantGrowthModifier
      add({
        kind: 'crop',
        via: `${p.name} (wild)`,
        viaId: p.id,
        inputs: [],
        outputs: [{ tag: p.crop.item, amount: p.crop.count }],
        dlc: p.dlc,
        needs: { plant: p.id, extras: extras.length ? extras : undefined },
        wildFactor: wild,
        throughput: { runsPerCycle: wild / cycles, instance: 'plant' },
        notes: [`every ${fmt(cycles / wild)} cycles when wild-planted; needs nothing`, ...boost],
        seconds: p.crop.durationSeconds / wild,
      })
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
    if (p.seed && p.seed.count > 0) {
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
