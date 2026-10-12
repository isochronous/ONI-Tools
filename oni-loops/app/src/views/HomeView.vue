<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChainCard from '../components/ChainCard.vue'
import ColonyPanel from '../components/ColonyPanel.vue'
import FilterBar from '../components/FilterBar.vue'
import ProcessList from '../components/ProcessList.vue'
import TagIcon from '../components/TagIcon.vue'
import TargetPicker from '../components/TargetPicker.vue'
import { gameData, label } from '../data/load'
import { answer, nodesOf, type Chain } from '../model/chains'
import { chainKeys, facetsOf, passes, processKeys } from '../model/filters'
import { buildGraph, fmt } from '../model/graph'
import { computeTiers, TIER_LABEL } from '../model/tiers'
import { FOUNTAIN_KG_PER_CYCLE, useColonyStore } from '../stores/colony'

const route = useRoute()
const router = useRouter()
const store = useColonyStore()
// The graph carries the critters' egg rates, which depend on their happiness, so it follows the colony.
const graph = computed(() =>
  buildGraph(gameData, {
    happiness: (id) => store.happinessOf(id),
    drink:
      store.ranching.drink === 'none'
        ? undefined
        : { tag: store.ranching.drink, kgPerCycle: FOUNTAIN_KG_PER_CYCLE },
    mutation: (id) => store.mutations[id],
  }),
)

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
const targetIsElement = computed(() => !!target.value && graph.value.elements.has(target.value))
const perCycle = computed({
  get: () => (targetIsElement.value ? store.demandKg : store.demandItems),
  set: (v: number) => {
    const n = Math.max(0.1, Number(v) || 0.1)
    if (targetIsElement.value) store.demandKg = n
    else store.demandItems = n
  },
})

// What the colony has, how much it wants, and what the player has hidden decide the answer;
// the filters then hide locked sources and anything a hidden key still reaches.
const tiers = computed(() =>
  computeTiers(gameData, graph.value, store.colony, store.clusterData, store.geysers),
)
const result = computed(() =>
  target.value
    ? answer(
        graph.value,
        target.value,
        { ...store.colony, excluded: store.hidden },
        tiers.value,
        perCycle.value,
      )
    : null,
)
// The filter bar lists what the answer can depend on with nothing switched off, so a chip is
// never lost to the filters: when the unfiltered answer is not the shown one it is searched too.
const unfiltered = computed(() =>
  target.value && store.hidden.size
    ? answer(graph.value, target.value, store.colony, tiers.value, perCycle.value)
    : result.value,
)
/** Keys the bar has listed for each target this session, kept listed so chips do not vanish. */
const seen = new Map<string, Set<string>>()
const facets = computed(() => {
  if (!result.value || !unfiltered.value) return []
  const kept = seen.get(result.value.target) ?? new Set<string>()
  return facetsOf(graph.value, unfiltered.value, result.value, store.hidden, kept)
})
watch(facets, (list) => {
  if (!result.value) return
  const kept = seen.get(result.value.target) ?? new Set<string>()
  for (const f of list) kept.add(f.key)
  seen.set(result.value.target, kept)
})

const shownChains = computed(() =>
  result.value
    ? result.value.chains.filter((c) => passes(chainKeys(graph.value, c), store.hidden))
    : [],
)
// Hidden counts are against the unfiltered answer, so a filter that empties the page says so.
const filteredChains = computed(() =>
  Math.max(0, (unfiltered.value?.chains.length ?? 0) - shownChains.value.length),
)
const shownLocked = computed(() =>
  result.value
    ? result.value.locked.filter((l) =>
        passes(processKeys(graph.value, l.process, result.value!.target), store.hidden),
      )
    : [],
)
const filteredLocked = computed(() =>
  Math.max(0, (unfiltered.value?.locked.length ?? 0) - shownLocked.value.length),
)
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
          <h1><TagIcon :tag="result.target" />{{ label(result.target) }}</h1>
          <p class="tier-line">
            <strong :class="'t-' + tiers.of(result.target)">{{
              TIER_LABEL[tiers.of(result.target)]
            }}</strong>
            for your colony:
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
          @rule="store.setRule"
          @dissolve="store.dissolveRule"
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
              it takes to make {{ fmt(perCycle) }}{{ targetIsElement ? ' kg of' : '' }}
              {{ label(result.target) }} per cycle, at full uptime.
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
            <button type="button" class="btn" @click="shown += PAGE">
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
          which geysers you have found and how many, which critters you can ranch, how many
          Duplicants.
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
  grid-template-columns: minmax(0, 1fr);
  gap: 1.5rem;
  max-width: 1100px;
}
@media (max-width: 960px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .colony {
    position: static;
    max-height: none;
    order: 2;
  }
}

/* The chosen material, named the way the game's details panel names a building: icon, bold capitals. */
.target h1 {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 0;
  font-size: 2.25rem;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.target h1 :deep(.icon) {
  width: 2.75rem;
  height: 2.75rem;
  margin: 0;
  vertical-align: middle;
}
.tier-line {
  margin-top: 0.35rem;
  color: var(--muted);
  max-width: var(--measure);
}
.tier-line strong {
  display: inline-block;
  margin-right: 0.2rem;
  padding: 0.05rem 0.45rem;
  border-radius: var(--radius);
  background: var(--raised);
  color: var(--text);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  vertical-align: 0.1em;
}
.tier-line strong.t-renewable {
  background: var(--good-dim);
  color: var(--good);
}
.tier-line strong.t-space,
.tier-line strong.t-none {
  background: var(--warn-dim);
  color: var(--warn);
}

/* A section heading: the game's uppercase label over a rule. */
.block-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem 1.5rem;
  padding-bottom: 0.4rem;
  border-bottom: 2px solid var(--line);
}
.block h2 {
  margin: 0;
  font-size: 0.9375rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
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
  padding: 0.25rem 0.5rem;
}
.meta {
  margin: 0.6rem 0 0.9rem;
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
.intro {
  display: grid;
  gap: 0.75rem;
  color: var(--muted);
  font-size: 1.0625rem;
  max-width: var(--measure);
}
</style>
