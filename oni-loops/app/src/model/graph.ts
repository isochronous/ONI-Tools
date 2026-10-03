import type { DlcRestriction, GameData } from '../data/types'
import { label } from '../data/load'

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

export interface Flow {
  tag: string
  amount: number
}

export interface Needs {
  critter?: string
  plant?: string
  building?: string
  /** e.g. radbolts, power, a specific atmosphere */
  extras?: string[]
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
  /** For crops and diets: wild version yields this fraction and needs no inputs. */
  wildFactor?: number
  /** Human-readable qualifiers shown next to the step. */
  notes: string[]
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
}

const NONE: DlcRestriction = { requires: [], forbids: [] }

function elementDlc(dlc: string): DlcRestriction {
  return dlc ? { requires: [dlc], forbids: [] } : NONE
}

export function buildGraph(d: GameData): Graph {
  const processes: Process[] = []
  const elementIds = new Set(d.elements.filter((e) => !e.disabled).map((e) => e.id))
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
    const transitions: [string, { id: string; massFraction: number } | undefined, string][] = [
      [e.highTempTarget, e.highTempOre, `heated in-world past ${celsius(e.highTemp + buffer)} °C`],
      [e.lowTempTarget, e.lowTempOre, `cooled in-world below ${celsius(e.lowTemp - buffer)} °C`],
    ]
    for (const [target, ore, note] of transitions) {
      if (!target || target === 'Vacuum' || target === 'Void' || !elementIds.has(target)) continue
      const outputs: Flow[] = []
      if (ore && ore.massFraction > 0 && elementIds.has(ore.id)) {
        outputs.push({ tag: ore.id, amount: ore.massFraction })
        outputs.push({ tag: target, amount: 1 - ore.massFraction })
      } else {
        outputs.push({ tag: target, amount: 1 })
      }
      add({ kind: 'transition', via: label(e.id), viaId: e.id, inputs: [{ tag: e.id, amount: 1 }], outputs, dlc, needs: {}, notes: [note] })
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

  // Fabricator recipes. Alternative ingredients become separate processes so a chain can
  // name the one it uses. A "doNotConsume" ingredient is not a catalyst: the fabricator
  // transfers its mass into the product (the Dehydrator's food becomes the dried food),
  // so it is an input like any other.
  const buildingDlc = new Map(d.buildings.map((b) => [b.id, b.dlc]))
  for (const r of d.recipes) {
    const combos = cartesian(r.ingredients.map((i) => i.options))
    for (const fab of r.fabricators) {
      for (const combo of combos) {
        const extras: string[] = []
        if (r.radboltsIn) extras.push(`${r.radboltsIn} radbolts`)
        add({
          kind: 'recipe',
          via: label(fab),
          viaId: fab,
          inputs: combo.map((o) => ({ tag: o.tag, amount: o.amount })),
          outputs: r.results.map((x) => ({ tag: x.tag, amount: x.amount })),
          dlc: buildingDlc.get(fab) ?? NONE,
          needs: { building: fab, extras: extras.length ? extras : undefined },
          notes: [],
          seconds: r.time,
        })
      }
    }
  }

  // Continuous converters: rates per second on both sides, normalised to per second.
  for (const b of d.buildings) {
    const inputs = b.inputs.map((f) => ({ tag: f.tag, amount: f.rate ?? f.amountPerUse ?? 0 }))
    const outputs = b.outputs
      .map((f) => ({ tag: f.tag, amount: f.rate ?? f.amountPerUse ?? 0 }))
      .filter((f) => f.amount > 0 && (elementIds.has(f.tag) || d.names[f.tag]))
    if (outputs.length === 0) continue
    const perUse = b.outputs.some((f) => f.amountPerUse !== undefined)
    add({
      kind: 'converter',
      via: b.name,
      viaId: b.id,
      inputs: inputs.filter((f) => f.amount > 0),
      outputs,
      dlc: b.dlc,
      needs: { building: b.id },
      notes: perUse ? ['per use'] : ['per second while running'],
      seconds: perUse ? undefined : 1,
    })
  }

  // Critters.
  const critters = new Map<string, { name: string; dlc: DlcRestriction }>()
  for (const c of d.critters) {
    critters.set(c.id, { name: c.name, dlc: c.dlc })
    for (const diet of c.diet ?? []) {
      if (!diet.produces || diet.produces === 'Vacuum' || diet.produces === 'Void') continue
      for (const food of diet.eats) {
        add({
          kind: 'diet',
          via: c.name,
          viaId: c.id,
          inputs: [{ tag: food, amount: 1 }],
          outputs: [{ tag: diet.produces, amount: diet.producedPerKgEaten }],
          dlc: c.dlc,
          needs: { critter: c.id },
          wildFactor: d.tuning.wildCritterCalorieBurnRatio,
          notes: c.caloriesBurnedPerCycle
            ? [`eats ${fmt(c.caloriesBurnedPerCycle / diet.caloriesPerKg)} kg/cycle when tame`]
            : [],
        })
      }
    }
    for (const drop of c.deathDrops ?? []) {
      add({ kind: 'drop', via: c.name, viaId: c.id, inputs: [{ tag: c.id, amount: 1 }], outputs: [{ tag: drop.tag, amount: drop.count }], dlc: c.dlc, needs: { critter: c.id }, notes: ['on death'] })
    }
    if (c.egg && c.cyclesPerEgg) {
      add({ kind: 'egg', via: c.name, viaId: c.id, inputs: [], outputs: [{ tag: c.egg, amount: 1 }], dlc: c.dlc, needs: { critter: c.id }, notes: [`one every ${fmt(c.cyclesPerEgg)} cycles when tame and fed`], wildFactor: d.tuning.wildCritterGrowthModifier })
    }
    if (c.growDrop) {
      add({ kind: 'grow', via: c.name, viaId: c.id, inputs: [], outputs: [{ tag: c.growDrop, amount: 1 }], dlc: c.dlc, needs: { critter: c.id }, notes: ['when it grows up'] })
    }
    if (c.shear) {
      add({ kind: 'shear', via: c.name, viaId: c.id, inputs: [], outputs: [{ tag: c.shear.item, amount: 1 }], dlc: c.dlc, needs: { critter: c.id, extras: ['in ' + label(c.shear.atmosphere)] }, notes: ['grows scales to shear'] })
    }
  }

  // Plants.
  for (const p of d.plants) {
    if (p.crop) {
      const cycles = p.crop.durationSeconds / d.tuning.secondsPerCycle
      const inputs: Flow[] = []
      for (const f of [...(p.irrigation ?? []), ...(p.fertilizer ?? [])]) inputs.push({ tag: f.tag, amount: f.rate * p.crop.durationSeconds })
      add({
        kind: 'crop',
        via: p.name,
        viaId: p.id,
        inputs,
        outputs: [{ tag: p.crop.item, amount: p.crop.count }],
        dlc: p.dlc,
        needs: { plant: p.id },
        wildFactor: d.tuning.wildPlantGrowthModifier,
        notes: [`every ${fmt(cycles)} cycles when domesticated`],
        seconds: p.crop.durationSeconds,
      })
      if (p.skilledHarvestBonus) {
        add({ kind: 'harvest-bonus', via: p.name, viaId: p.id, inputs: [], outputs: [{ tag: p.skilledHarvestBonus.tag, amount: p.skilledHarvestBonus.amount }], dlc: p.dlc, needs: { plant: p.id }, notes: ['when harvested by a skilled Duplicant'] })
      }
    }
    if (p.seed && p.seed.count > 0) {
      add({ kind: 'seed', via: p.name, viaId: p.id, inputs: [], outputs: [{ tag: p.seed.item, amount: p.seed.count }], dlc: p.dlc, needs: { plant: p.id }, notes: [p.seed.productionType.toLowerCase()] })
    }
  }

  // Sources.
  for (const g of d.geysers) {
    if (!elementIds.has(g.element)) continue
    add({ kind: 'geyser', via: label(g.id) === g.id ? label(g.element) + ' geyser' : label(g.id), viaId: g.id, inputs: [], outputs: [{ tag: g.element, amount: (g.minRatePerCycle + g.maxRatePerCycle) / 2 }], dlc: g.dlc, needs: {}, notes: [`${fmt(g.minRatePerCycle)}–${fmt(g.maxRatePerCycle)} kg/cycle average`] })
  }
  for (const w of d.worldgen) {
    for (const el of w.elements) {
      if (!elementIds.has(el)) continue
      add({ kind: 'worldgen', via: worldName(w.name), viaId: w.world, inputs: [], outputs: [{ tag: el, amount: 1 }], dlc: w.dlc, needs: {}, notes: ['in the terrain'] })
    }
  }

  const byOutput = new Map<string, Process[]>()
  const byInput = new Map<string, Process[]>()
  for (const p of processes) {
    for (const o of p.outputs) push(byOutput, o.tag, p)
    for (const i of p.inputs) push(byInput, i.tag, p)
  }
  return { processes, byOutput, byInput, critters, elements: elementIds }
}

function push(map: Map<string, Process[]>, key: string, p: Process) {
  const list = map.get(key)
  if (list) list.push(p)
  else map.set(key, [p])
}

function cartesian<T>(lists: T[][]): T[][] {
  return lists.reduce<T[][]>((acc, list) => acc.flatMap((prefix) => list.map((x) => [...prefix, x])), [[]])
}

/** Until a dump resolves them, some world names arrive as string keys ("STRINGS.WORLDS.MINIBASE.NAME"). */
function worldName(name: string): string {
  const m = /^STRINGS\.WORLDS\.(\w+)\.NAME$/.exec(name)
  if (!m || !m[1]) return name
  return m[1].toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
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
