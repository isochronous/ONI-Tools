import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { chooseDataSet, dataSet, gameData, SPACED_OUT } from '../data/load'
import { DEFAULT_PRIMARY_SHARE, type Colony } from '../model/search'
import { guaranteedGeysers } from '../model/tiers'

const STORAGE_KEY = 'oni-loops.colony'
const SAVED_VERSION = 3

interface Saved {
  /** Bumped when a default changes so stale saved values are dropped. */
  v?: number
  dlcs: string[]
  critters: string[] | null
  cluster: string | null
  /** Geyser types found on the map beyond the guaranteed ones. */
  extraGeysers: string[]
  primaryShare: number
  loopFloor: number
  /** Filter keys ("machine:Kiln") the player has switched off. */
  hidden: string[]
}

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
 * What the player's colony has (DLCs, asteroid and geysers, ranchable critters), which
 * changes the answers, plus the view preferences that only hide parts of them (the loop
 * floor and the filters).
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
  const primaryShare = ref(
    saved?.v === SAVED_VERSION
      ? (saved.primaryShare ?? DEFAULT_PRIMARY_SHARE)
      : DEFAULT_PRIMARY_SHARE,
  )
  const extraGeysers = ref(new Set(saved?.extraGeysers ?? []))
  /** Smallest return a loop may have and still be listed. */
  const loopFloor = ref(saved?.loopFloor ?? 0.5)
  const hidden = ref(new Set(saved?.hidden ?? []))

  const clusterData = computed(() => gameData.clusters.find((c) => c.id === cluster.value) ?? null)
  /** Guaranteed by the cluster's worldgen rules, keyed by geyser type. */
  const guaranteed = computed(() => guaranteedGeysers(gameData, clusterData.value))
  const geysers = computed(() => new Set([...guaranteed.value.keys(), ...extraGeysers.value]))

  const colony = computed<Colony>(() => ({
    dlcs: dlcs.value,
    critters: critters.value,
    cluster: cluster.value,
    geysers: geysers.value,
    primaryShare: primaryShare.value,
  }))

  function save() {
    try {
      const data: Saved = {
        v: SAVED_VERSION,
        dlcs: [...dlcs.value],
        critters: critters.value ? [...critters.value] : null,
        cluster: cluster.value,
        extraGeysers: [...extraGeysers.value],
        primaryShare: primaryShare.value,
        loopFloor: loopFloor.value,
        hidden: [...hidden.value],
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

  function toggleGeyser(id: string) {
    extraGeysers.value = toggled(extraGeysers.value, id)
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

  watch([colony, loopFloor, hidden], save, { deep: true })

  return {
    dlcs,
    critters,
    primaryShare,
    cluster,
    clusterData,
    guaranteed,
    extraGeysers,
    geysers,
    loopFloor,
    hidden,
    colony,
    toggleDlc,
    setCritter,
    assumeAllCritters,
    toggleGeyser,
    toggleHidden,
    setHidden,
    clearHidden,
  }
})
