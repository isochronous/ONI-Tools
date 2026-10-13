/**
 * The search, off the main thread. Finding every way to make something takes a few hundred
 * milliseconds, and the page asks twice when filters are on (the shown answer and the
 * unfiltered one), so switching a chip stuttered. A worker builds its own graph and tiers
 * from plain data the page sends (the same game data set, the colony, and the happiness and
 * mutation choices as records rather than callbacks) and sends the answer back; the page then
 * points each node's process at its own graph's copy, so the rest of the page works as before.
 */
import { dataSet } from '../data/load'
import type { Answer, Colony, Node } from '../model/chains'
import type { Graph, Process } from '../model/graph'

/** The graph options with the page's callbacks resolved into records. */
export interface PlainGraphOptions {
  /** By critter id; any critter not listed gets `defaultHappiness`. */
  happiness: Record<string, number>
  defaultHappiness: number
  drink?: { tag: string; kgPerCycle: number }
  mutations: Record<string, string>
  /** Farmer's Touch by plant id (every plant listed), and the Botanist of the Duplicant applying it. */
  farmTinker: { applied: Record<string, boolean>; botanist: number }
}

/** A colony with its sets and maps as arrays, for the message. */
export interface PlainColony {
  dlcs: string[]
  critters: string[] | null
  cluster: string | null
  geysers: [string, number][]
  features: [string, number][]
  duplicants: number
  excluded: string[]
}

export interface SearchRequest {
  id: number
  target: string
  perCycle: number
  options: PlainGraphOptions
  colony: PlainColony
}

export type SearchReply = { id: number; answer: Answer }

export function plainColony(colony: Colony, excluded: Iterable<string>): PlainColony {
  return {
    dlcs: [...colony.dlcs],
    critters: colony.critters ? [...colony.critters] : null,
    cluster: colony.cluster,
    geysers: [...colony.geysers],
    features: [...colony.features],
    duplicants: colony.duplicants,
    excluded: [...excluded],
  }
}

export function fromPlain(c: PlainColony): Colony {
  return {
    dlcs: new Set(c.dlcs),
    critters: c.critters ? new Set(c.critters) : null,
    cluster: c.cluster,
    geysers: new Map(c.geysers),
    features: new Map(c.features),
    duplicants: c.duplicants,
    excluded: new Set(c.excluded),
  }
}

let worker: Worker | null = null
let next = 0
const pending = new Map<number, (a: Answer) => void>()

function engine(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.postMessage({ kind: 'init', dataset: dataSet.id })
  worker.onmessage = (e: MessageEvent<SearchReply>) => {
    const done = pending.get(e.data.id)
    if (!done) return
    pending.delete(e.data.id)
    done(e.data.answer)
  }
  return worker
}

/** Asks the worker for the answer; the promise resolves when it comes back. */
export function search(
  target: string,
  perCycle: number,
  options: PlainGraphOptions,
  colony: PlainColony,
): Promise<Answer> {
  const id = ++next
  return new Promise((resolve) => {
    pending.set(id, resolve)
    const request: SearchRequest = { id, target, perCycle, options, colony }
    engine().postMessage(request)
  })
}

/**
 * The answer comes back as a copy; its processes are pointed at the page's own graph (the
 * same processes, built from the same data and choices), so nothing on the page holds two
 * copies of the graph and anything that compares processes still can.
 */
export function relink(answer: Answer, graph: Graph): Answer {
  const byId = new Map(graph.processes.map((p) => [p.id, p]))
  const own = (p: Process) => byId.get(p.id) ?? p
  const seen = new Set<Node>()
  const walk = (n: Node) => {
    if (seen.has(n)) return
    seen.add(n)
    n.process = own(n.process)
    if (n.alternatives) n.alternatives = n.alternatives.map(own)
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
  for (const l of answer.locked) l.process = own(l.process)
  return answer
}
