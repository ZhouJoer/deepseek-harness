/** Approved Python scripts executed by the selected local interpreter. @module */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { z } from 'zod'
import type {} from './workbench/index.ts'
import { inspectToolbox } from './toolbox.ts'
import { runProcess, requireProcessSuccess } from './workbench/process.ts'
import type { AnalysisContext, AnalysisProvider, AnalysisResult } from './workbench/providers.ts'
import type { AnalysisOperation } from './workbench/model.ts'

/** Native subprocess cleanup policy. */
export interface Config { graceMs: number }
/** Plugin identity. */
export const name = 'experimental-security-native'
/** Project approval and owned subprocess execution. */
export const inject = ['securityWorkbench', 'subprocess']
/** Cleanup grace after cancellation or timeout. */
export const Config: Schema<Config> = Schema.object({
  graceMs: Schema.number().step(1).min(1).default(3000),
})
const proposal = z.object({ cwd: z.string().optional() }).strict()
const parameters = z.object({ cwd: z.string(), python: z.string(), version: z.string().min(1), platform: z.string() }).strict()
const identity = z.object({ version: z.string(), platform: z.string() }).strict()
const probe = 'import json,sys; print(json.dumps({"version":sys.version.split()[0],"platform":sys.platform}))'

function requireDirectory(cwd: string, root: string): void {
  const tail = relative(root, cwd)
  if (!isAbsolute(cwd) || tail === '..' || tail.startsWith('..' + sep) || isAbsolute(tail))
    throw new Error('Native working directory must be inside the selected environment workspace')
}

/** Runs approved scripts with the Host user's permissions, without container isolation. */
export class NativeProvider implements AnalysisProvider {
  readonly id = 'native'
  readonly operations = ['python']
  readonly inputGuide = 'Native Host Python validation, including Windows DLL calls: choose a local environment and a validation check. Propose parameters {} or {cwd: absolute existing directory inside the environment workspace}. Preparation discovers the selected Python and pins its executable, version, Host platform and working directory. Supply the complete Python script in the plan, not a wrapper loading another mutable script. Execution uses stdin with -I -u -B; use absolute input paths and explicit outputs under analysisDirectory. Host files and dependencies remain live, not snapshots. Describe every file change, network or device access and cleanup for approval. Native scripts run with Host user permissions; no Docker filesystem/network isolation. Windows DLLs require Windows and matching Python architecture. Never substitute offline/python for native validation or reuse its approval.'
  constructor(private readonly ctx: Context, private readonly config: Config) {}
  async prepare(request: AnalysisOperation, context: AnalysisContext): Promise<AnalysisOperation> {
    if (context.environment.kind !== 'local') throw new Error('Native Python requires a local environment')
    const args = proposal.parse(request.parameters)
    if (args.cwd !== undefined && !isAbsolute(args.cwd)) throw new Error('Select an absolute native working directory')
    const cwd = await realpath(args.cwd ?? context.environment.cwd)
    requireDirectory(cwd, await realpath(context.environment.cwd))
    const limits = { durationMs: context.durationMs, maxOutputBytes: context.maxOutputBytes, graceMs: this.config.graceMs }
    const inventory = await inspectToolbox(this.ctx, context.environment, limits, context.signal, ['python'])
    const python = inventory.tools.find(tool => tool.id === 'python')
    if (!python || python.status !== 'available' || !isAbsolute(python.location))
      throw new Error('Configure an available native Python interpreter in this environment: ' + (python?.detail ?? 'not found'))
    const operation = this.resolve({ ...request,
      parameters: { cwd, python: python.location, version: python.version, platform: process.platform } }, context)
    await this.verify(operation, context)
    return operation
  }
  resolve(request: AnalysisOperation, context: AnalysisContext): AnalysisOperation {
    if (context.environment.kind !== 'local') throw new Error('Native Python requires a local environment')
    if (request.operation !== 'python' || !request.script) throw new Error('Select python and supply the complete immutable script')
    const args = parameters.parse(request.parameters)
    if (!isAbsolute(args.python) || args.platform !== process.platform) throw new Error('Native interpreter or Host platform changed; prepare a new plan')
    requireDirectory(args.cwd, context.environment.cwd)
    return { ...request, parameters: args, impact: 'target-write' }
  }
  private environment(request: AnalysisOperation, context: AnalysisContext) {
    const args = parameters.parse(request.parameters)
    return { ...context.environment, cwd: args.cwd,
      tools: [{ id: 'python', command: args.python, versionArgs: ['--version'], source: 'approved native plan' }] }
  }
  private async verify(request: AnalysisOperation, context: AnalysisContext): Promise<void> {
    const args = parameters.parse(request.parameters)
    const cwd = await realpath(args.cwd)
    requireDirectory(cwd, await realpath(context.environment.cwd))
    if (cwd !== args.cwd) throw new Error('Native working directory changed; prepare a new plan')
    const result = await runProcess(this.ctx, this.environment(request, context), 'python', ['-I', '-c', probe], {
      signal: context.signal, durationMs: context.durationMs, maxOutputBytes: context.maxOutputBytes, graceMs: this.config.graceMs,
    })
    requireProcessSuccess(result)
    if (result.truncated) throw new Error('Native interpreter inspection was truncated')
    const measured = identity.parse(JSON.parse(result.stdout))
    if (measured.version !== args.version || measured.platform !== args.platform)
      throw new Error('Native Python version or platform changed; prepare a new plan')
  }
  async run(request: AnalysisOperation, context: AnalysisContext): Promise<AnalysisResult> {
    const resolved = this.resolve(request, context)
    if (!resolved.script) throw new Error('Missing approved native script')
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(context.durationMs)])
    const bounded = { ...context, signal }
    await this.verify(resolved, bounded)
    const script = await context.artifacts.read(resolved.script)
    const result = await runProcess(this.ctx, this.environment(resolved, context), 'python', ['-I', '-u', '-B', '-'], {
      signal, durationMs: context.durationMs,
      maxOutputBytes: Math.max(1, Math.floor((context.maxOutputBytes - 1024) / 2)), graceMs: this.config.graceMs,
    }, script.toString('utf8'))
    const raw = { ...result, timedOut: result.timedOut || signal.aborted && !context.signal.aborted, cancelled: context.signal.aborted }
    let bytes = Buffer.from(JSON.stringify(raw))
    while (bytes.length > context.maxOutputBytes && (raw.stdout.length || raw.stderr.length)) {
      const field = raw.stdout.length >= raw.stderr.length ? 'stdout' : 'stderr'
      raw[field] = raw[field].slice(0, Math.floor(raw[field].length / 2))
      raw.truncated = true
      bytes = Buffer.from(JSON.stringify(raw))
    }
    const failure = raw.exitCode !== 0 || raw.signal !== null || raw.cancelled || raw.timedOut
      ? raw.stderr || 'Native Python check did not complete' : undefined
    return { bytes, mediaType: 'application/json', summary: (failure ?? raw.stdout).slice(0, 4096),
      incomplete: raw.truncated || !!failure, toolVersion: 'Python ' + parameters.parse(resolved.parameters).version,
      cleanup: 'Owned native subprocess settled; script-created files are retained', ...(failure ? { failure } : {}) }
  }
}
/** Register approved native validation.
 * @param ctx - project and subprocess services.
 * @param config - subprocess cleanup policy. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const controller = await ctx.securityWorkbench.ready
  ctx.effect(() => controller.providers.register(new NativeProvider(ctx, config)))
}
