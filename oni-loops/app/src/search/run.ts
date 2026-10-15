/**
 * The worker's side of the search: the graph and tiers from the request's plain data, cached
 * while the choices behind them do not change, then the answer with its internal shapes
 * dropped so the message carries only what the page shows.
 */
import { gameData } from '../data/load'
import { answer, type Answer, type Node } from '../model/chains'
import { buildGraph, type Graph } from '../model/graph'
import { computeTiers, type Tiers } from '../model/tiers'
import { fromPlain, type SearchReply, type SearchRequest } from './search'

let graphKey = ''
let graph: Graph | null = null
let tiersKey = ''
let tiers: Tiers | null = null

function graphFor(request: SearchRequest): Graph {
  const key = JSON.stringify(request.options)
  if (!graph || key !== graphKey) {
    const o = request.options
    graph = buildGraph(gameData, {
      happiness: (id) => o.happiness[id] ?? o.defaultHappiness,
      drink: o.drink,
      mutation: (id) => o.mutations[id],
      farmTinker: {
        applied: (id) => o.farmTinker.applied[id] ?? false,
        botanist: o.farmTinker.botanist,
      },
    })
    graphKey = key
    tiers = null
  }
  return graph
}

function tiersFor(request: SearchRequest, g: Graph): Tiers {
  const colony = fromPlain(request.colony)
  const key = JSON.stringify([request.colony.cluster, request.colony.geysers, request.colony.dlcs])
  if (!tiers || key !== tiersKey) {
    const cluster = gameData.clusters.find((c) => c.id === colony.cluster) ?? null
    tiers = computeTiers(gameData, g, colony, cluster, colony.geysers)
    tiersKey = key
  }
  return tiers
}

/** The shapes a node was built from are the search's own; the page never reads them. */
function strip(answer: Answer): Answer {
  const seen = new Set<Node>()
  const walk = (n: Node) => {
    if (seen.has(n)) return
    seen.add(n)
    delete n.shape
    for (const i of n.inputs) {
      if (i.node) walk(i.node)
      for (const r of i.reusedFrom ?? []) walk(r)
    }
    for (const r of n.reusedOut ?? []) walk(r.by)
  }
  for (const c of answer.chains) {
    walk(c.root)
    if (c.ceilingNode) walk(c.ceilingNode)
    if (c.strainNode) walk(c.strainNode)
  }
  return answer
}

export function run(request: SearchRequest): SearchReply {
  const g = graphFor(request)
  const t = tiersFor(request, g)
  const colony = fromPlain(request.colony)
  return { id: request.id, answer: strip(answer(g, request.target, colony, t, request.perCycle)) }
}
