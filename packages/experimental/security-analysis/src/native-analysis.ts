/** Project cancellation for native workspace processes and owned jobs. @module */
import type { Context } from '@deepseek-ai/cordis'
import { JobId } from '@deepseek-ai/dsh-jobs'
import type { SecurityController } from './workbench/controller.ts'

/** Join native execution to project stop without waiting for the coordinating Agent.
 * @param ctx - Host tool and job services.
 * @param ready - initialized domain controller.
 */
export function installNativeAnalysis(ctx: Context, ready: Promise<SecurityController>): void {
  ctx.on('tools/execute', async (exec, next) => {
    if (!exec.agent || !['bash', 'pwsh'].includes(exec.name)) return next()
    const controller = await ready
    const project = controller.analysisProject(exec.agent.id)
    if (!project) return next()
    const owner = exec.agent.id
    const abort = new AbortController()
    const done = Promise.withResolvers<void>()
    const release = controller.trackDelegation(project, abort, done.promise)
    const upstream = exec.signal
    exec.signal = AbortSignal.any([upstream, abort.signal])
    let background = false
    try {
      const result = await next()
      const value = result.value
      if (!result.isError && value && typeof value === 'object' && !Array.isArray(value)
        && value.kind === 'background' && typeof value.jobId === 'string') {
        const id = JobId(value.jobId)
        const finished = () => {
          const state = ctx.jobs.get(id, owner).status
          return state !== 'running' && state !== 'stopping'
        }
        let off = () => {}
        const cleanup = () => { off(); abort.signal.removeEventListener('abort', kill); release(); done.resolve() }
        const kill = () => { ctx.jobs.kill(id, owner, 'Security project stopped') }
        off = ctx.jobs.events.subscribe({ owner }, (event) => {
          if (event.type === 'settled' && event.job.id === id) cleanup()
        })
        abort.signal.addEventListener('abort', kill, { once: true })
        background = true
        if (abort.signal.aborted) kill()
        if (finished()) cleanup()
      }
      return result
    } finally {
      exec.signal = upstream
      if (!background) { release(); done.resolve() }
    }
  })
}
