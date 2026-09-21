/** Security-only preset roster for an explicitly selected Web profile. @module */
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'

/** Host dependencies of the ordinary preset registry. */
export const inject = ['loader', 'sessionProjections']
/**
 * Mount the security preset through the existing preset service.
 * @param ctx - Loader context carrying the application's resolver.
 * @returns completion after the roster activates.
 */
export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(AgentPresets, {
    default: 'security',
    roots: [{ path: fileURLToPath(new URL('../presets/', import.meta.url)), trust: 'system' }],
    includeShippedRoot: false,
    includeUserRoot: false,
  })
}
