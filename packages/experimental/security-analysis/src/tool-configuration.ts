/** Operator-owned tool overrides shared with the source CLI. @module */
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, parse } from 'node:path'
import { existsSync } from 'node:fs'
import { opendir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { z } from 'zod'
import { readSecurityTools, standaloneTool, writeSecurityToolsFile, type SecurityToolPin } from './local-tools.ts'
import { toolboxCatalog } from './toolbox.ts'
import type { ToolboxConfiguration, ToolboxFiles } from './toolbox-types.ts'
import type { SecurityEnvironment } from './workbench/providers.ts'

/** Wire input for probing, committing or removing one local executable. */
export const toolConfigurationInput = z.object({
  action: z.enum(['probe', 'save', 'remove']), id: z.string(), revision: z.string(),
  command: z.string().default(''), prefixArgs: z.array(z.string()).default([]), versionArgs: z.array(z.string()).default([]),
}).strict()

/** Live configuration changes apply only after an atomic file commit. */
export class LocalToolConfiguration {
  private readonly defaults: SecurityEnvironment['tools']
  constructor(readonly path: string, readonly environment: SecurityEnvironment) {
    if (!isAbsolute(path)) throw new Error('Tool configuration file must be absolute')
    if (environment.kind !== 'local') throw new Error('Tool configuration requires a local environment')
    this.defaults = structuredClone(environment.tools)
    this.refresh()
  }
  /** Reload edits without retaining removed overrides.
   * @returns the applied installation map. */
  refresh(): Record<string, SecurityToolPin> {
    const pins = readSecurityTools(this.path)
    const tools = new Map(this.defaults.map(tool => [tool.id, tool]))
    for (const [id, pin] of Object.entries(pins)) tools.set(id, { id, ...pin, source: 'Local tool configuration' })
    this.environment.tools = [...tools.values()]
    return pins
  }
  /** Read the current editable installation configuration.
   * @returns configured values and a revision for operator edits. */
  read(): ToolboxConfiguration {
    const pins = this.refresh()
    const ids = new Set([...toolboxCatalog.filter(tool => tool.commands.length).map(tool => tool.id),
      ...this.environment.tools.map(tool => tool.id)])
    return { editable: true, revision: revision(pins), tools: [...ids].filter(id =>
      !toolboxCatalog.some(tool => tool.id === id && !tool.commands.length)).map((id) => {
      const tool = this.environment.tools.find(tool => tool.id === id)
      return { id, command: tool?.command ?? '', prefixArgs: tool?.prefixArgs ?? [],
        versionArgs: tool?.versionArgs ?? standaloneTool(id).args, saved: Object.hasOwn(pins, id) }
    }) }
  }
  /** Commit a checked executable or remove its override after checking the observed file revision.
   * @param id - installation identity.
   * @param pin - verified executable; undefined restores deployment defaults.
   * @param expectedRevision - revision shown by the editing form.
   * @returns committed configuration, already applied to subsequent operations.
   */
  commit(id: string, pin: SecurityToolPin | undefined, expectedRevision: string): ToolboxConfiguration {
    standaloneTool(id)
    const pins = readSecurityTools(this.path)
    if (revision(pins) !== expectedRevision) throw new Error('Tool configuration changed; reload before saving')
    if (pin) pins[id] = pin
    else Reflect.deleteProperty(pins, id)
    writeSecurityToolsFile(this.path, JSON.stringify(pins, null, 2) + '\n')
    return this.read()
  }
}
function revision(pins: Record<string, SecurityToolPin>): string {
  return createHash('sha256').update(JSON.stringify(pins)).digest('hex')
}

/** Browse Host paths selected by an authenticated operator, without uploading tool binaries.
 * @param directory - absolute Host directory.
 * @param limit - maximum entries returned to the browser.
 * @returns directories and files, parent navigation and available roots.
 */
export async function browseToolFiles(directory: string, limit: number): Promise<ToolboxFiles> {
  if (!isAbsolute(directory)) throw new Error('Select an absolute Host directory')
  const roots = process.platform === 'win32'
    ? Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index) + ':\\').filter(existsSync)
    : ['/']
  const entries: ToolboxFiles['entries'] = []
  let truncated = false
  for await (const entry of await opendir(directory)) {
    if (!entry.isDirectory() && !entry.isFile()) continue
    if (entries.length >= limit) { truncated = true; break }
    entries.push({ name: entry.name, path: join(directory, entry.name), directory: entry.isDirectory() })
  }
  entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
  return { directory, parent: dirname(directory), roots: [...new Set([homedir(), parse(directory).root, ...roots])], entries, truncated }
}
