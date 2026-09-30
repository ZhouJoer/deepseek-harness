/** Security-only preset roster for an explicitly selected Web profile. @module */
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { entryListProblem, type PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'

/** Host dependencies of the ordinary preset registry. */
export const inject = ['agentPresets']
/**
 * Mount the security preset through the existing preset service.
 * @param ctx - Loader context carrying the application's resolver.
 * @returns completion after the roster activates.
 */
export async function apply(ctx: Context): Promise<void> {
  const metadata = load(await readFile(fileURLToPath(new URL('../presets/security/preset.yml', import.meta.url)), 'utf8')) as Pick<PresetDefinition, 'name' | 'description' | 'order'>
  const plugins: unknown = load(await readFile(fileURLToPath(new URL('../presets/security/agent.cordis.yml', import.meta.url)), 'utf8'), { schema: entryListSchema })
  const problem = entryListProblem(plugins)
  if (problem) throw new Error(problem)
  ctx.effect(() => ctx.agentPresets.register({
    id: 'security', ...metadata,
    plugins: plugins as PresetDefinition['plugins'],
  }))
}
