/** Mount the generated security Remote contribution and localized workbench. @module */
import securityRemote from '@deepseek-ai/dsh-experimental-security-analysis/remote'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { Workbench, type WorkbenchActions } from './Workbench.tsx'
import { NS, zh, en, type SecurityKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Security workbench operator-facing copy. */
    'security-workbench': SecurityKey
  }
}
/** Services required to mount security RPC and the input dock. */
export const inject = ['remote', 'slots', 'locale']

async function unwrap<T>(pending: Promise<RemoteResult<T>>): Promise<T> {
  const result = await pending
  if (!result.ok) throw result.error
  return result.value
}
/**
 * Mount the generated namespace before registering its consumer.
 * @param ctx - browser context with Remote, slots and locale.
 * @returns disposer that awaits both UI and Remote teardown.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(securityRemote)
  const ui = ctx.inject(['remote.securityWorkbench', 'slots', 'locale'], (scoped) => {
    scoped.effect(() => scoped.locale.register(NS, { zh, en }))
    const remote = scoped.remote.securityWorkbench
    const actions: WorkbenchActions = {
      subscribeReset: listener => scoped.on('connection/reset', listener),
      load: id => unwrap(remote.view(id)),
      command: (id, command) => unwrap(remote.command(id, command)),
      configuration: id => unwrap(remote.configuration(id)),
      environment: (id, environment, action) => unwrap(remote.environment(id, environment, action)),
      execute: (id, plan, operation, revision) => unwrap(remote.execute(id, plan, operation, revision)),
      search: (id, query, shared) => unwrap(remote.search(id, query, shared)),
      artifact: (id, hash) => unwrap(remote.artifact(id, hash)),
    }
    scoped.slots.inject('conversation.input.dock', () =>
      scoped.slots.register(
        {
          name: 'conversation.input.dock',
          id: 'security-workbench',
          order: 30,
          locale: NS,
          inject: () => actions,
        },
        Workbench,
      ),
    )
  })
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}
