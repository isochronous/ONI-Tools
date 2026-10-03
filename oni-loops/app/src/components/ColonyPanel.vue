<script setup lang="ts">
import { computed, ref } from 'vue'
import { gameData } from '../data/load'
import { useGraph } from '../model'
import { useColonyStore } from '../stores/colony'
import { randomGeyserSlots } from '../model/tiers'

const store = useColonyStore()
const graph = useGraph()
const showCritters = ref(false)

/** Critters that can be ranched (adults with a diet, egg, shear, or drop) under the chosen DLCs. */
const critters = computed(() => {
  const list: { id: string; name: string }[] = []
  for (const c of gameData.critters) {
    if (c.adult) continue // babies are listed under their adult
    if (c.dlc.requires.some((id) => !store.dlcs.has(id))) continue
    if (!graph.byOutput.size) continue
    list.push({ id: c.id, name: c.name })
  }
  return list.sort((a, b) => a.name.localeCompare(b.name))
})

const allIds = computed(() => critters.value.map((c) => c.id))

/** Clusters playable with the chosen DLCs. */
const clusters = computed(() =>
  gameData.clusters
    .filter((c) => c.dlc.requires.every((id) => store.dlcs.has(id)) && !c.dlc.forbids.some((id) => store.dlcs.has(id)))
    .sort((a, b) => a.name.localeCompare(b.name)),
)
const randomSlots = computed(() => randomGeyserSlots(gameData, store.clusterData))
const geyserTypes = computed(() =>
  gameData.geysers
    .filter((g) => g.dlc.requires.every((id) => store.dlcs.has(id)))
    .map((g) => ({ id: g.id, name: gameData.names['GeyserGeneric_' + g.id] ?? g.id }))
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
  <section class="panel">
    <h2>My colony</h2>

    <div class="group">
      <h3>DLCs</h3>
      <label v-for="d in gameData.dlcs" :key="d.id" class="check">
        <input type="checkbox" :checked="store.dlcs.has(d.id)" @change="store.toggleDlc(d.id)" />
        {{ d.name }}
      </label>
    </div>

    <div class="group">
      <h3>Asteroid</h3>
      <select :value="store.cluster ?? ''" @change="store.cluster = ($event.target as HTMLSelectElement).value || null">
        <option value="">Not chosen (no terrain or geyser knowledge)</option>
        <option v-for="c in clusters" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <template v-if="store.clusterData">
        <p v-if="store.guaranteed.size" class="hint">
          Guaranteed geysers:
          <span v-for="[id, g] in store.guaranteed" :key="id" class="chip">{{ g.min === g.max ? g.min : g.min + '–' + g.max }}× {{ geyserName(id) }}</span>
        </p>
        <p v-if="randomSlots.length" class="hint">
          Plus {{ randomSlots.map((s) => `${s.count} seed-random on ${s.world}`).join(', ') }}. Tick the ones you have found:
        </p>
        <div v-if="randomSlots.length" class="critters">
          <label v-for="g in geyserTypes" :key="g.id" class="check">
            <input type="checkbox" :checked="store.geysers.has(g.id)" :disabled="store.guaranteed.has(g.id)" @change="store.toggleGeyser(g.id)" />
            {{ g.name }}
          </label>
        </div>
      </template>
    </div>

    <div class="group">
      <h3>Plants</h3>
      <label class="check">
        <input type="radio" name="plants" :checked="store.domesticated" @change="store.domesticated = true" />
        Domesticated (full yield, needs irrigation and fertilizer)
      </label>
      <label class="check">
        <input type="radio" name="plants" :checked="!store.domesticated" @change="store.domesticated = false" />
        Wild (¼ yield, needs nothing)
      </label>
    </div>

    <div class="group">
      <h3>Loops</h3>
      <label class="slider">
        Show loops that return at least <strong>{{ Math.round(store.loopFloor * 100) }}%</strong>
        <input v-model.number="store.loopFloor" type="range" min="0" max="1" step="0.05" />
      </label>
      <p class="hint">100% lists only net-positive loops; lower it to see loops whose shortfall you can top up from elsewhere.</p>
      <label class="slider">
        Call a loop side-stream when the target is under <strong>{{ Math.round(store.primaryShare * 100) }}%</strong> of what a step consumes
        <input v-model.number="store.primaryShare" type="range" min="0" max="1" step="0.05" />
      </label>
      <p class="hint">Side-stream loops ride along a machine that mostly eats something else (steam into an oil refinery); they are listed last.</p>
    </div>

    <div class="group">
      <h3>
        Critters
        <button class="link" @click="showCritters = !showCritters">{{ showCritters ? 'hide' : 'choose' }}</button>
      </h3>
      <p v-if="store.critters === null" class="hint">
        Assuming any critter is available.
        <button v-if="showCritters" class="link" @click="store.critters = new Set()">Start from none</button>
      </p>
      <p v-else class="hint">
        {{ store.critters.size }} of {{ critters.length }} selected.
        <button class="link" @click="store.assumeAllCritters()">Assume all</button>
      </p>
      <div v-if="showCritters" class="critters">
        <label v-for="c in critters" :key="c.id" class="check">
          <input type="checkbox" :checked="has(c.id)" @change="store.setCritter(c.id, ($event.target as HTMLInputElement).checked, allIds)" />
          {{ c.name }}
        </label>
      </div>
    </div>
  </section>
</template>

<style scoped>
.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1rem 1.1rem;
}
h2 {
  margin: 0 0 0.6rem;
  font-size: 1.05rem;
}
h3 {
  margin: 0.9rem 0 0.4rem;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.check {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding: 0.2rem 0;
  cursor: pointer;
}
.slider {
  display: block;
}
.slider input {
  display: block;
  width: 100%;
  margin-top: 0.3rem;
}
.hint {
  margin: 0.3rem 0 0;
  font-size: 0.85rem;
  color: var(--muted);
}
.critters {
  max-height: 18rem;
  overflow: auto;
  margin-top: 0.4rem;
  padding-right: 0.3rem;
}
select {
  width: 100%;
  padding: 0.4rem;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.chip {
  display: inline-block;
  margin: 0.1rem 0.2rem 0.1rem 0;
  padding: 0 0.4rem;
  border-radius: 999px;
  background: var(--hover);
  color: var(--text);
}
.link {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  font-size: 0.85rem;
  padding: 0;
}
</style>
