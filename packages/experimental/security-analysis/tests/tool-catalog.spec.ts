/** Definition packs validate references before mutation and refresh without a restart. @module */
import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolCatalog } from '../src/tool-catalog.ts'
import { discoverTools, orderTools, parseToolPack } from '../src/tool-definitions.ts'
import { probeArguments, probeIdentity } from '../src/tool-probes.ts'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-catalog-')); roots.push(root)
  const path = join(root, 'packs.json')
  return { path, store: new ToolCatalog(path) }
}
const input = JSON.stringify({ version: 1, id: 'example', label: 'Example', tools: [
  { id: 'custom-cli', label: 'Custom CLI', commands: ['custom-cli'], tags: ['custom-domain'] },
  { id: 'custom-module', label: 'Module', dependency: 'python', invocation: 'python',
    probe: { kind: 'python-module', module: 'example_module', distribution: 'example-dist' } },
], collections: [{ id: 'custom-domain', label: 'Custom domain', toolIds: ['custom-cli', 'custom-module'] }] })
it('previews, imports and reloads custom CLI and module definitions without executing them', () => {
  const { store, path } = fixture(), preview = store.preview(input)
  expect(preview.conflicts).toEqual([])
  const captured = store.read()
  store.import(input, preview.revision, false)
  const current = new ToolCatalog(path).read()
  expect(captured.tools.some(tool => tool.id === 'custom-cli')).toBe(false)
  expect(discoverTools(current.tools, current.collections, { tags: ['custom-domain'] }).map(tool => tool.id)).toEqual(['custom-cli'])
  expect(discoverTools(current.tools, current.collections, { collectionIds: ['custom-domain'] })).toHaveLength(2)
  expect(orderTools(current.tools, ['custom-module']).map(tool => tool.id)).toEqual(['python', 'custom-module'])
  const module = current.tools.find(tool => tool.id === 'custom-module')!
  expect(probeArguments(module)[1]).toContain('example_module')
  expect(probeArguments(module)[1]).toContain('example-dist')
  expect(probeIdentity(module, '{"version":"1","location":"module.py"}')).toEqual({ version: '1', location: 'module.py' })
  expect(readFileSync(path, 'utf8')).not.toContain('checkedAt')
})
it('requires explicit replacement and rejects stale revisions without changing the file', () => {
  const { store, path } = fixture(), before = store.preview(input)
  store.import(input, before.revision, false)
  const saved = readFileSync(path, 'utf8'), preview = store.preview(input)
  expect(preview.conflicts).toContain('tool:custom-cli')
  expect(() => store.import(input, preview.revision, false)).toThrow('confirm replacement')
  expect(() => store.import(input, before.revision, true)).toThrow('changed')
  expect(readFileSync(path, 'utf8')).toBe(saved)
  expect(store.import(input, preview.revision, true).tools.filter(tool => tool.id === 'custom-cli')).toHaveLength(1)
})
it('rejects unknown fields, duplicate IDs, missing references and dependency cycles before saving', () => {
  const { store } = fixture()
  expect(() => parseToolPack({ ...JSON.parse(input), version: 2 })).toThrow()
  expect(() => parseToolPack({ ...JSON.parse(input), install: 'run' })).toThrow()
  expect(() => parseToolPack({ ...JSON.parse(input), tools: [{ id: 'x', label: 'x', commands: ['x'] }, { id: 'x', label: 'x', commands: ['x'] }] })).toThrow('Duplicate')
  for (const tools of [
    [{ id: 'a', label: 'A', dependency: 'absent' }],
    [{ id: 'a', label: 'A', dependency: 'b' }, { id: 'b', label: 'B', dependency: 'a' }],
  ]) expect(() => store.preview(JSON.stringify({ version: 1, id: 'invalid', label: 'Invalid', tools }))).toThrow()
  expect(() => store.preview(JSON.stringify({ version: 1, id: 'invalid', label: 'Invalid', tools: [], collections: [{ id: 'a', label: 'A', toolIds: ['absent'] }] }))).toThrow('Unknown tool')
  expect(() => new ToolCatalog().import(input, store.read().revision, false)).toThrow('read-only')
})
it('orders multi-level prerequisites once and synthesizes legacy custom definitions', () => {
  const { store } = fixture()
  const catalog = store.read([{ id: 'legacy-tool', command: '/private/tool', versionArgs: ['-v'], source: 'Legacy' }])
  expect(catalog.tools.find(tool => tool.id === 'legacy-tool')?.commands).toEqual(['legacy-tool'])
  expect(JSON.stringify(catalog.packs)).not.toContain('/private/tool')
  const pack = parseToolPack({ version: 1, id: 'chain', label: 'Chain', tools: [
    { id: 'leaf', label: 'leaf', commands: ['leaf'], dependencies: ['middle', 'root'] },
    { id: 'middle', label: 'middle', commands: ['middle'], dependencies: ['root'] },
    { id: 'root', label: 'root', commands: ['root'] },
  ] })
  expect(orderTools(pack.tools, ['leaf']).map(tool => tool.id)).toEqual(['root', 'middle', 'leaf'])
})
