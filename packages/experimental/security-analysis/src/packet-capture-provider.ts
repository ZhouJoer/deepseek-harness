/** Fixed offline Wi-Fi/BLE decoding against immutable project captures. @module */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import assert from 'node:assert/strict'
import { analysisScripts } from './analysis-scripts.ts'
import { inspectToolbox } from './toolbox.ts'
import { runProcess, requireProcessSuccess } from './workbench/process.ts'
import type { AnalysisContext, AnalysisProvider, AnalysisResult } from './workbench/providers.ts'
import type { AnalysisOperation } from './workbench/model.ts'
import type {} from './workbench/index.ts'
import { isPacketCapture } from './workbench/artifacts.ts'

/** Deployment limits applied before any subprocess runs. */
export interface Config {
  maxPackets: number
  maxDecodeBytes: number
  graceMs: number
}
/** Offline packet provider plugin identity. */
export const name = 'experimental-security-packet-capture'
/** Existing project authority and subprocess ownership. */
export const inject = ['securityWorkbench', 'subprocess']
/** Bounds are deployment-configurable and included in resolved observations. */
export const Config: Schema<Config> = Schema.object({
  maxPackets: Schema.number().step(1).min(1).default(10000),
  maxDecodeBytes: Schema.number().step(1).min(1024).default(16777216),
  graceMs: Schema.number().step(1).min(1).default(3000),
})
const requestParameters = z.object({ protocol: z.enum(['wifi', 'ble']),
  maxPackets: z.number().int().positive().optional(), maxDecodeBytes: z.number().int().positive().optional(),
  filter: z.string().max(4096).optional(),
}).strict()
const output = z.looseObject({ incomplete: z.boolean(), toolVersion: z.string(), inputSha256: z.string(),
  records: z.array(z.looseObject({ kind: z.string() })), warnings: z.array(z.string()),
})

/** Decodes files only; capture interfaces and executable overrides are not accepted parameters. */
export class PacketCaptureProvider implements AnalysisProvider {
  readonly id = 'packet-capture'
  readonly operations = ['summary', 'packets']
  readonly inputGuide = 'Offline imported file assets only, using local Python and TShark. summary groups recorded Wi-Fi/BLE fields; packets preserves frame references. Parameters: protocol (wifi or ble), optional maxPackets, maxDecodeBytes and TShark display filter. No live capture, device connection, decryption keys or arbitrary scripts. HCI observations do not establish air capture; missing or encrypted fields remain unknown.'
  constructor(private readonly ctx: Context, private readonly config: Config) {}
  resourceKey(): null { return null }
  resolve(request: AnalysisOperation, context: AnalysisContext): AnalysisOperation {
    if ('kind' in context.asset || context.asset.identity !== 'measured') throw new Error('Packet analysis requires an imported file asset')
    if (context.environment.kind !== 'local') throw new Error('Packet analysis requires a local environment')
    if (!this.operations.includes(request.operation) || request.script) throw new Error('Choose a fixed offline packet operation without a script')
    const parameters = requestParameters.parse(request.parameters)
    return { ...request, impact: 'observe', parameters: { protocol: parameters.protocol, filter: parameters.filter ?? '',
      maxPackets: Math.min(parameters.maxPackets ?? this.config.maxPackets, this.config.maxPackets),
      maxDecodeBytes: Math.min(parameters.maxDecodeBytes ?? this.config.maxDecodeBytes, this.config.maxDecodeBytes) } }
  }
  async run(request: AnalysisOperation, context: AnalysisContext): Promise<AnalysisResult> {
    const resolved = this.resolve(request, context)
    const args = requestParameters.parse(resolved.parameters)
    if ('kind' in context.asset) throw new Error('Packet analysis requires a file')
    if (!isPacketCapture(await context.artifacts.read(context.asset.artifact))) throw new Error('Expected a PCAP or PCAPNG file')
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(context.durationMs)])
    const limits = { durationMs: context.durationMs, maxOutputBytes: context.maxOutputBytes, graceMs: this.config.graceMs }
    const inventory = await inspectToolbox(this.ctx, context.environment, limits, signal, ['python', 'tshark'])
    const tools = ['python', 'tshark'].map((id) => {
      const tool = inventory.tools.find(item => item.id === id)
      if (!tool || tool.status !== 'available') throw new Error('Packet analysis dependency unavailable: ' + id + ': ' + (tool?.detail ?? 'not found'))
      if (id === 'tshark' && tool.prefixArgs?.length) throw new Error('Packet analysis requires the TShark executable without launcher arguments')
      return { id, command: tool.command, prefixArgs: tool.prefixArgs ?? [], source: tool.source, versionArgs: ['--version'] }
    })
    const environment = { ...context.environment, tools }
    const entry = analysisScripts().find(script => script.id === 'tshark.wireless')
    const tshark = tools.find(tool => tool.id === 'tshark')
    assert(entry && tshark)
    const input = await context.artifacts.materialize(context.asset.artifact)
    try {
      const destination = join(dirname(input), 'result.json')
      const result = await runProcess(this.ctx, environment, 'python', ['-B', entry.path,
        '--input', input, '--output', destination, '--tshark', tshark.command,
        '--timeout', String(Math.max(1, Math.ceil(context.durationMs / 1000))),
        '--max-packets', String(args.maxPackets), '--max-decode-bytes', String(args.maxDecodeBytes),
        '--max-output-bytes', String(context.maxOutputBytes), '--protocol', args.protocol,
        '--mode', request.operation, '--filter', args.filter ?? '',
      ], { ...limits, signal })
      requireProcessSuccess(result)
      if (result.truncated) throw new Error('Packet analysis process output exceeded its limit')
      const bytes = await readFile(destination)
      if (bytes.length > context.maxOutputBytes) throw new Error('Packet analysis output exceeded its limit')
      const decoded = output.parse(JSON.parse(bytes.toString('utf8')))
      if (decoded.inputSha256 !== context.asset.artifact.sha256) throw new Error('Packet analysis input identity changed')
      return { bytes, mediaType: 'application/json', summary: JSON.stringify(decoded.records[0] ?? {}),
        incomplete: decoded.incomplete, toolVersion: decoded.toolVersion, method: 'static', observationKind: 'inventory' }
    } finally { await context.artifacts.release(input) }
  }
}
/** Register a disposable provider in the existing security composition.
 * @param ctx - injected host context.
 * @param config - bounded decoder configuration.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const controller = await ctx.securityWorkbench.ready
  ctx.effect(() => controller.providers.register(new PacketCaptureProvider(ctx, config)))
}
