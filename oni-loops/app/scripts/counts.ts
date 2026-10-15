/**
 * The chains to one target at a rate, with the plant and critter counts the app shows, for
 * checking results by hand or against another calculator.
 *
 *   npx tsx app/scripts/counts.ts <tag> [per cycle] [cluster id]
 *   npx tsx app/scripts/counts.ts BeanPlantSeed 10
 */
import { dataSet, gameData, label, SPACED_OUT } from '../src/data/load'
import { buildGraph, fmt, stepLabel } from '../src/model/graph'
import { answer, setDlcNames, type Colony, type Node } from '../src/model/chains'
import { computeTiers, guaranteedFeatures, guaranteedGeysers } from '../src/model/tiers'

const graph = buildGraph(gameData)
setDlcNames(Object.fromEntries(gameData.dlcs.map((d) => [d.id, d.name])))
const target = process.argv[2] ?? 'BeanPlantSeed'
const rate = Number(process.argv[3] ?? (graph.elements.has(target) ? '100' : '10'))
const clusterId = process.argv[4] ?? 'clusters/SandstoneDefault'
const cluster = gameData.clusters.find((c) => c.id === clusterId) ?? null
const colony: Colony = {
  dlcs: new Set(
    gameData.dlcs.map((d) => d.id).filter((id) => dataSet.spacedOut || id !== SPACED_OUT),
  ),
  critters: null,
  cluster: clusterId,
  geysers: new Map([...guaranteedGeysers(gameData, cluster)].map(([id, g]) => [id, g.min])),
  features: new Map([...guaranteedFeatures(gameData, cluster)].map(([id, f]) => [id, f.min])),
  duplicants: 8,
  excluded: new Set(),
}
const tiers = computeTiers(gameData, graph, colony, cluster, colony.geysers)

/** What the app prints after a step: "(18 plants)", "(5 critters)", "(2 of them)". */
function count(n: Node): string {
  const t = n.process.throughput
  if (!t) return ''
  const c = (n.runs / t.runsPerCycle) * rate
  const whole = Math.ceil(c - 1e-9)
  if (t.instance === 'plant') return ` (${whole} plant${whole === 1 ? '' : 's'})`
  if (t.instance === 'critter') return ` (${whole} critter${whole === 1 ? '' : 's'})`
  if (t.instance === 'duplicant') return ` (${fmt(c)} Duplicant-uses a cycle)`
  return c <= 1 ? ` (one, ${fmt(Math.max(c * 100, 0.1))}% of the time)` : ` (${whole} of them)`
}

function show(n: Node, depth: number) {
  const pad = '  '.repeat(depth)
  for (const i of n.inputs) {
    if (i.node) show(i.node, depth + 1)
    else console.log(`${pad}  needs ${fmt(i.amount * rate)} ${label(i.tag)} [${i.tier}]`)
  }
  console.log(
    `${pad}${stepLabel(n.process)}${count(n)} -> ${fmt(n.amount * rate)} ${label(n.output)}`,
  )
}

const a = answer(graph, target, colony, tiers, rate)
console.log(
  `== ${fmt(rate)} ${label(target)} a cycle on ${cluster?.name ?? 'no cluster'}: ${a.chains.length} ways`,
)
for (const c of a.chains) {
  console.log(
    `\n[${c.worstTier}] ${c.size} steps${c.strain > 1 ? `, strain ${fmt(c.strain)}` : ''}`,
  )
  show(c.root, 1)
  const needs = c.needs.map((i) => `${fmt(i.amount * rate)} ${label(i.tag)}`).join(', ')
  const makes = c.makes.map((f) => `${fmt(f.amount * rate)} ${label(f.tag)}`).join(', ')
  console.log(`  in: ${needs || 'nothing'} | out besides the target: ${makes || 'nothing'}`)
}
