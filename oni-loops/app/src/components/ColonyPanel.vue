<script setup lang="ts">
import { computed, ref } from 'vue'
import { gameData } from '../data/load'
import type { PlantMutationData } from '../data/types'
import { DEFAULT_HAPPINESS, mutationFits } from '../model/graph'
import { randomGeyserSlots } from '../model/tiers'
import { useColonyStore } from '../stores/colony'

const store = useColonyStore()
const showCritters = ref(false)
const showPlants = ref(false)

/** Plants that bear a crop under the chosen DLCs, with the mutations the game allows each. */
const plants = computed(() => {
  // The game has a few plants in two prefabs with one name (the Arbor Tree and its branch); one row serves both.
  const byName = new Map<string, { ids: string[]; name: string; mutations: PlantMutationData[] }>()
  for (const p of gameData.plants) {
    if (!p.crop || p.dlc.requires.some((id) => !store.dlcs.has(id))) continue
    const row = byName.get(p.name) ?? { ids: [], name: p.name, mutations: [] }
    row.ids.push(p.id)
    for (const m of gameData.plantMutations ?? [])
      if (mutationFits(m, p.id) && !row.mutations.includes(m)) row.mutations.push(m)
    byName.set(p.name, row)
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
})
const mutatedCount = computed(() => Object.keys(store.mutations).length)

/** Adult critters under the chosen DLCs; babies are covered by their adult. */
const critters = computed(() =>
  gameData.critters
    .filter((c) => !c.adult && !c.dlc.requires.some((id) => !store.dlcs.has(id)))
    .map((c) => ({ id: c.id, name: c.name, laysEggs: !!c.egg && !!c.cyclesPerEgg }))
    .sort((a, b) => a.name.localeCompare(b.name)),
)

function happinessOf(id: string): number {
  return store.happiness[id] ?? DEFAULT_HAPPINESS
}
const allIds = computed(() => critters.value.map((c) => c.id))

/** Clusters playable with the chosen DLCs. */
const clusters = computed(() =>
  gameData.clusters
    .filter(
      (c) =>
        c.dlc.requires.every((id) => store.dlcs.has(id)) &&
        !c.dlc.forbids.some((id) => store.dlcs.has(id)),
    )
    .sort((a, b) => a.name.localeCompare(b.name)),
)
const randomSlots = computed(() => randomGeyserSlots(gameData, store.clusterData))
const geyserTypes = computed(() =>
  gameData.geysers
    .filter((g) => g.dlc.requires.every((id) => store.dlcs.has(id)))
    .map((g) => ({ id: g.id, name: geyserName(g.id) }))
    .sort((a, b) => a.name.localeCompare(b.name)),
)

function geyserName(id: string) {
  return gameData.names['GeyserGeneric_' + id] ?? id
}

/** "Oil Reservoirs", from the feature's prefab id. */
function featurePlural(id: string) {
  return (gameData.names[id] ?? id) + 's'
}

/** "Terra has 3", "Aquatic Classic has up to 6". */
function featureHint(f: { min: number; max: number; worlds: string[] }) {
  const where = f.worlds.join(' and ')
  if (f.min === f.max) return `${where} has ${f.min}.`
  if (f.min === 0) return `${where} has up to ${f.max}.`
  return `${where} has ${f.min} to ${f.max}.`
}

function has(id: string) {
  return store.critters === null || store.critters.has(id)
}
</script>

<template>
  <section class="panel" aria-label="My colony">
    <h2>My colony</h2>
    <p class="hint">What you have decides which answers exist and how they are ranked.</p>

    <div class="group">
      <p class="eyebrow">Game</p>
      <label v-for="d in gameData.dlcs" :key="d.id" class="check">
        <input type="checkbox" :checked="store.dlcs.has(d.id)" @change="store.toggleDlc(d.id)" />
        {{ d.name }}
      </label>
      <p class="hint">
        Spaced Out! is a different game: one asteroid and the Starmap without it, a cluster with
        rocket mining otherwise. Switching it reloads with the matching game data.
      </p>
    </div>

    <div class="group">
      <p class="eyebrow">Asteroid</p>
      <select
        :value="store.cluster ?? ''"
        aria-label="Asteroid"
        @change="store.cluster = ($event.target as HTMLSelectElement).value || null"
      >
        <option value="">Not chosen (no terrain or geyser knowledge)</option>
        <option v-for="c in clusters" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <template v-if="store.clusterData">
        <p v-if="store.guaranteed.size" class="hint geysers">
          Guaranteed geysers:
          <span v-for="[id, g] in store.guaranteed" :key="id" class="chip"
            >{{ g.min === g.max ? g.min : g.min + '–' + g.max }}× {{ geyserName(id) }}</span
          >
        </p>
        <template v-if="randomSlots.length">
          <p class="hint">
            Plus {{ randomSlots.map((s) => `${s.count} seed-random on ${s.world}`).join(', ') }}.
            Tick the ones you have found:
          </p>
          <div class="list">
            <label v-for="g in geyserTypes" :key="g.id" class="check">
              <input
                type="checkbox"
                :checked="store.geysers.has(g.id)"
                :disabled="store.guaranteed.has(g.id)"
                @change="store.toggleGeyser(g.id)"
              />
              {{ g.name }}
            </label>
          </div>
        </template>
        <label v-for="[id, f] in store.guaranteedFeatureCounts" :key="id" class="count feature">
          <input
            :value="store.features.get(id) ?? 0"
            type="number"
            min="0"
            max="99"
            step="1"
            class="num"
            :aria-label="featurePlural(id) + ' found'"
            @input="store.setFeature(id, Number(($event.target as HTMLInputElement).value))"
          />
          <span class="hint">{{ featurePlural(id) }} found. {{ featureHint(f) }}</span>
        </label>
      </template>
    </div>

    <div class="group">
      <p class="eyebrow">Duplicants</p>
      <label class="count">
        <input
          v-model.number="store.duplicants"
          type="number"
          min="1"
          max="200"
          step="1"
          class="num"
        />
        <span class="hint"
          >Each visits a toilet about once a cycle, so loops through toilets and showers can only
          run so fast.</span
        >
      </label>
    </div>

    <details
      v-if="gameData.plantMutations?.length"
      class="group fold"
      :open="showPlants"
      @toggle="showPlants = ($event.target as HTMLDetailsElement).open"
    >
      <summary class="fold-head">
        <span class="eyebrow">Plants</span>
        <span class="hint">
          <template v-if="mutatedCount">{{ mutatedCount }} with a mutated seed</template>
          <template v-else>plain seeds throughout</template>
        </span>
      </summary>
      <template v-if="showPlants">
        <p class="hint">
          A mutated seed changes the plant's yield, growth time, and water or fertilizer use, and
          needs radiation to stay viable. Pick the mutation you are growing, if any.
        </p>
        <div class="list">
          <div v-for="p in plants" :key="p.name" class="plant">
            <span>{{ p.name }}</span>
            <select
              :value="store.mutations[p.ids[0]!] ?? ''"
              :aria-label="`${p.name} mutation`"
              @change="
                p.ids.forEach((id) =>
                  store.setMutation(id, ($event.target as HTMLSelectElement).value),
                )
              "
            >
              <option value="">Plain</option>
              <option v-for="m in p.mutations" :key="m.id" :value="m.id">{{ m.name }}</option>
            </select>
          </div>
        </div>
      </template>
    </details>

    <details
      class="group fold"
      :open="showCritters"
      @toggle="showCritters = ($event.target as HTMLDetailsElement).open"
    >
      <summary class="fold-head">
        <span class="eyebrow">Critters</span>
        <span class="hint">
          <template v-if="store.critters === null">assuming any critter is available</template>
          <template v-else>{{ store.critters.size }} of {{ critters.length }} available</template>
        </span>
      </summary>
      <p v-if="store.critters === null" class="hint">
        <button type="button" class="link" @click="store.critters = new Set()">
          Start from none
        </button>
      </p>
      <p v-else class="hint">
        <button type="button" class="link" @click="store.assumeAllCritters()">Assume all</button>
      </p>
      <template v-if="showCritters">
        <p class="hint">
          Happiness sets how fast a tame critter lays eggs: 1 + 2.25 × happiness times the base
          rate. Tame is −1, groomed +5, cramped −5, so a groomed critter in a proper stable is 4.
        </p>
        <div class="list">
          <div v-for="c in critters" :key="c.id" class="critter">
            <label class="check">
              <input
                type="checkbox"
                :checked="has(c.id)"
                @change="
                  store.setCritter(c.id, ($event.target as HTMLInputElement).checked, allIds)
                "
              />
              {{ c.name }}
            </label>
            <input
              v-if="c.laysEggs"
              type="number"
              class="num happiness"
              min="-10"
              max="10"
              step="1"
              :value="happinessOf(c.id)"
              :aria-label="`${c.name} happiness`"
              title="Happiness"
              @change="store.setHappiness(c.id, Number(($event.target as HTMLInputElement).value))"
            />
          </div>
        </div>
      </template>
    </details>
  </section>
</template>

<style scoped>
.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: 1.1rem 1.25rem 1.25rem;
}
h2 {
  margin: 0 0 0.25rem;
  font-size: 1.125rem;
}
.group {
  margin-top: 1.25rem;
}
/* A group that folds away: its summary names it and says what is chosen, with a chevron. */
.fold-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25rem 0.6rem;
  cursor: pointer;
  list-style: none;
}
.fold-head::-webkit-details-marker {
  display: none;
}
.fold-head .eyebrow {
  margin: 0;
}
.fold-head .eyebrow::before {
  content: '▸';
  display: inline-block;
  width: 1rem;
  color: var(--muted);
  transition: transform 120ms;
}
.fold[open] .fold-head .eyebrow::before {
  transform: rotate(90deg);
}
.fold-head .hint {
  margin: 0;
}
.check {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  padding: 0.2rem 0;
  cursor: pointer;
}
.check input {
  accent-color: var(--accent);
  width: 1rem;
  height: 1rem;
  margin: 0;
}
.hint {
  margin-top: 0.4rem;
}
.geysers .chip {
  margin: 0.15rem 0.2rem 0.15rem 0;
}
.plant {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 9rem;
  gap: 0.5rem;
  align-items: center;
  padding: 0.15rem 0;
}
.plant select {
  width: 100%;
  padding: 0.15rem 0.35rem;
  font-size: 0.875rem;
}
.critter {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 3.5rem;
  gap: 0.5rem;
  align-items: center;
}
.happiness {
  width: 100%;
  padding: 0.15rem 0.35rem;
  background: var(--raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  font-size: 0.875rem;
}
.list {
  max-height: 18rem;
  overflow: auto;
  margin-top: 0.4rem;
  padding-right: 0.3rem;
}
select {
  width: 100%;
  padding: 0.45rem 0.5rem;
  background: var(--raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
}
.count {
  display: grid;
  grid-template-columns: 5rem minmax(0, 1fr);
  gap: 0.75rem;
  align-items: start;
}
.count input {
  width: 100%;
  padding: 0.4rem 0.5rem;
  background: var(--raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
}
.count .hint {
  margin: 0;
}
.count.feature {
  margin-top: 0.6rem;
}
</style>
