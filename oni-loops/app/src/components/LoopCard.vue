<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { label } from '../data/load'
import { qty, unitOf, useGraph } from '../model'
import { fmt, stepLabel, type Flow } from '../model/graph'
import { isPositive, runAt, type Loop } from '../model/search'
import { TIER_LABEL, type Tiers } from '../model/tiers'
import { useColonyStore } from '../stores/colony'
import TagIcon from './TagIcon.vue'

const props = defineProps<{ loop: Loop; target: string; tiers: Tiers; perCycle: number }>()
const graph = useGraph()
const store = useColonyStore()

/** Returns a topped-up loop can be driven to, besides what it does alone. */
const PRESET_RETURNS = [1, 1.5, 2]

interface Preset {
  value: number
  text: string
}

/** Up to three choices: the loop as it is when that already pays back, then the fixed returns above it. */
const presets = computed<Preset[]>(() => {
  if (!props.loop.topUp) return []
  const list: Preset[] = []
  if (props.loop.ratio >= 1) list.push({ value: props.loop.ratio, text: 'as is' })
  for (const v of PRESET_RETURNS)
    if (v > props.loop.ratio + 1e-9) list.push({ value: v, text: `×${fmt(v)}` })
  return list.slice(0, 3)
})

const want = ref(defaultWant())
watch(
  () => props.loop,
  () => (want.value = defaultWant()),
)

function defaultWant(): number {
  return props.loop.ratio >= 1 ? props.loop.ratio : 1
}

const run = computed(() =>
  runAt(graph, props.loop, want.value, props.target, store.colony, props.tiers),
)
const paysBack = computed(
  () => run.value.ratio > 1.0001 || (props.loop.topUp !== undefined && run.value.ratio >= 1 - 1e-9),
)
const unit = computed(() => unitOf(props.target).trim() || 'unit of')

/**
 * Units arriving at step `i` per unit of target, including the top-up once the chain has
 * been boosted (from the top-up step on, everything runs harder by the same factor).
 */
function into(i: number): number {
  let amount = 1
  for (let k = 0; k < i; k++) amount *= props.loop.steps[k]!.ratio
  const t = props.loop.topUp
  if (t && run.value.topUpAmount > 0 && i >= t.step) amount *= run.value.ratio / props.loop.ratio
  return amount
}

/** What the loop itself brings to step `i`: everything arriving there minus any top-up fed in at that step. */
function own(i: number): number {
  const t = props.loop.topUp
  return t && t.step === i ? into(i) - run.value.topUpAmount : into(i)
}

/**
 * How many of what does step `i` the wanted rate keeps busy, as a parenthetical: "one running
 * 3% of the time", "4 of them", "2 Duplicants once a cycle each".
 */
function countText(i: number): string {
  const t = props.loop.steps[i]!.process.throughput
  const per = run.value.steps[i]!.instancesPerUnit
  if (!t || per === undefined) return ''
  const n = per * props.perCycle
  const whole = Math.ceil(n - 1e-9)
  switch (t.instance) {
    case 'duplicant':
      return whole === 1 ? '1 Duplicant, once a cycle' : `${whole} Duplicants, once a cycle each`
    case 'building': {
      const worked = t.operated ? ' with a Duplicant at it' : ''
      if (n <= 1) return `one running ${fmt(Math.max(n * 100, 0.1))}% of the time${worked}`
      return `${whole} of them${t.operated ? ', each with a Duplicant at it' : ''}`
    }
    case 'critter':
      return whole === 1 ? '1 critter' : `${whole} critters`
    case 'plant':
      return whole === 1 ? '1 plant' : `${whole} plants`
  }
}

/**
 * Every amount on the chain is shown at the rate the page runs the loop at, so "1 kg Peat"
 * becomes "100 kg Peat" when 100 kg enter each cycle.
 */
function atRate(amount: number): number {
  return amount * props.perCycle
}

/** "4.5 kg Sand", or "50 kg of any seed" for an input that takes several things, per cycle. */
function flowText(f: Flow): string {
  if (!f.anyOf) return qty(atRate(f.amount), f.tag)
  return `${fmt(atRate(f.amount))}${unitOf(f.tag)} of any ${f.anyOfName ?? graph.kinds.get(f.tag) ?? 'item'}`
}

/** Joins names the way a sentence would: "a", "a and b", "a, b, and c". */
function list(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}

function alternatives(names: string[]): string {
  const shown = names.slice(0, 3)
  const more = names.length - shown.length
  return more > 0 ? `${list([...shown, `${more} more`])}` : list(shown)
}

