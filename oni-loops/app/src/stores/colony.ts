import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { gameData } from '../data/load'
import type { Colony } from '../model/search'

const STORAGE_KEY = 'oni-loops.colony'

interface Saved {
  dlcs: string[]
  critters: string[] | null
  domesticated: boolean
  loopFloor: number
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Saved) : null
  } catch {
    return null
  }
}

/** What the player's colony has: DLCs, ranchable critters, wild/domestic plants, loop floor. */
export const useColonyStore = defineStore('colony', () => {
  const saved = load()
  const dlcs = ref(new Set(saved?.dlcs ?? gameData.dlcs.map((d) => d.id)))
  /** null = assume any critter is available. */
  const critters = ref<Set<string> | null>(saved?.critters ? new Set(saved.critters) : null)
  const domesticated = ref(saved?.domesticated ?? true)
  const loopFloor = ref(saved?.loopFloor ?? 0.5)

  const colony = computed<Colony>(() => ({
    dlcs: dlcs.value,
    critters: critters.value,
    domesticated: domesticated.value,
    loopFloor: loopFloor.value,
  }))

  function toggleDlc(id: string) {
    const next = new Set(dlcs.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    dlcs.value = next
  }

  function setCritter(id: string, available: boolean, all: Iterable<string>) {
    const next = new Set(critters.value ?? all)
    if (available) next.add(id)
    else next.delete(id)
    critters.value = next
  }

  function assumeAllCritters() {
    critters.value = null
  }

  watch(
    colony,
    (c) => {
      try {
        const data: Saved = { dlcs: [...c.dlcs], critters: c.critters ? [...c.critters] : null, domesticated: c.domesticated, loopFloor: c.loopFloor }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      } catch {
        /* storage may be unavailable */
      }
    },
    { deep: true },
  )

  return { dlcs, critters, domesticated, loopFloor, colony, toggleDlc, setCritter, assumeAllCritters }
})
