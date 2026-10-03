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
  const contains = targets.filter((t) => !t.name.toLowerCase().startsWith(q) && t.name.toLowerCase().includes(q))
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
    <label class="picker-label" for="target">I want more…</label>
    <div class="picker-row">
      <input
        id="target"
        v-model="query"
        type="search"
        autocomplete="off"
        :placeholder="selected ? selected.name : 'Diamond, Reed Fiber, Polluted Water…'"
        @focus="open = true"
        @blur="open = false"
        @keydown.enter.prevent="matches[0] && choose(matches[0])"
      />
      <span v-if="selected" class="chosen">{{ selected.name }}</span>
    </div>
    <ul v-if="open && matches.length" class="matches">
      <li v-for="t in matches" :key="t.tag" @mousedown.prevent="choose(t)">
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
.picker-label {
  display: block;
  font-size: 0.85rem;
  color: var(--muted);
  margin-bottom: 0.3rem;
}
.picker-row {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}
input {
  flex: 1;
  font-size: 1.25rem;
  padding: 0.6rem 0.8rem;
  background: var(--panel);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
}
input:focus {
  outline: 2px solid var(--accent);
  border-color: transparent;
}
.chosen {
  font-size: 1.1rem;
  font-weight: 600;
  white-space: nowrap;
}
.matches {
  position: absolute;
  z-index: 10;
  left: 0;
  right: 0;
  margin: 0.3rem 0 0;
  padding: 0.3rem;
  list-style: none;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
.matches li {
  display: flex;
  justify-content: space-between;
  padding: 0.45rem 0.6rem;
  border-radius: 6px;
  cursor: pointer;
}
.matches li:hover {
  background: var(--hover);
}
.kind {
  color: var(--muted);
  font-size: 0.8rem;
}
</style>
