<script setup lang="ts">
import { computed } from 'vue'
import { FACET_GROUPS, type Facet } from '../model/filters'
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
}>()

const groups = computed(() =>
  FACET_GROUPS.map((g) => ({ ...g, facets: props.facets.filter((f) => f.group === g.id) })).filter(
    (g) => g.facets.length,
  ),
)
const active = computed(() => props.facets.filter((f) => props.hidden.has(f.key)).length)

/** True when every chip of the group is switched off, so the group link offers to switch them back on. */
function allOff(facets: Facet[]): boolean {
  return facets.every((f) => props.hidden.has(f.key))
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
          <button
            type="button"
            class="link all"
            @click="
              emit(
                'set',
                g.facets.map((f) => f.key),
                !allOff(g.facets),
              )
            "
          >
            {{ allOff(g.facets) ? 'all on' : 'all off' }}
          </button>
        </span>
        <div class="chips">
          <button
            v-for="f in g.facets"
            :key="f.key"
            type="button"
            class="facet"
            :class="{ off: hidden.has(f.key) }"
            :aria-pressed="hidden.has(f.key)"
            :title="
              hidden.has(f.key)
                ? `Show answers that use ${f.name}`
                : `Hide the ${f.uses} answer${f.uses === 1 ? '' : 's'} that use ${f.name}`
            "
            @click="emit('toggle', f.key)"
          >
            <span class="name"><TagIcon :tag="f.id" />{{ f.name }}</span>
            <span class="uses num">{{ f.uses }}</span>
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
@media (max-width: 640px) {
  .row {
    grid-template-columns: 1fr;
    gap: 0.25rem;
  }
}
</style>
