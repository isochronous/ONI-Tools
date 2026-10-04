import { dataSet, gameData, label, SPACED_OUT } from '../src/data/load'
import { buildGraph, fmt } from '../src/model/graph'
import { answer, effectiveRatio, setDlcNames, type Colony } from '../src/model/search'
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
  primaryShare: 0.5,
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

for (const target of ['Diamond', 'BasicFabric', 'TempConductorSolid', 'Water']) {
  const a = answer(graph, target, colony, tiers)
  console.log(
    `\n== ${label(target)}: ${a.loops.length} loops, ${a.producers.length} producers, ${a.locked.length} locked`,
  )
  for (const loop of a.loops.slice(0, 4)) {
    console.log(
      `  x${fmt(loop.ratio)}${loop.topUp && loop.topUp.amount > 0 ? ` (x${fmt(effectiveRatio(loop))} with ${fmt(loop.topUp.amount)} ${label(loop.topUp.tag)} at step ${loop.topUp.step + 1})` : ''} ${loop.primary ? 'primary' : 'side-stream(' + fmt(loop.minShare * 100) + '%)'} worst=${loop.worstTier}: ` +
        loop.steps
          .map(
            (s) =>
              `${label(s.from)} -[${s.process.via}${s.alternatives?.length ? ' or ' + s.alternatives.join('/') : ''}]-> ${label(s.to)}`,
          )
          .join(' ; '),
    )
    if (loop.externals.length)
      console.log(
        '      needs: ' +
          loop.externals
            .slice(0, 4)
            .map((f) => `${fmt(f.amount)} ${label(f.tag)} [${tiers.of(f.tag)}]`)
            .join(', '),
      )
  }
}
