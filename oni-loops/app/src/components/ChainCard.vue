<script setup lang="ts">
import { computed } from 'vue'
import { label } from '../data/load'
import { qty, unitOf } from '../model'
import { fmt, stepLabel, type Process } from '../model/graph'
import { nodesOf, type Chain } from '../model/chains'
import { TIER_LABEL, type Tiers } from '../model/tiers'
import { useColonyStore } from '../stores/colony'
import ChainSteps from './ChainSteps.vue'

const props = defineProps<{ chain: Chain; target: string; tiers: Tiers; perCycle: number }>()
const store = useColonyStore()

/** The chain's headline: what its hardest leaf costs the colony. */
const HEADLINE: Record<string, string> = {
  renewable: 'Renewable',
  local: 'Finite',
  'off-world': 'Off-world',
  space: 'Space',
  none: 'No source',
}

const unit = computed(() => unitOf(props.target).trim() || 'unit of')

const INSTANCE_NOUN: Record<string, string> = {
  building: 'of them',
  plant: 'plants',
  critter: 'critters',
  geyser: 'geysers',
  duplicant: 'Duplicants',
}

/** "plants", "of them", or for a building on a terrain feature "Oil Reservoirs". */
function instanceNoun(p: Process): string {
  const t = p.throughput!
  return t.instance === 'feature' ? label(p.needs.feature!) + 's' : INSTANCE_NOUN[t.instance]!
}

/** Joins names the way a sentence would: "a", "a and b", "a, b, and c". */
function list(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}

/** "a Volcano", "an Oil Reservoir". */
function article(name: string): string {
  return (/^[aeiou]/i.test(name) ? 'an ' : 'a ') + name
}

/** What the chain costs, as a sentence: "fed by a geyser and your terrain", "needs a rocket for Isoresin". */
const costText = computed(() => {
  const c = props.chain
  // A geyser or terrain feature the colony has not found is the usual reason a chain is out of reach.
  const missing = nodesOf(c)
    .map((n) =>
      n.process.needs.feature && !((store.features.get(n.process.needs.feature) ?? 0) > 0)
        ? label(n.process.needs.feature)
        : n.process.kind === 'geyser' && !store.geysers.has(n.process.viaId)
          ? [n.process.via, ...(n.alternatives ?? []).map((p) => p.via)].join(' or ')
          : '',
    )
    .filter((name) => name)
  if (missing.length)
    return `needs ${list([...new Set(missing)].map(article))}, which your colony has not found.`
  if (c.needs.length === 0) {
    if (c.worstTier === 'renewable') return 'runs on sources that never run out.'
    return c.worstTier === 'local' ? "draws on your asteroid's terrain." : 'see the steps.'
  }
  const worst = c.needs.filter((i) => i.tier === c.worstTier).map((i) => label(i.tag))
  switch (c.worstTier) {
    case 'renewable':
      return `everything it takes from outside is renewable: ${list(c.needs.map((i) => label(i.tag)))}.`
    case 'local':
      return `draws on your asteroid's finite ${list(worst)}.`
    case 'off-world':
      return `needs ${list(worst)} from another planetoid.`
    case 'space':
      return `needs ${list(worst)} from space.`
    default:
      return `nothing your colony can reach provides ${list(worst)}.`
  }
})
</script>

<template>
  <article class="chain-card" :class="'tier-' + chain.worstTier">
    <header class="head">
      <p class="headline">
        <span class="tier-word">{{ HEADLINE[chain.worstTier] }}</span>
        <span class="headline-text"
          >{{ costText }}
          <template v-if="chain.feedback > 0">
            Of every {{ unit }} made, {{ fmt(chain.feedback * 100) }}% goes back in, so making
            {{ fmt(perCycle) }}{{ unitOf(target) }} a cycle means making
            {{ qty(perCycle / (1 - chain.feedback), target) }} gross.
          </template>
        </span>
      </p>
      <p v-if="chain.impractical" class="capped">
        A step here needs an in-world temperature past 500 °C or below −50 °C: a volcano, a magma
        pool, or serious engineering.
      </p>
      <p v-if="chain.strain > 1" class="capped">
        At this rate the {{ stepLabel(chain.strainNode!.process) }} step needs
        {{ fmt(Math.ceil(chain.strainCount!)) }} {{ instanceNoun(chain.strainNode!.process) }},
        {{
          chain.strainNode!.process.throughput!.instance === 'feature'
            ? 'more than your colony has found.'
            : 'more than a colony would build for this.'
        }}
      </p>
      <p v-if="chain.ceiling !== undefined && chain.ceiling < perCycle - 1e-9" class="capped">
        With {{ store.duplicants }} Duplicants this chain makes at most
        <strong class="num">{{ qty(chain.ceiling, target) }}</strong> per cycle: the
        {{ stepLabel(chain.ceilingNode!.process) }} step waits on them.
      </p>
    </header>

    <ChainSteps :root="chain.root" :rate="perCycle" :tiers="tiers" />

    <p v-if="chain.needs.length || chain.makes.length" class="foot">
      Each cycle, for {{ fmt(perCycle) }}{{ unitOf(target) }} of {{ label(target) }}:
      <template v-if="chain.needs.length">
        <template v-for="(i, k) in chain.needs" :key="i.tag"
          ><template v-if="k > 0">{{ k === chain.needs.length - 1 ? ' and ' : ', ' }}</template
          ><span
            class="extra"
            :class="'t-' + i.tier"
            :title="`${TIER_LABEL[i.tier]}: ${tiers.reason(i.tag)}`"
            >{{ qty(i.amount * perCycle, i.tag) }}</span
          ></template
        >
        in<template v-if="chain.makes.length">; </template>
      </template>
      <template v-if="chain.makes.length">
        {{ list(chain.makes.map((f) => qty(f.amount * perCycle, f.tag))) }} out</template
      >.
    </p>
  </article>
</template>

<style scoped>
.chain-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: 1rem 1.25rem 1.1rem;
}
.chain-card.tier-renewable {
  border-color: rgba(138, 209, 127, 0.35);
}

.head {
  display: grid;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.headline {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.75rem;
  max-width: var(--measure);
}
.tier-word {
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1.1;
  color: var(--muted);
}
.tier-renewable .tier-word {
  color: var(--good);
}
.tier-space .tier-word,
.tier-none .tier-word {
  color: var(--warn);
}
.headline-text {
  color: var(--muted);
  font-size: 0.9375rem;
}
.capped {
  font-size: 0.9375rem;
  color: var(--warn);
  max-width: var(--measure);
}
.capped strong {
  font-weight: 600;
}

.foot {
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border);
  font-size: 0.875rem;
  color: var(--muted);
  max-width: var(--measure);
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
</style>
