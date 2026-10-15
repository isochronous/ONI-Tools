<script setup lang="ts">
import { computed } from 'vue'
import { iconOf } from '../model'

/** The game's icon for a material, item, critter, plant, or building, when the dump has it. */
const props = defineProps<{ tag: string }>()
const src = computed(() => iconOf(props.tag))
</script>

<template>
  <img v-if="src" :src="src" alt="" class="icon" loading="lazy" decoding="async" />
</template>

<style scoped>
.icon {
  width: 1.25em;
  height: 1.25em;
  object-fit: contain;
  vertical-align: -0.3em;
  margin-right: 0.3em;
}
</style>
