/** Shared local executable configuration for the operator UI and source CLI. @module */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { toolboxCatalog } from './toolbox.ts'

/** An executable and its read-only version query. */
export interface SecurityToolPin {
  command: string
  prefixArgs: string[]
  versionArgs: string[]
}

/** Resolve built-in metadata or conventional defaults for a custom executable.
 * @param id - tool identifier; dependent tools require their parent runtime instead.
 * @returns discovery names and version arguments.
 */
export function standaloneTool(id: string): (typeof toolboxCatalog)[number] {
  if (!/^[a-z][a-z0-9_-]*$/.test(id)) throw new Error(`Invalid tool ID: ${id}; use lowercase letters, digits, hyphens or underscores`)
  const tool = toolboxCatalog.find(tool => tool.id === id)
  if (tool && !tool.commands.length) throw new Error(`${id}: configure its parent runtime or provider instead`)
  return tool ?? { id, category: 'custom', commands: [id], args: ['--version'], url: '' }
}

/** Read validated installations without treating malformed files as empty.
 * @param path - JSON file mapping tool IDs to absolute paths or installation objects.
 * @returns saved installations, or an empty map when the file does not exist.
 */
export function readSecurityTools(path: string): Record<string, SecurityToolPin> {
  let text: string
  try { text = readFileSync(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
  const data: unknown = JSON.parse(text)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${path}: expected a tool-to-installation JSON object`)
  const pins: Record<string, SecurityToolPin> = {}
  for (const [id, value] of Object.entries(data as Record<string, unknown>)) {
    const tool = standaloneTool(id)
    let command: unknown = value
    let versionArgs: unknown = tool.args
    let prefixArgs: unknown = []
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      command = 'command' in value ? value.command : undefined
      prefixArgs = 'prefixArgs' in value ? value.prefixArgs : []
      versionArgs = 'versionArgs' in value ? value.versionArgs : tool.args
    }
    if (typeof command !== 'string' || !isAbsolute(command)) throw new Error(`${path}: ${id} needs an absolute executable path`)
    if (!Array.isArray(versionArgs) || !versionArgs.length || !versionArgs.every((arg: unknown) => typeof arg === 'string'))
      throw new Error(`${path}: ${id} needs a nonempty versionArgs string array`)
    if (!Array.isArray(prefixArgs) || !prefixArgs.every((arg: unknown) => typeof arg === 'string'))
      throw new Error(`${path}: ${id} needs a prefixArgs string array`)
    pins[id] = { command, prefixArgs, versionArgs }
  }
  return pins
}

/** Replace one local configuration file atomically.
 * @param path - destination file, whose parent is created if needed.
 * @param contents - complete UTF-8 content.
 */
export function writeSecurityToolsFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = path + '.' + randomUUID() + '.tmp'
  try {
    writeFileSync(temporary, contents, { flag: 'wx', mode: 0o600 })
    renameSync(temporary, path)
  } finally {
    try { unlinkSync(temporary) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
