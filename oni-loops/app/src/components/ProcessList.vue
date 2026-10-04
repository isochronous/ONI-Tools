<script setup lang="ts">
import { computed } from 'vue'
import { label } from '../data/load'
import { fmt, type Flow, type Process, type ProcessKind } from '../model/graph'
import { qty, unitOf, useGraph } from '../model'
import { TIER_LABEL, TIER_ORDER, type Tier, type Tiers } from '../model/tiers'

const props = defineProps<{ processes: Process[]; target: string; reasons?: Map<string, string>; tiers: Tiers }>()
const graph = useGraph()

/** One row per distinct conversion; critter morphs with the same diet share a row. */
interface Row {
  id: string
  via: string
  p: Process
}

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
  rot: 'Spoiling and decomposing',
  geyser: 'Geysers and vents',
  worldgen: 'In the terrain of',
  starmap: 'Brought back by rockets from',
}

const groups = computed(() => {
  const map = new Map<ProcessKind, Map<string, Row>>()
  for (const p of props.processes) {
    const rows = map.get(p.kind) ?? new Map<string, Row>()
    map.set(p.kind, rows)
    const sig = [p.kind, JSON.stringify(p.inputs), JSON.stringify(p.outputs), p.notes.join('|'), props.reasons?.get(p.id) ?? ''].join('#')
    const row = rows.get(sig)
    if (row) {
      if (!row.via.split(', ').includes(p.via)) row.via += ', ' + p.via
    } else rows.set(sig, { id: p.id, via: p.via, p })
  }
  return [...map.entries()].map(([kind, rows]) => [kind, [...rows.values()]] as const)
})

/** "any seed (31 kinds)" for an any-of input, else the item's name. */
function inputText(f: Flow): string {
  if (!f.anyOf) return qty(f.amount, f.tag)
  const kinds = new Set(f.anyOf.map((t) => graph.kinds.get(t) ?? 'item'))
  const what = f.anyOfName ? `any ${f.anyOfName}` : kinds.size === 1 ? `any ${[...kinds][0]}` : 'any of these'
  return `${fmt(f.amount)}${unitOf(f.tag)} ${what} (${f.anyOf.length} kinds)`
}

function inputTitle(f: Flow): string {
  const tier = inputTier(f)
  const names = f.anyOf ? f.anyOf.map((t) => label(t)).join(', ') : ''
  return TIER_LABEL[tier] + ': ' + props.tiers.reason(f.anyOf ? bestOf(f.anyOf) : f.tag) + (names ? ' · ' + names : '')
}

function bestOf(tags: string[]): string {
  let best = tags[0]!
  for (const t of tags) if (TIER_ORDER[props.tiers.of(t)] < TIER_ORDER[props.tiers.of(best)]) best = t
  return best
}

function inputTier(f: Flow): Tier {
  return props.tiers.of(f.anyOf ? bestOf(f.anyOf) : f.tag)
}

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
        <li v-for="{ id, via, p } in list" :key="id">
          <template v-if="kind === 'worldgen' || kind === 'starmap'">
            <span class="via">{{ via }}</span>
            <span v-if="kind === 'starmap'" class="notes">{{ p.notes.join(' · ') }}</span>
          </template>
          <template v-else>
            <span class="via">{{ via }}</span>
            <span class="io">
              <template v-if="p.inputs.length">
                <span v-for="(f, i) in p.inputs" :key="f.tag" :class="'t-' + inputTier(f)" :title="inputTitle(f)">{{ i ? ' + ' : '' }}{{ inputText(f) }}</span>
                <span class="arrow"> → </span>
              </template>
              <strong>{{ qty(amountOf(p, target), target) }}{{ unit(p) }}</strong>
              <span v-for="f in p.outputs.filter((o) => o.tag !== target)" :key="f.tag" class="extra"> + {{ qty(f.amount, f.tag) }}</span>
            </span>
            <span v-if="p.notes.length || p.needs.extras?.length" class="notes">
              {{ [...p.notes, ...(p.needs.extras ?? [])].join(' · ') }}
            </span>
          </template>
          <span v-if="reasons?.get(id)" class="locked">{{ reasons.get(id) }}</span>
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
