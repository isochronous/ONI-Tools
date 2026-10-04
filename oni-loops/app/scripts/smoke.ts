import { dataSet, gameData, label, SPACED_OUT } from '../src/data/load'
import { buildGraph, fmt, stepLabel } from '../src/model/graph'
import { answer, setDlcNames, type Colony, type Node } from '../src/model/chains'
import { computeTiers, guaranteedGeysers, randomGeyserSlots, TIER_LABEL } from '../src/model/tiers'

const graph = buildGraph(gameData)
setDlcNames(Object.fromEntries(gameData.dlcs.map((d) => [d.id, d.name])))
console.log('processes:', graph.processes.length)

const clusterId = process.argv[2] ?? 'clusters/SandstoneDefault'
const cluster = gameData.clusters.find((c) => c.id === clusterId) ?? null
const guaranteed = guaranteedGeysers(gameData, cluster)
console.log(
  `cluster ${cluster?.name}: worlds ${cluster?.worlds.length}, guaranteed geysers:`,
  [...guaranteed].map(([k, v]) => `${k} ${v.min}-${v.max} (${v.worlds.join('/')})`).join('; '),
)
console.log('random geyser slots:', randomGeyserSlots(gameData, cluster))

const colony: Colony = {
  dlcs: new Set(
    gameData.dlcs.map((d) => d.id).filter((id) => dataSet.spacedOut || id !== SPACED_OUT),
  ),
  critters: null,
  cluster: clusterId,
  geysers: new Set(guaranteed.keys()),
  duplicants: 8,
}
const tiers = computeTiers(gameData, graph, colony, cluster, colony.geysers)
for (const tag of [
  'Water',
  'DirtyWater',
  'Sand',
  'Wolframite',
  'Tungsten',
  'Isoresin',
  'Niobium',
  'Electrum',
  'BasicFabric',
  'SlimeMold',
  'Diamond',
  'Plastic',
  'Steel',
])
  console.log(
    `  ${label(tag).padEnd(16)} ${TIER_LABEL[tiers.of(tag)].padEnd(28)} ${tiers.reason(tag)}`,
  )

/** One line per node, inputs first, indented by depth. */
function show(n: Node, depth: number) {
  const pad = '      ' + '  '.repeat(depth)
  for (const i of n.inputs) {
    if (i.node) show(i.node, depth + 1)
    else
      console.log(
        `${pad}  ${fmt(i.amount)} ${label(i.tag)}${i.feedback ? ' (fed back)' : ` [${i.tier}]`}`,
      )
  }
  console.log(
    `${pad}${stepLabel(n.process)}${n.alternatives?.length ? ' or ' + n.alternatives.join('/') : ''} -> ${fmt(n.amount)} ${label(n.output)}`,
  )
}

for (const target of process.argv.slice(3).length
  ? process.argv.slice(3)
  : ['IgneousRock', 'Diamond', 'BasicFabric', 'Water', 'Peat']) {
  const a = answer(graph, target, colony, tiers, graph.elements.has(target) ? 100 : 10)
  console.log(`\n== ${label(target)}: ${a.chains.length} ways, ${a.locked.length} locked`)
  for (const c of a.chains.slice(0, 4)) {
    console.log(
      `  [${c.worstTier}] ${c.size} steps${c.feedback ? `, feedback ${fmt(c.feedback * 100)}%` : ''}${c.ceiling !== undefined ? `, ceiling ${fmt(c.ceiling)}/cycle${c.capped ? ' (capped)' : ''}` : ''}`,
    )
    show(c.root, 0)
    if (c.needs.length)
      console.log(
        '      needs: ' +
          c.needs.map((i) => `${fmt(i.amount)} ${label(i.tag)} [${i.tier}]`).join(', '),
      )
  }
}
