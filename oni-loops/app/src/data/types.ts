/**
 * Shape of data/<build>.json as written by tools/OniDataDump and tools/import-dump.py.
 * Amounts are the game's own units: kg for recipes and drops, kg/s for building rates,
 * kcal for calories. Tags are the game's internal ids; names come from `names`.
 */

export type DlcId = 'EXPANSION1_ID' | 'DLC2_ID' | 'DLC3_ID' | 'DLC4_ID' | 'DLC5_ID'

export interface DlcRestriction {
  requires: string[]
  forbids: string[]
}

export interface GameInfo {
  build: string
  dumpedAt: string
  activeDlcs: string[]
}

export interface Tuning {
  /** How fast a Duplicant's bladder fills, out of 100 (1/6 per second: one toilet visit a cycle). */
  bladderPerSecond?: number
  wildPlantGrowthModifier: number
  wildCritterCalorieBurnRatio: number
  wildCritterGrowthModifier: number
  secondsPerCycle: number
  /** Kelvin past lowTemp/highTemp before the sim actually changes phase. */
  stateTransitionBufferK: number
  /** A Mimika's pollination: growth bonus (0.25 = +25%), how long one lasts, and the pause between plants. Absent in older dumps. */
  pollination?: { growthBonus: number; effectSeconds: number; searchCooldownSeconds: number }
}

export interface ElementData {
  id: string
  name: string
  state: 'solid' | 'liquid' | 'gas' | 'other'
  dlc: string
  disabled: boolean
  materialCategory: string
  tags: string[]
  lowTemp: number
  highTemp: number
  lowTempTarget: string
  highTempTarget: string
  highTempOre?: { id: string; massFraction: number }
  lowTempOre?: { id: string; massFraction: number }
  sublimate?: { id: string; rate: number; efficiency: number }
  convertId?: string
}

export interface ItemData {
  id: string
  name: string
  tags: string[]
  dlc: DlcRestriction
  kind: 'food' | 'seed' | 'egg' | 'critter' | 'plant' | 'item'
  calories?: number
  /** Seconds until this food spoils at room temperature; absent for food that never spoils. */
  spoilSeconds?: number
  sublimates?: { element: string; rate: number }
}

export interface Amount {
  tag: string
  amount: number
}

export interface RecipeData {
  id: string
  fabricators: string[]
  time: number
  ingredients: { options: Amount[]; doNotConsume: boolean }[]
  results: Amount[]
  radboltsIn?: number
  radboltsOut?: number
}

export interface BuildingFlow {
  tag: string
  rate?: number
  amountPerUse?: number
  via: string
  /** The building only takes this input at or above this temperature (the Steam Turbine's 125 C). */
  minTemperatureK?: number
}

export interface BuildingData {
  id: string
  name: string
  dlc: DlcRestriction
  inputs: BuildingFlow[]
  outputs: BuildingFlow[]
  /** Pipe the building draws its input from ("Liquid", "Gas"), when it has one. */
  inputConduit?: string
  /** Pipe the building sends its product down, when it has one; otherwise it drops it in the world. */
  outputConduit?: string
}

export interface DietData {
  eats: string[]
  produces: string
  caloriesPerKg: number
  producedPerKgEaten: number
}

export interface CritterData {
  id: string
  name: string
  dlc: DlcRestriction
  diet?: DietData[]
  caloriesBurnedPerCycle?: number
  stomachCalories?: number
  deathDrops?: { tag: string; count: number }[]
  egg?: string
  cyclesPerEgg?: number
  adult?: string
  growDrop?: string
  shear?: {
    item: string
    atmosphere: string
    /** Kilograms dropped per shearing. */
    mass?: number
    /** Seconds for a tame critter to regrow its scales. */
    seconds?: number
  }
  /** Cycles until it dies of old age. */
  lifespanCycles?: number
}

export interface PlantData {
  id: string
  name: string
  dlc: DlcRestriction
  crop?: { item: string; durationSeconds: number; count: number }
  irrigation?: { tag: string; rate: number }[]
  fertilizer?: { tag: string; rate: number }[]
  seed?: { item: string; productionType: string; count: number }
  skilledHarvestBonus?: Amount
  /** A vine mother: the crop count is for all of this many vines on one plant. */
  branches?: number
  /** Wilts unless a Mimika, Sweetle, or Grubgrub tends it. */
  needsPollination?: boolean
  /** Critter prefab ids a flytrap plant eats, one per harvest, when it is one. */
  prey?: string[]
}

export interface GeyserData {
  id: string
  element: string
  dlc: DlcRestriction
  temperature: number
  minRatePerCycle: number
  maxRatePerCycle: number
}

export interface GeyserRule {
  ruleId: string
  /** GuaranteeOne, GuaranteeSome, GuaranteeSomeTryMore, GuaranteeAll, GuaranteeRange, TryOne, TrySome, ... */
  listRule: string
  someCount: number
  moreCount: number
  rangeMin: number
  rangeMax: number
  times: number
  /** Each template and the geyser prefabs it contains ("GeyserGeneric_molten_iron"; plain "GeyserGeneric" = seed-random type). */
  templates: { template: string; geysers: string[] }[]
}

export interface WorldData {
  world: string
  name: string
  dlc: DlcRestriction
  biomes: string[]
  elements: string[]
  geyserRules: GeyserRule[]
}

export interface ClusterData {
  id: string
  name: string
  dlc: DlcRestriction
  startWorldIndex: number
  /** World ids, as in WorldData.world. */
  worlds: string[]
  spacePois: { pois: string[]; numToSpawn: number; guarantee: boolean }[]
}

/** A base-game rocket destination (the Starmap without Spaced Out). */
export interface SpaceDestinationData {
  id: string
  name: string
  visitable: boolean
  cyclesToRecover: number
  /** kg a destination holds when fully recharged. */
  massToRecover: number
  minMass: number
  maxMass: number
  /** Element id -> weight range; each trip's cargo is split between the elements in proportion to a per-destination roll of these weights. */
  elements: Record<string, { min: number; max: number }>
  /** Prefab id -> count of critters or seeds recoverable per trip. */
  entities: Record<string, number>
}

export interface SpacePoiData {
  id: string
  dlc: DlcRestriction
  /** Element id -> relative weight of the POI's mass. */
  elements: Record<string, number>
  capacityMin: number
  capacityMax: number
  rechargeMin: number
  rechargeMax: number
}

export interface GameData {
  game: GameInfo
  tuning: Tuning
  dlcs: { id: string; name: string }[]
  names: Record<string, string>
  elements: ElementData[]
  items: ItemData[]
  recipes: RecipeData[]
  buildings: BuildingData[]
  /** Every fabricator, with whether a Duplicant works it for the whole craft. */
  fabricators?: { id: string; duplicantOperated: boolean }[]
  critters: CritterData[]
  plants: PlantData[]
  geysers: GeyserData[]
  worldgen: WorldData[]
  clusters: ClusterData[]
  spacePois: SpacePoiData[]
  /** Base-game Starmap destinations; the import script empties this for a Spaced Out dump, and older dumps lack it. */
  spaceDestinations?: SpaceDestinationData[]
}
