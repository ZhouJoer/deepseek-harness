/** Serializable tool packs, dependency ordering and bounded discovery. @module */
import { z } from 'zod'
const id = z.string().regex(/^[a-z][a-z0-9_-]*$/).max(100)
const strings = z.array(z.string().max(8192)).max(100)
const definition = z.object({
  id, label: z.string().min(1).max(200), description: z.string().max(4096).default(''),
  category: z.enum(['runtime', 'reverse', 'device', 'web', 'utility', 'custom']).default('custom'),
  tags: z.array(z.string().min(1).max(100)).max(100).default([]),
  platforms: z.array(z.enum(['win32', 'linux', 'darwin'])).default([]),
  commands: strings.default([]), args: strings.default(['--version']), url: z.url().or(z.literal('')).default(''),
  searchPaths: z.array(z.object({ environment: z.string().min(1), path: strings }).strict()).default([]),
  dependency: id.optional(), dependencies: z.array(id).default([]),
  invocation: z.enum(['shell', 'plugin', 'python', 'provider']).default('shell'), provider: id.optional(),
  probe: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('command') }).strict(),
    z.object({ kind: z.literal('identity') }).strict(),
    z.object({ kind: z.literal('python-module'), module: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_.]*$/), distribution: z.string().min(1) }).strict(),
    z.object({ kind: z.literal('json-plugin'), name: z.string().min(1) }).strict(),
  ]).default({ kind: 'command' }),
  guide: z.string().max(16384).default(''), skills: strings.default([]),
}).strict().superRefine((tool, ctx) => {
  if (['python-module', 'json-plugin'].includes(tool.probe.kind) && !tool.dependency)
    ctx.addIssue({ code: 'custom', message: 'Module/plugin probes require a runtime dependency' })
  if (tool.invocation === 'provider' && !tool.provider)
    ctx.addIssue({ code: 'custom', message: 'Provider tools require a provider ID' })
  if (tool.invocation !== 'provider' && !tool.commands.length && !tool.dependency)
    ctx.addIssue({ code: 'custom', message: 'Executable tools require commands or a runtime dependency' })
})
const collection = z.object({ id, label: z.string().min(1).max(200), toolIds: z.array(id).max(1000) }).strict()
const pack = z.object({ version: z.literal(1), id, label: z.string().min(1).max(200),
  tools: z.array(definition).max(1000), collections: z.array(collection).max(1000).default([]) }).strict()
/** Shareable definition; it never records an installation or a measured status. */
export type ToolDefinition = z.infer<typeof definition>
/** Versioned import/export format. Dependencies may refer to other registered packs. */
export type ToolPack = z.infer<typeof pack>
/** Validate untrusted pack fields; cross-pack references are checked when resolving the catalog.
 * @param input - parsed JSON data.
 * @returns normalized definition pack.
 */
export function parseToolPack(input: unknown): ToolPack {
  const value = pack.parse(input)
  for (const items of [value.tools, value.collections]) {
    if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Duplicate identity in tool pack')
  }
  return value
}
/** Order the selected tools and all dependencies, rejecting missing references and cycles.
 * @param tools - complete catalog snapshot.
 * @param ids - selected identities; omission selects all tools.
 * @returns dependencies before their consumers.
 */
export function orderTools(tools: readonly ToolDefinition[], ids: readonly string[] = tools.map(tool => tool.id)): ToolDefinition[] {
  const index = new Map(tools.map(tool => [tool.id, tool]))
  const visiting = new Set<string>(), visited = new Set<string>(), result: ToolDefinition[] = []
  const visit = (id: string) => {
    if (visited.has(id)) return
    if (visiting.has(id)) throw new Error('Tool dependency cycle: ' + id)
    const tool = index.get(id)
    if (!tool) throw new Error('Unknown tool reference: ' + id)
    visiting.add(id)
    for (const parent of [...tool.dependencies, ...(tool.dependency ? [tool.dependency] : [])]) visit(parent)
    visiting.delete(id); visited.add(id); result.push(tool)
  }
  for (const id of ids) visit(id)
  return result
}
/** User preferences affect discovery, never execution authority. */
export const toolPreferencesSchema = z.object({ toolIds: z.array(id).max(100), tags: strings,
  collectionIds: z.array(id).max(100) }).strict()
/** Transient preferences copied to a delegated session at creation. */
export type ToolPreferences = z.infer<typeof toolPreferencesSchema>
/** Filter catalog data without executing probes or loading full guides.
 * @param tools - current definitions.
 * @param collections - registered tool collections.
 * @param query - optional text, tags and explicit selections.
 * @returns matching definitions in catalog order.
 */
export function discoverTools(tools: readonly ToolDefinition[], collections: ToolPack['collections'], query: {
  query?: string
  tags?: readonly string[] | undefined
  toolIds?: readonly string[]
  collectionIds?: readonly string[] | undefined
}): ToolDefinition[] {
  const selected = new Set(query.toolIds ?? [])
  for (const id of query.collectionIds ?? []) {
    const collection = collections.find(item => item.id === id)
    if (!collection) throw new Error('Unknown collection: ' + id)
    for (const tool of collection.toolIds) selected.add(tool)
  }
  for (const id of selected) if (!tools.some(tool => tool.id === id)) throw new Error('Unknown tool: ' + id)
  const words = query.query?.toLowerCase().trim().split(/\s+/).filter(Boolean) ?? []
  return tools.filter(tool => (!selected.size || selected.has(tool.id))
    && (!query.tags?.length || query.tags.some(tag => tool.tags.includes(tag)))
    && (!words.length || words.some(word => [tool.id, tool.label, tool.description, ...tool.tags].join(' ').toLowerCase().includes(word))))
}

/** Validate one operator-edited definition with catalog defaults.
 * @param input - untrusted definition fields.
 * @returns normalized executable or provider definition.
 */
export function parseToolDefinition(input: unknown): ToolDefinition { return definition.parse(input) }
