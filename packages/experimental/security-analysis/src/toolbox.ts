/** Bounded, read-only discovery in the selected execution environment. @module */
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type { SecurityEnvironment, ToolInstallation } from './workbench/providers.ts'
import { runProcess, requireProcessSuccess } from './workbench/process.ts'
import type { ToolboxInventory, ToolboxTool } from './toolbox-types.ts'

interface CatalogEntry {
  id: string
  category: ToolboxTool['category']
  commands: string[]
  args: string[]
  url: string
  dependency?: string
  invocation?: ToolboxTool['invocation']
  provider?: string
}
class MissingContainerTool extends Error {}
const pythonIdentity = 'import json,sys; print(json.dumps({"version":sys.version.split()[0],"location":sys.executable}))'
const catalog: readonly CatalogEntry[] = [
  { id: 'python', category: 'runtime', commands: ['python', 'python3'], args: ['-c', pythonIdentity], url: 'https://www.python.org/downloads/' },
  { id: 'bash', category: 'runtime', commands: ['bash'], args: ['--version'], url: 'https://www.gnu.org/software/bash/' },
  { id: 'pwsh', category: 'runtime', commands: ['pwsh', 'powershell'], args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], url: 'https://github.com/PowerShell/PowerShell' },
  { id: 'radare2', category: 'reverse', commands: ['radare2', 'r2'], args: ['-v'], url: 'https://github.com/radareorg/radare2' },
  { id: 'r2ghidra', category: 'reverse', commands: [], args: ['-q', '-c', 'Lcj', '--'], dependency: 'radare2', invocation: 'plugin', url: 'https://github.com/radareorg/r2ghidra' },
  { id: 'r2pipe', category: 'reverse', commands: [], args: [], dependency: 'python', invocation: 'python', url: 'https://github.com/radareorg/radare2-r2pipe' },
  { id: 'frida', category: 'reverse', commands: [], args: [], dependency: 'python', invocation: 'python', provider: 'frida', url: 'https://frida.re/docs/installation/' },
  { id: 'ghidra', category: 'reverse', commands: [], args: [], invocation: 'provider', provider: 'ghidra', url: 'https://ghidra-sre.org/' },
  { id: 'jadx', category: 'reverse', commands: ['jadx'], args: ['--version'], provider: 'android', url: 'https://github.com/skylot/jadx' },
  { id: 'adb', category: 'device', commands: ['adb'], args: ['version'], provider: 'android', url: 'https://developer.android.com/tools/releases/platform-tools' },
  { id: 'fastboot', category: 'device', commands: ['fastboot'], args: ['--version'], url: 'https://developer.android.com/tools/releases/platform-tools' },
  { id: 'docker', category: 'utility', commands: ['docker'], args: ['--version'], url: 'https://docs.docker.com/get-docker/' },
  { id: 'curl', category: 'web', commands: ['curl'], args: ['--version'], provider: 'web', url: 'https://curl.se/download.html' },
  { id: 'john', category: 'utility', commands: ['john'], args: ['--list=build-info'], url: 'https://www.openwall.com/john/' },
  { id: 'nuclei', category: 'web', commands: ['nuclei'], args: ['-version'], url: 'https://github.com/projectdiscovery/nuclei' },
  { id: 'metasploit', category: 'web', commands: ['msfconsole'], args: ['--version'], url: 'https://docs.metasploit.com/' },
  { id: 'file', category: 'utility', commands: ['file'], args: ['--version'], url: 'https://www.darwinsys.com/file/' },
  ...['strings', 'readelf', 'objdump', 'nm'].map(id => ({ id, category: 'reverse' as const, commands: [id], args: ['--version'], url: 'https://www.gnu.org/software/binutils/' })),
]

/** Configured per-process bounds shared with environment health checks. */
export interface InventoryLimits { durationMs: number; maxOutputBytes: number; graceMs: number }

