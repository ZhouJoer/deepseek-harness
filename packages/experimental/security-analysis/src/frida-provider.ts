/** Programmable Frida observations bound to immutable approved scripts. @module */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type {} from './workbench/index.ts'
import { runProcess, requireProcessSuccess, environmentPath } from './workbench/process.ts'
import type { AnalysisProvider, AnalysisContext } from './workbench/providers.ts'
import { operationSchema, type AnalysisOperation } from './workbench/model.ts'

/** Runner cleanup grace and fixed observation window. */
export interface Config {
  graceMs: number
  javaBridge?: { path: string; sha256: string; version: string } | undefined
}
/** Plugin identity. */
export const name = 'experimental-security-reverse-frida'
/** The security owner admits actions; subprocess owns their host lifetime. */
export const inject = ['securityWorkbench', 'subprocess']
/** Deployment cleanup grace. */
export const Config: Schema<Config> = Schema.object({
  graceMs: Schema.number().step(1).min(1).default(3000),
  javaBridge: Schema.union([
    Schema.const(undefined),
    Schema.object({
      path: Schema.string().required(),
      sha256: Schema.string()
        .pattern(/^[a-f0-9]{64}$/u)
        .required(),
      version: Schema.string().required(),
    }),
  ]),
})
const targetSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('attach'),
      pid: z.number().int().positive(),
      name: z.string().min(1),
      started: z.string().min(1),
    })
    .strict(),
  z.object({ mode: z.literal('spawn'), argv: z.array(z.string().min(1)).min(1) }).strict(),
])
const parameters = z
  .object({
    javaBridge: z.boolean().optional(),
    bridgeHash: z.string().optional(),
    bridgeVersion: z.string().optional(),
    packageName: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/u)
      .optional(),
    target: targetSchema.optional(),
    module: z.string().min(1).optional(),
    symbol: z.string().min(1).optional(),
  })
  .strict()
const responseSchema = z
  .object({
    identity: z.json(),
    messages: z.array(z.json()),
    incomplete: z.boolean(),
    cleanup: z.string(),
    version: z.string().optional(),
  })
  .strict()