/** The step's conditions as a sentence: "Steam at 125 °C or hotter; across up to 24 vines on one plant." */
function needs(extras: string[] | undefined): string {
  if (!extras?.length) return ''
  const text = extras.join('; ')
  return text.charAt(0).toUpperCase() + text.slice(1) + '.'
}
</script>

<template>
  <article class="loop" :class="{ 'pays-back': paysBack }">
    <header class="head">
      <p class="return">
        <span class="ratio num">×{{ fmt(run.ratio) }}</span>
        <span class="return-text">
          <template v-if="run.topUpAmount > 0">
            back for every {{ unit }} {{ label(target) }} in, with
            <strong>{{ qty(atRate(run.topUpAmount), loop.topUp!.tag) }}</strong> added per cycle ({{
              qty(run.topUpAmount, loop.topUp!.tag)
            }}
            per {{ unit }}). Alone it returns ×{{ fmt(loop.ratio) }}.
          </template>
          <template v-else-if="isPositive(loop)"
            >back for every {{ unit }} {{ label(target) }} in, with nothing added: run at
            {{ fmt(perCycle) }}{{ unitOf(target) }} per cycle it nets
            <strong>{{ qty((run.ratio - 1) * perCycle, target) }}</strong> extra.</template
          >
          <template v-else
            >back for every {{ unit }} {{ label(target) }} in. Nothing in this chain can be topped
            up from outside, so the rest has to come from another source.</template
          >
        </span>
      </p>
      <div
        v-if="presets.length > 1"
        class="presets"
        role="group"
        aria-label="Drive this loop to return"
      >
        <span class="presets-label">Drive to</span>
        <button
          v-for="p in presets"
          :key="p.value"
          type="button"
          class="preset"
          :class="{ on: Math.abs(p.value - want) < 1e-9 }"
          :aria-pressed="Math.abs(p.value - want) < 1e-9"
          @click="want = p.value"
        >
          {{ p.text }}
        </button>
      </div>
      <span
        v-if="!loop.primary"
        class="side"
        :title="`At one step ${label(target)} is only ${fmt(loop.minShare * 100)}% of what the machine eats; the rest is the real cost.`"
        >side-stream</span
      >
      <p v-if="run.ceiling !== undefined && run.ceiling < perCycle - 1e-9" class="capped">
        With {{ store.duplicants }} Duplicants this loop can only be run at
        <strong class="num">{{ qty(run.ceiling, target) }}</strong> per cycle: the
        {{ stepLabel(loop.steps[run.ceilingStep!]!.process) }} step waits on them.
      </p>
    </header>

    <ol class="chain">
      <li v-for="(s, i) in loop.steps" :key="i" class="step">
        <p class="node">
          <span class="amount num"><TagIcon :tag="s.from" />{{ qty(atRate(own(i)), s.from) }}</span>
          <span
            v-if="loop.topUp && loop.topUp.step === i && run.topUpAmount > 0"
            class="added num"
            :title="`${label(s.from)} is ${TIER_LABEL[loop.topUp.tier]} for your colony: ${tiers.reason(s.from)}`"
            >+ {{ fmt(atRate(run.topUpAmount)) }}{{ unitOf(s.from) }} provided separately</span
          >
        </p>
        <p class="via">
          <span class="how"
            ><TagIcon
              v-if="s.process.needs.building || s.process.needs.critter || s.process.needs.plant"
              :tag="s.process.needs.building ?? s.process.needs.critter ?? s.process.needs.plant!"
            />{{ stepLabel(s.process) }}</span
          ><span v-if="countText(i)" class="count"> ({{ countText(i) }})</span
          ><template v-if="run.steps[i]!.extraInputs.length">
            with
            <template v-for="(f, k) in run.steps[i]!.extraInputs" :key="f.tag"
              ><template v-if="k > 0">{{
                k === run.steps[i]!.extraInputs.length - 1 ? ' and ' : ', '
              }}</template
              ><span
                class="extra"
                :class="'t-' + tiers.of(f.tag)"
                :title="`${TIER_LABEL[tiers.of(f.tag)]}: ${tiers.reason(f.tag)}`"
                >{{ flowText(f) }}</span
              ></template
            ></template
          ><template v-if="run.steps[i]!.extraOutputs.length"
            >, leaving {{ list(run.steps[i]!.extraOutputs.map(flowText)) }}</template
          >.<template v-if="needs(s.process.needs.extras)">{{
            ' ' + needs(s.process.needs.extras)
          }}</template
          ><template v-if="s.alternatives?.length"
            ><span class="alt" :title="s.alternatives.join(', ')">{{
              ' Or ' + alternatives(s.alternatives) + '.'
            }}</span></template
          >
        </p>
      </li>
      <li class="step end">
        <p class="node">
          <span class="amount num"
            ><TagIcon :tag="target" />{{ qty(atRate(into(loop.steps.length)), target) }}</span
          >
          <span class="back">back where it started</span>
        </p>
      </li>
    </ol>

    <p v-if="run.externals.length || run.byproducts.length" class="foot">
      Over the whole loop, each cycle:
      <template v-if="run.externals.length">
        <template v-for="(f, k) in run.externals" :key="f.tag"
          ><template v-if="k > 0">{{ k === run.externals.length - 1 ? ' and ' : ', ' }}</template
          ><span
            class="extra"
            :class="'t-' + tiers.of(f.tag)"
            :title="`${TIER_LABEL[tiers.of(f.tag)]}: ${tiers.reason(f.tag)}`"
            >{{ qty(atRate(f.amount), f.tag) }}</span
          ></template
        >
        in<template v-if="run.byproducts.length">; </template>
      </template>
      <template v-if="run.byproducts.length">
        {{ list(run.byproducts.map((f) => qty(atRate(f.amount), f.tag))) }} out</template
      >.
    </p>
  </article>
