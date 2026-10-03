<script setup lang="ts">
import { computed } from 'vue'
import { label } from '../data/load'
import { fmt, stepLabel } from '../model/graph'
import { isPositive, type Loop, type Step } from '../model/search'
import { TIER_LABEL, type Tiers } from '../model/tiers'

const props = defineProps<{ loop: Loop; target: string; tiers: Tiers }>()

const positive = computed(() => isPositive(props.loop))

function how(s: Step): string {
  return stepLabel(s.process)
}

function needsOf(s: Step): string[] {
  const n = s.process.needs.extras ?? []
  return n
}
</script>

<template>
  <article class="loop" :class="{ positive }">
    <header>
      <span class="ratio">×{{ fmt(loop.ratio) }}</span>
      <span class="tier">{{ positive ? 'net-positive loop' : 'top-up loop' }}</span>
      <span v-if="!loop.primary" class="side" :title="`At one step ${label(target)}'s share of what the machine eats is only ${fmt(loop.minShare * 100)}%; the rest is the real cost.`">side-stream</span>
      <span v-if="!positive" class="shortfall">returns {{ fmt(loop.ratio) }} per 1 {{ label(target) }}; top up {{ fmt(1 - loop.ratio) }} elsewhere</span>
    </header>
    <ol class="chain">
      <li v-for="(s, i) in loop.steps" :key="i">
        <span class="from">{{ i === 0 ? '1' : fmt(loop.steps.slice(0, i).reduce((r, x) => r * x.ratio, 1)) }} {{ label(s.from) }}</span>
        <span class="arrow">→</span>
        <span class="how">
          {{ how(s) }}
          <small v-for="n in needsOf(s)" :key="n" class="need">{{ n }}</small>
        </span>
        <span class="arrow">→</span>
        <span class="to">{{ fmt(loop.steps.slice(0, i + 1).reduce((r, x) => r * x.ratio, 1)) }} {{ label(s.to) }}</span>
      </li>
    </ol>
    <p v-if="loop.alternatives.length" class="alts">or using {{ loop.alternatives.join(', ') }}</p>
    <footer v-if="loop.externals.length || loop.byproducts.length">
      <p v-if="loop.externals.length">
        <strong>Also needs</strong> per 1 {{ label(target) }}:
        <span v-for="f in loop.externals" :key="f.tag" class="chip" :class="'t-' + tiers.of(f.tag)" :title="tiers.reason(f.tag)">{{ fmt(f.amount) }} {{ label(f.tag) }} <em>{{ TIER_LABEL[tiers.of(f.tag)] }}</em></span>
      </p>
      <p v-if="loop.byproducts.length">
        <strong>Also makes</strong>:
        <span v-for="f in loop.byproducts" :key="f.tag" class="chip plus">{{ fmt(f.amount) }} {{ label(f.tag) }}</span>
      </p>
    </footer>
  </article>
</template>

<style scoped>
.loop {
  background: var(--panel);
  border: 1px solid var(--border);
  border-left: 4px solid var(--muted);
  border-radius: 10px;
  padding: 0.8rem 1rem;
}
.loop.positive {
  border-left-color: var(--good);
}
header {
  display: flex;
  gap: 0.8rem;
  align-items: baseline;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}
.ratio {
  font-size: 1.4rem;
  font-weight: 700;
}
.positive .ratio {
  color: var(--good);
}
.tier {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}
.shortfall {
  font-size: 0.85rem;
  color: var(--muted);
}
.chain {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.25rem;
}
.chain li {
  display: grid;
  grid-template-columns: minmax(8rem, 1fr) auto minmax(10rem, 1.4fr) auto minmax(8rem, 1fr);
  gap: 0.5rem;
  align-items: center;
  font-size: 0.95rem;
}
.arrow {
  color: var(--muted);
}
.how {
  color: var(--accent);
}
.need {
  display: inline-block;
  margin-left: 0.4rem;
  padding: 0 0.35rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--muted);
  font-size: 0.75rem;
}
footer {
  margin-top: 0.6rem;
  font-size: 0.85rem;
  color: var(--muted);
}
footer p {
  margin: 0.2rem 0;
}
.chip {
  display: inline-block;
  margin: 0.1rem 0.25rem;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  background: var(--hover);
  color: var(--text);
}
.chip.plus {
  background: rgba(80, 200, 120, 0.15);
}
.chip em {
  font-style: normal;
  color: var(--muted);
  font-size: 0.75rem;
  margin-left: 0.2rem;
}
.chip.t-space,
.chip.t-none {
  outline: 1px solid var(--warn);
}
.side {
  font-size: 0.75rem;
  padding: 0 0.4rem;
  border: 1px solid var(--warn);
  border-radius: 4px;
  color: var(--warn);
}
.alts {
  margin: 0.3rem 0 0;
  font-size: 0.85rem;
  color: var(--muted);
}
</style>