/** Python bindings retain Frida Device, Session and Script ownership in one process. */
export class FridaProvider implements AnalysisProvider {
  readonly id = 'frida'
  readonly inputGuide = 'All operations run through a validation plan. processes accepts {}. Other operations require target {mode: attach, pid, name, started} from enumeration or approved {mode: spawn, argv: [...]}. exports and trace require module; trace also requires symbol. Android additionally requires packageName and a matching APK. script requires immutable script content prepared in the plan; javaBridge: true requires the configured bundled bridge. bridgeHash and bridgeVersion are provider-owned. Configure python with official Frida bindings; execution cannot install them.'
  readonly operations = ['processes', 'modules', 'exports', 'trace', 'script'] as const
  constructor(
    private readonly ctx: Context,
    private readonly graceMs: number,
    private readonly bridge?: Config['javaBridge'],
  ) {}
  async prepare(request: AnalysisOperation, context: AnalysisContext): Promise<AnalysisOperation> {
    const args = parameters.parse(request.parameters)
    if (!args.javaBridge) return request
    if (request.operation !== 'script' || !request.script || !this.bridge)
      throw new Error('Configure the bundled Java bridge and select a custom script')
    const bridge = await readFile(this.bridge.path)
    if (createHash('sha256').update(bridge).digest('hex') !== this.bridge.sha256)
      throw new Error('Bundled Java bridge identity mismatch')
    const source = await context.artifacts.read(request.script)
    return {
      ...request,
      script: await context.artifacts.put(Buffer.concat([bridge, Buffer.from('\n'), source]), 'text/javascript'),
      parameters: operationSchema.shape.parameters.parse({
        ...args,
        bridgeHash: this.bridge.sha256,
        bridgeVersion: this.bridge.version,
      }),
    }
  }
  resolve(request: AnalysisOperation, context: AnalysisContext): AnalysisOperation {
    if (!this.operations.some(operation => operation === request.operation))
      throw new Error('Unsupported Frida operation')
    const args = parameters.parse(request.parameters)
    if (args.javaBridge && (args.bridgeHash !== this.bridge?.sha256 || args.bridgeVersion !== this.bridge?.version))
      throw new Error('Java bridge changed; prepare another plan')
    if (request.script && request.operation !== 'script')
      throw new Error('Custom code requires the script operation and target-write approval')
    if (request.operation !== 'processes' && !args.target)
      throw new Error('Frida observation requires an exact process or spawn target')
    if (['exports', 'trace'].includes(request.operation) && !args.module) throw new Error('Select a module')
    if (request.operation === 'trace' && !args.symbol) throw new Error('Select an exported symbol')
    if (request.operation === 'script' && !request.script)
      throw new Error('Save the script before preparing its validation plan')
    if (context.environment.kind === 'android' && !context.environment.deviceId)
      throw new Error('Select an Android device')
    if (context.environment.kind === 'android' && request.operation !== 'processes') {
      if (!args.packageName || context.asset.format !== 'apk')
        throw new Error('Android validation requires an APK and explicit package identity')
      if (args.target?.mode === 'spawn' && (args.target.argv.length !== 1 || args.target.argv[0] !== args.packageName))
        throw new Error('Spawn must select exactly the approved package')
    }
    return {
      ...request,
      parameters: operationSchema.shape.parameters.parse(args),
      impact: request.operation === 'script' || args.target?.mode === 'spawn' ? 'target-write' : 'observe',
    }
  }
  async run(request: AnalysisOperation, context: AnalysisContext) {
    const args = parameters.parse(request.parameters)
    let script = ''
    if (request.script) script = (await context.artifacts.read(request.script)).toString('utf8')
    else if (request.operation === 'modules')
      script =
        'send(Process.enumerateModules().map(m => ({name:m.name,path:m.path,base:m.base.toString(),size:m.size})));'
    else if (request.operation === 'exports')
      script = 'send(Process.getModuleByName(' + JSON.stringify(args.module) + ').enumerateExports());'
    else if (request.operation === 'trace')
      script =
        'const m=Process.getModuleByName(' +
        JSON.stringify(args.module) +
        '); Interceptor.attach(m.getExportByName(' +
        JSON.stringify(args.symbol) +
        '),{onEnter(){send({module:m.name,offset:this.context.pc.sub(m.base).toString(),backtrace:Thread.backtrace(this.context,Backtracer.ACCURATE).map(DebugSymbol.fromAddress).map(String)});}});'
    if (/^\s*import\s/mu.test(script))
      throw new Error('Compile module imports and frida-java-bridge into a bundled script before approval')
    if (args.target?.mode === 'spawn' && context.environment.kind !== 'android') {
      const executable = args.target.argv[0]
      assert(executable, 'Resolved spawn requires an executable')
      const imported = await context.artifacts.import(executable, [context.environment.cwd])
      if (imported.artifact.sha256 !== context.asset.artifact.sha256)
        throw new Error('Spawn executable does not match the approved sample')
    }
    if (context.environment.kind === 'android' && request.operation !== 'processes') {
      assert(args.packageName, 'Resolved Android request requires a package')
      await this.verifyAndroidPackage(args.packageName, context)
    }
    const runner = fileURLToPath(new URL('../resources/frida_runner.py', import.meta.url))
    const code = await readFile(runner, 'utf8')
    context.signal.throwIfAborted()
    const channel = await context.artifacts.materialize(
      await context.artifacts.put(Buffer.alloc(0), 'application/octet-stream'),
    )
    const forced = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let notification: Promise<void> | undefined
    const cancel = () => {
      notification = writeFile(channel + '.cancel', '')
      notification.catch((error: unknown) =>{  forced.abort(error) })
      timer = setTimeout(() =>{  forced.abort(new Error('Frida cleanup deadline exceeded')) }, this.graceMs)
    }
    context.signal.addEventListener('abort', cancel, { once: true })
    if (context.signal.aborted) cancel()
    let outcome
    try {
      outcome = await runProcess(
        this.ctx,
        context.environment,
        'python',
        ['-I', '-c', code],
        {
          signal: forced.signal,
          durationMs: context.durationMs + this.graceMs * 2,
          maxOutputBytes: context.maxOutputBytes,
          graceMs: this.graceMs,
        },
        JSON.stringify({
          operation: request.operation,
          deviceId: context.environment.kind === 'android' ? context.environment.deviceId : 'local',
          sampleHash: context.asset.artifact.sha256,
          packageName: args.packageName,
          cancelPath: environmentPath(context.environment, channel + '.cancel'),
          target:
            args.target?.mode === 'spawn'
              ? {
                ...args.target,
                argv: args.target.argv.map((arg, index) => index === 0 ? environmentPath(context.environment, arg) : arg),
              }
              : args.target,
          script,
          durationMs: context.durationMs,
          maxOutputBytes: context.maxOutputBytes,
        }),
      )
    } finally {
      context.signal.removeEventListener('abort', cancel)
      clearTimeout(timer)
      try {
        await notification
      } finally {
        await context.artifacts.release(channel)
      }
    }
    requireProcessSuccess(outcome)
    if (outcome.truncated) throw new Error('Frida result exceeded the protocol output limit')
    const result = responseSchema.parse(JSON.parse(outcome.stdout))
    return {
      bytes: Buffer.from(outcome.stdout),
      mediaType: 'application/json',
      summary: JSON.stringify({ identity: result.identity, events: result.messages.length, cleanup: result.cleanup }),
      incomplete: result.incomplete,
      toolVersion: result.version ?? 'Frida version unavailable',
    }
  }
  private async verifyAndroidPackage(packageName: string, context: AnalysisContext): Promise<void> {
    const limits = {
      signal: context.signal,
      durationMs: context.durationMs,
      maxOutputBytes: context.maxOutputBytes,
      graceMs: this.graceMs,
    }
    const deviceId = context.environment.deviceId
    assert(deviceId, 'Resolved Android validation requires a device')
    const located = await runProcess(
      this.ctx,
      context.environment,
      'adb',
      ['-s', deviceId, 'shell', 'pm', 'path', packageName],
      limits,
    )
    requireProcessSuccess(located)
    const paths = located.stdout.trim().split(/\r?\n/u)
    if (located.truncated || paths.length !== 1 || !paths[0]?.startsWith('package:/'))
      throw new Error('A single installed APK is required to verify this package')
    const local = await context.artifacts.materialize(context.asset.artifact)
    try {
      const pulled = await runProcess(
        this.ctx,
        context.environment,
        'adb',
        ['-s', deviceId, 'pull', paths[0].slice(8), local],
        limits,
      )
      requireProcessSuccess(pulled)
      const pathModule = await import('node:path')
      const installed = await context.artifacts.import(local, [pathModule.dirname(local)])
      if (installed.artifact.sha256 !== context.asset.artifact.sha256)
        throw new Error('Installed APK differs from the approved sample')
    } finally {
      await context.artifacts.release(local)
    }
  }
}
/**
 * Register the Frida provider.
 * @param ctx - security and subprocess services.
 * @param config - runner cleanup policy.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const controller = await ctx.securityWorkbench.ready
  ctx.effect(() => controller.providers.register(new FridaProvider(ctx, config.graceMs, config.javaBridge)))
}
