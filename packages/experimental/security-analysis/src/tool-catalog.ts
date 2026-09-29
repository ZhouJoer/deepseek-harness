/** Operator-owned definitions with atomic, revision-checked imports. @module */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { builtinToolPack } from './builtin-tools.ts'
import { parseToolPack, parseToolDefinition, orderTools, type ToolPack, type ToolDefinition } from './tool-definitions.ts'
import { writeSecurityToolsFile } from './local-tools.ts'
import type { ToolInstallation } from './workbench/providers.ts'
/** Resolved catalog snapshot shared by discovery and a complete probe operation. */
export interface ToolCatalogSnapshot {
  revision: string
  editable: boolean
  packs: ToolPack[]
  tools: ToolDefinition[]
  collections: ToolPack['collections']
}
/** A validated import preview. Importing does not execute any supplied command. */
export interface ToolPackPreview { revision: string; pack: ToolPack; conflicts: string[] }
/** Resolve definitions and legacy installations, rejecting invalid cross-pack references.
 * @param packs - ordered packs; later definitions replace earlier ones only after explicit import approval.
 * @param pins - old installations without definitions become minimal custom tools.
 * @returns complete validated definition graph.
 */
export function resolveCatalog(packs: ToolPack[], pins: readonly ToolInstallation[] = []): Pick<ToolCatalogSnapshot, 'tools' | 'collections'> {
  const tools = new Map<string, ToolDefinition>(), collections = new Map<string, ToolPack['collections'][number]>()
  for (const pack of packs) {
    for (const tool of pack.tools) tools.set(tool.id, tool)
    for (const collection of pack.collections) collections.set(collection.id, collection)
  }
  for (const pin of pins) if (!tools.has(pin.id))
    tools.set(pin.id, parseToolDefinition({ id: pin.id, label: pin.id, commands: [pin.id], args: pin.versionArgs }))
  const result = { tools: [...tools.values()], collections: [...collections.values()] }
  orderTools(result.tools)
  for (const collection of result.collections) orderTools(result.tools, collection.toolIds)
  return result
}
/** File-backed packs are re-read for each request; in-flight probes retain their snapshot. */
export class ToolCatalog {
  constructor(readonly path?: string) {}
  private saved(): ToolPack[] {
    if (!this.path) return []
    let text: string
    try { text = readFileSync(this.path, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const data: unknown = JSON.parse(text)
    if (!Array.isArray(data)) throw new Error('Tool catalog file must contain an array of packs')
    const packs = data.map(parseToolPack)
    if (new Set(packs.map(pack => pack.id)).size !== packs.length) throw new Error('Duplicate tool pack ID')
    return packs
  }
  /** Read a validated snapshot without executing probes.
   * @param pins - environment installations, including legacy custom tools.
   * @returns definitions and current file revision.
   */
  read(pins: readonly ToolInstallation[] = []): ToolCatalogSnapshot {
    const saved = this.saved(), packs = [builtinToolPack, ...saved]
    return { editable: !!this.path, revision: createHash('sha256').update(JSON.stringify(saved)).digest('hex'),
      packs, ...resolveCatalog(packs, pins) }
  }
  /** Preview a pack and all identity conflicts without modifying files.
   * @param input - untrusted JSON text.
   * @returns normalized pack, conflicts and the catalog revision.
   */
  preview(input: string): ToolPackPreview {
    const pack = parseToolPack(JSON.parse(input)), current = this.read()
    if (pack.id === builtinToolPack.id) throw new Error('Use a custom pack ID when overriding built-in tools')
    const conflicts = [
      ...current.packs.filter(item => item.id === pack.id).map(item => 'pack:' + item.id),
      ...pack.tools.filter(tool => current.tools.some(item => item.id === tool.id)).map(tool => 'tool:' + tool.id),
      ...pack.collections.filter(group => current.collections.some(item => item.id === group.id)).map(group => 'collection:' + group.id),
    ]
    resolveCatalog([...current.packs.filter(item => item.id !== pack.id), pack])
    return { revision: current.revision, pack, conflicts }
  }
  /** Atomically register a reviewed pack. No installation or probe is performed.
   * @param input - complete JSON pack.
   * @param revision - preview revision.
   * @param replace - explicit approval of identity conflicts.
   * @returns the committed catalog.
   */
  import(input: string, revision: string, replace: boolean): ToolCatalogSnapshot {
    if (!this.path) throw new Error('Tool catalog is read-only; configure toolCatalogPath')
    const preview = this.preview(input)
    if (preview.revision !== revision) throw new Error('Tool catalog changed; preview again before saving')
    if (preview.conflicts.length && !replace) throw new Error('Tool identities already exist; confirm replacement')
    const packs = this.saved().filter(pack => pack.id !== preview.pack.id)
    packs.push(preview.pack)
    writeSecurityToolsFile(this.path, JSON.stringify(packs, null, 2) + '\n')
    return this.read()
  }
}
