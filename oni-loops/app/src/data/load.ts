import type { GameData } from './types'
import dump from '../../../data/U59-744825-all-dlcs.json'

/** The bundled game data. One build for now; a build picker can come later. */
export const gameData: GameData = dump as unknown as GameData

const missing = new Set<string>()

/**
 * The game's display name for a tag. The UI must never show an internal id, so an
 * unknown tag is reported once in development and shown de-camel-cased as a last resort.
 */
export function label(tag: string): string {
  const name = gameData.names[tag]
  if (name) return name
  if (import.meta.env?.DEV && !missing.has(tag)) {
    missing.add(tag)
    console.warn(`[oni-loops] no display name for tag ${tag}`)
  }
  return tag.replace(/([a-z])([A-Z])/g, '$1 $2')
}
