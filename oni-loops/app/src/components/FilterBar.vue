<script setup lang="ts">
import { computed } from 'vue'
import { FACET_GROUPS, groupRule, type Facet, type FacetGroup } from '../model/filters'
import TagIcon from './TagIcon.vue'

const props = defineProps<{
  facets: Facet[]
  hidden: Set<string>
  hiddenLoops: number
  hiddenSources: number
}>()
const emit = defineEmits<{
  (e: 'toggle', key: string): void
  (e: 'set', keys: string[], off: boolean): void
  (e: 'clear'): void
  /** The whole group switched off (a rule the search applies) or back on. */
  (e: 'rule', group: FacetGroup, off: boolean): void
  /** One chip of a ruled-off group switched on: the rule becomes the other chips, hidden. */
  (e: 'dissolve', group: FacetGroup, hideKeys: string[]): void
}>()

const groups = computed(() =>
  FACET_GROUPS.map((g) => ({ ...g, facets: props.facets.filter((f) => f.group === g.id) })).filter(
    (g) => g.facets.length,
  ),
)
const active = computed(() => props.facets.filter((f) => f.state === 'off').length)

/** True while the whole group is switched off by its rule. */
function ruled(group: FacetGroup): boolean {
  return props.hidden.has(groupRule(group))
}

/** The group's links: "all on" while any chip is off, "all off" while any is on. */
function allOff(facets: Facet[]): boolean {
  return facets.every((f) => f.state === 'off')
}
function anyOff(facets: Facet[]): boolean {
  return facets.some((f) => f.state === 'off')
}

/** A chip under its group's rule comes back on by dissolving the rule into the other chips. */
function clickChip(group: FacetGroup, facets: Facet[], f: Facet) {
  if (ruled(group))
    emit(
      'dissolve',
      group,
      facets.filter((x) => x.key !== f.key).map((x) => x.key),
    )
  else emit('toggle', f.key)
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function chipTitle(f: Facet): string {
  switch (f.state) {
    case 'off':
      return f.possible
        ? `Show the ${plural(f.possible, 'answer')} that use ${f.name}`
        : `Show answers that use ${f.name}`
    case 'blocked':
      return `Switched on, but every answer that uses ${f.name} also needs something you switched off`
    default:
      return `Hide the ${plural(f.uses, 'answer')} that use ${f.name}`
  }
}

function summary(): string {
  const parts: string[] = []
  if (props.hiddenLoops)
    parts.push(`${props.hiddenLoops} loop${props.hiddenLoops === 1 ? '' : 's'}`)
  if (props.hiddenSources)
    parts.push(`${props.hiddenSources} source${props.hiddenSources === 1 ? '' : 's'}`)
  return parts.length
    ? `Hiding ${parts.join(' and ')}.`
    : 'Nothing on this page uses what you switched off.'
}
</script>

<template>
  <details v-if="groups.length" class="filters panel" open>
    <summary class="filters-head strip">
      <span class="title">Switch off what you don't have, or don't want to use</span>
      <span class="status note">
        <template v-if="active">{{ summary() }}</template>
        <template v-else
          >Nothing switched off. Hiding is instant and changes nothing else on the page.</template
        >
      </span>
    </summary>
    <div class="body">
      <p v-if="active" class="status clear">
        <button type="button" class="link" @click="emit('clear')">Show everything</button>
      </p>
      <div v-for="g in groups" :key="g.id" class="row">
        <span class="row-title eyebrow">
          {{ g.title }}
          <span class="all">
            <button
              type="button"
              class="link"
              :disabled="!anyOff(g.facets)"
              @click="emit('rule', g.id, false)"
            >
              all on
            </button>
            ·
            <button
              type="button"
              class="link"
              :disabled="allOff(g.facets)"
              @click="emit('rule', g.id, true)"
            >
              all off
            </button>
          </span>
        </span>
        <div class="chips">
          <button
            v-for="f in g.facets"
            :key="f.key"
            type="button"
            class="facet"
            :class="f.state"
            :aria-pressed="f.state === 'off'"
            :title="chipTitle(f)"
            @click="clickChip(g.id, g.facets, f)"
          >
            <span class="name"><TagIcon :tag="f.id" />{{ f.name }}</span>
            <span class="uses num">{{ f.state === 'blocked' ? '!' : f.uses }}</span>
          </button>
        </div>
      </div>
    </div>
  </details>
</template>

<style scoped>
.filters {
  padding-bottom: 1rem;
}
/* Chrome lays a details element's children out through a slot, so the spacing lives on a plain box inside it. */
.body {
  display: grid;
  gap: 0.75rem;
  padding: 0.9rem 1rem 0;
}
.filters-head {
  cursor: pointer;
  list-style: none;
}
.filters-head::-webkit-details-marker {
  display: none;
}
.title::before {
  content: '▸';
  display: inline-block;
  width: 1rem;
  color: var(--muted);
  transition: transform 120ms;
}
.filters[open] .title::before {
  transform: rotate(90deg);
}
.clear {
  margin: -0.25rem 0 -0.25rem;
}
.status {
  font-size: 0.875rem;
}
.row {
  display: grid;
  grid-template-columns: 7rem minmax(0, 1fr);
  gap: 0.5rem 1rem;
  align-items: start;
}
.row-title {
  display: grid;
  justify-items: start;
  padding-top: 0.25rem;
}
.all {
  font-size: 0.8125rem;
  letter-spacing: 0;
  text-transform: none;
  font-weight: 400;
  color: var(--muted);
}
.all .link:disabled {
  color: var(--muted);
  opacity: 0.5;
  cursor: default;
  text-decoration: none;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
/* A source as a tag: name, then its count in a darker cell, like a resource row in the game. */
.facet {
  display: inline-flex;
  align-items: stretch;
  padding: 0;
  background: var(--raised);
  border: 1px solid transparent;
  border-bottom-color: var(--edge);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 0.875rem;
  line-height: 1.3;
  overflow: hidden;
  transition:
    border-color 120ms,
    background-color 120ms,
    color 120ms;
}
.facet:hover {
  background: var(--raised-hover);
  color: var(--accent);
}
.name {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.5rem;
}
.uses {
  display: inline-flex;
  align-items: center;
  min-width: 1.6rem;
  padding: 0 0.35rem;
  justify-content: center;
  background: var(--inset);
  color: var(--muted);
  font-size: 0.75rem;
}
/* Switched off: struck through, on the game's hatch for what is unavailable. */
.facet.off {
  background-color: transparent;
  background-image: repeating-linear-gradient(-45deg, var(--warn-dim) 0 2px, transparent 2px 7px);
  border-color: var(--warn);
  color: var(--muted);
}
.facet.off .name {
  text-decoration: line-through;
  text-decoration-color: var(--warn);
}
.facet.off :deep(.icon) {
  opacity: 0.4;
}
.facet.off .uses {
  background: var(--warn);
  color: #fff;
}
/* Switched on but unused while other things are off: dimmed, with a mark in the count cell. */
.facet.blocked {
  color: var(--muted);
  border-style: dashed;
  border-color: var(--line-strong);
}
.facet.blocked :deep(.icon) {
  opacity: 0.6;
}
.facet.blocked .uses {
  background: var(--accent);
  color: #fff;
  font-weight: 700;
}
@media (max-width: 640px) {
  .row {
    grid-template-columns: 1fr;
    gap: 0.25rem;
  }
}
</style>
