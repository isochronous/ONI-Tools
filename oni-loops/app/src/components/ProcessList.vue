<script setup lang="ts">
import { computed } from 'vue'
import { label } from '../data/load'
import { fmt, type Process, type ProcessKind } from '../model/graph'
import { TIER_LABEL, type Tiers } from '../model/tiers'

const props = defineProps<{ processes: Process[]; target: string; reasons?: Map<string, string>; tiers: Tiers }>()

const KIND_TITLES: Record<ProcessKind, string> = {
  recipe: 'Made in a building',
  converter: 'Made continuously by a building',
  diet: 'Excreted by critters',
  drop: 'Dropped when a critter dies',
  egg: 'Laid by critters',
  grow: 'Shed when a critter grows up',
  shear: 'Sheared from critters',
  crop: 'Grown',
  seed: 'Seeds from plants',
  'harvest-bonus': 'Bonus on skilled harvests',
  transition: 'Phase change (heating or cooling in-world)',
  sublimate: 'Off-gassing',
  geyser: 'Geysers and vents',
  worldgen: 'In the terrain of',
  starmap: 'Brought back by rockets from',
}

const groups = computed(() => {
  const map = new Map<ProcessKind, Process[]>()
  for (const p of props.processes) {
    const list = map.get(p.kind)
    if (list) list.push(p)
    else map.set(p.kind, [p])
  }
  return [...map.entries()]
})

function amountOf(p: Process, tag: string): number {
  return p.outputs.find((f) => f.tag === tag)?.amount ?? 0
}

function unit(p: Process): string {
  if (p.kind === 'converter') return p.notes.includes('per use') ? 'per use' : '/s'
  if (p.kind === 'geyser') return '/cycle'
  return ''
}
</script>

<template>
  <div class="groups">
    <section v-for="[kind, list] in groups" :key="kind">
      <h3>{{ KIND_TITLES[kind] }}</h3>
      <ul>
        <li v-for="p in list" :key="p.id">
          <template v-if="kind === 'worldgen' || kind === 'starmap'">
            <span class="via">{{ p.via }}</span>
            <span v-if="kind === 'starmap'" class="notes">{{ p.notes.join(' · ') }}</span>
          </template>
          <template v-else>
            <span class="via">{{ p.via }}</span>
            <span class="io">
              <template v-if="p.inputs.length">
                <span v-for="(f, i) in p.inputs" :key="f.tag" :class="'t-' + tiers.of(f.tag)" :title="TIER_LABEL[tiers.of(f.tag)] + ': ' + tiers.reason(f.tag)">{{ i ? ' + ' : '' }}{{ fmt(f.amount) }} {{ label(f.tag) }}</span>
                <span class="arrow"> → </span>
              </template>
              <strong>{{ fmt(amountOf(p, target)) }} {{ label(target) }}{{ unit(p) }}</strong>
              <span v-for="f in p.outputs.filter((o) => o.tag !== target)" :key="f.tag" class="extra"> + {{ fmt(f.amount) }} {{ label(f.tag) }}</span>
            </span>
            <span v-if="p.notes.length || p.needs.extras?.length" class="notes">
              {{ [...p.notes, ...(p.needs.extras ?? [])].join(' · ') }}
            </span>
          </template>
          <span v-if="reasons?.get(p.id)" class="locked">{{ reasons.get(p.id) }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.groups {
  display: grid;
  gap: 1rem;
}
h3 {
  margin: 0 0 0.3rem;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}
ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
li {
  display: grid;
  grid-template-columns: 11rem 1fr;
  gap: 0.2rem 1rem;
  padding: 0.35rem 0;
  border-top: 1px solid var(--border);
  font-size: 0.95rem;
}
.via {
  font-weight: 600;
}
.arrow,
.extra,
.notes {
  color: var(--muted);
}
.notes {
  grid-column: 2;
  font-size: 0.8rem;
}
.t-space,
.t-none {
  text-decoration: underline dotted var(--warn);
}
.locked {
  grid-column: 2;
  font-size: 0.8rem;
  color: var(--warn);
}
</style>
