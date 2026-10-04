<script setup lang="ts">
import { qty, unitOf } from '../model'
import { fmt, stepLabel } from '../model/graph'
import type { Input, Node } from '../model/chains'
import { TIER_LABEL, type Tiers } from '../model/tiers'
import TagIcon from './TagIcon.vue'

/**
 * One node of a chain as a tree entry: the material made, the step that makes it, and
 * beneath it, indented, one entry per input that is itself made. Inputs taken from
 * outside are named in the step's sentence. The target is the root; sources are the leaves.
 */
const props = defineProps<{
  node: Node
  /** Scale from per-unit amounts to the page's rate. */
  rate: number
  tiers: Tiers
  /** True for the target itself. */
  root?: boolean
}>()

function at(amount: number): number {
  return amount * props.rate
}

const made = () => props.node.inputs.filter((i) => i.node)
const outside = () => props.node.inputs.filter((i) => !i.node)

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

/** Other outputs of the step, per cycle. */
function leaving(): string {
  const n = props.node
  return list(
    n.process.outputs
      .filter((f) => f.tag !== n.output)
      .map((f) => qty(at(f.amount * n.runs), f.tag)),
  )
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
  <li class="entry" :class="{ root, source: node.inputs.length === 0 }">
    <p class="material">
      <span class="amount num"
        ><TagIcon :tag="node.output" />{{ qty(at(node.amount), node.output) }}</span
      >
    </p>
    <p class="step">
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
    </p>
    <ul v-if="made().length" class="inputs">
      <ChainTree v-for="i in made()" :key="i.tag" :node="i.node!" :rate="rate" :tiers="tiers" />
    </ul>
  </li>
</template>

<style scoped>
/*
 * A file-tree: each entry hangs off its parent's vertical line by a short tick. The line
 * runs down past every sibling and stops at the last one's tick.
 */
.entry {
  --indent: 1.75rem;
  --tick: 1.1rem;
  position: relative;
  padding: 0.6rem 0 0 0;
}
.inputs {
  list-style: none;
  margin: 0;
  padding: 0 0 0 var(--indent);
}
.inputs > .entry::before {
  content: '';
  position: absolute;
  left: calc(-1 * var(--indent) + 0.5rem);
  top: 0;
  bottom: 0;
  border-left: 2px solid var(--rail);
}
.inputs > .entry:last-child::before {
  bottom: auto;
  height: calc(0.6rem + 0.8rem);
}
.inputs > .entry::after {
  content: '';
  position: absolute;
  left: calc(-1 * var(--indent) + 0.5rem);
  top: calc(0.6rem + 0.8rem);
  width: var(--tick);
  border-top: 2px solid var(--rail);
}

.material {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  line-height: 1.6;
}
.amount {
  font-weight: 600;
}
.root > .material .amount {
  font-size: 1.125rem;
}
.step {
  padding-left: 0.1rem;
  font-size: 0.9375rem;
  color: var(--muted);
  max-width: var(--measure);
}
.how {
  color: var(--accent);
}
.source > .step .how {
  color: var(--good);
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
