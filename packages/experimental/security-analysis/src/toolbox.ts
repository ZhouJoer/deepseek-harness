/** Bounded, read-only discovery in the selected execution environment. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { SecurityEnvironment, ToolInstallation } from './workbench/providers.ts'
import { runProcess, requireProcessSuccess, toolInvocation, installation } from './workbench/process.ts'
import type { ToolboxInventory, ToolboxTool } from './toolbox-types.ts'

import { builtinToolPack } from './builtin-tools.ts'
import { orderTools, type ToolDefinition } from './tool-definitions.ts'
import { resolveCatalog } from './tool-catalog.ts'
import { toolCandidates } from './tool-candidates.ts'
import { probeArguments, probeIdentity } from './tool-probes.ts'
export { pythonModuleProbe } from './tool-probes.ts'
/** Built-in definitions; runtime consumers resolve the operator catalog for each request. */
export const toolboxCatalog = builtinToolPack.tools
class MissingContainerTool extends Error {}

/** Configured per-process bounds shared with environment health checks. */
export interface InventoryLimits { durationMs: number; maxOutputBytes: number; graceMs: number }

/** Inspect tools without installing software or starting containers.
 * @param ctx - Host subprocess service.
 * @param environment - explicit execution world and installation overrides.
 * @param limits - process deadline and output bounds.
 * @param signal - caller cancellation.
 * @param toolIds - optional tool selection; required runtime dependencies are also inspected.
 * @param catalog - captured current definitions; built-ins when omitted.
 * @returns separate runtime and optional-tool observations.
 */