</template>

<style scoped>
.loop {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: 1rem 1.25rem 1.1rem;
}
.loop.pays-back {
  border-color: rgba(138, 209, 127, 0.35);
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0.75rem 1.5rem;
  margin-bottom: 1rem;
}
.return {
  flex: 1 1 24rem;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.75rem;
  max-width: var(--measure);
}
.ratio {
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1;
  color: var(--warn);
}
.pays-back .ratio {
  color: var(--good);
}
.return-text {
  color: var(--muted);
  font-size: 0.9375rem;
}
.return-text strong {
  color: var(--text);
  font-weight: 600;
}

.presets {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.presets-label {
  font-size: 0.875rem;
  color: var(--muted);
}
.preset {
  padding: 0.25rem 0.7rem;
  background: var(--raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  cursor: pointer;
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;
}
.preset + .preset {
  margin-left: -1px;
}
.preset:first-of-type {
  border-radius: var(--radius-control) 0 0 var(--radius-control);
}
.preset:last-of-type {
  border-radius: 0 var(--radius-control) var(--radius-control) 0;
}
.preset:first-of-type:last-of-type {
  border-radius: var(--radius-control);
}
.preset:hover {
  border-color: var(--border-strong);
}
.preset.on {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-ink);
  font-weight: 600;
  position: relative;
}

.capped {
  flex-basis: 100%;
  font-size: 0.9375rem;
  color: var(--warn);
  max-width: var(--measure);
}
.capped strong {
  font-weight: 600;
}
.count {
  color: var(--faint);
}
.side {
  align-self: center;
  font-size: 0.8125rem;
  padding: 0.1rem 0.5rem;
  border: 1px solid var(--warn);
  border-radius: var(--radius-control);
  color: var(--warn);
}

/* The chain: materials sit on a rail, the process between two materials hangs off it. */
.chain {
  margin: 0;
  padding: 0 0 0 1.25rem;
  list-style: none;
  position: relative;
}
.chain::before {
  content: '';
  position: absolute;
  left: 0.3125rem;
  top: 0.75rem;
  bottom: 0.75rem;
  width: 2px;
  background: var(--rail);
  border-radius: 1px;
}
.step {
  position: relative;
}
.node {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25rem 0.75rem;
  min-height: 1.5rem;
}
.node::before {
  content: '';
  position: absolute;
  left: -1.25rem;
  top: 0.4375rem;
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 50%;
  background: var(--panel);
  border: 2px solid var(--muted);
}
.end .node::before {
  border-color: var(--good);
  background: var(--good);
}
.loop:not(.pays-back) .end .node::before {
  border-color: var(--warn);
  background: var(--warn);
}
.amount {
  font-weight: 600;
}
.added {
  font-size: 0.875rem;
  color: var(--good);
}
.back {
  font-size: 0.875rem;
  color: var(--muted);
}
.via {
  padding: 0.3rem 0 0.5rem 1.25rem;
  font-size: 0.9375rem;
  color: var(--muted);
  max-width: var(--measure);
}
.how {
  color: var(--accent);
}
.extra {
  color: var(--text);
}
.extra.t-off-world {
  text-decoration: underline dotted var(--border-strong);
}
.extra.t-space,
.extra.t-none {
  text-decoration: underline dotted var(--warn);
  text-underline-offset: 0.15em;
}
.alt {
  color: var(--faint);
}

.foot {
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border);
  font-size: 0.875rem;
  color: var(--muted);
  max-width: var(--measure);
}
</style>
