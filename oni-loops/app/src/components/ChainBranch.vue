<script setup lang="ts">
import { label } from '../data/load'
import { qty, unitOf } from '../model'
import { fmt, stepLabel } from '../model/graph'
import type { Input, Node } from '../model/chains'
import { TIER_LABEL, type Tiers } from '../model/tiers'
import TagIcon from './TagIcon.vue'

/**
 * One node of a chain and everything that feeds it, read top to bottom: what goes in, the
 * process, what comes out. An input made by its own sub-chain is drawn above as a branch;
 * an input taken from outside is named in the process sentence.
 */
const props = defineProps<{
  node: Node
  /** Scale from per-unit amounts to the page's rate. */
  rate: number
  tiers: Tiers
  /** The chain's target, so feedback reads as "fed back from what this makes". */
  target: string
  /** True for the last node of the chain: its output is the target, marked as the end. */
  final?: boolean
}>()

const branches = () => props.node.inputs.filter((i) => i.node)
const outside = () => props.node.inputs.filter((i) => !i.node)

function at(amount: number): number {
  return amount * props.rate
}

/** "4.5 kg Sand", or "50 kg of any seed" for an input that takes several things. */
function inputText(i: Input): string {
  if (i.anyOfName) return `${fmt(at(i.amount))}${unitOf(i.tag)} of any ${i.anyOfName}`
  return qty(at(i.amount), i.tag)
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
  return more > 0 ? list([...shown, `${more} more`]) : list(shown)
}

/** The step's conditions as a sentence: "Steam at 125 °C or hotter; across up to 24 vines on one plant." */
function needs(extras: string[] | undefined): string {
  if (!extras?.length) return ''
  const text = extras.join('; ')
  return text.charAt(0).toUpperCase() + text.slice(1) + '.'
}

/** Other outputs of the process, per cycle. */
function leaving(): string {
  const n = props.node
  const extra = n.process.outputs
    .filter((f) => f.tag !== n.output)
    .map((f) => qty(at(f.amount * n.runs), f.tag))
  return list(extra)
}

/**
 * How many of what does the step the rate keeps busy: "one running 3% of the time",
 * "4 of them", "2 Duplicants once a cycle each", "1 geyser".
 */
function countText(): string {
  const t = props.node.process.throughput
  if (!t) return ''
  const n = (props.node.runs / t.runsPerCycle) * props.rate
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
    case 'geyser':
      return whole === 1 ? '1 geyser' : `${whole} geysers`
  }
}

function doer(): string | undefined {
  const n = props.node.process.needs
  return n.building ?? n.critter ?? n.plant
}
</script>

<template>
  <!-- Inputs that come from their own sub-chains, each drawn as a branch. -->
  <template v-if="branches().length === 1">
    <ChainBranch :node="branches()[0]!.node!" :rate="rate" :tiers="tiers" :target="target" />
  </template>
  <li v-else-if="branches().length > 1" class="branches">
    <ol v-for="i in branches()" :key="i.tag" class="branch">
      <ChainBranch :node="i.node!" :rate="rate" :tiers="tiers" :target="target" />
    </ol>
  </li>

  <!-- The process, with what it takes from outside and what else it leaves. -->
  <li class="via">
    <span class="how"><TagIcon v-if="doer()" :tag="doer()!" />{{ stepLabel(node.process) }}</span
    ><span v-if="countText()" class="count"> ({{ countText() }})</span
    ><template v-if="outside().length">
      with
      <template v-for="(i, k) in outside()" :key="i.tag"
        ><template v-if="k > 0">{{ k === outside().length - 1 ? ' and ' : ', ' }}</template
        ><span v-if="i.feedback" class="extra feedback"
          >{{ inputText(i) }} fed back from what this makes</span
        ><span
          v-else
          class="extra"
          :class="'t-' + i.tier"
          :title="`${TIER_LABEL[i.tier]}: ${tiers.reason(i.tag)}`"
          >{{ inputText(i) }}</span
        ></template
      ></template
    ><template v-if="leaving()">, leaving {{ leaving() }}</template
    >.<template v-if="needs(node.process.needs.extras)">{{
      ' ' + needs(node.process.needs.extras)
    }}</template
    ><span v-if="node.alternatives?.length" class="alt" :title="node.alternatives.join(', ')"
      >Or {{ alternatives(node.alternatives) }}.</span
    >
  </li>

  <!-- What it makes. -->
  <li class="node" :class="{ end: final }">
    <span class="amount num"
      ><TagIcon :tag="node.output" />{{ qty(at(node.amount), node.output) }}</span
    >
    <span v-if="final" class="back">{{ label(target) }}, made</span>
  </li>
</template>

<style scoped>
/*
 * A step fed by several made inputs is a confluence: each input's chain runs down its own
 * side rail, which curves into the trunk just above the step that consumes them all.
 */
.branches {
  display: grid;
  gap: 1rem;
  padding: 0.25rem 0 1.25rem;
}
.branch {
  --lane: 1.5rem;
  margin: 0 0 0 var(--lane);
  padding: 0 0 0.25rem 1.25rem;
  list-style: none;
  position: relative;
  border-left: 2px solid var(--rail);
}
/* The curve from the side rail down into the trunk. */
.branch::after {
  content: '';
  position: absolute;
  left: calc(-1 * var(--lane) - 2px);
  bottom: calc(-1 * var(--lane));
  width: var(--lane);
  height: var(--lane);
  border-right: 2px solid var(--rail);
  border-bottom: 2px solid var(--rail);
  border-bottom-right-radius: var(--lane);
}
/* The side rail starts at its first dot, not above it. */
.branch > .node:first-child::after,
.branch > .via:first-child::after {
  content: '';
  position: absolute;
  left: calc(-1.25rem - 2px);
  top: -0.25rem;
  width: 2px;
  height: 0.9rem;
  background: var(--panel);
}
.branch > .via:first-child::after {
  height: 0.6rem;
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
.node.end::before {
  border-color: var(--good);
  background: var(--good);
}
.amount {
  font-weight: 600;
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
.count {
  color: var(--faint);
}
.extra {
  color: var(--text);
}
.extra.feedback {
  color: var(--good);
}
.extra.t-off-world {
  text-decoration: underline dotted var(--border-strong);
}
.extra.t-space,
.extra.t-none {
  text-decoration: underline dotted var(--warn);
  text-underline-offset: 0.15em;
}
/* Another way to do the same step, on its own line and in the same colour as the step itself. */
.alt {
  display: block;
  color: var(--accent);
}
</style>
