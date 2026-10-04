<script setup lang="ts">
import { computed, ref } from 'vue'
import { gameData } from '../data/load'
import { randomGeyserSlots } from '../model/tiers'
import { useColonyStore } from '../stores/colony'

const store = useColonyStore()
const showCritters = ref(false)

/** Adult critters under the chosen DLCs; babies are covered by their adult. */
const critters = computed(() =>
  gameData.critters
    .filter((c) => !c.adult && !c.dlc.requires.some((id) => !store.dlcs.has(id)))
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name)),
)
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
      <div v-if="showCritters" class="list">
        <label v-for="c in critters" :key="c.id" class="check">
          <input
            type="checkbox"
            :checked="has(c.id)"
            @change="store.setCritter(c.id, ($event.target as HTMLInputElement).checked, allIds)"
          />
          {{ c.name }}
        </label>
      </div>
    </div>

    <details class="group fine">
      <summary>Fine print</summary>
      <label class="slider">
        Call a loop side-stream when the target is under
        <strong class="num">{{ Math.round(store.primaryShare * 100) }}%</strong> of what a step
        consumes
        <input v-model.number="store.primaryShare" type="range" min="0" max="1" step="0.05" />
      </label>
      <p class="hint">
        A side-stream loop passes through a step where the loop's own material is only a small part
        of what that step consumes, so the step's output is really paid for by something else: 0.04
        kg of carbon dioxide into an Algae Terrarium that drinks 180 kg of water does not make the
        water "free". They are listed after the others.
      </p>
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
.slider {
  display: block;
  font-size: 0.9375rem;
}
.slider input {
  display: block;
  margin-top: 0.3rem;
}
.fine summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 0.875rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}
</style>
