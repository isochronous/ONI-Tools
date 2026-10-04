<script setup lang="ts">
import { computed } from 'vue'
import { label } from '../data/load'
import { qty, unitOf } from '../model'
import { fmt, stepLabel } from '../model/graph'
import { effectiveRatio, isPositive, type Loop, type Step } from '../model/search'
import { TIER_LABEL, type Tiers } from '../model/tiers'

const props = defineProps<{ loop: Loop; target: string; tiers: Tiers }>()

/** Green when the loop pays back on its own or with its top-up. */
const positive = computed(() => isPositive(props.loop) || props.loop.topUp !== undefined)

/**
 * Units arriving at step `i` per unit of target, including the top-up once the chain has
 * been boosted (from the top-up step on, everything runs harder by the same factor).
 */
function into(i: number): number {
  let amount = 1
  for (let k = 0; k < i; k++) amount *= props.loop.steps[k]!.ratio
  const t = props.loop.topUp
  if (t && i >= t.step) amount *= t.ratio / props.loop.ratio
  return amount
}

/** Units leaving step `i`, likewise. */
function outOf(i: number): number {
  return into(i + 1)
}

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
      <span class="ratio">×{{ fmt(effectiveRatio(loop)) }}</span>
      <span class="tier">{{ loop.topUp ? 'with a top-up' : positive ? 'net-positive loop' : 'top-up loop' }}</span>
      <span v-if="!loop.primary" class="side" :title="`At one step ${label(target)}'s share of what the machine eats is only ${fmt(loop.minShare * 100)}%; the rest is the real cost.`">side-stream</span>
      <span v-if="loop.topUp" class="shortfall">with {{ qty(loop.topUp.amount, loop.topUp.tag) }} extra ({{ TIER_LABEL[loop.topUp.tier] }}) per {{ unitOf(target).trim() || 'unit of' }} {{ label(target) }} fed into step {{ loop.topUp.step + 1 }}; ×{{ fmt(loop.ratio) }} on its own</span>
      <span v-else-if="!positive" class="shortfall">returns {{ fmt(loop.ratio) }} per 1{{ unitOf(target) }} {{ label(target) }}; top up {{ fmt(1 - loop.ratio) }}{{ unitOf(target) }} elsewhere</span>
    </header>
    <ol class="chain">
      <li v-for="(s, i) in loop.steps" :key="i">
        <span class="from">{{ qty(into(i), s.from) }}<small v-if="loop.topUp && loop.topUp.step === i" class="topup">incl. {{ fmt(loop.topUp.amount) }}{{ unitOf(s.from) }} top-up</small></span>
        <span class="arrow">→</span>
        <span class="how">
          {{ how(s) }}
          <small v-for="n in needsOf(s)" :key="n" class="need">{{ n }}</small>
          <small v-if="s.alternatives?.length" class="alt" :title="s.alternatives.join(', ')">or {{ s.alternatives.slice(0, 3).join(', or ') }}<template v-if="s.alternatives.length > 3"> and {{ s.alternatives.length - 3 }} more</template></small>
        </span>
        <span class="arrow">→</span>
        <span class="to">{{ qty(outOf(i), s.to) }}</span>
      </li>
    </ol>
    <footer v-if="loop.externals.length || loop.byproducts.length">
      <p v-if="loop.externals.length">
        <strong>Also needs</strong> per 1{{ unitOf(target) }} {{ label(target) }}:
        <span v-for="f in loop.externals" :key="f.tag" class="chip" :class="'t-' + tiers.of(f.tag)" :title="tiers.reason(f.tag)">{{ qty(f.amount, f.tag) }} <em>{{ TIER_LABEL[tiers.of(f.tag)] }}</em></span>
      </p>
      <p v-if="loop.byproducts.length">
        <strong>Also makes</strong>:
        <span v-for="f in loop.byproducts" :key="f.tag" class="chip plus">{{ qty(f.amount, f.tag) }}</span>
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
.alt {
  display: block;
  font-size: 0.75rem;
  color: var(--muted);
}
.topup {
  display: block;
  font-size: 0.75rem;
  color: var(--good);
}
</style>
