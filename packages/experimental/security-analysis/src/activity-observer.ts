/** Observe native analysis execution without treating command text as proof of inner tools. @module */
import type { Context } from '@deepseek-ai/cordis'
import { JobId, type JobSnapshot } from '@deepseek-ai/dsh-jobs'
import { z } from 'zod'
import { toolboxCatalog } from './toolbox.ts'
import type { ToolDefinition } from './tool-definitions.ts'
import type { SecurityController } from './workbench/controller.ts'
import type { SecurityActivity, SecurityActivityStore } from './workbench/activity.ts'

const foreground = z.object({ kind: z.literal('foreground'), exitCode: z.number().nullable(),
  signal: z.string().nullable(), timedOut: z.boolean(), aborted: z.boolean(),
  stdout: z.object({ truncated: z.boolean() }), stderr: z.object({ truncated: z.boolean() }),
})
const background = z.object({ kind: z.literal('background'), jobId: z.string() })

/** Extract only candidate identities; quotes, dead code and imports cannot prove execution.
 * @param command - submitted Shell program.
 * @param catalog - definitions captured for this invocation.
 * @returns distinct catalog identities mentioned by the command, or an unidentified script.
 */
export function analysisToolCandidates(command: string, catalog: readonly ToolDefinition[] = toolboxCatalog): string[] {
  const words = new Set(command.toLowerCase().split(/[^a-z0-9_-]+/u))
  const tools = catalog.filter(tool => tool.category !== 'runtime' && tool.id !== 'docker'
    && [tool.id, ...tool.commands, ...(tool.probe.kind === 'python-module' ? [tool.probe.module.split('.')[0] ?? ''] : [])]
      .some(name => words.has(name.toLowerCase()))).map(tool => tool.id)
  return tools.length ? tools : ['script']
}

/** Interpret a Shell job's producer-owned termination detail, not its generic completed label.
 * @param snapshot - runtime-owned job settlement.
 * @returns independent invocation outcome and output completeness.
 */
export function analysisJobOutcome(snapshot: JobSnapshot): Pick<SecurityActivity, 'status' | 'incomplete' | 'detail'> {
  const exit = /^exit code: (-?\d+)$/u.exec(snapshot.detail ?? '')
  const status = snapshot.status === 'killed' ? 'cancelled' : snapshot.status === 'failed' ? 'failed'
    : snapshot.status === 'completed' && exit ? (Number(exit[1]) === 0 ? 'completed' : 'failed') : 'unknown'
  return { status, incomplete: true, detail: snapshot.detail ?? '' }
}

/** Track Shell invocations through the same dispatcher used by direct and PTC tools.
 * @param ctx - tool and job lifecycle owner.
 * @param ready - domain initialization.
 * @param catalog - current definition reader; built-ins when omitted.
 */
export function installActivityObserver(ctx: Context, ready: Promise<SecurityController>,
  catalog: () => readonly ToolDefinition[] = () => toolboxCatalog): void {
  const jobs = new Map<string, { record: SecurityActivity; store: SecurityActivityStore }>()
  const settled = async (snapshot: JobSnapshot) => {
    const key = JSON.stringify([snapshot.ownerSession, snapshot.id])
    const entry = jobs.get(key)
    if (!entry || snapshot.status === 'running' || snapshot.status === 'stopping') return
    jobs.delete(key)
    await entry.store.finish(entry.record.id, analysisJobOutcome(snapshot))
  }
  ctx.effect(() => ctx.jobs.onJobDone(snapshot => settled(snapshot)))
  ctx.on('tools/post-execute', async (exec, result, next) => {
    if (exec.agent && result.isError && ['security_static', 'security_execute'].includes(exec.name)) {
      const controller = await ready
      const binding = controller.binding(exec.agent.id)
      const store = controller.activity
      if (binding && store && !store.has(exec.agent.id, exec.callId)) {
        const provider = z.object({ provider: z.string() }).safeParse(exec.arguments)
        const record = await store.start({ projectId: binding.engagementId, sessionId: exec.agent.id,
          callId: exec.callId, checkpointId: controller.checkpointId(exec.agent.id),
          tools: [provider.success ? provider.data.provider : exec.name], verified: false,
          parameters: JSON.stringify(exec.arguments).slice(0, controller.options.maxOutputBytes) })
        await store.finish(record.id, { status: exec.signal.aborted ? 'cancelled' : 'failed', incomplete: true,
          detail: JSON.stringify(result).slice(0, controller.options.maxOutputBytes) })
      }
    }
    return next()
  })
  ctx.on('tools/execute', async (exec, next) => {
    if (!exec.agent || !['bash', 'pwsh'].includes(exec.name)) return next()
    const controller = await ready
    const projectId = controller.analysisProject(exec.agent.id)
    const store = controller.activity
    if (!projectId || !store) return next()
    const args = z.object({ command: z.string() }).parse(exec.arguments)
    if (/^(?:&\s+)?(?:"[^"]+"|'[^']+'|[^\s;|&]+)\s+(?:--version|-version|-v|version)\s*$/u.test(args.command.trim())) return next()
    const record = await store.start({ projectId, sessionId: exec.agent.id, callId: exec.callId,
      checkpointId: controller.checkpointId(exec.agent.id), tools: analysisToolCandidates(args.command, catalog()),
      verified: false, parameters: args.command.slice(0, controller.options.maxOutputBytes) })
    try {
      const result = await next()
      const job = background.safeParse(result.value)
      if (!result.isError && job.success) {
        const snapshot = ctx.jobs.get(JobId(job.data.jobId), exec.agent)
        jobs.set(JSON.stringify([exec.agent.id, snapshot.id]), { record, store })
        await settled(snapshot)
      } else {
        const parsed = foreground.safeParse(result.value)
        const value = parsed.success ? parsed.data : undefined
        await store.finish(record.id, {
          status: exec.signal.aborted || value?.aborted ? 'cancelled' : result.isError || value?.timedOut
            || (value && (value.exitCode !== 0 || value.signal !== null)) ? 'failed' : value ? 'completed' : 'unknown',
          incomplete: !value || value.stdout.truncated || value.stderr.truncated || value.timedOut || value.aborted,
          detail: value ? JSON.stringify({ exitCode: value.exitCode, signal: value.signal, timedOut: value.timedOut,
            aborted: value.aborted }) : JSON.stringify(result).slice(0, controller.options.maxOutputBytes),
        })
      }
      return result
    } catch (error) {
      await store.finish(record.id, { status: exec.signal.aborted ? 'cancelled' : 'failed', incomplete: true,
        detail: String(error).slice(0, controller.options.maxOutputBytes) })
      throw error
    }
  })
}
