import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { chooseDataSet, dataSet, gameData, SPACED_OUT } from '../data/load'
import { DEFAULT_DUPLICANTS, type Colony } from '../model/chains'
import { guaranteedFeatures, guaranteedGeysers } from '../model/tiers'
import { groupOf, groupRule, type FacetGroup } from '../model/filters'
import type { SeedResult } from '../worldgen/seed'

const STORAGE_KEY = 'oni-loops.colony'
const SAVED_VERSION = 5

interface Saved {
  /** Bumped when a default changes so stale saved values are dropped. */
  v?: number
  dlcs: string[]
  critters: string[] | null
  cluster: string | null
  /** Geysers found, by type id, with how many, where the player entered a count. */
  geysers: Record<string, number>
  /** Before v5: geyser types found beyond the guaranteed ones, one each. */
  extraGeysers?: string[]
  /** Terrain features found (Oil Reservoirs), by prefab id, where the player changed the guaranteed count. */
  features: Record<string, number>
  duplicants: number
  /** How much of a target the player wants per cycle, for elements (kg) and for items (count). */
  demandKg: number
  demandItems: number
  /** Filter keys ("machine:Kiln") the player has switched off. */
  hidden: string[]
  /** Tame critter happiness by critter id, where the player overrode the ranching default. */
  happiness: Record<string, number>
  /** What every stable has: grooming, a fountain and its drink, a condo. */
  ranching?: Ranching
  /** The mutation each plant's seeds carry, by plant id, where one is chosen. */
  mutations: Record<string, string>
  /** What the farms have: a Farm Station giving Farmer's Touch, and who applies it. */
  farming?: Farming
  /** Farmer's Touch by plant id, where the player set a plant apart from the farms' default. */
  touched?: Record<string, boolean>
  /** The map seed last read, with what its worlds place, and which worlds the counts follow. */
  seed?: SeedResult
  seedWorlds?: string[]
}

/** What the colony's farms provide: whether a Farm Station keeps every plant under Farmer's Touch. */
export interface Farming {
  /** Farmer's Touch on every plant, each overridable. */
  farmStation: boolean
  /** The Botanist attribute of the Duplicant applying it, which lengthens each application. */
  botanist: number
}

/**
 * Botanist of a Duplicant who can work a Farm Station: the Farmer skill it needs, and the
 * Junior Farmer skill before it, each add 2 (ROLES.ATTRIBUTE_BONUS_FIRST and _SECOND).
 */
export const DEFAULT_BOTANIST = 4

/** What the colony's stables provide, which sets every tame critter's happiness. */
export interface Ranching {
  /** Groomed at a Grooming Station: +5. */
  groomed: boolean
  /** The liquid in the Critter Fountains (the Aquatic Critter Fountain for fish): Brackene +5, Squid Ink +3. */
  drink: 'none' | 'Milk' | 'Ink'
  /** A Critter Condo in the stable: +1. */
  condo: boolean
}

/** Happiness each fountain drink gives (MilkFeederConfig: HadMilk, HadInk), and the game's names for the elements. */
export const DRINKS: Record<Exclude<Ranching['drink'], 'none'>, { happiness: number }> = {
  Milk: { happiness: 5 },
  Ink: { happiness: 3 },
}
/** One feeding is 5 kg and its effect lasts one cycle, so a topped-up critter drinks 5 kg a cycle. */
export const FOUNTAIN_KG_PER_CYCLE = 5
/** Being tame: -1. */
const TAME_HAPPINESS = -1
const GROOMED_HAPPINESS = 5
const CONDO_HAPPINESS = 1

function load(): Partial<Saved> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Partial<Saved>) : null
  } catch {
    return null
  }
}

