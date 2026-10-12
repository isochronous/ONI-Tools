<script setup lang="ts">
import { computed, ref } from 'vue'
import { allTargets, type Target } from '../model'

const props = defineProps<{ modelValue: string | null }>()
const emit = defineEmits<{ (e: 'update:modelValue', tag: string): void }>()

const query = ref('')
const open = ref(false)
const targets = allTargets()

const selected = computed(() => targets.find((t) => t.tag === props.modelValue) ?? null)

const matches = computed<Target[]>(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return []
  const starts = targets.filter((t) => t.name.toLowerCase().startsWith(q))
  const contains = targets.filter(
    (t) => !t.name.toLowerCase().startsWith(q) && t.name.toLowerCase().includes(q),
  )
  return [...starts, ...contains].slice(0, 12)
})

function choose(t: Target) {
  emit('update:modelValue', t.tag)
  query.value = ''
  open.value = false
}
</script>

<template>
  <div class="picker">
    <label class="field" :class="{ open: open && matches.length }">
      <span class="prompt">I want more</span>
      <input
        v-model="query"
        type="search"
        autocomplete="off"
        :placeholder="selected ? 'something else…' : 'Diamond, Reed Fiber, Polluted Water…'"
        @focus="open = true"
        @blur="open = false"
        @keydown.enter.prevent="matches[0] && choose(matches[0])"
      />
    </label>
    <ul v-if="open && matches.length" class="matches" role="listbox">
      <li v-for="t in matches" :key="t.tag" role="option" @mousedown.prevent="choose(t)">
        <span>{{ t.name }}</span>
        <span class="kind">{{ t.kind }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.picker {
  position: relative;
}
/* The game's search box: a dark inset with the prompt as a label, lit yellow while typing. */
.field {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0 0 0 1rem;
  background: var(--inset);
  border: 1px solid var(--edge);
  border-radius: var(--radius);
  box-shadow: 0 2px 0 var(--edge);
  transition:
    border-color 120ms,
    box-shadow 120ms;
}
.field:focus-within {
  border-color: var(--accent);
  box-shadow:
    0 0 0 1px var(--accent),
    0 2px 0 var(--edge);
}
.field.open {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}
.prompt {
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent);
  white-space: nowrap;
}
input {
  flex: 1;
  min-width: 0;
  font-size: 1.25rem;
  padding: 0.7rem 1rem 0.7rem 0;
  background: transparent;
  border: none;
}
input:focus,
input:focus-visible {
  outline: none;
  box-shadow: none;
  border: none;
}
input::placeholder {
  color: var(--faint);
}
.matches {
  position: absolute;
  z-index: 10;
  left: 0;
  right: 0;
  margin: 0;
  padding: 0.3rem;
  list-style: none;
  background: var(--panel);
  border: 1px solid var(--accent);
  border-top: 0;
  border-radius: 0 0 var(--radius) var(--radius);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
}
.matches li {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius);
  cursor: pointer;
}
.matches li:hover {
  background: var(--raised);
  color: var(--accent);
}
.kind {
  color: var(--faint);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
</style>
