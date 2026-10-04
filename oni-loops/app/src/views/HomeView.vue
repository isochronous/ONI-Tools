<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChainCard from '../components/ChainCard.vue'
import ColonyPanel from '../components/ColonyPanel.vue'
import FilterBar from '../components/FilterBar.vue'
import ProcessList from '../components/ProcessList.vue'
import TargetPicker from '../components/TargetPicker.vue'
import { gameData, label } from '../data/load'
import { useGraph } from '../model'
import { answer, nodesOf, type Chain } from '../model/chains'
import { chainKeys, facetsOf, passes, processKeys } from '../model/filters'
import { fmt } from '../model/graph'
import { computeTiers, TIER_LABEL } from '../model/tiers'
import { useColonyStore } from '../stores/colony'

const route = useRoute()
const router = useRouter()
const store = useColonyStore()
const graph = useGraph()

const target = computed<string | null>(
  () => (typeof route.query.t === 'string' && route.query.t) || null,
)

function setTarget(tag: string) {
  router.push({ query: { ...route.query, t: tag } })
}

watch(
  target,
  (t) => {
    document.title = t ? `${label(t)} · ONI Loops` : 'ONI Loops'
  },
  { immediate: true },
)

/** Elements are wanted in kilograms per cycle, items in pieces; each remembers its own figure. */
const targetIsElement = computed(() => !!target.value && graph.elements.has(target.value))
const perCycle = computed({
  get: () => (targetIsElement.value ? store.demandKg : store.demandItems),
  set: (v: number) => {
    const n = Math.max(0.1, Number(v) || 0.1)
    if (targetIsElement.value) store.demandKg = n
    else store.demandItems = n
  },
})

// What the colony has, and how much it wants, decide the answer; the filters only hide parts of it.
const tiers = computed(() =>
  computeTiers(gameData, graph, store.colony, store.clusterData, store.geysers),
)
const result = computed(() =>
  target.value ? answer(graph, target.value, store.colony, tiers.value, perCycle.value) : null,
)
const facets = computed(() => (result.value ? facetsOf(graph, result.value) : []))

const shownChains = computed(() =>
  result.value ? result.value.chains.filter((c) => passes(chainKeys(graph, c), store.hidden)) : [],
)
const filteredChains = computed(() => (result.value?.chains.length ?? 0) - shownChains.value.length)
const shownLocked = computed(() =>
  result.value
    ? result.value.locked.filter((l) =>
        passes(processKeys(graph, l.process, result.value!.target), store.hidden),
      )
    : [],
)
const filteredLocked = computed(() => (result.value?.locked.length ?? 0) - shownLocked.value.length)
const lockedReasons = computed(
  () => new Map(shownLocked.value.map((l) => [l.process.id, l.reason])),
)

/** Cards are tall, so the list grows a page at a time. */
const PAGE = 8
const shown = ref(PAGE)
watch([target, () => store.hidden], () => (shown.value = PAGE))
const paged = computed(() => shownChains.value.slice(0, shown.value))
const more = computed(() => shownChains.value.length - paged.value.length)

/** Stable identity for a chain across recomputes. */
function chainKey(chain: Chain): string {
  return nodesOf(chain)
    .map((n) => n.process.id)
    .join('>')
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}
</script>

