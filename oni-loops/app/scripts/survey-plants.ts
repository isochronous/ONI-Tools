// Surveys every target: how many distinct tended plants the most plant-heavy practical chain involves, and how many mutation combinations that implies. Usage: npx tsx scripts/survey-plants.ts [clusterId]
import { dataSet, gameData, label, SPACED_OUT } from '../src/data/load'
import { allTargets } from '../src/model'
import { buildGraph, stepLabel } from '../src/model/graph'
import { answer, nodesOf, setDlcNames, type Chain, type Colony } from '../src/model/chains'
import { computeTiers, guaranteedFeatures, guaranteedGeysers } from '../src/model/tiers'

const graph = buildGraph(gameData)
setDlcNames({})
const clusterId = process.argv[2] ?? 'clusters/SandstoneDefault'
const cluster = gameData.clusters.find((x) => x.id === clusterId) ?? null
const colony: Colony = {
  dlcs: new Set(
    gameData.dlcs.map((d) => d.id).filter((id) => dataSet.spacedOut || id !== SPACED_OUT),
  ),
  critters: null,
  cluster: clusterId,
  geysers: new Set(guaranteedGeysers(gameData, cluster).keys()),
  features: new Map([...guaranteedFeatures(gameData, cluster)].map(([id, f]) => [id, f.min])),
  duplicants: 8,
}
const tiers = computeTiers(gameData, graph, colony, cluster, colony.geysers)
const mutationsFor = new Map<string, number>()
for (const p of gameData.plants)
  mutationsFor.set(
    p.id,
    (gameData.plantMutations ?? []).filter(
      (m) => !m.notFor?.includes(p.id) && (!m.onlyFor?.length || m.onlyFor.includes(p.id)),
    ).length,
  )

/** Distinct tended plants in a chain (wild harvests take no input, so a mutation changes only their yield). */
function tendedPlants(c: Chain): string[] {
  return [
    ...new Set(
      nodesOf(c)
        .filter((n) => n.process.kind === 'crop' && n.process.inputs.length > 0)
        .map((n) => n.process.viaId),
    ),
  ]
}
function allPlants(c: Chain): string[] {
  return [
    ...new Set(
      nodesOf(c)
        .filter((n) => n.process.kind === 'crop')
        .map((n) => n.process.viaId),
    ),
  ]
}

const t0 = Date.now()
const rows: {
  target: string
  chains: number
  maxTended: number
  maxAll: number
  worst: Chain | null
  combos: number
}[] = []
const histTended = new Map<number, number>()
let searched = 0
for (const t of allTargets()) {
  const a = answer(graph, t.tag, colony, tiers, graph.elements.has(t.tag) ? 100 : 10)
  searched++
  let maxTended = 0,
    maxAll = 0,
    worst: Chain | null = null,
    combos = 0
  for (const c of a.chains) {
    if (c.impractical) continue
    const tended = tendedPlants(c)
    const n = tended.length
    histTended.set(n, (histTended.get(n) ?? 0) + 1)
    const k = tended.reduce((p, id) => p * (1 + (mutationsFor.get(id) ?? 0)), 1)
    if (n > maxTended || (n === maxTended && k > combos)) {
      maxTended = n
      worst = c
      combos = k
    }
    maxAll = Math.max(maxAll, allPlants(c).length)
  }
  rows.push({ target: t.name, chains: a.chains.length, maxTended, maxAll, worst, combos })
}
console.log(
  `${searched} targets searched in ${((Date.now() - t0) / 1000).toFixed(1)} s on ${cluster?.name}`,
)
console.log(
  'chains by number of distinct tended plants:',
  [...histTended.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, c]) => `${n}: ${c}`)
    .join(', '),
)
rows.sort((a, b) => b.maxTended - a.maxTended || b.combos - a.combos)
console.log(
  '\nTop targets by tended plants in one practical chain (combos = product over plants of 1 + allowed mutations):',
)
for (const r of rows.slice(0, 12)) {
  console.log(
    `${r.target}: ${r.maxTended} tended (${r.maxAll} incl. wild), ${r.combos} combos, ${r.chains} chains`,
  )
  if (r.worst)
    console.log(
      '   ' +
        nodesOf(r.worst)
          .map((n) => stepLabel(n.process))
          .reverse()
          .join(' > '),
    )
}
const withPlants = rows.filter((r) => r.maxTended > 0).length
console.log(
  `\n${withPlants} of ${rows.length} targets have a practical chain with a tended plant; max distinct tended plants in one chain: ${rows[0]?.maxTended}; max mutation combos for one chain: ${Math.max(...rows.map((r) => r.combos))}`,
)
