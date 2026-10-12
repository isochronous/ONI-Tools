/**
 * Ask for the chains to one target the way the app does, with facets hidden, and print each
 * chain as its line of steps. For checking what the search does with the filter bar.
 *
 *   npx tsx app/scripts/ask.ts <tag> [cluster id] [hidden keys, comma-separated]
 *   npx tsx app/scripts/ask.ts Urchin clusters/AquaticClassicCluster machine:Kiln,critter:Hatch
 */
import { dataSet, gameData, label, SPACED_OUT } from '../src/data/load'
import { buildGraph, fmt, stepLabel } from '../src/model/graph'
import { answer, setDlcNames, type Colony, type Node } from '../src/model/chains'
import { computeTiers, guaranteedFeatures, guaranteedGeysers } from '../src/model/tiers'

const graph = buildGraph(gameData)
setDlcNames(Object.fromEntries(gameData.dlcs.map((d) => [d.id, d.name])))
const target = process.argv[2] ?? 'Urchin'
const clusterId = process.argv[3] ?? 'clusters/SandstoneDefault'
const hidden = new Set((process.argv[4] ?? '').split(',').filter(Boolean))
const cluster = gameData.clusters.find((c) => c.id === clusterId) ?? null
const guaranteed = guaranteedGeysers(gameData, cluster)
const colony: Colony = {
  dlcs: new Set(
    gameData.dlcs.map((d) => d.id).filter((id) => dataSet.spacedOut || id !== SPACED_OUT),
  ),
  critters: null,
  cluster: clusterId,
  geysers: new Map([...guaranteed].map(([id, g]) => [id, g.min])),
  features: new Map([...guaranteedFeatures(gameData, cluster)].map(([id, f]) => [id, f.min])),
  duplicants: 8,
  excluded: hidden,
}
const tiers = computeTiers(gameData, graph, colony, cluster, colony.geysers)

function show(n: Node, depth: number) {
  const pad = '    ' + '  '.repeat(depth)
  for (const i of n.inputs) {
    if (i.node) show(i.node, depth + 1)
    else console.log(`${pad}  ${fmt(i.amount)} ${label(i.tag)} [${i.tier}]`)
  }
  const or = n.alternatives?.length
    ? ' or ' + n.alternatives.map((p) => stepLabel(p)).join('/')
    : ''
  console.log(`${pad}${stepLabel(n.process)}${or} -> ${fmt(n.amount)} ${label(n.output)}`)
}

const a = answer(graph, target, colony, tiers, graph.elements.has(target) ? 100 : 10)
console.log(
  `== ${label(target)} on ${cluster?.name ?? 'no cluster'}, hidden [${[...hidden].join(', ')}]: ${a.chains.length} ways, ${a.locked.length} locked`,
)
for (const c of a.chains) {
  const vias: string[] = []
  const walk = (n: Node) => {
    vias.push(n.process.via)
    n.inputs.forEach((i) => i.node && walk(i.node))
  }
  walk(c.root)
  console.log(`  [${c.worstTier}] ${c.size} steps: ${vias.join(' < ')}`)
}
if (process.argv.includes('--full'))
  for (const c of a.chains) {
    console.log('')
    show(c.root, 0)
  }