export async function inspectToolbox(ctx: Context, environment: SecurityEnvironment, limits: InventoryLimits,
  signal: AbortSignal, toolIds?: readonly string[], catalog: readonly ToolDefinition[] = toolboxCatalog): Promise<ToolboxInventory> {
  environment = { ...environment, tools: structuredClone(environment.tools) }
  const resolved = resolveCatalog([{ ...builtinToolPack, tools: [...catalog], collections: [] }], environment.tools)
  const entries = orderTools(resolved.tools, toolIds).filter(tool => environment.kind !== 'docker' || tool.id !== 'docker')
  const container = environment.externalContainer?.name ?? environment.containerId
  const inventory: ToolboxInventory = { environmentId: environment.id, kind: environment.kind,
    runtime: 'ready', detail: '', checkedAt: Date.now(), workdir: environment.externalContainer?.workdir ?? (environment.kind === 'docker'
      ? environment.webTarget ? '/tmp' : '/workspace' : environment.cwd),
    ...(container ? { containerId: container } : {}), tools: [] }
  const run = async (tool: ToolInstallation, args: string[]) => {
    const selected = environment.tools.find(item => item.id === tool.id)
    const tools = [...environment.tools.filter(item => item.id !== tool.id), { ...selected, ...tool }]
    const result = await runProcess(ctx, { ...environment, tools }, tool.id, args, { ...limits, signal, stopContainerOnAbort: false })
    if (environment.kind === 'docker' && tool.id !== 'docker' && !result.timedOut && !result.cancelled &&
      (result.exitCode === 127 || (result.exitCode === 126 && result.stderr.includes('executable file not found'))))
      throw new MissingContainerTool(JSON.stringify(result))
    requireProcessSuccess(result)
    if (result.truncated) throw new Error('Tool inventory output exceeded its limit')
    return (result.stdout || result.stderr).trim()
  }
  if (environment.kind === 'docker') {
    try {
      const docker = environment.tools.find(tool => tool.id === 'docker')
      if (!docker) throw new Error('Docker command is not configured')
      await run(docker, ['info', '--format', '{{.ServerVersion}}'])
      if (!container || await run(docker, ['inspect', '--format', '{{.State.Running}}', container]) !== 'true') inventory.runtime = 'stopped'
    } catch (error) {
      signal.throwIfAborted()
      inventory.runtime = 'unavailable'
      inventory.detail = error instanceof Error ? error.message : String(error)
    }
  }
  for (const entry of entries) {
    signal.throwIfAborted()
    const configured = environment.tools.find(tool => tool.id === entry.id)
    const row: ToolboxTool = { id: entry.id, category: entry.category, status: 'not-checked',
      command: configured?.command ?? '', location: '', version: '', source: configured?.source ?? 'PATH',
      detail: '', installUrl: entry.url, invocation: entry.invocation,
      ...(configured?.prefixArgs?.length ? { prefixArgs: configured.prefixArgs } : {}),
      ...(entry.provider ? { provider: entry.provider } : {}),
      ...(entry.dependency ? { dependency: entry.dependency } : {}) }
    inventory.tools.push(row)
    if (inventory.runtime !== 'ready') continue
    if (entry.platforms.length && !entry.platforms.includes(environment.kind === 'docker' ? 'linux' : process.platform as 'win32' | 'linux' | 'darwin')) {
      row.detail = 'unsupported-platform'; continue
    }
    if (entry.dependencies.some(id => inventory.tools.find(tool => tool.id === id)?.status !== 'available')) {
      row.detail = 'dependency-unavailable'; continue
    }
    let executableFound = false
    try {
      if (entry.dependency) {
        const dependency = inventory.tools.find(tool => tool.id === entry.dependency)
        if (dependency?.status !== 'available') { row.detail = 'dependency-unavailable'; continue }
        const selectedCommand = environment.tools.find(tool => tool.id === entry.dependency)?.command
        if (configured && configured.command !== dependency.command && configured.command !== selectedCommand) {
          row.status = 'error'
          row.detail = 'Conflicting executable override; configure the selected ' + entry.dependency + ' installation instead.'
          continue
        }
        row.command = dependency.command
        executableFound = true
        row.source = dependency.source
        if (dependency.prefixArgs) row.prefixArgs = dependency.prefixArgs
        const prefixArgs = dependency.prefixArgs ?? []
        const tool = { id: entry.id, command: dependency.command, prefixArgs, versionArgs: [], source: row.source }
        const identity = probeIdentity(entry, await run(tool, probeArguments(entry)))
        if (!identity) { row.status = 'missing'; continue }
        row.version = identity.version; row.location = identity.location ?? ''
        row.status = 'available'
        continue
      }
      const candidates = configured ? [configured.command] : [...entry.commands, ...(environment.kind === 'docker' ? [] : toolCandidates(entry))]
      if (!candidates.length) { row.detail = 'configuration-required'; continue }
      let lastError: unknown
      for (const candidate of candidates) {
        try {
          row.command = environment.kind === 'docker' ? candidate : await ctx.subprocess.resolveExecutable(candidate, {}, signal)
          executableFound = true
          row.location = row.command
          const tool = { id: entry.id, command: row.command, versionArgs: configured?.versionArgs ?? entry.args, source: row.source }
          const identity = probeIdentity(entry, await run(tool, probeArguments(entry, tool.versionArgs)))
          if (!identity) { row.status = 'missing'; break }
          row.version = identity.version; row.location = identity.location ?? row.command
          row.status = 'available'
          break
        } catch (error) { signal.throwIfAborted(); lastError = error }
      }
      if (row.status !== 'available') throw lastError
    } catch (error) {
      signal.throwIfAborted()
      row.detail = error instanceof Error ? error.message : String(error)
      row.status = configured || (executableFound && !(error instanceof MissingContainerTool) && !/ModuleNotFoundError|PackageNotFoundError/.test(row.detail)) ? 'error' : 'missing'
    }
  }
  if (environment.kind === 'docker' && inventory.runtime === 'ready') {
    const docker = installation(environment, 'docker')
    const command = await ctx.subprocess.resolveExecutable(docker.command, {}, signal)
    for (const row of inventory.tools) {
      if (row.status !== 'available') continue
      row.installation = { command: row.command, prefixArgs: [...row.prefixArgs ?? []] }
      row.prefixArgs = toolInvocation(environment, row).prefixArgs
      row.command = command
    }
  }
  return inventory
}
