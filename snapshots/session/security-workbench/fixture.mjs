/** Real security workbench with operator-owned scope and logged model tool results. */
import { join } from 'node:path'
export const name = 'security-workbench-snapshot-fixture'
export const inject = ['tools', 'agents', 'systemPrompt', 'storageDomain', 'subagents', 'jobs']
export async function apply(ctx) {
  const entry = process.env.DSH_EXAMPLE_MODE === 'lib' ? 'lib/index.js' : 'src/index.ts'
  const plugin = await import(new URL(`../../../packages/experimental/security-analysis/${entry}`, import.meta.url))
  await ctx.plugin(plugin.default, {
    root: join(process.env.DSH_HOME, 'security'),
    importRoots: [process.cwd()],
    environments: [],
  })
}
