<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ColonyPanel from '../components/ColonyPanel.vue'
import LoopCard from '../components/LoopCard.vue'
import ProcessList from '../components/ProcessList.vue'
import TargetPicker from '../components/TargetPicker.vue'
import { label } from '../data/load'
import { useGraph } from '../model'
import { answer } from '../model/search'
import { useColonyStore } from '../stores/colony'

const route = useRoute()
const router = useRouter()
const store = useColonyStore()
const graph = useGraph()

const target = computed<string | null>(() => (typeof route.query.t === 'string' && route.query.t) || null)

function setTarget(tag: string) {
  router.push({ query: { ...route.query, t: tag } })
}

const result = computed(() => (target.value ? answer(graph, target.value, store.colony) : null))
const lockedReasons = computed(() => new Map(result.value?.locked.map((l) => [l.process.id, l.reason]) ?? []))

watch(target, (t) => {
  document.title = t ? `${label(t)} · ONI Loops` : 'ONI Loops'
}, { immediate: true })
</script>

<template>
  <div class="layout">
    <aside>
      <ColonyPanel />
    </aside>
    <main>
      <TargetPicker :model-value="target" @update:model-value="setTarget" />

      <template v-if="result">
        <section class="block">
          <h2>
            Loops
            <small v-if="result.hiddenCycles">{{ result.hiddenCycles }} below your floor hidden</small>
          </h2>
          <p v-if="!result.loops.length" class="empty">No cycle brings {{ label(result.target) }} back at or above your floor with what your colony has.</p>
          <div class="loops">
            <LoopCard v-for="(loop, i) in result.loops" :key="i" :loop="loop" :target="result.target" />
          </div>
        </section>

        <section class="block">
          <h2>Ways to get {{ label(result.target) }}</h2>
          <p v-if="!result.producers.length" class="empty">
            Nothing your colony has makes or contains {{ label(result.target) }}.
            <template v-if="!result.locked.length">The game defines no source for it at all.</template>
          </p>
          <ProcessList :processes="result.producers" :target="result.target" />
        </section>

        <section v-if="result.locked.length" class="block">
          <h2>One step away</h2>
          <ProcessList :processes="result.locked.map((l) => l.process)" :target="result.target" :reasons="lockedReasons" />
        </section>
      </template>
      <p v-else class="intro">
        Pick something you want more of. You get every way the game can produce it with what your colony has, and any loop that brings it back to itself, net-positive loops first.
      </p>
    </main>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 18rem 1fr;
  gap: 1.5rem;
  align-items: start;
}
@media (max-width: 800px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
main {
  display: grid;
  gap: 1.5rem;
}
.block h2 {
  font-size: 1.1rem;
  margin: 0 0 0.6rem;
  display: flex;
  gap: 0.8rem;
  align-items: baseline;
}
.block h2 small {
  font-size: 0.8rem;
  font-weight: 400;
  color: var(--muted);
}
.loops {
  display: grid;
  gap: 0.8rem;
}
.empty,
.intro {
  color: var(--muted);
}
</style>
