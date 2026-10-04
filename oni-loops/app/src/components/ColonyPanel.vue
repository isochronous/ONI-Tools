<script setup lang="ts">
import { computed, ref } from 'vue'
import { gameData } from '../data/load'
import { DEFAULT_HAPPINESS } from '../model/graph'
import { randomGeyserSlots } from '../model/tiers'
import { useColonyStore } from '../stores/colony'

const store = useColonyStore()
const showCritters = ref(false)

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

    <div class="group">
      <p class="eyebrow row">
        Critters
        <button type="button" class="link" @click="showCritters = !showCritters">
          {{ showCritters ? 'Done' : 'Choose' }}
        </button>
      </p>
      <p v-if="store.critters === null" class="hint">
        Assuming any critter is available.
        <button v-if="showCritters" type="button" class="link" @click="store.critters = new Set()">
          Start from none
        </button>
      </p>
      <p v-else class="hint">
        {{ store.critters.size }} of {{ critters.length }} available.
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
    </div>
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
.eyebrow.row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.eyebrow .link {
  font-size: 0.875rem;
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
</style>
