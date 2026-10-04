<script setup lang="ts">
import { computed } from 'vue'
import { qty, unitOf } from '../model'
import { fmt, stepLabel } from '../model/graph'
import type { Input, Node } from '../model/chains'
import type { Process } from '../model/graph'
import { TIER_LABEL, type Tiers } from '../model/tiers'
import TagIcon from './TagIcon.vue'

/**
 * A chain laid out the way it is built, with no indentation: a run of steps down a rail,
 * each ending in the material it makes. When a step takes several made materials, their
 * runs sit one above the other, separated by space, and the step that combines them names
 * them. The product comes last, under a rule, off the rail.
 */
const props = defineProps<{
  root: Node
  /** Scale from per-unit amounts to the page's rate. */
  rate: number
  tiers: Tiers
}>()

type Rail = 'none' | 'down' | 'through' | 'up'
interface RunRow {
  kind: 'step' | 'material' | 'feedback'
  node: Node
  rail: Rail
  /** For a feedback row: the share of the product fed back into this step. */
  input?: Input
}
type Row =
  | RunRow
  | { kind: 'join' } // several runs above feed the next step
  | { kind: 'gap' } // between runs that feed the same step

/** The rows of a node's subtree in build order; the root's own material is left to the result line. */
function rows(node: Node, isRoot: boolean): Row[] {
  const made = node.inputs.filter((i) => i.node)
  const out: Row[] = []
  if (made.length === 1) out.push(...rows(made[0]!.node!, false))
  else if (made.length > 1) {
    made.forEach((i, k) => {
      if (k > 0) out.push({ kind: 'gap' })
      out.push(...rows(i.node!, false))
    })
    out.push({ kind: 'join' })
  }
  // What a step gets from the chain itself, the product fed back or another step's leftovers,
  // is its own line above the step, like any other material.
  for (const i of node.inputs)
    if (i.feedback || i.reused) out.push({ kind: 'feedback', node, rail: 'none', input: i })
  out.push({ kind: 'step', node, rail: 'none' })
  if (!isRoot) out.push({ kind: 'material', node, rail: 'none' })
  return out
}

/** A run is the rows between gaps and joins; the rail runs from its first dot to its last. */
interface Run {
  rows: RunRow[]
}

const runs = computed<(Run | Row)[]>(() => {
  const all = rows(props.root, true)
  const out: (Run | Row)[] = []
  let current: RunRow[] = []
  const flush = () => {
    if (!current.length) return
    const dots = current.map((r, i) => (r.kind !== 'step' ? i : -1)).filter((i) => i >= 0)
    const first = dots[0] ?? -1
    const last = dots[dots.length - 1] ?? -1
    current.forEach((r, i) => {
      if (first < 0 || i < first || i > last) r.rail = 'none'
      else if (i === first && i === last) r.rail = 'none'
      else if (i === first) r.rail = 'down'
      else if (i === last) r.rail = 'up'
      else r.rail = 'through'
    })
    out.push({ rows: current })
    current = []
  }
  for (const r of all) {
    if (r.kind === 'gap' || r.kind === 'join') {
      flush()
      out.push(r)
    } else current.push(r)
  }
  flush()
  return out
})

function isRun(x: Run | Row): x is Run {
  return 'rows' in x
}

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