function toggled(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/**
 * What the player's colony has (DLCs, asteroid and geysers, ranchable critters, Duplicants),
 * which changes the answers, plus what it wants per cycle and the filters that only hide
 * parts of the answer.
 */
export const useColonyStore = defineStore('colony', () => {
  const saved = load()
  const dlcs = ref(new Set(saved?.dlcs ?? gameData.dlcs.map((d) => d.id)))
  // The loaded data set decides Spaced Out; the saved flag may be stale.
  if (dataSet.spacedOut) dlcs.value.add(SPACED_OUT)
  else dlcs.value.delete(SPACED_OUT)
  /** null = assume any critter is available. */
  const critters = ref<Set<string> | null>(saved?.critters ? new Set(saved.critters) : null)
  const cluster = ref<string | null>(saved?.cluster ?? null)
  const geyserCounts = ref<Record<string, number>>(
    saved?.geysers ?? Object.fromEntries((saved?.extraGeysers ?? []).map((id) => [id, 1])),
  )
  const featureCounts = ref<Record<string, number>>({ ...(saved?.features ?? {}) })
  const duplicants = ref(saved?.duplicants ?? DEFAULT_DUPLICANTS)
  const demandKg = ref(saved?.demandKg ?? 100)
  const demandItems = ref(saved?.demandItems ?? 10)
  const hidden = ref(new Set(saved?.hidden ?? []))
  const happiness = ref<Record<string, number>>({ ...(saved?.happiness ?? {}) })
  const ranching = ref<Ranching>({ groomed: true, drink: 'none', condo: false, ...saved?.ranching })
  const mutations = ref<Record<string, string>>({ ...(saved?.mutations ?? {}) })
  const farming = ref<Farming>({
    farmStation: false,
    botanist: DEFAULT_BOTANIST,
    ...saved?.farming,
  })
  const touched = ref<Record<string, boolean>>({ ...saved?.touched })
  /** The seed read last, if any, and the worlds whose geysers the counts add up. */
  const seed = ref<SeedResult | null>(saved?.seed ?? null)
  const seedWorlds = ref<string[]>(saved?.seedWorlds ?? [])

  const clusterData = computed(() => gameData.clusters.find((c) => c.id === cluster.value) ?? null)
  /** Guaranteed by the cluster's worldgen rules, keyed by geyser type. */
  const guaranteed = computed(() => guaranteedGeysers(gameData, clusterData.value))
  /** How many of each type the colony has found: what the player entered, else the guaranteed count. */
  const geysers = computed(() => {
    const out = new Map<string, number>()
    for (const [id, g] of guaranteed.value) out.set(id, geyserCounts.value[id] ?? g.min)
    for (const [id, n] of Object.entries(geyserCounts.value))
      if (n > 0 && !out.has(id)) out.set(id, n)
    return out
  })
  /** Terrain features the cluster's worlds place, with the guaranteed count. */
  const guaranteedFeatureCounts = computed(() => guaranteedFeatures(gameData, clusterData.value))
  /** How many of each the colony has found: what the player entered, else the guaranteed count. */
  const features = computed(
    () =>
      new Map(
        [...guaranteedFeatureCounts.value].map(([id, f]) => [id, featureCounts.value[id] ?? f.min]),
      ),
  )

  /** What the stables give a tame critter: tame, plus grooming, the fountain's drink and a condo as chosen. */
  const defaultHappiness = computed(
    () =>
      TAME_HAPPINESS +
      (ranching.value.groomed ? GROOMED_HAPPINESS : 0) +
      (ranching.value.drink === 'none' ? 0 : DRINKS[ranching.value.drink].happiness) +
      (ranching.value.condo ? CONDO_HAPPINESS : 0),
  )
  /** A critter's happiness: its own number if the player set one, else the stables' default. */
  function happinessOf(id: string): number {
    return happiness.value[id] ?? defaultHappiness.value
  }
  /** Whether a plant gets Farmer's Touch: its own setting if the player made one, else the farms' default. */
  function touchedOf(id: string): boolean {
    return touched.value[id] ?? farming.value.farmStation
  }

  const colony = computed<Colony>(() => ({
    dlcs: dlcs.value,
    critters: critters.value,
    cluster: cluster.value,
    geysers: geysers.value,
    features: features.value,
    duplicants: duplicants.value,
  }))

  function save() {
    try {
      const data: Saved = {
        v: SAVED_VERSION,
        dlcs: [...dlcs.value],
        critters: critters.value ? [...critters.value] : null,
        cluster: cluster.value,
        geysers: geyserCounts.value,
        features: featureCounts.value,
        duplicants: duplicants.value,
        demandKg: demandKg.value,
        demandItems: demandItems.value,
        hidden: [...hidden.value],
        happiness: happiness.value,
        ranching: ranching.value,
        mutations: mutations.value,
        farming: farming.value,
        touched: touched.value,
        seed: seed.value ?? undefined,
        seedWorlds: seedWorlds.value,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      /* storage may be unavailable */
    }
  }

  function toggleDlc(id: string) {
    dlcs.value = toggled(dlcs.value, id)
    if (id === SPACED_OUT) {
      // Spaced Out is a different data set (clusters and rocket POIs instead of one asteroid
      // and the Starmap), so the page reloads with the other dump. Asteroid ids differ too.
      cluster.value = null
      chooseDataSet(dlcs.value.has(id))
      save()
      location.reload()
    }
  }

  function setGeyser(id: string, count: number) {
    const n = Math.max(0, Math.min(99, Math.round(Number(count) || 0)))
    geyserCounts.value = { ...geyserCounts.value, [id]: n }
  }

  function setFeature(id: string, count: number) {
    const n = Math.max(0, Math.min(99, Math.round(Number(count) || 0)))
    featureCounts.value = { ...featureCounts.value, [id]: n }
  }

  /**
   * Takes a seed as read by the worldgen engine: the asteroid becomes the seed's cluster and
   * the geyser and feature counts become what the start world places. The player can add the
   * other worlds, and the counts stay theirs to edit afterwards.
   */
  function applySeed(result: SeedResult) {
    seed.value = result
    seedWorlds.value = result.worlds.filter((w) => w.start).map((w) => w.id)
    if (gameData.clusters.some((c) => c.id === result.clusterId)) cluster.value = result.clusterId
    applySeedCounts()
  }

  /** Counts a world of the seed in, or out, and sets the counts to the worlds that are in. */
  function setSeedWorld(id: string, counted: boolean) {
    const next = seedWorlds.value.filter((w) => w !== id)
    if (counted) next.push(id)
    seedWorlds.value = next
    applySeedCounts()
  }

  function clearSeed() {
    seed.value = null
    seedWorlds.value = []
  }

  /** Every geyser type and feature the data set knows, set to what the counted worlds place. */
  function applySeedCounts() {
    if (!seed.value) return
    const worlds = seed.value.worlds.filter((w) => seedWorlds.value.includes(w.id))
    const geysers: Record<string, number> = {}
    for (const g of gameData.geysers)
      geysers[g.id] = worlds.reduce((n, w) => n + (w.geysers[g.id] ?? 0), 0)
    geyserCounts.value = geysers
    const features: Record<string, number> = {}
    for (const f of gameData.features ?? [])
      features[f.id] = worlds.reduce((n, w) => n + (w.features[f.id] ?? 0), 0)
    featureCounts.value = features
  }

  function setCritter(id: string, available: boolean, all: string[]) {
    const next = new Set<string>(critters.value ?? all)
    if (available) next.add(id)
    else next.delete(id)
    critters.value = next
  }

  function assumeAllCritters() {
    critters.value = null
  }

  function setMutation(plantId: string, mutationId: string) {
    const next = { ...mutations.value }
    if (mutationId) next[plantId] = mutationId
    else delete next[plantId]
    mutations.value = next
  }

  /** A plant's own Farmer's Touch; set to the farms' default it follows the farms again. */
  function setTouched(id: string, on: boolean) {
    const next = { ...touched.value }
    if (on === farming.value.farmStation) delete next[id]
    else next[id] = on
    touched.value = next
  }

  /** A critter's own happiness; set to the stables' default it follows the stables again. */
  function setHappiness(id: string, value: number) {
    const n = Math.max(-10, Math.min(10, Number(value) || 0))
    const next = { ...happiness.value }
    if (n === defaultHappiness.value) delete next[id]
    else next[id] = n
    happiness.value = next
  }

  function toggleHidden(key: string) {
    hidden.value = toggled(hidden.value, key)
  }

  /** Switches a whole group of filter keys off (or back on) at once. */
  function setHidden(keys: string[], off: boolean) {
    const next = new Set(hidden.value)
    for (const k of keys)
      if (off) next.add(k)
      else next.delete(k)
    hidden.value = next
  }

  function clearHidden() {
    hidden.value = new Set()
  }

  /**
   * A whole group switched off is one rule key (`critter:*`) rather than the chips listed,
   * so nothing of the group can come back through a route the list did not know; switching
   * the group on drops the rule and the group's own keys.
   */
  function setRule(group: FacetGroup, off: boolean) {
    const next = new Set([...hidden.value].filter((k) => groupOf(k) !== group))
    if (off) next.add(groupRule(group))
    hidden.value = next
  }

  /** One chip of a ruled-off group switched back on: the rule becomes the other chips, hidden one by one. */
  function dissolveRule(group: FacetGroup, hideKeys: string[]) {
    const next = new Set([...hidden.value].filter((k) => k !== groupRule(group)))
    for (const k of hideKeys) next.add(k)
    hidden.value = next
  }

  watch(
    [
      colony,
      hidden,
      demandKg,
      demandItems,
      happiness,
      ranching,
      mutations,
      farming,
      touched,
      seed,
      seedWorlds,
    ],
    save,
    { deep: true },
  )

  return {
    dlcs,
    critters,
    duplicants,
    demandKg,
    demandItems,
    cluster,
    clusterData,
    guaranteed,
    geysers,
    guaranteedFeatureCounts,
    features,
    hidden,
    happiness,
    ranching,
    defaultHappiness,
    happinessOf,
    mutations,
    farming,
    touched,
    touchedOf,
    seed,
    seedWorlds,
    colony,
    toggleDlc,
    setCritter,
    assumeAllCritters,
    setGeyser,
    setFeature,
    applySeed,
    setSeedWorld,
    clearSeed,
    toggleHidden,
    setHappiness,
    setMutation,
    setTouched,
    setHidden,
    clearHidden,
    setRule,
    dissolveRule,
  }
})
