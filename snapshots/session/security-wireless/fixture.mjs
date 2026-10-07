/** Real provider discovery without external software or device probes. */
import { join } from 'node:path'
export const name = 'security-wireless-snapshot-fixture'
export const inject = ['tools', 'agents', 'systemPrompt', 'storageDomain', 'subprocess', 'subagents', 'jobs', 'approval']
export async function apply(ctx) {
  const built = process.env.DSH_EXAMPLE_MODE === 'lib'
  const entry = built ? 'lib/index.js' : 'src/index.ts'
  const service = await import(new URL(`../../../packages/experimental/security-analysis/${entry}`, import.meta.url))
  await ctx.plugin(service.default, { root: join(process.env.DSH_HOME, 'security'), importRoots: [process.cwd()],
    toolCatalogPath: join(process.env.DSH_HOME, 'tools.json'), environments: [], knowledgeIntervalMs: 0 })
  const providerEntry = built ? 'lib/packet-capture.js' : 'src/packet-capture-provider.ts'
  const provider = await import(new URL(`../../../packages/experimental/security-analysis/${providerEntry}`, import.meta.url))
  await ctx.plugin(provider, {})
}
