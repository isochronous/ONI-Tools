/// <reference lib="webworker" />
/**
 * The search worker. The first message names the game data set the page is on; the search
 * code loads after that, since the data set is chosen when it loads.
 */
import type { SearchRequest } from './search'

type Init = { kind: 'init'; dataset: string }

let impl: Promise<typeof import('./run')> | null = null

self.onmessage = async (e: MessageEvent<Init | SearchRequest>) => {
  if ('kind' in e.data) {
    ;(globalThis as { ONI_LOOPS_DATASET?: string }).ONI_LOOPS_DATASET = e.data.dataset
    impl = import('./run')
    return
  }
  const { run } = await impl!
  self.postMessage(run(e.data))
}