/** Inspect tools without installing software or starting containers.
 * @param ctx - Host subprocess service.
 * @param environment - explicit execution world and installation overrides.
 * @param limits - process deadline and output bounds.
 * @param signal - caller cancellation.
 * @returns separate runtime and optional-tool observations.
 */
export async function inspectToolbox(ctx: Context, environment: SecurityEnvironment, limits: InventoryLimits,
  signal: AbortSignal): Promise<ToolboxInventory> {
  const entries: CatalogEntry[] = [...catalog.filter(item => environment.kind !== 'docker' || item.id !== 'docker'),
    ...environment.tools.filter(tool => !catalog.some(item => item.id === tool.id))
      .map(tool => ({ id: tool.id, category: 'custom' as const, commands: [tool.command], args: tool.versionArgs, url: '' }))]
  const inventory: ToolboxInventory = { environmentId: environment.id, kind: environment.kind,
    runtime: 'ready', detail: '', checkedAt: Date.now(), workdir: environment.kind === 'docker'
      ? environment.webTarget ? '/tmp' : '/workspace' : environment.cwd,
    ...(environment.containerId ? { containerId: environment.containerId } : {}), tools: [] }
  const run = async (tool: ToolInstallation, args: string[]) => {
    const tools = [...environment.tools.filter(item => item.id !== tool.id), tool]
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
      if (!environment.containerId || await run(docker, ['inspect', '--format', '{{.State.Running}}', environment.containerId]) !== 'true') inventory.runtime = 'stopped'
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
      detail: '', installUrl: entry.url, invocation: entry.invocation ?? 'shell',
      ...(entry.provider ? { provider: entry.provider } : {}),
      ...(entry.dependency ? { dependency: entry.dependency } : {}) }
    inventory.tools.push(row)
    if (inventory.runtime !== 'ready') continue
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
        const tool = { id: entry.id, command: dependency.command, versionArgs: [], source: row.source }
        if (entry.id === 'r2ghidra') {
          const plugins = z.array(z.object({ name: z.string(), version: z.string().optional(), path: z.string().optional() }))
            .parse(JSON.parse(await run(tool, entry.args)))
          const plugin = plugins.find(item => item.name === 'r2ghidra')
          if (!plugin) { row.status = 'missing'; continue }
          row.version = plugin.version ?? ''
          row.location = plugin.path ?? ''
        } else {
          const module = entry.id
          const data = z.object({ version: z.string(), location: z.string() }).parse(JSON.parse(await run(tool,
            ['-c', `import json,importlib,importlib.metadata; m=importlib.import_module('${module}'); print(json.dumps({'version':importlib.metadata.version('${module}'),'location':m.__file__ or ''}))`])))
          row.version = data.version; row.location = data.location
        }
        row.status = 'available'
        continue
      }
      const candidates = configured ? [configured.command] : entry.commands
      if (!candidates.length) { row.detail = 'configuration-required'; continue }
      let lastError: unknown
      for (const candidate of candidates) {
        try {
          row.command = environment.kind === 'docker' ? candidate : await ctx.subprocess.resolveExecutable(candidate, {}, signal)
          executableFound = true
          row.location = row.command
          const tool = { id: entry.id, command: row.command, versionArgs: configured?.versionArgs ?? entry.args, source: row.source }
          const output = await run(tool, entry.id === 'python' ? entry.args : tool.versionArgs)
          if (!output) throw new Error('Version query returned no output')
          if (entry.id === 'python') {
            const data = z.object({ version: z.string(), location: z.string() }).parse(JSON.parse(output))
            row.version = data.version; row.location = data.location
          } else row.version = output
          row.status = 'available'
          break
        } catch (error) { signal.throwIfAborted(); lastError = error }
      }
      if (row.status !== 'available') throw lastError
    } catch (error) {
      signal.throwIfAborted()
      row.detail = error instanceof Error ? error.message : String(error)
      row.status = configured || (executableFound && !(error instanceof MissingContainerTool) && !row.detail.includes('ModuleNotFoundError')) ? 'error' : 'missing'
    }
  }
  return inventory
}
