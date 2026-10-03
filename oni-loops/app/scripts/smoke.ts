import { gameData } from '../src/data/load'
import { buildGraph, fmt } from '../src/model/graph'
import { answer, setDlcNames } from '../src/model/search'
import { label } from '../src/data/load'

const graph = buildGraph(gameData)
setDlcNames(Object.fromEntries(gameData.dlcs.map((d) => [d.id, d.name])))
console.log('processes:', graph.processes.length, 'by kind:', Object.entries(graph.processes.reduce<Record<string, number>>((a, p) => ((a[p.kind] = (a[p.kind] ?? 0) + 1), a), {})).map(([k, v]) => `${k}=${v}`).join(' '))
const colony = { dlcs: new Set(gameData.dlcs.map((d) => d.id)), critters: null, domesticated: true, loopFloor: 0.5 }
for (const target of ['Diamond', 'ReedFiber' in gameData.names ? 'ReedFiber' : 'BasicFabric', 'Water', 'Electrum', 'Slime']) {
  const a = answer(graph, target, colony)
  console.log(`\n== ${label(target)}: ${a.loops.length} loops, ${a.producers.length} producers, ${a.locked.length} locked`)
  for (const loop of a.loops.slice(0, 3)) {
    console.log(`  loop x${fmt(loop.ratio)}: ` + loop.steps.map((s) => `${label(s.from)} -[${s.process.via}]-> ${fmt(s.ratio)} ${label(s.to)}`).join(' ; '))
  }
  for (const p of a.producers.slice(0, 6)) console.log(`  ${p.kind.padEnd(10)} ${p.via}: ${p.inputs.map((f) => `${fmt(f.amount)} ${label(f.tag)}`).join(' + ') || '(source)'} -> ${p.outputs.map((f) => `${fmt(f.amount)} ${label(f.tag)}`).join(', ')}  ${p.notes.join('; ')}`)
}
