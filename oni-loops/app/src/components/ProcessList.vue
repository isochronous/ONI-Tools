<script setup lang="ts">
import { computed } from 'vue'
import { label } from '../data/load'
import { fmt, type Flow, type Process, type ProcessKind } from '../model/graph'
import { qty, unitOf, useGraph } from '../model'
import { TIER_LABEL, TIER_ORDER, type Tier, type Tiers } from '../model/tiers'
import TagIcon from './TagIcon.vue'

const props = defineProps<{
  processes: Process[]
  target: string
  reasons?: Map<string, string>
  tiers: Tiers
}>()
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
  transition: 'Phase change, by heating or cooling in-world',
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
    const sig = [
      p.kind,
      JSON.stringify(p.inputs),
      JSON.stringify(p.outputs),
      p.notes.join('|'),
      props.reasons?.get(p.id) ?? '',
    ].join('#')
    const row = rows.get(sig)
    if (row) {
      if (!row.via.split(', ').includes(p.via)) row.via += ', ' + p.via
    } else rows.set(sig, { id: p.id, via: p.via, p })
  }
  return [...map.entries()].map(([kind, rows]) => ({ kind, rows: [...rows.values()] }))
})

/** "any seed (31 kinds)" for an any-of input, else the amount and name. */
function inputText(f: Flow): string {
  if (!f.anyOf) return qty(f.amount, f.tag)
  const kinds = new Set(f.anyOf.map((t) => graph.kinds.get(t) ?? 'item'))
  const what = f.anyOfName
    ? `any ${f.anyOfName}`
    : kinds.size === 1
      ? `any ${[...kinds][0]}`
      : 'any of these'
  return `${fmt(f.amount)}${unitOf(f.tag)} ${what} (${f.anyOf.length} kinds)`
}

function inputTitle(f: Flow): string {
  const tier = inputTier(f)
  const names = f.anyOf ? f.anyOf.map((t) => label(t)).join(', ') : ''
  return (
    TIER_LABEL[tier] +
    ': ' +
    props.tiers.reason(f.anyOf ? bestOf(f.anyOf) : f.tag) +
    (names ? '. ' + names : '')
  )
}

function bestOf(tags: string[]): string {
  let best = tags[0]!
  for (const t of tags)
    if (TIER_ORDER[props.tiers.of(t)] < TIER_ORDER[props.tiers.of(best)]) best = t
  return best
}

function inputTier(f: Flow): Tier {
  return props.tiers.of(f.anyOf ? bestOf(f.anyOf) : f.tag)
}

function amountOf(p: Process, tag: string): number {
  return p.outputs.find((f) => f.tag === tag)?.amount ?? 0
}

function unit(p: Process): string {
  if (p.kind === 'converter') return p.notes.includes('per use') ? ' per use' : ' per second'
  if (p.kind === 'geyser') return ' per cycle'
  return ''
}

function notes(p: Process): string[] {
  return [...p.notes, ...(p.needs.extras ?? [])]
}
</script>

<template>
  <div class="groups">
    <section v-for="g in groups" :key="g.kind" class="group">
      <h3>{{ KIND_TITLES[g.kind] }}</h3>
      <ul>
        <li v-for="{ id, via, p } in g.rows" :key="id" class="row">
          <span class="via"
            ><TagIcon
              v-if="p.needs.building || p.needs.critter || p.needs.plant"
              :tag="p.needs.building ?? p.needs.critter ?? p.needs.plant!"
            />{{ via }}</span
          >
          <template v-if="g.kind === 'worldgen' || g.kind === 'starmap'">
            <span class="flow"
              ><span class="note" v-for="n in p.notes" :key="n">{{ n }}</span></span
            >
          </template>
          <template v-else>
            <span class="flow">
              <template v-if="p.inputs.length">
                <template v-for="(f, i) in p.inputs" :key="f.tag">
                  <span v-if="i" class="plus">+</span>
                  <span class="num" :class="'t-' + inputTier(f)" :title="inputTitle(f)"
                    ><TagIcon v-if="!f.anyOf" :tag="f.tag" />{{ inputText(f) }}</span
                  >
                </template>
                <span class="arrow" aria-hidden="true">→</span>
              </template>
              <strong class="num gives"
                ><TagIcon :tag="target" />{{ qty(amountOf(p, target), target)
                }}{{ unit(p) }}</strong
              >
              <template v-for="f in p.outputs.filter((o) => o.tag !== target)" :key="f.tag">
                <span class="plus">+</span>
                <span class="extra num"><TagIcon :tag="f.tag" />{{ qty(f.amount, f.tag) }}</span>
              </template>
            </span>
            <span v-if="notes(p).length" class="notes">
              <span v-for="n in notes(p)" :key="n" class="note">{{ n }}</span>
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
  gap: 1.25rem;
}
h3 {
  margin: 0 0 0.25rem;
  font-size: 0.9375rem;
  color: var(--muted);
}
ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.row {
  display: grid;
  grid-template-columns: minmax(10rem, 14rem) minmax(0, 1fr);
  gap: 0.15rem 1.25rem;
  padding: 0.5rem 0;
  border-top: 1px solid var(--border);
}
.via {
  font-weight: 600;
}
.flow {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.2rem 0.45rem;
}
.gives {
  font-weight: 600;
}
.arrow,
.plus,
.extra {
  color: var(--muted);
}
.arrow {
  color: var(--accent);
}
.notes {
  grid-column: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 0.15rem 1rem;
  font-size: 0.875rem;
  color: var(--muted);
}
.t-off-world {
  text-decoration: underline dotted var(--border-strong);
}
.t-space,
.t-none {
  text-decoration: underline dotted var(--warn);
}
.locked {
  grid-column: 2;
  font-size: 0.875rem;
  color: var(--warn);
}
@media (max-width: 640px) {
  .row {
    grid-template-columns: 1fr;
  }
  .notes,
  .locked {
    grid-column: 1;
  }
}
</style>
