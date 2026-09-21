/** Human-authored CLI and chat commands for the security workbench. @module */
import type { Context } from '@deepseek-ai/cordis'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from './workbench/index.ts'

/** Required human command and security services. */
export const inject = ['commands', 'securityWorkbench']
/**
 * Register the user command; model tools never receive its operator authority.
 * @param ctx - command and security domain context.
 */
export function apply(ctx: Context): void {
  ctx.commands.register({
    definitionId: CommandDefinitionId('@deepseek-ai/dsh-experimental-security-analysis/commands'),
    name: 'security',
    description: 'Inspect a security project or submit an operator command',
    input: { hint: '[JSON command]', attachments: false },
    handler: async (invocation) => {
      const input = invocation.rawInput.trim()
      const controller = await ctx.securityWorkbench.ready
      const view = input
        ? await controller.command(invocation.agent.id, JSON.parse(input), true)
        : controller.view(invocation.agent.id)
      return { kind: 'success', text: JSON.stringify(view, null, 2) }
    },
  })
}