/** Another way to do the step, with what that way needs at this rate: "Lura Plant (wild) harvest (16 plants)". */
function alternatives(n: Node): string {
  const names = (n.alternatives ?? []).map((p) => {
    const count = countText(n, p)
    return count ? `${stepLabel(p)} (${count})` : stepLabel(p)
  })
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

/** Other outputs of the step, per cycle, noting any part another step of the chain uses. */
function leaving(n: Node): string {
  return list(
    n.process.outputs
      .filter((f) => f.tag !== n.output)
      .map((f) => {
        const used = (n.reusedOut ?? []).filter((r) => r.tag === f.tag)
        const text = qty(at(f.amount * n.runs), f.tag)
        if (!used.length) return text
        const total = used.reduce((sum, r) => sum + r.amount, 0)
        return `${text} (${fmt(at(total))} of it for ${list([...new Set(used.map((r) => r.by.process.via))])})`
      }),
  )
}

/** Made inputs a combining step gathers from the runs above it. */
function gathered(n: Node): string {
  const made = n.inputs.filter((i) => i.node)
  return made.length > 1 ? list(made.map(inputText)) : ''
}

function outside(n: Node): Input[] {
  return n.inputs.filter((i) => !i.node && !i.feedback && !i.reused)
}

/** Who leaves what an input reuses: "Dartle", or "Dartle and Rhex". */
function leftBy(i: Input): string {
  return list([...new Set((i.reusedFrom ?? []).map((f) => f.process.via))])
}

/**
 * How many of what does the step the rate keeps busy: "one running 3% of the time",
 * "4 of them", "2 Duplicants once a cycle each", "1 geyser".
 */
function countText(n: Node, process: Process = n.process): string {
  const t = process.throughput
  if (!t) return ''
  const count = (n.runs / t.runsPerCycle) * props.rate
  const whole = Math.ceil(count - 1e-9)
  switch (t.instance) {
    case 'duplicant':
      return whole === 1 ? '1 Duplicant, once a cycle' : `${whole} Duplicants, once a cycle each`
    case 'building': {
      const worked = t.operated ? ' with a Duplicant at it' : ''
      if (count <= 1) return `one running ${fmt(Math.max(count * 100, 0.1))}% of the time${worked}`
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

/**
 * The step as a sentence from the material above it, in the same voice as "fed to Lumb": a
 * plant fed from a run above reads by what it does with that material, "used to fertilize
 * Dew Dripper" or "used to irrigate Bristle Blossom".
 */
function stepText(n: Node): string {
  if (n.process.kind !== 'crop') return stepLabel(n.process)
  const roles = new Set(n.inputs.filter((i) => i.node && i.role).map((i) => i.role!))
  if (roles.size === 0) return stepLabel(n.process)
  const verbs: string[] = []
  if (roles.has('irrigation')) verbs.push('irrigate')
  if (roles.has('fertilizer')) verbs.push('fertilize')
  const use = verbs.length ? `used to ${verbs.join(' and ')}` : ''
  if (roles.has('prey'))
    return use ? `${use}, and fed to, ${n.process.via}` : `fed to ${n.process.via}`
  return `${use} ${n.process.via}`
}

function doer(n: Node): string | undefined {
  const needs = n.process.needs
  return needs.building ?? needs.critter ?? needs.plant
}
</script>

<template>
  <div class="steps">
    <template v-for="(block, b) in runs" :key="b">
      <div v-if="!isRun(block) && block.kind === 'gap'" class="gap" />
      <div v-else-if="!isRun(block)" class="join" aria-hidden="true" />
      <ol v-else class="run">
        <li v-for="(row, r) in block.rows" :key="r" :class="[row.kind, 'rail-' + row.rail]">
          <template v-if="row.kind === 'step'">
            <span class="how" :class="{ source: row.node.inputs.length === 0 }"
              ><TagIcon v-if="doer(row.node)" :tag="doer(row.node)!" />{{
                stepText(row.node)
              }}</span
            ><span v-if="countText(row.node)" class="count"> ({{ countText(row.node) }})</span
            ><template v-if="gathered(row.node)">{{
              ' takes ' + gathered(row.node) + ' from above'
            }}</template
            ><template v-if="outside(row.node).length"
              >{{ gathered(row.node) ? ' plus ' : ' with '
              }}<template v-for="(i, k) in outside(row.node)" :key="i.tag"
                ><template v-if="k > 0">{{
                  k === outside(row.node).length - 1 ? ' and ' : ', '
                }}</template
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
            ><template v-if="leaving(row.node)">, leaving {{ leaving(row.node) }}</template
            >.<template v-if="needs(row.node.process.needs.extras)">{{
              ' ' + needs(row.node.process.needs.extras)
            }}</template
            ><span
              v-if="row.node.alternatives?.length"
              class="alt"
              :title="row.node.alternatives.map((p) => stepLabel(p)).join(', ')"
              >Or {{ alternatives(row.node) }}.</span
            >
          </template>
          <template v-else-if="row.kind === 'feedback'">
            <span class="amount num"
              ><TagIcon :tag="row.input!.tag" />{{
                row.input!.feedback
                  ? inputText(row.input!)
                  : qty(at(row.input!.reused!), row.input!.tag)
              }}</span
            >
            <span class="fed-back">{{
              row.input!.feedback ? 'from what this loop makes' : 'left by ' + leftBy(row.input!)
            }}</span>
          </template>
          <span v-else class="amount num"
            ><TagIcon :tag="row.node.output" />{{ qty(at(row.node.amount), row.node.output) }}</span
          >
        </li>
      </ol>
    </template>
    <p class="result">
      <span class="amount num"
        ><TagIcon :tag="root.output" />{{ qty(at(root.amount), root.output) }}</span
      >
    </p>
  </div>
</template>

<style scoped>
.steps {
  --x: 0.5rem; /* the rail's column */
  --dot-y: 0.8rem; /* dot centre, from the top of a material row */
  display: grid;
}
.run {
  list-style: none;
  margin: 0;
  padding: 0;
}
.run > li {
  position: relative;
  padding-left: 1.4rem;
}
.step {
  font-size: 0.9375rem;
  color: var(--muted);
  max-width: var(--measure);
  padding-bottom: 0.15rem;
}
.material,
.feedback {
  line-height: 1.6;
  padding-bottom: 0.35rem;
}
.fed-back {
  margin-left: 0.6rem;
  font-size: 0.875rem;
  color: var(--good);
}
.feedback::before,
.material::before {
  content: '';
  position: absolute;
  z-index: 1;
  left: calc(var(--x) - 0.375rem);
  top: calc(var(--dot-y) - 0.375rem);
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 50%;
  background: var(--panel);
  border: 2px solid var(--muted);
}
/* The rail: a segment through each row between the run's first and last dots. */
.run > li::after {
  content: '';
  position: absolute;
  left: calc(var(--x) - 1px);
  top: 0;
  bottom: 0;
  border-left: 2px solid var(--rail);
}
.run > li.rail-none::after {
  display: none;
}
.run > li.rail-down::after {
  top: var(--dot-y);
}
.run > li.rail-up::after {
  bottom: auto;
  height: var(--dot-y);
}
.amount {
  font-weight: 600;
}

/* Several runs feed one step: space between them, and a short rule where they meet. */
.gap {
  height: 0.9rem;
}
.join {
  width: 6rem;
  margin: 0.25rem 0 0.6rem 1.4rem;
  border-top: 2px solid var(--rail);
}

/* The product, off the rail, under a rule, like the result of a sum. */
.result {
  margin-top: 0.4rem;
  padding: 0.6rem 0 0 1.4rem;
  border-top: 2px solid var(--border-strong);
  max-width: var(--measure);
}
.result .amount {
  font-size: 1.125rem;
  color: var(--good);
}

.how {
  color: var(--accent);
}
.how.source {
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
