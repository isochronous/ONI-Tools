import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { chooseDataSet, dataSet, gameData, SPACED_OUT } from '../data/load'
import { DEFAULT_PRIMARY_SHARE, DEFAULT_TOP_UP_RATIO, type Colony } from '../model/search'
import { guaranteedGeysers } from '../model/tiers'

const STORAGE_KEY = 'oni-loops.colony'
const SAVED_VERSION = 2

interface Saved {
  /** Bumped when a default changes so stale saved values are dropped. */
  v?: number
  dlcs: string[]
  critters: string[] | null
  loopFloor: number
  cluster: string | null
  /** Geyser types found on the map beyond the guaranteed ones. */
  extraGeysers: string[]
  primaryShare: number
  topUpRatio?: number
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Saved) : null
  } catch {
    return null
  }
}

/** What the player's colony has: DLCs, asteroid and geysers, ranchable critters, loop floor. */
export const useColonyStore = defineStore('colony', () => {
  const saved = load()
  const dlcs = ref(new Set(saved?.dlcs ?? gameData.dlcs.map((d) => d.id)))
  // The loaded data set decides Spaced Out; the saved flag may be stale.
  if (dataSet.spacedOut) dlcs.value.add(SPACED_OUT)
  else dlcs.value.delete(SPACED_OUT)
  /** null = assume any critter is available. */
  const critters = ref<Set<string> | null>(saved?.critters ? new Set(saved.critters) : null)
  const loopFloor = ref(saved?.loopFloor ?? 0.5)
  const cluster = ref<string | null>(saved?.cluster ?? null)
  const primaryShare = ref(saved?.v === SAVED_VERSION ? (saved.primaryShare ?? DEFAULT_PRIMARY_SHARE) : DEFAULT_PRIMARY_SHARE)
  const extraGeysers = ref(new Set(saved?.extraGeysers ?? []))
  const topUpRatio = ref(saved?.topUpRatio ?? DEFAULT_TOP_UP_RATIO)

  const clusterData = computed(() => gameData.clusters.find((c) => c.id === cluster.value) ?? null)
  /** Guaranteed by the cluster's worldgen rules, keyed by geyser type. */
  const guaranteed = computed(() => guaranteedGeysers(gameData, clusterData.value))
  const geysers = computed(() => new Set([...guaranteed.value.keys(), ...extraGeysers.value]))

  const colony = computed<Colony>(() => ({
    dlcs: dlcs.value,
    critters: critters.value,
    loopFloor: loopFloor.value,
    cluster: cluster.value,
    geysers: geysers.value,
    primaryShare: primaryShare.value,
    topUpRatio: topUpRatio.value,
  }))

  function toggleGeyser(id: string) {
    const next = new Set(extraGeysers.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    extraGeysers.value = next
  }

  function save(c: Colony) {
    try {
      const data: Saved = { v: SAVED_VERSION, dlcs: [...c.dlcs], critters: c.critters ? [...c.critters] : null, loopFloor: c.loopFloor, cluster: c.cluster, extraGeysers: [...extraGeysers.value], primaryShare: c.primaryShare, topUpRatio: c.topUpRatio }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      /* storage may be unavailable */
    }
  }

  function toggleDlc(id: string) {
    const next = new Set(dlcs.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    dlcs.value = next
    if (id === SPACED_OUT) {
      // Spaced Out is a different data set (clusters and rocket POIs instead of one asteroid
      // and the Starmap), so the page reloads with the other dump. Asteroid ids differ too.
      cluster.value = null
      chooseDataSet(next.has(id))
      save(colony.value)
      location.reload()
    }
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

  watch(colony, save, { deep: true })

  return { dlcs, critters, loopFloor, primaryShare, topUpRatio, cluster, clusterData, guaranteed, extraGeysers, geysers, colony, toggleDlc, setCritter, assumeAllCritters, toggleGeyser }
})
