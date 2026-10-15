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

/** Why the count is a strain: more than the colony has found, or more than a colony would build. */
function strainText(p: Process): string {
  const t = p.throughput!
  if (t.instance === 'feature')
    return `more than the ${store.features.get(p.needs.feature!) ?? 0} your colony has found.`
  if (t.instance === 'geyser')
    return `more than the ${store.geysers.get(p.viaId) ?? 0} your colony has found.`
  return 'more than a colony would build for this.'
}

/** What the chain's critters drink at the fountains each cycle, summed by drink: "15 kg Brackene". */
const drinkText = computed(() => {
  const total = new Map<string, number>()
  for (const n of nodesOf(props.chain))
    for (const u of n.process.upkeep ?? [])
      total.set(u.tag, (total.get(u.tag) ?? 0) + u.amount * n.runs * props.perCycle)
  return list([...total].map(([tag, amount]) => qty(amount, tag)))
})

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
        : n.process.kind === 'geyser' && !((store.geysers.get(n.process.viaId) ?? 0) > 0)
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
  <article class="chain-card panel" :class="'tier-' + chain.worstTier">
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
        {{ strainText(chain.strainNode!.process) }}
      </p>
      <p v-if="chain.ceiling !== undefined && chain.ceiling < perCycle - 1e-9" class="capped">
        With {{ store.duplicants }} Duplicants this chain makes at most
        <strong class="num">{{ qty(chain.ceiling, target) }}</strong> per cycle: the
        {{ stepLabel(chain.ceilingNode!.process) }} step waits on them.
      </p>
    </header>

    <ChainSteps :root="chain.root" :rate="perCycle" :tiers="tiers" />

    <p v-if="chain.needs.length || chain.makes.length || drinkText" class="foot">
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
      ><template v-if="!chain.needs.length && !chain.makes.length">nothing in or out</template
      >.<template v-if="drinkText"> Plus {{ drinkText }} drunk at the Critter Fountains.</template>
    </p>
  </article>
</template>

<style scoped>
/* A card with the game's notification-tile edge: its colour says what the loop costs. */
.chain-card {
  border-left: 3px solid var(--line-strong);
}
.chain-card.tier-renewable {
  border-left-color: var(--good);
}
.chain-card.tier-space,
.chain-card.tier-none {
  border-left-color: var(--warn);
}

.head {
  display: grid;
  gap: 0.4rem;
  padding: 0.6rem 1rem;
  background: var(--band);
  border-radius: 0 var(--radius) 0 0;
}
.headline {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  gap: 0.75rem;
  max-width: var(--measure);
}
.tier-word {
  padding: 0.05rem 0.45rem;
  border-radius: var(--radius);
  background: var(--raised);
  color: var(--text);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
}
.tier-renewable .tier-word {
  background: var(--good-dim);
  color: var(--good);
}
.tier-space .tier-word,
.tier-none .tier-word {
  background: var(--warn-dim);
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
  font-weight: 700;
}

.chain-card > .steps {
  padding: 0.9rem 1rem 0;
}

.foot {
  margin: 0.9rem 1rem 0;
  padding: 0.6rem 0 0.9rem;
  border-top: 1px solid var(--line);
  font-size: 0.875rem;
  color: var(--muted);
  max-width: var(--measure);
}
.chain-card > .steps:last-child {
  padding-bottom: 1rem;
}
.extra {
  color: var(--text);
}
.extra.t-off-world {
  text-decoration: underline dotted var(--line-strong);
}
.extra.t-space,
.extra.t-none {
  text-decoration: underline dotted var(--warn);
  text-underline-offset: 0.15em;
}
</style>
