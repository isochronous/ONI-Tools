<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ColonyPanel from '../components/ColonyPanel.vue'
import FilterBar from '../components/FilterBar.vue'
import LoopCard from '../components/LoopCard.vue'
import ProcessList from '../components/ProcessList.vue'
import TargetPicker from '../components/TargetPicker.vue'
import { gameData, label } from '../data/load'
import { useGraph } from '../model'
import { facetsOf, loopKeys, passes, processKeys } from '../model/filters'
import { fmt } from '../model/graph'
import { answer, effectiveRatio, type Loop } from '../model/search'
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

// What the colony has, and how much it wants, decide the answer; everything below only hides parts of it.
const tiers = computed(() =>
  computeTiers(gameData, graph, store.colony, store.clusterData, store.geysers),
)
const result = computed(() =>
  target.value ? answer(graph, target.value, store.colony, tiers.value, perCycle.value) : null,
)
const facets = computed(() => (result.value ? facetsOf(graph, result.value) : []))

const aboveFloor = computed(
  () => result.value?.loops.filter((l) => effectiveRatio(l) >= store.loopFloor - 1e-9) ?? [],
)
const belowFloor = computed(() => (result.value?.loops.length ?? 0) - aboveFloor.value.length)
const shownLoops = computed(() =>
  result.value
    ? aboveFloor.value.filter((l) => passes(loopKeys(graph, l, result.value!.target), store.hidden))
    : [],
)
const filteredLoops = computed(() => aboveFloor.value.length - shownLoops.value.length)
const primaryLoops = computed(() => shownLoops.value.filter((l) => l.primary))
const sideLoops = computed(() => shownLoops.value.filter((l) => !l.primary))

const shownProducers = computed(() =>
  result.value
    ? result.value.producers.filter((p) =>
        passes(processKeys(graph, p, result.value!.target), store.hidden),
      )
    : [],
)
const shownLocked = computed(() =>
  result.value
    ? result.value.locked.filter((l) =>
        passes(processKeys(graph, l.process, result.value!.target), store.hidden),
      )
    : [],
)
const filteredSources = computed(() =>
  result.value
    ? result.value.producers.length +
      result.value.locked.length -
      shownProducers.value.length -
      shownLocked.value.length
    : 0,
)
const lockedReasons = computed(
  () => new Map(shownLocked.value.map((l) => [l.process.id, l.reason])),
)

/** Cards are tall, so the list grows a page at a time. */
const PAGE = 8
const shownPrimary = ref(PAGE)
const showSide = ref(false)
watch([target, () => store.hidden, () => store.loopFloor], () => {
  shownPrimary.value = PAGE
  showSide.value = false
})
const pagedPrimary = computed(() => primaryLoops.value.slice(0, shownPrimary.value))
const morePrimary = computed(() => primaryLoops.value.length - pagedPrimary.value.length)

/** Stable identity for a loop across recomputes, so a card keeps its chosen return. */
function loopKey(loop: Loop): string {
  return loop.steps.map((s) => s.process.id).join('>')
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
          :hidden-loops="filteredLoops"
          :hidden-sources="filteredSources"
          @toggle="store.toggleHidden"
          @set="store.setHidden"
          @clear="store.clearHidden"
        />

        <section class="block">
          <div class="block-head">
            <h2>Loops back to {{ label(result.target) }}</h2>
            <div class="controls">
              <label class="demand">
                <span>Run each loop at</span>
                <input v-model.number="perCycle" type="number" min="0.1" step="any" class="num" />
                <span>{{ targetIsElement ? 'kg' : '' }} per cycle</span>
              </label>
              <label class="floor">
                <span
                  >Show loops that return at least
                  <strong class="num">{{ Math.round(store.loopFloor * 100) }}%</strong></span
                >
                <input v-model.number="store.loopFloor" type="range" min="0" max="1" step="0.05" />
              </label>
            </div>
          </div>
          <p class="meta">
            <template v-if="result.loops.length === 0"
              >No cycle brings {{ label(result.target) }} back to itself with what your colony
              has.</template
            >
            <template v-else>
              {{ plural(shownLoops.length, 'loop') }} shown<template v-if="belowFloor"
                >, {{ belowFloor }} below your floor</template
              ><template v-if="filteredLoops">, {{ filteredLoops }} switched off above</template>.
              <template v-if="shownLoops.length && !primaryLoops.length">
                All of them are side-streams, where {{ label(result.target) }} only rides along a
                machine that mostly eats something else.</template
              >
              <template v-else-if="shownLoops.length">
                A loop short of ×1 is driven back to ×1 by adding more of an intermediate you can
                get anyway; the card says how much. Counts on each step are for
                {{ fmt(perCycle) }}{{ targetIsElement ? ' kg' : '' }} of
                {{ label(result.target) }} entering the loop per cycle, at full uptime.</template
              >
            </template>
          </p>
          <div class="loops">
            <LoopCard
              v-for="loop in pagedPrimary"
              :key="loopKey(loop)"
              :loop="loop"
              :target="result.target"
              :tiers="tiers"
              :per-cycle="perCycle"
            />
          </div>
          <p v-if="morePrimary" class="more">
            <button type="button" class="more-button" @click="shownPrimary += PAGE">
              Show {{ Math.min(PAGE, morePrimary) }} more
            </button>
            <button type="button" class="link" @click="shownPrimary = primaryLoops.length">
              Show all {{ morePrimary }}
            </button>
          </p>
          <template v-if="sideLoops.length">
            <p class="side-toggle">
              <button type="button" class="link" @click="showSide = !showSide">
                {{ showSide ? 'Hide' : 'Show' }} {{ plural(sideLoops.length, 'side-stream loop') }}
              </button>
              <span class="hint"
                >where {{ label(result.target) }} is only a small part of what one step eats</span
              >
            </p>
            <div v-if="showSide" class="loops">
              <LoopCard
                v-for="loop in sideLoops"
                :key="loopKey(loop)"
                :loop="loop"
                :target="result.target"
                :tiers="tiers"
                :per-cycle="perCycle"
              />
            </div>
          </template>
        </section>

        <section class="block">
          <div class="block-head">
            <h2>Ways to get {{ label(result.target) }}</h2>
          </div>
          <p v-if="!shownProducers.length" class="meta">
            <template v-if="result.producers.length">Every source is switched off above.</template>
            <template v-else>
              Nothing your colony has makes or contains {{ label(result.target) }}.
              <template v-if="!result.locked.length">
                The game defines no source for it at all.</template
              >
            </template>
          </p>
          <ProcessList :processes="shownProducers" :target="result.target" :tiers="tiers" />
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
          colony has, and every loop that brings it back to itself, the easiest to run first.
        </p>
        <p>
          Set up your colony on the left so the answers match your game: which DLCs, which asteroid,
          which geysers you have found, which critters you can ranch.
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
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 0.5rem 1.5rem;
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
.floor {
  display: grid;
  gap: 0.15rem;
  width: min(100%, 22rem);
  font-size: 0.875rem;
  color: var(--muted);
}
.floor strong {
  color: var(--text);
}
.meta {
  margin: 0.4rem 0 0.9rem;
  color: var(--muted);
  max-width: var(--measure);
}
.loops {
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
.side-toggle {
  margin: 1rem 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.75rem;
  align-items: baseline;
}
.intro {
  display: grid;
  gap: 0.75rem;
  color: var(--muted);
  font-size: 1.0625rem;
  max-width: var(--measure);
}
</style>