<template>
  <div class="layout">
    <aside class="colony">
      <ColonyPanel />
    </aside>

    <main class="main">
      <TargetPicker :model-value="target" @update:model-value="setTarget" />

      <template v-if="result">
        <header class="target">
          <h1>{{ label(result.target) }}</h1>
          <p class="tier-line">
            <strong>{{ TIER_LABEL[tiers.of(result.target)] }}</strong> for your colony:
            {{ tiers.reason(result.target) }}.
          </p>
        </header>

        <FilterBar
          :facets="facets"
          :hidden="store.hidden"
          :hidden-loops="filteredChains"
          :hidden-sources="filteredLocked"
          @toggle="store.toggleHidden"
          @set="store.setHidden"
          @clear="store.clearHidden"
        />

        <section class="block">
          <div class="block-head">
            <h2>Ways to get {{ label(result.target) }}</h2>
            <label class="demand">
              <span>Make</span>
              <input
                v-model.lazy.number="perCycle"
                type="number"
                min="0.1"
                step="any"
                class="num"
              />
              <span>{{ targetIsElement ? 'kg' : '' }} per cycle</span>
            </label>
          </div>
          <p class="meta">
            <template v-if="result.chains.length === 0">
              Nothing your colony has makes or contains {{ label(result.target) }}.
              <template v-if="!result.locked.length">
                The game defines no source for it at all.</template
              >
            </template>
            <template v-else>
              {{ plural(shownChains.length, 'way') }} shown<template v-if="filteredChains"
                >, {{ filteredChains }} switched off above</template
              >, easiest first. Each step says how many buildings, critters, plants, or Duplicants
              making {{ fmt(perCycle) }}{{ targetIsElement ? ' kg' : '' }} of
              {{ label(result.target) }} a cycle keeps busy, at full uptime.
            </template>
          </p>
          <div class="chains">
            <ChainCard
              v-for="chain in paged"
              :key="chainKey(chain)"
              :chain="chain"
              :target="result.target"
              :tiers="tiers"
              :per-cycle="perCycle"
            />
          </div>
          <p v-if="more" class="more">
            <button type="button" class="more-button" @click="shown += PAGE">
              Show {{ Math.min(PAGE, more) }} more
            </button>
            <button type="button" class="link" @click="shown = shownChains.length">
              Show all {{ more }}
            </button>
          </p>
        </section>

        <section v-if="shownLocked.length" class="block">
          <div class="block-head">
            <h2>One step away</h2>
          </div>
          <p class="meta">Sources that need a DLC or a critter your colony does not have.</p>
          <ProcessList
            :processes="shownLocked.map((l) => l.process)"
            :target="result.target"
            :reasons="lockedReasons"
            :tiers="tiers"
          />
        </section>
      </template>

      <div v-else class="intro">
        <p>
          Pick something you want more of. You get every way the game can make it with what your
          colony has, from sources that never run out first, with how much of everything a cycle's
          worth takes.
        </p>
        <p>
          Set up your colony on the left so the answers match your game: which DLCs, which asteroid,
          which geysers you have found, which critters you can ranch, how many Duplicants.
        </p>
      </div>
    </main>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 20rem minmax(0, 1fr);
  gap: 1.5rem;
  align-items: start;
}
.colony {
  position: sticky;
  top: 1rem;
  max-height: calc(100vh - 2rem);
  overflow: auto;
}
.main {
  display: grid;
  gap: 1.5rem;
  max-width: 1100px;
}
@media (max-width: 960px) {
  .layout {
    grid-template-columns: 1fr;
  }
  .colony {
    position: static;
    max-height: none;
    order: 2;
  }
}

.target h1 {
  margin: 0;
  font-size: 2.25rem;
  font-weight: 700;
}
.tier-line {
  margin-top: 0.25rem;
  color: var(--muted);
  max-width: var(--measure);
}
.tier-line strong {
  color: var(--text);
  font-weight: 600;
}

.block-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem 1.5rem;
}
.block h2 {
  margin: 0;
  font-size: 1.375rem;
}
.demand {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.875rem;
  color: var(--muted);
}
.demand input {
  width: 5.5rem;
  padding: 0.3rem 0.5rem;
  background: var(--raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  color: var(--text);
}
.meta {
  margin: 0.4rem 0 0.9rem;
  color: var(--muted);
  max-width: var(--measure);
}
.chains {
  display: grid;
  gap: 1rem;
}
.more {
  margin: 1rem 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  align-items: center;
}
.more-button {
  padding: 0.45rem 1rem;
  background: var(--raised);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  cursor: pointer;
}
.more-button:hover {
  border-color: var(--accent);
}
.intro {
  display: grid;
  gap: 0.75rem;
  color: var(--muted);
  font-size: 1.0625rem;
  max-width: var(--measure);
}
</style>
